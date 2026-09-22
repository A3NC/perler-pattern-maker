import assert from 'node:assert/strict';
import { test } from 'vitest';
import { cellsBetween } from './cell-path';
import type { CellPosition } from './viewport';

function at(col: number, row: number): CellPosition {
    return { col, row };
}

/** Every consecutive pair touches, edge-wise or corner-wise: no gaps in the run. */
function assertConnected(path: CellPosition[]): void {
    for (let i = 1; i < path.length; i += 1) {
        const stepCol = Math.abs(path[i].col - path[i - 1].col);
        const stepRow = Math.abs(path[i].row - path[i - 1].row);
        assert.ok(
            stepCol <= 1 && stepRow <= 1 && stepCol + stepRow > 0,
            `gap between ${JSON.stringify(path[i - 1])} and ${JSON.stringify(path[i])}`
        );
    }
}

test('a point is its own path', () => {
    assert.deepEqual(cellsBetween(at(4, 7), at(4, 7)), [at(4, 7)]);
});

test('adjacent cells give both endpoints and nothing else', () => {
    assert.deepEqual(cellsBetween(at(2, 2), at(3, 2)), [at(2, 2), at(3, 2)]);
});

test('a perfect diagonal steps one cell on each axis at a time', () => {
    assert.deepEqual(
        cellsBetween(at(0, 0), at(3, 3)),
        [at(0, 0), at(1, 1), at(2, 2), at(3, 3)]
    );
});

test('a steep diagonal fills every row it crosses, with no skipped cells', () => {
    // 3 across, 11 down: the shallow axis is the one a naive implementation
    // drops, and this is the shape a slow near-vertical drag produces.
    const path = cellsBetween(at(0, 0), at(3, 11));

    assertConnected(path);
    assert.deepEqual(path[0], at(0, 0));
    assert.deepEqual(path[path.length - 1], at(3, 11));

    const rows = new Set(path.map((cell) => cell.row));
    assert.equal(rows.size, 12, 'every row between the endpoints is touched');
});

test('a long fast jump is connected end to end', () => {
    // EDIT-1's real failure mode: one pointermove reporting a position far from
    // the last, which at a small cell size is most of the pattern.
    const path = cellsBetween(at(2, 3), at(147, 96));

    assertConnected(path);
    assert.deepEqual(path[0], at(2, 3));
    assert.deepEqual(path[path.length - 1], at(147, 96));
    // The run is as long as its dominant axis; that is what "no skipped cells"
    // means for a line, and a dotted result would be far shorter.
    assert.equal(path.length, 146);
});

test('direction does not matter: the reversed drag is the reversed path', () => {
    const forward = cellsBetween(at(1, 2), at(9, 5));
    const backward = cellsBetween(at(9, 5), at(1, 2));

    assertConnected(backward);
    assert.equal(backward.length, forward.length);
    assert.deepEqual(backward[0], at(9, 5));
    assert.deepEqual(backward[backward.length - 1], at(1, 2));
});

test('negative directions work, since a drag goes up and left as readily', () => {
    const path = cellsBetween(at(6, 6), at(0, 2));
    assertConnected(path);
    assert.deepEqual(path[0], at(6, 6));
    assert.deepEqual(path[path.length - 1], at(0, 2));
});

test('a non-finite endpoint yields no path rather than looping forever', () => {
    assert.deepEqual(cellsBetween(at(0, 0), at(Number.NaN, 3)), []);
});
