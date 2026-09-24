import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    EXPORT_CELL_PX,
    EXPORT_LABEL_FONT_PX,
    EXPORT_MAX_PIXELS,
    MIN_EXPORT_CELL_PX,
    exportBoundaryPx,
    exportCellRect,
    exportFileName,
    exportLayout,
    exportRefusalMessage,
    widestExportLabel
} from './export-layout';
import type { ExportLayout, ExportMeasurements } from './export-layout';

// Bold monospace advances ~0.6 em per glyph, so a three-character code is ~1.8
// px wide per px of font, and "300" at the label font ~1.8 × 12. Stand-ins for
// what the renderer measures; the layout only has to treat them consistently.
const MONO_ADVANCE = 0.6;
function measure(widestCode: string, widestLabel: string): ExportMeasurements {
    return {
        codeWidthPerFontPx: widestCode.length * MONO_ADVANCE,
        labelWidthPx: widestLabel.length * MONO_ADVANCE * EXPORT_LABEL_FONT_PX
    };
}

function layoutOf(width: number, height: number, widestCode = 'P17'): ExportLayout {
    const result = exportLayout(width, height, measure(widestCode, widestExportLabel(width, height)));
    assert.ok(result.ok, `expected ${width} × ${height} to lay out`);
    return result.layout;
}

test('the same pattern always lays out the same file (OUT-3)', () => {
    // The signature has no parameter a zoom or dpr could arrive through; this
    // is the Check stated as a test anyway.
    assert.deepEqual(layoutOf(100, 100), layoutOf(100, 100));
    assert.deepEqual(layoutOf(300, 166), layoutOf(300, 166));
});

test('a design-target pattern gets the preferred cell size', () => {
    assert.equal(layoutOf(100, 100).cellSize, EXPORT_CELL_PX);
    assert.equal(layoutOf(1, 1).cellSize, EXPORT_CELL_PX);
});

test('every cell edge is an integer and neighbours share an edge exactly (GEN-5)', () => {
    const layout = layoutOf(37, 23);
    assert.ok(Number.isInteger(layout.cellSize));
    for (let row = 0; row < 23; row++) {
        for (let col = 0; col < 37; col++) {
            const rect = exportCellRect(col, row, layout);
            assert.ok(Number.isInteger(rect.x) && Number.isInteger(rect.y));
            if (col > 0) assert.equal(exportCellRect(col - 1, row, layout).x + rect.size, rect.x);
            if (row > 0) assert.equal(exportCellRect(col, row - 1, layout).y + rect.size, rect.y);
        }
    }
});

test('the image never exceeds the pixel budget, even at the hard limit', () => {
    // NFR-3's hard limit in its widest and squarest shapes, both orientations.
    for (const [w, h] of [[300, 166], [166, 300], [223, 223], [300, 1], [1, 300]]) {
        const layout = layoutOf(w, h);
        assert.ok(layout.width * layout.height <= EXPORT_MAX_PIXELS, `${w} × ${h}`);
    }
});

test('step-down picks the largest cell size that fits', () => {
    const layout = layoutOf(300, 166);
    assert.ok(layout.cellSize < EXPORT_CELL_PX, 'the hard limit should need stepping down');
    assert.ok(layout.cellSize >= MIN_EXPORT_CELL_PX);
    // One pixel more per cell adds one pattern-width of pixels per axis, and
    // must go over the budget -- otherwise a bigger cell was available.
    const biggerArea = (layout.width + 300) * (layout.height + 166);
    assert.ok(biggerArea > EXPORT_MAX_PIXELS);
});

test('the image is exactly the cells plus both margins on each axis', () => {
    const layout = layoutOf(40, 25);
    assert.equal(layout.width, (40 * layout.cellSize) + (2 * layout.marginX));
    assert.equal(layout.height, (25 * layout.cellSize) + (2 * layout.marginY));
});

