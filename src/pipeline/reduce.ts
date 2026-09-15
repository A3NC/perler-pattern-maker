import { oklabDistance } from '../lib/oklab';

/**
 * GEN-3: bring the pattern down to the SET-4 color limit, and collapse
 * near-duplicate colors while we are at it. Decision D17.
 *
 * Not frequency ranking. Keeping the most-used colors protects exactly the wrong
 * ones: a white canvas's four near-whites are all frequent, so all four survive
 * -- which is R2's stated failure -- while the forty beads that make up a dog's
 * eyes rank far down and get dropped, which is R4's. Ranking by
 * `count x perceptual distance to the nearest survivor` inverts both: a color
 * with a near-identical neighbour is cheap to lose however common it is, and a
 * color with no neighbour is expensive to lose however rare.
 *
 * Two phases, because they answer different questions:
 *   - Phase A collapses colors closer than MERGE_FLOOR regardless of the limit.
 *     Reduction that only fires at the limit never runs on flat artwork, which
 *     usually lands under 30 colors -- so R2's speckle would survive untouched.
 *   - Phase B enforces the limit.
 * MERGE_FLOOR = 0 disables Phase A, leaving pure limit-based reduction.
 *
 * Every argmin breaks ties on the lower palette index, so the result is a
 * function of the input alone (GEN-7).
 *
 * Pure and DOM-free (NFR-4). k is the number of *used* colors, at most the
 * palette size, so the naive recompute below is ~10M operations worst case --
 * single-digit milliseconds, and not worth a heap.
 */

/**
 * Below this OkLab distance two colors are treated as the same bead. A judgment
 * call, not a measurement -- the same species as MIN_CODE_FONT_PX (M1) and the
 * guide pitch thresholds (M10) -- calibrated against R1, R2 and R6.
 */
export const DEFAULT_MERGE_FLOOR = 0.02;

export interface ReduceOptions {
    /** SET-4's maximum distinct colors. */
    limit: number;
    /** Phase A threshold; 0 disables it. */
    mergeFloor?: number;
}

/** For each survivor, the nearest other survivor and the distance to it. */
function nearestWithin(survivors: number[], lab: Float64Array): { target: number[]; distance: number[] } {
    const n = survivors.length;
    const target = new Array<number>(n).fill(-1);
    const distance = new Array<number>(n).fill(Infinity);

    for (let p = 0; p < n; p += 1) {
        const i = survivors[p] * 3;
        for (let q = 0; q < n; q += 1) {
            if (q === p) continue;
            const j = survivors[q] * 3;
            const d = oklabDistance(lab[i], lab[i + 1], lab[i + 2], lab[j], lab[j + 1], lab[j + 2]);
            // Strict <, over a list held in ascending palette order, keeps the
            // lowest index on a tie.
            if (d < distance[p]) {
                distance[p] = d;
                target[p] = survivors[q];
            }
        }
    }

    return { target, distance };
}

/**
 * Maps every used palette index to the index it should be drawn as. Survivors
 * map to themselves, so the caller can look up unconditionally.
 */
export function reduceColors(
    usedCounts: ReadonlyMap<number, number>,
    lab: Float64Array,
    options: ReduceOptions
): Map<number, number> {
    const limit = Math.max(1, Math.floor(options.limit));
    const mergeFloor = Math.max(0, options.mergeFloor ?? DEFAULT_MERGE_FLOOR);

    // Ascending order is what makes every tie-break below deterministic.
    const survivors = [...usedCounts.keys()].sort((a, b) => a - b);
    const counts = new Map(usedCounts);
    const mergedInto = new Map<number, number>();

    const absorb = (removed: number, keeper: number): void => {
        counts.set(keeper, (counts.get(keeper) ?? 0) + (counts.get(removed) ?? 0));
        mergedInto.set(removed, keeper);
        survivors.splice(survivors.indexOf(removed), 1);
    };

    // Phase A -- collapse near-duplicates, limit or no limit.
    while (mergeFloor > 0 && survivors.length > 1) {
        const { target, distance } = nearestWithin(survivors, lab);

        let best = 0;
        for (let p = 1; p < survivors.length; p += 1) {
            if (distance[p] < distance[best]) best = p;
        }
        if (distance[best] >= mergeFloor) break;

        // Of the two, drop the rarer; on equal counts drop the higher index.
        const a = survivors[best];
        const b = target[best];
        const countA = counts.get(a) ?? 0;
        const countB = counts.get(b) ?? 0;
        const removed = countA < countB || (countA === countB && a > b) ? a : b;
        absorb(removed, removed === a ? b : a);
    }

    // Phase B -- enforce the limit, cheapest loss first.
    while (survivors.length > limit && survivors.length > 1) {
        const { target, distance } = nearestWithin(survivors, lab);

        let best = 0;
        let bestCost = (counts.get(survivors[0]) ?? 0) * distance[0];
        for (let p = 1; p < survivors.length; p += 1) {
            const cost = (counts.get(survivors[p]) ?? 0) * distance[p];
            if (cost < bestCost) {
                bestCost = cost;
                best = p;
            }
        }

        absorb(survivors[best], target[best]);
    }

    // Path-compress: a merged into b, b later into c, must resolve a -> c.
    const resolved = new Map<number, number>();
    for (const index of usedCounts.keys()) {
        let current = index;
        while (mergedInto.has(current)) {
            current = mergedInto.get(current) as number;
        }
        resolved.set(index, current);
    }

    return resolved;
}
