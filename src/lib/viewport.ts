// Viewport math for the canvas pattern view: zoom limits, the center-fixed
// scroll offset, and the visible cell range. Dependency-free and DOM-free so it
// stays testable in bare Node (NFR-4) -- every canvas and element call site
// lives in src/render/canvas-view.ts.
//
// All lengths are CSS pixels. Device pixel ratio is applied once at the context
// in step 6 and deliberately never reaches this module.

/** Multiplicative change per zoom click. */
export const ZOOM_STEP = 1.25;

/**
 * VIEW-2's readable ceiling: cell size at maximum zoom. Two zoom clicks above
 * the original 30px, which was tight for inspecting an individual bead.
 *
 * Raising this is cheap only because the canvas is sized to the container
 * rather than the pattern (D1, settled at step 2 of M1): the ceiling now costs
 * spacer width, not backing-store memory, and a frame gets *cheaper* as cells
 * grow, since fewer of them fit on screen. Under the pattern-sized canvas this
 * replaced, the same change would have multiplied canvas area by 2.4.
 */
export const MAX_CELL_SIZE_PX = 30 * ZOOM_STEP ** 2;

/**
 * Absolute floor for a cell. Only binds on patterns too large to fit even one
 * pixel per cell in the container; the usual zoom-out floor is fitCellSize.
 */
export const MIN_CELL_SIZE_PX = 1;

/** Code text height, as a fraction of the cell. 1/3 is the old grid's 10px in 30px. */
export const CODE_FONT_RATIO = 1 / 3;

/**
 * The smallest code font still worth drawing, in CSS px. Below this, bold
 * monospace glyphs are a smudge rather than a code, and drawing them costs a
 * fillText per cell to make the pattern harder to read.
 *
 * Calibrated by eye at 1x, where a HiDPI display upscales the canvas and text
 * looks worse than it will once step 6 scales the backing store by
 * devicePixelRatio -- so this is biased toward hiding codes too eagerly and is
 * due a re-check after that lands.
 */
const MIN_CODE_FONT_PX = 6;

/**
 * VIEW-5's legibility threshold: cells smaller than this are drawn as color
 * only. Derived from the font floor rather than chosen separately, so changing
 * CODE_FONT_RATIO cannot leave the two silently disagreeing.
 */
export const MIN_CODE_CELL_SIZE_PX = MIN_CODE_FONT_PX / CODE_FONT_RATIO;

/** Inclusive cell index range. `end < start` means nothing is visible. */
export interface CellRange {
    start: number;
    end: number;
}

/** A cell address in the pattern. */
export interface CellPosition {
    col: number;
    row: number;
}

/**
 * Everything cellAtClientPoint needs to place a screen point in the pattern.
 * `canvasLeft`/`canvasTop` are the canvas's client-space corner -- structurally
 * the two fields of a DOMRect this module cares about, deliberately not the
 * type itself, so the mapping stays DOM-free and testable in Node.
 */
export interface CellLookup {
    clientX: number;
    clientY: number;
    canvasLeft: number;
    canvasTop: number;
    scrollLeft: number;
    scrollTop: number;
    cellSize: number;
    patternWidth: number;
    patternHeight: number;
}

export function clampCellSize(
    cellSize: number,
    minCellSize = MIN_CELL_SIZE_PX,
    maxCellSize = MAX_CELL_SIZE_PX
): number {
    if (!Number.isFinite(cellSize)) return minCellSize;
    return Math.min(Math.max(cellSize, minCellSize), maxCellSize);
}

/**
 * Whether cells are large enough for their codes to be readable (VIEW-5).
 *
 * This is only the size half of the condition: the user's toggle (VIEW-3) is
 * the other, and the two are independent -- a pattern zoomed out past this
 * threshold draws no text but must leave the checkbox exactly as the user set
 * it, so that zooming back in restores the codes.
 */
export function shouldDrawCodes(cellSize: number): boolean {
    return cellSize >= MIN_CODE_CELL_SIZE_PX;
}

/**
 * The largest cell size at which the whole pattern still fits the container --
 * VIEW-2's minimum zoom. Derived rather than hardcoded so a 300-wide pattern
 * can zoom out further than a 20-wide one.
 */
export function fitCellSize(
    patternWidth: number,
    patternHeight: number,
    containerWidth: number,
    containerHeight: number
): number {
    if (patternWidth <= 0 || patternHeight <= 0) return MAX_CELL_SIZE_PX;
    return clampCellSize(Math.min(containerWidth / patternWidth, containerHeight / patternHeight));
}

function clampScrollOffset(
    scrollOffset: number,
    viewportLength: number,
    cellSize: number,
    cellCount: number
): number {
    const maxOffset = Math.max(0, (cellCount * cellSize) - viewportLength);
    return Math.min(Math.max(scrollOffset, 0), maxOffset);
}

/**
 * The scroll offset, along one axis, that keeps the pattern point currently at
 * the viewport center at the viewport center after a zoom (VIEW-2). Clamped to
 * the new scroll range, so zooming out near an edge settles rather than
 * leaving dead space.
 */
export function zoomedScrollOffset(
    scrollOffset: number,
    viewportLength: number,
    cellSize: number,
    newCellSize: number,
    cellCount: number
): number {
    if (cellSize <= 0) return 0;

    const centerCell = (scrollOffset + (viewportLength / 2)) / cellSize;
    const centered = (centerCell * newCellSize) - (viewportLength / 2);
    return clampScrollOffset(centered, viewportLength, newCellSize, cellCount);
}

/**
 * The cell indices touching the viewport along one axis, partial cells at both
 * edges included. This is what keeps the canvas viewport-sized rather than
 * pattern-sized: the draw loop is bounded by container area, not cell count.
 */
export function visibleCellRange(
    scrollOffset: number,
    viewportLength: number,
    cellSize: number,
    cellCount: number
): CellRange {
    if (cellCount <= 0 || cellSize <= 0 || viewportLength <= 0) {
        return { start: 0, end: -1 };
    }

    const start = Math.max(0, Math.floor(scrollOffset / cellSize));
    const end = Math.min(cellCount - 1, Math.ceil((scrollOffset + viewportLength) / cellSize) - 1);
    return start > end ? { start: 0, end: -1 } : { start, end };
}

/**
 * The bead under a screen point, or null when the point falls outside the
 * pattern. The inverse of the draw loop's cell -> screen placement.
 *
 * The canvas is pinned to the visible corner of the scroll area, so its
 * top-left corner is always the pattern coordinate (scrollLeft, scrollTop) --
 * which is what makes this a single formula rather than a case analysis over
 * whether the pattern is larger or smaller than the container.
 *
 * M1 only needs this to exist and be correct. M5 is what consumes it: this is
 * the seam that keeps the editor a normal-sized milestone (D1).
 */
export function cellAtClientPoint(lookup: CellLookup): CellPosition | null {
    const { cellSize, patternWidth, patternHeight } = lookup;
    if (cellSize <= 0) return null;

    const patternX = (lookup.clientX - lookup.canvasLeft) + lookup.scrollLeft;
    const patternY = (lookup.clientY - lookup.canvasTop) + lookup.scrollTop;

    // Math.floor, not Math.trunc: a point just left of or above the pattern
    // must land outside it, and trunc would fold that onto cell 0.
    const col = Math.floor(patternX / cellSize);
    const row = Math.floor(patternY / cellSize);

    if (col < 0 || row < 0 || col >= patternWidth || row >= patternHeight) {
        return null;
    }
    return { col, row };
}
