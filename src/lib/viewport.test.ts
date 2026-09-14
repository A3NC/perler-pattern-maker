import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    CODE_FONT_RATIO,
    MAX_CELL_SIZE_PX,
    MIN_CODE_CELL_SIZE_PX,
    ZOOM_STEP,
    cellAtClientPoint,
    clampCellSize,
    fitCellSize,
    shouldDrawCodes,
    visibleCellRange,
    zoomedScrollOffset
} from './viewport';

const CANVAS_LEFT = 40;
const CANVAS_TOP = 64;

/** Where the draw loop puts a point inside cell (col, row), in client space. */
function clientPointIn(
    col: number,
    row: number,
    cellSize: number,
    scrollLeft: number,
    scrollTop: number,
    offsetInCell = 0.5
): { clientX: number; clientY: number } {
    return {
        clientX: CANVAS_LEFT + ((col + offsetInCell) * cellSize) - scrollLeft,
        clientY: CANVAS_TOP + ((row + offsetInCell) * cellSize) - scrollTop
    };
}

function lookupAt(
    clientX: number,
    clientY: number,
    cellSize: number,
    scrollLeft = 0,
    scrollTop = 0
) {
    return {
        clientX,
        clientY,
        canvasLeft: CANVAS_LEFT,
        canvasTop: CANVAS_TOP,
        scrollLeft,
        scrollTop,
        cellSize,
        patternWidth: 100,
        patternHeight: 100
    };
}

test('fitCellSize uses the limiting axis', () => {
    // 100 × 100 in a 760 × 500 container: height binds at 5px per cell.
    assert.equal(fitCellSize(100, 100, 760, 500), 5);
    // 300 × 160 near the NFR-3 hard limit, in a narrow 390px viewport.
    assert.equal(fitCellSize(300, 160, 390, 500), 1.3);
});

test('fitCellSize never exceeds the readable maximum', () => {
    // A 4 × 4 pattern would "fit" at 125px per cell; zoom stops at 30.
    assert.equal(fitCellSize(4, 4, 500, 500), MAX_CELL_SIZE_PX);
});

test('clampCellSize holds the zoom range', () => {
    assert.equal(clampCellSize(12, 5, 30), 12);
    assert.equal(clampCellSize(2, 5, 30), 5);
    assert.equal(clampCellSize(90, 5, 30), 30);
    assert.equal(clampCellSize(Number.NaN, 5, 30), 5);
});

test('shouldDrawCodes switches at the threshold', () => {
    assert.equal(shouldDrawCodes(MIN_CODE_CELL_SIZE_PX), true);
    assert.equal(shouldDrawCodes(MIN_CODE_CELL_SIZE_PX - 0.01), false);
    assert.equal(shouldDrawCodes(MAX_CELL_SIZE_PX), true);
    assert.equal(shouldDrawCodes(0), false);
});

test('shouldDrawCodes hides the codes the fit view cannot render', () => {
    // VIEW-5's Check, at the zoom every Generate opens on: a 100 × 100 fit to a
    // 760 × 500 container is 5px per cell, where the code font would be under
    // 2px. Colors still draw -- only the text is skipped.
    assert.equal(shouldDrawCodes(fitCellSize(100, 100, 760, 500)), false);
    // And the 300 × 160 case near NFR-3's hard limit, fit to a 390px viewport.
    assert.equal(shouldDrawCodes(fitCellSize(300, 160, 390, 500)), false);
});

test('the code threshold sits inside the zoom range', () => {
    // A threshold at or above the maximum zoom would hide codes permanently,
    // which would fail VIEW-3 rather than satisfy VIEW-5.
    assert.ok(MIN_CODE_CELL_SIZE_PX < MAX_CELL_SIZE_PX);

    // Zooming in from the 100 × 100 fit must actually cross it, and zooming
    // back out must return below it (VIEW-5's Check, both directions).
    let cellSize = fitCellSize(100, 100, 760, 500);
    let clicks = 0;
    while (cellSize < MAX_CELL_SIZE_PX && !shouldDrawCodes(cellSize)) {
        cellSize = clampCellSize(cellSize * ZOOM_STEP, 5, MAX_CELL_SIZE_PX);
        clicks++;
    }
    assert.equal(shouldDrawCodes(cellSize), true);
    assert.ok(clicks <= 10, `codes appeared after ${clicks} zoom clicks`);

    assert.equal(shouldDrawCodes(clampCellSize(cellSize / ZOOM_STEP, 5, MAX_CELL_SIZE_PX)), false);
});

