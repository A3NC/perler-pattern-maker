// Geometry for the PNG export (OUT-1, OUT-3, D22): cell size, margins, the code
// font, and where the gridlines and edge numbers go. Dependency-free and
// DOM-free so it stays testable in bare Node (NFR-4) -- every canvas call lives
// in src/render/export-png.ts.
//
// The signature is the OUT-3 guarantee. A layout is a function of the pattern's
// width and height plus two text measurements, and nothing else: there is no
// parameter a zoom level, a scroll offset or a devicePixelRatio could arrive
// through, so the same pattern always lays out the same file.
//
// Every length is an integer image pixel. The on-screen view rounds both edges
// of every cell because its cell size is fractional; here the cell size is an
// integer, so every cell edge lands on a pixel by construction and neighbours
// share an edge exactly (GEN-5).

import { GRID_INTERVAL, gridlineIndices } from './guides';

/** Preferred cell size. Patterns too large for it step down; see chooseCellSize. */
export const EXPORT_CELL_PX = 32;

/**
 * Largest image area the export will produce, in pixels. iOS Safari is widely
 * reported to cap canvas area at 4096² and NFR-5 puts a phone in scope, so the
 * phone's number is the one that binds. Headless Chrome was measured at M6 up
 * to 16384² without failing, which is why this is not a per-browser value: one
 * conservative budget keeps a pattern producing the same file on every device.
 *
 * A judgment constant like MERGE_FLOOR: tests assert the budget is respected,
 * never the number.
 */
export const EXPORT_MAX_PIXELS = 4096 * 4096;

/**
 * Code height as a fraction of the cell. Larger than the view's 1/3, because
 * in the view you zoom until a code is readable, while in the file a code's
 * pixel count is fixed at export.
 */
export const EXPORT_CODE_FONT_RATIO = 0.4;

/** How much of a cell's width a code may fill before the font is shrunk to fit. */
export const EXPORT_CODE_MAX_WIDTH_RATIO = 0.86;

/**
 * The smallest code font worth exporting, in image pixels. The bar is D22's:
 * readable when the file is zoomed in on a screen, where a viewer magnifies
 * pixels, so this is a glyph-height floor rather than a physical size. Its own
 * constant, not viewport.ts's MIN_CODE_FONT_PX -- that one decides when the
 * view *hides* codes; this one decides whether a file is worth producing.
 * Judged by eye; tests assert the floor holds, never the number.
 */
const MIN_EXPORT_CODE_FONT_PX = 7;

/**
 * The smallest cell the step-down may choose. Derived from the font floor, the
 * way viewport.ts derives MIN_CODE_CELL_SIZE_PX, so the two cannot disagree.
 */
export const MIN_EXPORT_CELL_PX = Math.ceil(MIN_EXPORT_CODE_FONT_PX / EXPORT_CODE_FONT_RATIO);

/** Edge-number font, in image pixels. Fixed: the numbers label the grid, not a bead. */
export const EXPORT_LABEL_FONT_PX = 16;

/** Space between an edge number and whatever it sits beside. */
export const EXPORT_LABEL_PADDING_PX = 4;

/**
 * The two things the layout needs that only a canvas can measure. Taken as
 * arguments so this module never measures text itself.
 */
export interface ExportMeasurements {
    /** Width of the pattern's widest code at a 1 px font; 0 if every cell is empty. */
    codeWidthPerFontPx: number;
    /** Width of the widest edge number this pattern prints, at EXPORT_LABEL_FONT_PX. */
    labelWidthPx: number;
}

export interface ExportLayout {
    /** Integer px per bead. */
    cellSize: number;
    /**
     * Row-number band on the left, mirrored on the right. The right one holds
     * the overhang of a column number at the far edge.
     */
    marginX: number;
    /** Column-number band on top, mirrored below for a row number at the far edge. */
    marginY: number;
    /** The whole image, px. */
    width: number;
    height: number;
    codeFontPx: number;
    /**
     * Interior gridlines, as boundary indices (boundary b is the edge between
     * cell b-1 and cell b). The pattern's own edges are the frame, drawn
     * outside the cells, so they are not in this list.
     */
    gridlines: { cols: number[]; rows: number[] };
    /** Which boundaries get an edge number, including 0 and the far edges when on-interval. */
    labels: { cols: number[]; rows: number[] };
}

export type ExportRefusal = 'too-large' | 'illegible';

export type ExportLayoutResult =
    | { ok: true; layout: ExportLayout }
    | { ok: false; reason: ExportRefusal; message: string };

/** One cell's square, in image pixels. */
export interface ExportCellRect {
    x: number;
    y: number;
    size: number;
}

function marginsFor(labelWidthPx: number): { marginX: number; marginY: number } {
    return {
        marginX: Math.ceil(labelWidthPx) + (EXPORT_LABEL_PADDING_PX * 2),
        marginY: EXPORT_LABEL_FONT_PX + (EXPORT_LABEL_PADDING_PX * 2)
    };
}

