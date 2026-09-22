import assert from 'node:assert/strict';
import { test } from 'vitest';
import { applyEdits, createStrokeRecorder, sameCellColor } from './pattern-edit';
import { tallyPattern } from './pattern-utils';
import type { ColorTally, PaletteColor, Pattern } from '../types';

const RED: PaletteColor = { name: 'R1', rgb: [255, 0, 0] };
const BLUE: PaletteColor = { name: 'B1', rgb: [0, 0, 255] };
const GREEN: PaletteColor = { name: 'G1', rgb: [0, 255, 0] };

/** A 3 x 2 pattern: RED everywhere but one BLUE cell and one empty cell. */
function makePattern(): Pattern {
    return {
        width: 3,
        height: 2,
        cells: [RED, RED, BLUE, RED, null, RED]
    };
}

function counts(tallies: Record<string, ColorTally>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of Object.keys(tallies)) out[name] = tallies[name].count;
    return out;
}

test('sameCellColor compares by name and treats empty as a value', () => {
    assert.equal(sameCellColor(RED, { name: 'R1', rgb: [1, 2, 3] }), true);
    assert.equal(sameCellColor(RED, BLUE), false);
    assert.equal(sameCellColor(null, null), true);
    assert.equal(sameCellColor(null, RED), false);
});

test('applyEdits moves cells and tallies together, and inverts exactly', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);
    const before = counts(tallies);

    // EDIT-4's Check: A -> B decrements A by 1 and increments B by 1.
    const edits = [{ index: 0, prev: RED, next: BLUE }];
    applyEdits(pattern, tallies, edits);

    assert.equal(pattern.cells[0], BLUE);
    assert.equal(tallies.R1.count, before.R1 - 1);
    assert.equal(tallies.B1.count, before.B1 + 1);

    applyEdits(pattern, tallies, edits, 'revert');
    assert.equal(pattern.cells[0], RED);
    assert.deepEqual(counts(tallies), before);
});

test('erasing drops the cell from the tallies, and the last one removes the row', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);

    // EDIT-2: erased cells render as empty and leave the bead count.
    applyEdits(pattern, tallies, [{ index: 2, prev: BLUE, next: null }]);

    assert.equal(pattern.cells[2], null);
    assert.equal('B1' in tallies, false, 'a count-0 row would inflate Colors Used');
    assert.deepEqual(counts(tallies), counts(tallyPattern(pattern)));
});

test('reverting walks backwards, so overlapping records restore the original', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);
    const before = counts(tallies);

    // Hand-built and deliberately overlapping: the recorder would collapse
    // these, but applyEdits must be correct without relying on that.
    const edits = [
        { index: 0, prev: RED, next: BLUE },
        { index: 0, prev: BLUE, next: GREEN }
    ];
    applyEdits(pattern, tallies, edits);
    assert.equal(pattern.cells[0], GREEN);

    applyEdits(pattern, tallies, edits, 'revert');
    assert.equal(pattern.cells[0], RED);
    assert.deepEqual(counts(tallies), before);
});

test('a recorder keeps one record per cell, holding the color the stroke started from', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);
    const recorder = createStrokeRecorder(pattern, tallies);

    // A drag that crosses cell 0 three times, as interpolation and scribbling do.
    assert.equal(recorder.paint(0, BLUE), true);
    assert.equal(recorder.paint(0, GREEN), true);
    assert.equal(recorder.paint(1, GREEN), true);

    const stroke = recorder.commit();
    assert.equal(stroke.length, 2);
    assert.deepEqual(stroke[0], { index: 0, prev: RED, next: GREEN });
    assert.deepEqual(stroke[1], { index: 1, prev: RED, next: GREEN });

    // And undoing it lands back on the pre-stroke state, not an intermediate one.
    applyEdits(pattern, tallies, stroke, 'revert');
    assert.deepEqual(pattern.cells, makePattern().cells);
    assert.deepEqual(counts(tallies), counts(tallyPattern(pattern)));
});

test('a recorder drops no-ops: repainting a cell and painting it back records nothing', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);
    const recorder = createStrokeRecorder(pattern, tallies);

    assert.equal(recorder.paint(0, RED), false, 'already that color');
    recorder.paint(1, BLUE);
    recorder.paint(1, RED);

    assert.deepEqual(recorder.commit(), []);
});

test('a recorder ignores out-of-range indices rather than growing the cells array', () => {
    const pattern = makePattern();
    const tallies = tallyPattern(pattern);
    const recorder = createStrokeRecorder(pattern, tallies);

    assert.equal(recorder.paint(-1, BLUE), false);
    assert.equal(recorder.paint(6, BLUE), false);
    assert.equal(pattern.cells.length, 6);
    assert.deepEqual(recorder.commit(), []);
});
