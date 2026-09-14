// Guide geometry for the canvas pattern view: gridlines every N cells (VIEW-6)
// and the edge rulers that number them (VIEW-7). Dependency-free and DOM-free so
// it stays testable in bare Node (NFR-4) -- every canvas call site lives in
// src/render/canvas-view.ts.
//
// All lengths are CSS pixels, the same contract src/lib/viewport.ts holds to;
// devicePixelRatio is applied once at the context and never reaches this module.
//
// M6's PNG export is the intended second consumer (D16), which is why this is a
// module rather than a few lines inlined into the draw loop.

import type { CellRange } from './viewport';

/** Cells between gridlines (VIEW-6). Counting beads in tens is the whole point. */
export const GRID_INTERVAL = 10;

/**
 * Below this on-screen gap between neighbouring gridlines, the grid stops being
 * structure and becomes texture over the beads.
 */
const MIN_GRIDLINE_PITCH_PX = 14;

/** Smallest gap between two ruler labels that keeps them from running together. */
const MIN_LABEL_PITCH_PX = 34;

/** Label steps step through 1-2-5 per decade, so they read 10, 20, 50, 100 ... */
const LABEL_LADDER = [1, 2, 5];

/** How far the ladder is allowed to climb before giving up. */
const MAX_LABEL_DECADES = 5;

/**
 * Whether gridlines are worth drawing at this zoom. The test is on the *pitch*
 * between lines, not on cell size: an interval of 10 tiny cells can still be a
 * perfectly legible gap, which is exactly the zoomed-out case where a grid helps
 * most. (Contrast shouldDrawCodes, which tests the cell, because code text has
 * to fit inside one.)
 */
export function shouldDrawGridlines(cellSize: number, interval = GRID_INTERVAL): boolean {
    if (cellSize <= 0 || interval <= 0) return false;
    return cellSize * interval >= MIN_GRIDLINE_PITCH_PX;
}

/**
 * The gridline positions crossing a visible range, as *boundary* indices: index
 * b is the edge between cell b-1 and cell b, so b runs one past the last visible
 * cell. Consumes the CellRange visibleCellRange already returns.
 *
 * Boundary 0 (the pattern's own leading edge) is included when visible, the way
 * graph paper has a line at the origin.
 */
export function gridlineIndices(range: CellRange, interval = GRID_INTERVAL): number[] {
    // end < start is visibleCellRange's "nothing visible", which must not fall
    // through to the loop below and emit a line at boundary 0.
    if (interval <= 0 || range.end < range.start) return [];

    const indices: number[] = [];
    const last = range.end + 1;
    for (let b = Math.ceil(range.start / interval) * interval; b <= last; b += interval) {
        indices.push(b);
    }
    return indices;
}

/**
 * How many cells apart ruler labels should sit. Labels are fixed-size chrome, so
 * unlike bead codes they do not shrink with zoom -- they collide instead. Thin
 * them to every 20th, 50th, 100th ... cell rather than letting them overlap.
 */
export function rulerLabelStep(cellSize: number, interval = GRID_INTERVAL): number {
    if (cellSize <= 0 || interval <= 0) return interval;

    let magnitude = 1;
    for (let decade = 0; decade <= MAX_LABEL_DECADES; decade++) {
        for (const rung of LABEL_LADDER) {
            const step = interval * rung * magnitude;
            if (step * cellSize >= MIN_LABEL_PITCH_PX) return step;
        }
        magnitude *= 10;
    }
    return interval * magnitude;
}

/**
 * Whether one axis gets a ruler: only when the pattern overflows the viewport
 * along it. You cannot lose your place in a pattern you can see all of, and the
 * label strip costs some occluded beads -- so it earns its place exactly when
 * there is something to scroll. Per-axis, so a wide short pattern gets a column
 * ruler and no row ruler.
 */
export function shouldDrawRuler(patternExtentPx: number, viewportLengthPx: number): boolean {
    return patternExtentPx > viewportLengthPx;
}
