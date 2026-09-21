import { ACTIVE_DOWNSAMPLER } from './downscale';
import { addColorTally, isTransparentAlpha } from '../lib/pattern-utils';
import { ACTIVE_MATCHER, paletteToOklab } from './color-match';
import { reduceColors } from './reduce';
import type { ColorTally, PaletteColor, Palette, Pattern, SourcePixels } from '../types';

export interface GeneratedPattern {
    pattern: Pattern;
    tallies: Record<string, ColorTally>;
    beadCount: number;
}

export interface GenerateOptions {
    /** Bead-grid size, from calculateDimensions. The source arrives larger than this. */
    gridWidth: number;
    gridHeight: number;
    /** SET-4's maximum distinct colors. Defaults to the whole palette. */
    colorLimit?: number;
    /** Phase A near-duplicate threshold (D17); 0 disables it. */
    mergeFloor?: number;
}

/** Empty cells carry this instead of a palette index. */
const EMPTY = -1;

/**
 * The GEN-6 boundary: pixels in, Pattern out. Deliberately DOM-free so it stays
 * testable in bare Node (NFR-4); decoding the image is rasterize.ts's job.
 *
 * Three steps, in this order and not another:
 *   1. ACTIVE_DOWNSAMPLER summarizes the source pixels covering each bead cell,
 *      in linear light (GEN-4). The source is *larger* than the bead grid --
 *      rasterize.ts hands over an intermediate-resolution buffer, because the
 *      averaging is ours to do where it can be tested. Both strategies return
 *      the same shape, so D18's lineart handling is one identifier in
 *      downscale.ts and no branch here.
 *   2. ACTIVE_MATCHER maps each averaged colour to a palette entry (GEN-2).
 *      Swapping algorithms is one identifier in color-match.ts and nothing here
 *      or above, which is GEN-6's Check.
 *   3. reduceColors merges colours down to the limit (GEN-3, D17).
 *
 * Averaged colours stay linear from step 1 into step 2: re-encoding to bytes in
 * between is exactly the round trip that would darken every blend. Reduction
 * runs after matching, over palette indices, so it is a few hundred operations
 * on the colour set rather than anything per cell.
 *
 * The matcher is built per call rather than per cell -- 221 palette conversions
 * per generate, microseconds, against 11M if it were built inside the loop. It
 * is deliberately not hoisted to palette-load time in main.ts, because that
 * would put the algorithm choice outside the pipeline and break the property
 * GEN-6 asks for.
 *
 * Cells are row-major and `null` where coverage fell below the alpha threshold
 * the app has always used. Tallies accumulate in that same row-major order,
 * which is what decides how equal counts break ties once the inventory is
 * sorted -- do not reorder the final loop.
 */
export function generatePattern(
    source: SourcePixels,
    palette: Palette,
    options: GenerateOptions
): GeneratedPattern {
    const { gridWidth, gridHeight, colorLimit, mergeFloor } = options;
    const cellCount = gridWidth * gridHeight;

    const averaged = ACTIVE_DOWNSAMPLER(source, gridWidth, gridHeight);
    const matcher = ACTIVE_MATCHER(palette);

    const matched = new Int32Array(cellCount);
    const usedCounts = new Map<number, number>();
    let beadCount = 0;

    for (let cell = 0; cell < cellCount; cell += 1) {
        if (isTransparentAlpha(averaged.alpha[cell] * 255)) {
            matched[cell] = EMPTY;
            continue;
        }

        const base = cell * 3;
        const index = matcher.match(
            averaged.linear[base],
            averaged.linear[base + 1],
            averaged.linear[base + 2]
        );

        matched[cell] = index;
        usedCounts.set(index, (usedCounts.get(index) ?? 0) + 1);
        beadCount++;
    }

    const remap = reduceColors(usedCounts, paletteToOklab(palette), {
        limit: colorLimit ?? palette.length,
        mergeFloor
    });

    // One row-major pass to apply the remap and build the inventory, so first
    // appearance -- and therefore the sort tie-break -- is measured on the
    // colours that actually ship, not the ones that were merged away.
    const cells: (PaletteColor | null)[] = [];
    const tallies: Record<string, ColorTally> = {};

    for (let cell = 0; cell < cellCount; cell += 1) {
        const index = matched[cell];
        if (index === EMPTY) {
            cells.push(null);
            continue;
        }

        const color = palette[remap.get(index) ?? index];
        addColorTally(tallies, color);
        cells.push(color);
    }

    return {
        pattern: { width: gridWidth, height: gridHeight, cells },
        tallies,
        beadCount
    };
}