test('no cell intrudes into a margin, so a label can never sit on a bead', () => {
    const layout = layoutOf(53, 41);
    const first = exportCellRect(0, 0, layout);
    const last = exportCellRect(52, 40, layout);
    assert.ok(first.x >= layout.marginX && first.y >= layout.marginY);
    assert.ok(last.x + last.size <= layout.width - layout.marginX);
    assert.ok(last.y + last.size <= layout.height - layout.marginY);
});

test('the left margin fits the widest row number with padding to spare', () => {
    const widest = measure('P17', widestExportLabel(300, 166)).labelWidthPx;
    const layout = layoutOf(300, 166);
    assert.ok(layout.marginX > widest);
    assert.ok(layout.marginY > EXPORT_LABEL_FONT_PX);
});

test('a pattern too large for any legible cell size is refused, not shrunk', () => {
    // 300 × 300 is past NFR-3's cell limit, so generation never produces it --
    // which is exactly why it is a safe way to exercise the refusal.
    const result = exportLayout(300, 300, measure('P17', '300'));
    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.equal(result.reason, 'too-large');
        assert.equal(result.message, exportRefusalMessage('too-large'));
    }
});

test('codes too long to fit legibly are refused with their own reason', () => {
    const result = exportLayout(10, 10, measure('ABCDEFGHIJKL', '10'));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'illegible');
});

test('the two refusals say different things', () => {
    assert.notEqual(exportRefusalMessage('too-large'), exportRefusalMessage('illegible'));
});

test('a code font fits inside its cell and grows no larger than the preferred ratio', () => {
    const layout = layoutOf(100, 100);
    assert.ok(Number.isInteger(layout.codeFontPx));
    assert.ok(layout.codeFontPx * 3 * MONO_ADVANCE < layout.cellSize);
    // Long codes shrink the font rather than spilling.
    const long = layoutOf(100, 100, 'ABCD');
    assert.ok(long.codeFontPx < layout.codeFontPx);
    assert.ok(long.codeFontPx * 4 * MONO_ADVANCE < long.cellSize);
});

test('an all-empty pattern still lays out', () => {
    const result = exportLayout(20, 20, { codeWidthPerFontPx: 0, labelWidthPx: 14 });
    assert.ok(result.ok);
});

test('interior gridlines fall every tenth boundary; the pattern edges are the frame', () => {
    const layout = layoutOf(35, 20);
    assert.deepEqual(layout.gridlines.cols, [10, 20, 30]);
    // 20 is the far edge: the frame draws it, not a gridline.
    assert.deepEqual(layout.gridlines.rows, [10]);
});

test('labels include the origin and a far edge that lands on the interval', () => {
    const layout = layoutOf(35, 20);
    assert.deepEqual(layout.labels.cols, [0, 10, 20, 30]);
    assert.deepEqual(layout.labels.rows, [0, 10, 20]);
});

test('patterns narrower than one interval lay out without degenerate lists', () => {
    const tiny = layoutOf(1, 1);
    assert.deepEqual(tiny.gridlines, { cols: [], rows: [] });
    assert.deepEqual(tiny.labels, { cols: [0], rows: [0] });
    assert.ok(tiny.marginX > 0 && tiny.marginY > 0);

    const strip = layoutOf(300, 1);
    assert.equal(strip.gridlines.cols.length, 29);
    assert.deepEqual(strip.gridlines.rows, []);
});

test('boundary positions line up with cell edges', () => {
    const layout = layoutOf(30, 30);
    assert.equal(exportBoundaryPx(10, layout.marginX, layout.cellSize), exportCellRect(10, 0, layout).x);
    assert.equal(exportBoundaryPx(0, layout.marginY, layout.cellSize), exportCellRect(0, 0, layout).y);
});

test('the widest label is the largest on-interval boundary on either axis', () => {
    assert.equal(widestExportLabel(300, 166), '300');
    assert.equal(widestExportLabel(166, 95), '160');
    assert.equal(widestExportLabel(7, 3), '0');
});

test('file names carry the grid size and nothing that varies between exports', () => {
    assert.equal(exportFileName(120, 90), 'perler-120x90.png');
});
