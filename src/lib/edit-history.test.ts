import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createEditHistory } from './edit-history';
import { applyEdits, createStrokeRecorder } from './pattern-edit';
import type { CellEdit, Stroke } from './pattern-edit';
import { tallyPattern } from './pattern-utils';
import type { ColorTally, PaletteColor, Pattern } from '../types';

const RED: PaletteColor = { name: 'R1', rgb: [255, 0, 0] };
const BLUE: PaletteColor = { name: 'B1', rgb: [0, 0, 255] };

/** A stroke of `length` records, distinguishable by the tag on its first index. */
function fakeStroke(tag: number, length = 1): Stroke {
    const edits: CellEdit[] = [];
    for (let i = 0; i < length; i += 1) {
        edits.push({ index: (tag * 1000) + i, prev: RED, next: BLUE });
    }
    return edits;
}

test('undo and redo walk the stack and report their own ends', () => {
    const history = createEditHistory();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.undo(), null);
    assert.equal(history.redo(), null);

    history.push(fakeStroke(1));
    history.push(fakeStroke(2));
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);

    assert.deepEqual(history.undo(), fakeStroke(2));
    assert.deepEqual(history.undo(), fakeStroke(1));
    assert.equal(history.undo(), null, 'the bottom of the stack');
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);

    assert.deepEqual(history.redo(), fakeStroke(1));
    assert.deepEqual(history.redo(), fakeStroke(2));
    assert.equal(history.redo(), null, 'the top of the stack');
});

test('empty strokes are not recorded, so a click that changed nothing is not undoable', () => {
    const history = createEditHistory();
    history.push([]);
    assert.equal(history.canUndo(), false);
    assert.equal(history.size(), 0);
});

test('pushing behind the cursor discards the tail rather than leaving it replayable', () => {
    const history = createEditHistory();
    history.push(fakeStroke(1));
    history.push(fakeStroke(2));
    history.push(fakeStroke(3));

    history.undo();
    history.undo();
    assert.equal(history.canRedo(), true);

    // EDIT-7's Check: a new edit after undoing discards the redone-away tail.
    // Strokes 2 and 3 describe a state the pattern will never be in again.
    history.push(fakeStroke(4));
    assert.equal(history.canRedo(), false);
    assert.equal(history.size(), 2);
    assert.equal(history.recordedCells(), 2, 'the discarded tail is not still counted');

    assert.deepEqual(history.undo(), fakeStroke(4));
    assert.deepEqual(history.undo(), fakeStroke(1));
    assert.equal(history.undo(), null);
});

test('the stack is bounded by recorded cells, evicting oldest strokes first', () => {
    const budget = 10;
    const history = createEditHistory(budget);

    for (let tag = 1; tag <= 6; tag += 1) history.push(fakeStroke(tag, 4));

    assert.ok(history.recordedCells() <= budget, 'the budget is enforced');
    assert.ok(history.size() < 6, 'oldest strokes were dropped');

    // The most recent strokes survive; undo runs out at the eviction boundary
    // rather than replaying a stroke that is no longer held.
    assert.deepEqual(history.undo(), fakeStroke(6, 4));
    while (history.undo() !== null) { /* drain */ }
    assert.equal(history.canUndo(), false);
});

test('one stroke larger than the whole budget stays undoable', () => {
    // A fill at NFR-3's limit is a single stroke; dropping it to meet a budget
    // would make the one action most in need of undo the one that has none.
    const history = createEditHistory(10);
    history.push(fakeStroke(1, 500));

    assert.equal(history.size(), 1);
    assert.equal(history.canUndo(), true);
    assert.deepEqual(history.undo(), fakeStroke(1, 500));
});

test('clear empties both directions', () => {
    const history = createEditHistory();
    history.push(fakeStroke(1));
    history.undo();
    history.clear();

    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
    assert.equal(history.recordedCells(), 0);
});

// --- the tally correctness anchor -------------------------------------------

/** Deterministic pseudo-random, so a failure is reproducible. */
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function countsOf(tallies: Record<string, ColorTally>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of Object.keys(tallies)) out[name] = tallies[name].count;
    return out;
}

test('incremental tallies agree with a full re-tally after random strokes and undos', () => {
    const palette: (PaletteColor | null)[] = [
        { name: 'A1', rgb: [249, 240, 205] },
        { name: 'B2', rgb: [10, 20, 30] },
        { name: 'C3', rgb: [200, 30, 90] },
        null
    ];

    const width = 12;
    const height = 9;
    const pattern: Pattern = {
        width,
        height,
        cells: Array.from({ length: width * height }, (_, i) => palette[i % palette.length])
    };
    const tallies = tallyPattern(pattern);
    const history = createEditHistory();
    const random = makeRandom(20260921);

    for (let round = 0; round < 200; round += 1) {
        if (random() < 0.3 && history.canUndo()) {
            applyEdits(pattern, tallies, history.undo() as Stroke, 'revert');
        } else if (random() < 0.15 && history.canRedo()) {
            applyEdits(pattern, tallies, history.redo() as Stroke);
        } else {
            const recorder = createStrokeRecorder(pattern, tallies);
            const runLength = 1 + Math.floor(random() * 8);
            for (let step = 0; step < runLength; step += 1) {
                const index = Math.floor(random() * pattern.cells.length);
                recorder.paint(index, palette[Math.floor(random() * palette.length)]);
            }
            history.push(recorder.commit());
        }

        // The property the editor relies on: nothing it does incrementally can
        // drift from what a fresh count of the pattern would say.
        assert.deepEqual(countsOf(tallies), countsOf(tallyPattern(pattern)), `round ${round}`);
    }
});
