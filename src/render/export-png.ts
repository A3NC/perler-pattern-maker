import { getContrastColor } from '../contrast';
import {
    EXPORT_LABEL_FONT_PX,
    EXPORT_LABEL_PADDING_PX,
    exportBoundaryPx,
    exportCellRect,
    exportFileName,
    exportLayout,
    widestExportLabel
} from '../lib/export-layout';
import type { ExportLayout } from '../lib/export-layout';
import type { Pattern } from '../types';
import { GRID_RULE_DARK, GRID_RULE_LIGHT, RULER_TEXT } from './guide-style';

// The PNG export (OUT-1 … OUT-3, D22). Holds no decisions: the geometry is
// src/lib/export-layout.ts, and this module only measures text, draws what the
// layout says, encodes, and downloads.
//
// Nothing from the on-screen view reaches it -- not the zoom, the scroll, the
// devicePixelRatio, or the Show Codes and Grid checkboxes. One image pixel is
// one canvas pixel, with no transform, and that is what makes two exports of the
// same pattern the same file (OUT-3).

/** Opaque, so empty cells read as paper rather than a viewer's checkerboard. */
const BACKGROUND = '#FFFFFF';

/** How long the download's object URL is kept alive after the click. */
const REVOKE_DELAY_MS = 10_000;

/** A failed export, with a machine-readable reason so callers need not match strings. */
export class ExportError extends Error {
    readonly reason: 'too-large' | 'illegible' | 'no-context' | 'encode-failed';

    constructor(reason: ExportError['reason'], message: string) {
        super(message);
        this.name = 'ExportError';
        this.reason = reason;
    }
}

function codeFont(px: number): string {
    return `bold ${px}px monospace`;
}

function widestCodeIn(pattern: Pattern): string {
    let widest = '';
    for (const cell of pattern.cells) {
        if (cell && cell.name.length > widest.length) widest = cell.name;
    }
    return widest;
}

/** Render the pattern to a PNG and download it. */
export async function exportPatternPng(pattern: Pattern): Promise<void> {
    // Detached: never inserted into the document, so no CSS size, no layout,
    // and no devicePixelRatio. A plain canvas rather than OffscreenCanvas,
    // whose 2D context older Safari lacks; nothing here runs off-thread.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new ExportError('no-context', 'This browser could not provide a canvas to draw the export.');
    }

    try {
        const result = exportLayout(pattern.width, pattern.height, measure(ctx, pattern));
        if (!result.ok) throw new ExportError(result.reason, result.message);
        const layout = result.layout;

        // Resizing resets the context, so everything is set up after this.
        canvas.width = layout.width;
        canvas.height = layout.height;

        draw(ctx, pattern, layout);
        const blob = await encodePng(canvas);
        download(blob, exportFileName(pattern.width, pattern.height));
    } finally {
        // iOS counts canvas memory against the tab until the element is
        // collected; at the pixel budget that is ~64 MB held for nothing.
        canvas.width = 0;
        canvas.height = 0;
    }
}

/** The two text widths the layout needs and cannot measure for itself. */
function measure(ctx: CanvasRenderingContext2D, pattern: Pattern) {
    // Measured at a large size and scaled down: text width scales linearly
    // with font size, and a 1 px measurement is mostly rounding.
    const probePx = 100;
    ctx.font = codeFont(probePx);
    const widestCode = widestCodeIn(pattern);
    const codeWidthPerFontPx = widestCode ? ctx.measureText(widestCode).width / probePx : 0;

    ctx.font = codeFont(EXPORT_LABEL_FONT_PX);
    const labelWidthPx = ctx.measureText(widestExportLabel(pattern.width, pattern.height)).width;

    return { codeWidthPerFontPx, labelWidthPx };
}

function draw(ctx: CanvasRenderingContext2D, pattern: Pattern, layout: ExportLayout): void {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, layout.width, layout.height);

    drawCells(ctx, pattern, layout);
    drawGridlines(ctx, pattern, layout);
    drawFrame(ctx, pattern, layout);
    drawLabels(ctx, pattern, layout);
}

/**
 * Every non-empty cell and its code (OUT-1). No Math.round anywhere: the layout
 * hands back integer rects, and if one ever needed rounding the layout would be
 * wrong. Empty cells are left as background with no code -- a white bead is
 * still told apart from a hole, because it carries its code.
 */
function drawCells(ctx: CanvasRenderingContext2D, pattern: Pattern, layout: ExportLayout): void {
    ctx.font = codeFont(layout.codeFontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < pattern.height; row++) {
        for (let col = 0; col < pattern.width; col++) {
            const cell = pattern.cells[(row * pattern.width) + col];
            if (!cell) continue;

            const { x, y, size } = exportCellRect(col, row, layout);
            const [r, g, b] = cell.rgb;
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x, y, size, size);

            // Every cell, whatever the view's Show Codes checkbox says: OUT-1
            // asks for a code on every cell, and a file should not depend on a
            // setting the user may have forgotten.
            ctx.fillStyle = getContrastColor(r, g, b);
            ctx.fillText(cell.name, x + (size / 2), y + (size / 2));
        }
    }
}