test('the threshold is the font floor in cell terms', () => {
    // The threshold is derived from a minimum font size, so the font at the
    // threshold is exactly that floor -- 6px -- and never smaller above it.
    assert.equal(MIN_CODE_CELL_SIZE_PX * CODE_FONT_RATIO, 6);
});

test('zoomedScrollOffset holds the viewport center fixed', () => {
    // Viewport spans cells 10..30, so its center sits on cell 20. Doubling the
    // cell size must leave cell 20 under the center: 20 × 20 - 100 = 300.
    assert.equal(zoomedScrollOffset(100, 200, 10, 20, 100), 300);
    // And back again, exactly.
    assert.equal(zoomedScrollOffset(300, 200, 20, 10, 100), 100);
});

test('zoomedScrollOffset clamps to the new scroll range', () => {
    // Zooming out until the pattern fits leaves nowhere to scroll.
    assert.equal(zoomedScrollOffset(300, 200, 20, 2, 100), 0);
    // Centering near the right edge would overscroll: 100 cells × 20px - 200px.
    assert.equal(zoomedScrollOffset(900, 200, 10, 20, 100), 1800);
});

test('visibleCellRange covers partial cells at both edges', () => {
    // Aligned: cells 0..19 exactly span a 200px viewport.
    assert.deepEqual(visibleCellRange(0, 200, 10, 100), { start: 0, end: 19 });
    // Offset by half a cell pulls in one more on the trailing edge.
    assert.deepEqual(visibleCellRange(5, 200, 10, 100), { start: 0, end: 20 });
    assert.deepEqual(visibleCellRange(95, 200, 10, 100), { start: 9, end: 29 });
});

test('visibleCellRange stops at the pattern edge', () => {
    // Viewport larger than the pattern: every cell, and no phantom ones.
    assert.deepEqual(visibleCellRange(0, 500, 10, 12), { start: 0, end: 11 });
    // Scrolled past the pattern entirely: end < start, nothing to draw.
    assert.deepEqual(visibleCellRange(5000, 200, 10, 12), { start: 0, end: -1 });
    assert.deepEqual(visibleCellRange(0, 200, 10, 0), { start: 0, end: -1 });
});

// NFR-3's hard limit as the plan's non-square case, in the reference container.
const LIMIT_W = 300;
const LIMIT_H = 160;
const CONTAINER_W = 760;
const CONTAINER_H = 500;

/** Cells the draw loop touches in one frame -- its whole per-frame cost. */
function cellsPerFrame(cellSize: number, scrollLeft = 0, scrollTop = 0): number {
    const cols = visibleCellRange(scrollLeft, CONTAINER_W, cellSize, LIMIT_W);
    const rows = visibleCellRange(scrollTop, CONTAINER_H, cellSize, LIMIT_H);
    return (cols.end - cols.start + 1) * (rows.end - rows.start + 1);
}

test('per-frame work is bounded by the container, not the pattern', () => {
    // The step 2 precondition, stated as a cost: zooming in on a 48,000-cell
    // pattern must make each frame cheaper, never more expensive. A
    // pattern-sized canvas would draw all 48,000 cells at every zoom.
    const fit = fitCellSize(LIMIT_W, LIMIT_H, CONTAINER_W, CONTAINER_H);

    let cellSize = fit;
    let previous = cellsPerFrame(cellSize);
    // The whole pattern is on screen at fit zoom, so that frame is the worst.
    assert.equal(previous, LIMIT_W * LIMIT_H);

    while (cellSize < MAX_CELL_SIZE_PX) {
        cellSize = clampCellSize(cellSize * ZOOM_STEP, fit, MAX_CELL_SIZE_PX);
        // Scrolled to the middle, where the visible range is not clipped by an
        // edge and the frame is therefore at its most expensive for this zoom.
        const count = cellsPerFrame(cellSize, (LIMIT_W * cellSize) / 3, (LIMIT_H * cellSize) / 3);
        assert.ok(count <= previous, `${count} cells at ${cellSize}px exceeded ${previous}`);
        previous = count;
    }

    // At maximum zoom a frame is a few hundred cells out of 48,000.
    assert.ok(previous < 600, `${previous} cells at maximum zoom`);
});

