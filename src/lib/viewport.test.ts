import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    MAX_CELL_SIZE_PX,
    clampCellSize,
    fitCellSize,
    visibleCellRange,
    zoomedScrollOffset
} from './viewport';

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