function imageSize(
    patternWidth: number,
    patternHeight: number,
    cellSize: number,
    marginX: number,
    marginY: number
): { width: number; height: number } {
    return {
        width: (patternWidth * cellSize) + (marginX * 2),
        height: (patternHeight * cellSize) + (marginY * 2)
    };
}

/**
 * The code font for a cell size, shrunk if the widest code would spill past
 * its cell -- the view's rule, so a PAL-6 palette with long codes still fits.
 * Floored to a whole pixel: a fractional font gains nothing in a fixed file.
 */
function codeFontFor(cellSize: number, codeWidthPerFontPx: number): number {
    const preferred = cellSize * EXPORT_CODE_FONT_RATIO;
    if (codeWidthPerFontPx <= 0) return Math.floor(preferred);
    const fitted = (cellSize * EXPORT_CODE_MAX_WIDTH_RATIO) / codeWidthPerFontPx;
    return Math.floor(Math.min(preferred, fitted));
}

/**
 * The largest integer cell size, from EXPORT_CELL_PX down to the legibility
 * floor, whose image fits EXPORT_MAX_PIXELS -- or null when none does. A
 * function of the pattern's size only, so OUT-3 holds: "predictable" means the
 * same pattern always gives the same file, not that every pattern gets the same
 * cell.
 */
function chooseCellSize(
    patternWidth: number,
    patternHeight: number,
    marginX: number,
    marginY: number
): number | null {
    for (let cellSize = EXPORT_CELL_PX; cellSize >= MIN_EXPORT_CELL_PX; cellSize--) {
        const { width, height } = imageSize(patternWidth, patternHeight, cellSize, marginX, marginY);
        if (width * height <= EXPORT_MAX_PIXELS) return cellSize;
    }
    return null;
}

export function exportLayout(
    patternWidth: number,
    patternHeight: number,
    measurements: ExportMeasurements
): ExportLayoutResult {
    const { marginX, marginY } = marginsFor(measurements.labelWidthPx);

    const cellSize = chooseCellSize(patternWidth, patternHeight, marginX, marginY);
    if (cellSize === null) {
        return { ok: false, reason: 'too-large', message: exportRefusalMessage('too-large') };
    }

    const codeFontPx = codeFontFor(cellSize, measurements.codeWidthPerFontPx);
    if (codeFontPx < MIN_EXPORT_CODE_FONT_PX) {
        return { ok: false, reason: 'illegible', message: exportRefusalMessage('illegible') };
    }

    // The full range, not a visible one: the export draws every cell.
    const colBoundaries = gridlineIndices({ start: 0, end: patternWidth - 1 });
    const rowBoundaries = gridlineIndices({ start: 0, end: patternHeight - 1 });

    const { width, height } = imageSize(patternWidth, patternHeight, cellSize, marginX, marginY);

    return {
        ok: true,
        layout: {
            cellSize,
            marginX,
            marginY,
            width,
            height,
            codeFontPx,
            gridlines: {
                cols: colBoundaries.filter((b) => b > 0 && b < patternWidth),
                rows: rowBoundaries.filter((b) => b > 0 && b < patternHeight)
            },
            // Every GRID_INTERVAL, never thinned. rulerLabelStep thins by screen
            // pitch, and at a cell of MIN_EXPORT_CELL_PX or more the pitch is
            // far past where thinning would start.
            labels: { cols: colBoundaries, rows: rowBoundaries }
        }
    };
}

export function exportCellRect(col: number, row: number, layout: ExportLayout): ExportCellRect {
    return {
        x: layout.marginX + (col * layout.cellSize),
        y: layout.marginY + (row * layout.cellSize),
        size: layout.cellSize
    };
}

/** Image-pixel position of a boundary index along one axis. */
export function exportBoundaryPx(boundary: number, margin: number, cellSize: number): number {
    return margin + (boundary * cellSize);
}

/**
 * The widest number the edge labels print, for measuring labelWidthPx: the
 * largest on-interval boundary on either axis.
 */
export function widestExportLabel(patternWidth: number, patternHeight: number): string {
    const largest = Math.max(patternWidth, patternHeight);
    return String(Math.floor(largest / GRID_INTERVAL) * GRID_INTERVAL);
}

/**
 * Enough to tell two exports apart. No timestamp: two exports of the same
 * pattern should be the same file under the same name, which is also what
 * makes OUT-3's comparison easy to run.
 */
export function exportFileName(patternWidth: number, patternHeight: number): string {
    return `perler-${patternWidth}x${patternHeight}.png`;
}

/** Every user-facing export refusal, in one place, like image-file.ts's messages. */
export function exportRefusalMessage(reason: ExportRefusal): string {
    switch (reason) {
        case 'too-large':
            return 'This pattern is too large to export as one image with readable codes. '
                + 'Lower the target width or use a larger bead size, then generate again.';
        case 'illegible':
            return 'This palette\'s color codes are too long to fit legibly in an exported bead cell.';
    }
}