test('text never draws on more than a container-full of cells', () => {
    // fillText is the expensive call, and step 5's threshold is what bounds how
    // many of them a frame can make: codes only draw at >= 18px per cell, and
    // few 18px cells fit a 760 x 500 container. This is why step 6's
    // performance bar survives the 50,000-cell hard limit.
    const worst = cellsPerFrame(
        MIN_CODE_CELL_SIZE_PX,
        MIN_CODE_CELL_SIZE_PX / 2,
        MIN_CODE_CELL_SIZE_PX / 2
    );
    assert.ok(worst < 1500, `${worst} code draws per frame at the threshold`);
    assert.ok(worst < (LIMIT_W * LIMIT_H) / 20, 'text frames are a fraction of the pattern');
});

test('cellAtClientPoint round-trips at every zoom level', () => {
    // The fit-to-390px extreme, two middling zooms, and the readable maximum.
    for (const cellSize of [1.3, 5, 12.5, MAX_CELL_SIZE_PX]) {
        for (const [col, row] of [[0, 0], [7, 3], [42, 17], [99, 99]]) {
            const point = clientPointIn(col, row, cellSize, 0, 0);
            assert.deepEqual(
                cellAtClientPoint(lookupAt(point.clientX, point.clientY, cellSize)),
                { col, row },
                `cell ${col},${row} at ${cellSize}px`
            );
        }
    }
});

test('cellAtClientPoint round-trips while scrolled', () => {
    // Scrolled to the middle of a 100 × 100 at maximum zoom.
    const point = clientPointIn(40, 50, 30, 1200, 1500);
    assert.deepEqual(cellAtClientPoint(lookupAt(point.clientX, point.clientY, 30, 1200, 1500)), {
        col: 40,
        row: 50
    });
});

test('cellAtClientPoint puts cell boundaries on the higher cell', () => {
    // Exactly the left/top edge of cell 5,5 belongs to 5,5, not to 4,4.
    const edge = clientPointIn(5, 5, 10, 0, 0, 0);
    assert.deepEqual(cellAtClientPoint(lookupAt(edge.clientX, edge.clientY, 10)), { col: 5, row: 5 });

    const justBefore = clientPointIn(5, 5, 10, 0, 0, -0.01);
    assert.deepEqual(cellAtClientPoint(lookupAt(justBefore.clientX, justBefore.clientY, 10)), {
        col: 4,
        row: 4
    });
});

test('cellAtClientPoint returns null outside the pattern', () => {
    // Left of and above the first cell -- the Math.trunc trap, which would
    // wrongly report cell 0,0 for both.
    assert.equal(cellAtClientPoint(lookupAt(CANVAS_LEFT - 1, CANVAS_TOP + 5, 10)), null);
    assert.equal(cellAtClientPoint(lookupAt(CANVAS_LEFT + 5, CANVAS_TOP - 1, 10)), null);

    // Past the last cell: a 100-wide pattern at 10px ends at 1000.
    assert.equal(cellAtClientPoint(lookupAt(CANVAS_LEFT + 1000, CANVAS_TOP + 5, 10)), null);
    assert.equal(cellAtClientPoint(lookupAt(CANVAS_LEFT + 5, CANVAS_TOP + 1000, 10)), null);

    // The last cell itself is still inside.
    assert.deepEqual(cellAtClientPoint(lookupAt(CANVAS_LEFT + 999, CANVAS_TOP + 999, 10)), {
        col: 99,
        row: 99
    });
});