/**
 * Interior gridlines every GRID_INTERVAL, as the view's dark/light double rule
 * so a line reads against any bead. fillRect rather than stroke, for the same
 * reason the view gives: a filled rect lands on the pixel grid by construction.
 */
function drawGridlines(ctx: CanvasRenderingContext2D, pattern: Pattern, layout: ExportLayout): void {
    const { cellSize, marginX, marginY } = layout;
    const cellsWidth = pattern.width * cellSize;
    const cellsHeight = pattern.height * cellSize;
    const xs = layout.gridlines.cols.map((b) => exportBoundaryPx(b, marginX, cellSize));
    const ys = layout.gridlines.rows.map((b) => exportBoundaryPx(b, marginY, cellSize));

    ctx.fillStyle = GRID_RULE_DARK;
    for (const x of xs) ctx.fillRect(x, marginY, 1, cellsHeight);
    for (const y of ys) ctx.fillRect(marginX, y, cellsWidth, 1);

    ctx.fillStyle = GRID_RULE_LIGHT;
    for (const x of xs) ctx.fillRect(x + 1, marginY, 1, cellsHeight);
    for (const y of ys) ctx.fillRect(marginX, y + 1, cellsWidth, 1);
}

/**
 * A one-pixel rule just *outside* the cells on all four sides. Against a white
 * background an unframed pattern has no visible edge where its outer beads are
 * white; drawn outside, it covers no bead.
 */
function drawFrame(ctx: CanvasRenderingContext2D, pattern: Pattern, layout: ExportLayout): void {
    const { cellSize, marginX, marginY } = layout;
    const cellsWidth = pattern.width * cellSize;
    const cellsHeight = pattern.height * cellSize;

    ctx.fillStyle = GRID_RULE_DARK;
    ctx.fillRect(marginX - 1, marginY - 1, cellsWidth + 2, 1);
    ctx.fillRect(marginX - 1, marginY + cellsHeight, cellsWidth + 2, 1);
    ctx.fillRect(marginX - 1, marginY, 1, cellsHeight);
    ctx.fillRect(marginX + cellsWidth, marginY, 1, cellsHeight);
}

/**
 * Column numbers across the top, row numbers down the left, in the margins
 * outside the cells (D22). The view's rulers can sit over beads because it pans;
 * a file cannot, so here a label over a cell would hide that cell's code for
 * good. Each number trails a short tick at its boundary, the way the view's
 * labels trail their rule.
 */
function drawLabels(ctx: CanvasRenderingContext2D, pattern: Pattern, layout: ExportLayout): void {
    const { cellSize, marginX, marginY } = layout;
    const tick = EXPORT_LABEL_PADDING_PX;

    ctx.font = codeFont(EXPORT_LABEL_FONT_PX);
    ctx.textBaseline = 'middle';

    ctx.fillStyle = GRID_RULE_DARK;
    for (const b of layout.labels.cols) {
        ctx.fillRect(exportBoundaryPx(b, marginX, cellSize), marginY - tick, 1, tick);
    }
    for (const b of layout.labels.rows) {
        ctx.fillRect(marginX - tick, exportBoundaryPx(b, marginY, cellSize), tick, 1);
    }

    ctx.fillStyle = RULER_TEXT;
    ctx.textAlign = 'left';
    for (const b of layout.labels.cols) {
        const x = exportBoundaryPx(b, marginX, cellSize);
        ctx.fillText(String(b), x + EXPORT_LABEL_PADDING_PX, marginY / 2);
    }

    ctx.textAlign = 'right';
    for (const b of layout.labels.rows) {
        const y = exportBoundaryPx(b, marginY, cellSize);
        // Just below its boundary, mirroring a column number just right of its own.
        ctx.fillText(String(b), marginX - EXPORT_LABEL_PADDING_PX, y + (EXPORT_LABEL_FONT_PX / 2));
    }
}

/**
 * A null blob is the silent failure M6's step 1 is about: an over-large canvas
 * does not throw, it encodes to nothing. Treated as an error with its own
 * reason, never as "nothing to do".
 */
function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new ExportError(
                    'encode-failed',
                    'The browser could not encode the pattern as a PNG. It may be too large for this device.'
                ));
            }
        }, 'image/png');
    });
}

/**
 * An object URL, not a data URL -- the same reasoning upload.ts records: a data
 * URL base64-encodes the whole file into a string held live in memory.
 */
function download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Deferred, and generously: revoking before the browser has started
    // reading the blob cancels the download in some browsers, and nothing
    // reports when it has. Holding the blob a few seconds longer costs nothing.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
