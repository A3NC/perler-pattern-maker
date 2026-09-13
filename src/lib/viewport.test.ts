import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    MAX_CELL_SIZE_PX,
    cellAtClientPoint,
    clampCellSize,
    fitCellSize,
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
