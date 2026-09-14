import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    GRID_INTERVAL,
    gridlineIndices,
    rulerLabelStep,
    shouldDrawGridlines,
    shouldDrawRuler
} from './guides';
import { MAX_CELL_SIZE_PX, fitCellSize, visibleCellRange } from './viewport';

test('gridlineIndices returns boundaries, one past the last visible cell', () => {
    // Cells 0..19 visible: boundaries at 0, 10 and 20 -- 20 being the trailing
    // edge of cell 19, which is a line the user sees.
    assert.deepEqual(gridlineIndices({ start: 0, end: 19 }), [0, 10, 20]);
});

test('gridlineIndices starts at the first boundary inside the range', () => {
    // Scrolled into the middle: no line at 3, the next one is 10.
    assert.deepEqual(gridlineIndices({ start: 3, end: 27 }), [10, 20]);
    // A range starting exactly on a boundary includes it.
    assert.deepEqual(gridlineIndices({ start: 20, end: 29 }), [20, 30]);
});

test('gridlineIndices handles ranges narrower than the interval', () => {
    // Zoomed far in, between two lines: nothing to draw.
    assert.deepEqual(gridlineIndices({ start: 11, end: 18 }), []);
    // ... but one boundary inside the range is still found.
    assert.deepEqual(gridlineIndices({ start: 11, end: 20 }), [20]);
});

test('gridlineIndices draws nothing for an empty range', () => {
    // visibleCellRange signals "nothing visible" as end < start. Falling through
    // would emit a line at boundary 0, drawing a stray rule over empty space.
    assert.deepEqual(gridlineIndices({ start: 0, end: -1 }), []);
    assert.deepEqual(gridlineIndices(visibleCellRange(5000, 200, 10, 12)), []);
});

test('gridlineIndices matches what the draw loop actually asks for', () => {
    // The real composition: a 100-cell axis at 12px, scrolled 250px into a 760px
    // viewport, shows cells 20..84, so lines land at 20,30,...,80.
    const range = visibleCellRange(250, 760, 12, 100);
    assert.deepEqual(range, { start: 20, end: 84 });
    assert.deepEqual(gridlineIndices(range), [20, 30, 40, 50, 60, 70, 80]);
});

test('shouldDrawGridlines tests the gap between lines, not the cell', () => {
    // 1.4px cells are far too small for a code, but ten of them is a 14px gap --
    // still a legible grid, and the zoom where a grid helps most.
    assert.equal(shouldDrawGridlines(1.4), true);
    assert.equal(shouldDrawGridlines(1.39), false);
    assert.equal(shouldDrawGridlines(0), false);

    // Both plan size targets draw a grid at their opening fit zoom.
    assert.equal(shouldDrawGridlines(fitCellSize(100, 100, 760, 500)), true);
    assert.equal(shouldDrawGridlines(fitCellSize(300, 160, 760, 500)), true);
});

test('rulerLabelStep thins labels instead of colliding them', () => {
    // Roomy zooms label every 10th cell.
    assert.equal(rulerLabelStep(MAX_CELL_SIZE_PX), GRID_INTERVAL);
    assert.equal(rulerLabelStep(5), GRID_INTERVAL);

    // At the 300-wide fit, 10 cells is only ~25px -- too tight, so step to 20.
    assert.equal(rulerLabelStep(fitCellSize(300, 160, 760, 500)), 20);

    // Tighter still climbs the 1-2-5 ladder rather than landing on 30 or 40.
    assert.equal(rulerLabelStep(1), 50);
    assert.equal(rulerLabelStep(0.3), 200);
});

test('rulerLabelStep never returns a step below the interval', () => {
    for (const cellSize of [0.1, 1, 2.53, 5, 12.5, MAX_CELL_SIZE_PX, 1000]) {
        const step = rulerLabelStep(cellSize);
        assert.ok(step >= GRID_INTERVAL, `step ${step} at ${cellSize}px`);
        assert.equal(step % GRID_INTERVAL, 0, `step ${step} is a multiple of the interval`);
    }
    // Degenerate input falls back rather than looping or returning 0.
    assert.equal(rulerLabelStep(0), GRID_INTERVAL);
    assert.equal(rulerLabelStep(-5), GRID_INTERVAL);
});

test('every label step actually clears the collision minimum', () => {
    // The property the function exists to guarantee, swept across the zoom range.
    for (let cellSize = 0.5; cellSize <= MAX_CELL_SIZE_PX; cellSize += 0.25) {
        const pitch = rulerLabelStep(cellSize) * cellSize;
        assert.ok(pitch >= 34, `labels ${pitch.toFixed(1)}px apart at ${cellSize}px cells`);
    }
});

test('shouldDrawRuler fires only when the axis overflows', () => {
    // 100 cells at 30px is 3000px in a 760px viewport: you can get lost.
    assert.equal(shouldDrawRuler(3000, 760), true);
    // The same pattern zoomed out to fit: nothing to scroll, nothing to lose.
    assert.equal(shouldDrawRuler(500, 760), false);
    // Exactly filling the viewport still has nothing off-screen.
    assert.equal(shouldDrawRuler(760, 760), false);
});

test('shouldDrawRuler is decided per axis', () => {
    // A wide, short pattern at 30px: 300 cols overflow the 760px width, but 12
    // rows are only 360px in a 500px-tall window -- so the column ruler draws
    // and the row ruler stays away.
    assert.equal(shouldDrawRuler(300 * 30, 760), true);
    assert.equal(shouldDrawRuler(12 * 30, 500), false);
});
