import assert from 'node:assert/strict';
import { test } from 'vitest';
import { floodFillRegion } from './flood-fill';
import type { PaletteColor, Pattern } from '../types';

const W: PaletteColor = { name: 'H1', rgb: [255, 255, 255] };
const K: PaletteColor = { name: 'P18', rgb: [0, 0, 0] };
const B: PaletteColor = { name: 'P17', rgb: [0, 0, 255] };

/** Build a pattern from rows of single-character keys. */
function fromRows(rows: string[], key: Record<string, PaletteColor | null>): Pattern {
    const width = rows[0].length;
    const cells = rows.flatMap((line) => [...line].map((char) => key[char]));
    return { width, height: rows.length, cells };
}

const KEY = { '.': W, '#': K, 'b': B, ' ': null };

test('a uniform pattern fills entirely', () => {
    const pattern = fromRows(['...', '...'], KEY);
    assert.deepEqual(floodFillRegion(pattern, 1, 1), [0, 1, 2, 3, 4, 5]);
});

test('fill stops at a different color and never crosses it', () => {
    // A vertical black wall down the middle splits the white into two regions.
    const pattern = fromRows([
        '.#.',
        '.#.',
        '.#.'
    ], KEY);

    assert.deepEqual(floodFillRegion(pattern, 0, 0), [0, 3, 6]);
    assert.deepEqual(floodFillRegion(pattern, 2, 0), [2, 5, 8]);
});

test('the region is 4-connected, so a diagonal touch is a different region', () => {
    const pattern = fromRows([
        '.#',
        '#.'
    ], KEY);

    // EDIT-8's Check is "the contiguous same-color region", and a corner is not
    // contiguous for beads: they are threaded in rows and columns.
    assert.deepEqual(floodFillRegion(pattern, 0, 0), [0]);
});

test('an enclosed region does not leak into the outside of the same color', () => {
    const pattern = fromRows([
        '#####',
        '#...#',
        '#.#.#',
        '#...#',
        '#####'
    ], KEY);

    const inside = floodFillRegion(pattern, 1, 1);
    assert.equal(inside.length, 8, 'the inner 3x3 minus the black cell at its centre');
    assert.ok(!inside.includes(12), 'the black cell at the centre is excluded');
});

test('empty cells fill as a color of their own, which is what fill-with-empty needs', () => {
    // GEN-1 leaves transparent source as null. Filling those back in, or filling
    // a uniform background with empty, both depend on null matching null.
    const pattern = fromRows([
        '  b',
        '  b',
        'bbb'
    ], KEY);

    assert.deepEqual(floodFillRegion(pattern, 0, 0), [0, 1, 3, 4]);
});

test('matching is by name, not object identity: a deserialized pattern still fills', () => {
    // M7 will rebuild cells as fresh objects; identity comparison would then
    // make every cell its own region.
    const clone = (color: PaletteColor): PaletteColor => ({ ...color, rgb: [...color.rgb] });
    const pattern: Pattern = {
        width: 2,
        height: 2,
        cells: [W, clone(W), clone(W), W]
    };

    assert.deepEqual(floodFillRegion(pattern, 0, 0), [0, 1, 2, 3]);
});

test('an origin outside the pattern fills nothing', () => {
    const pattern = fromRows(['..', '..'], KEY);
    assert.deepEqual(floodFillRegion(pattern, -1, 0), []);
    assert.deepEqual(floodFillRegion(pattern, 0, 2), []);
});

test('the result is ascending row-major, so the recorded stroke is deterministic', () => {
    const pattern = fromRows([
        '..b',
        '...',
        'b..'
    ], KEY);

    const region = floodFillRegion(pattern, 1, 1);
    assert.deepEqual(region, [...region].sort((a, b) => a - b));
    assert.deepEqual(region, [0, 1, 3, 4, 5, 7, 8]);
});

test('a full-grid region at the hard limit completes without overflowing the stack', () => {
    // NFR-3's 50,000-cell ceiling, as one region: this is exactly the case that
    // rules out recursion, and it is also the largest stroke history can hold.
    const width = 250;
    const height = 200;
    const pattern: Pattern = {
        width,
        height,
        cells: new Array<PaletteColor | null>(width * height).fill(W)
    };

    assert.equal(floodFillRegion(pattern, 0, 0).length, 50000);
});
