import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizePalette } from '../lib/pattern-utils';
import { paletteToOklab } from './color-match';
import { reduceColors } from './reduce';
import type { Palette } from '../types';

/**
 * Four near-identical whites plus three colors that are genuinely far apart.
 * This is R2's white canvas and R4's eye highlight in the same fixture.
 */
const palette: Palette = normalizePalette([
    { name: 'white', hex: '#FFFFFF' },
    { name: 'pearl', hex: '#FDFDFB' },
    { name: 'cream', hex: '#FCFBF8' },
    { name: 'snow', hex: '#FEFEFE' },
    { name: 'black', hex: '#000000' },
    { name: 'red', hex: '#E03030' },
    { name: 'blue', hex: '#2040C0' }
]);
const lab = paletteToOklab(palette);

const WHITE = 0, PEARL = 1, CREAM = 2, SNOW = 3, BLACK = 4, RED = 5, BLUE = 6;

const names = (remap: Map<number, number>): Record<string, string> =>
    Object.fromEntries([...remap].map(([from, to]) => [palette[from].name, palette[to].name]));

const distinct = (remap: Map<number, number>): number => new Set(remap.values()).size;

test('the limit is respected and every color still maps somewhere', () => {
    const counts = new Map([[WHITE, 500], [PEARL, 400], [CREAM, 300], [BLACK, 200], [RED, 100], [BLUE, 50]]);
    const remap = reduceColors(counts, lab, { limit: 3, mergeFloor: 0 });

    assert.ok(distinct(remap) <= 3, `expected at most 3 colors, got ${distinct(remap)}`);
    for (const index of counts.keys()) {
        assert.ok(remap.has(index), `${palette[index].name} must map to something`);
    }
});

test('D17: a rare isolated color outlives a common near-duplicate', () => {
    // The case frequency ranking gets backwards. Ranked by count the survivors
    // would be white, pearl and cream -- three shades of the same white -- and
    // blue, the only thing that looks different, would be dropped. Cost ranking
    // keeps blue precisely because nothing can stand in for it.
    const counts = new Map([[WHITE, 900], [PEARL, 800], [CREAM, 700], [BLUE, 20]]);
    const remap = reduceColors(counts, lab, { limit: 2, mergeFloor: 0 });

    const survivors = new Set([...remap.values()].map((index) => palette[index].name));
    assert.ok(survivors.has('blue'), `blue should survive, got ${[...survivors]}`);
    assert.equal(survivors.size, 2);
});

test('Phase A collapses near-duplicates even when the limit is not binding (R2)', () => {
    // Four whites, a limit of 30 that never fires. Frequency reduction would do
    // nothing at all here and the canvas would stay speckled.
    const counts = new Map([[WHITE, 400], [PEARL, 300], [CREAM, 200], [SNOW, 100], [RED, 50]]);
    const remap = reduceColors(counts, lab, { limit: 30 });

    const survivors = new Set([...remap.values()].map((index) => palette[index].name));
    assert.equal(survivors.size, 2, `whites should collapse to one, got ${[...survivors]}`);
    assert.ok(survivors.has('red'), 'red is far from the whites and must survive');
});

test('a zero floor leaves an already-under-limit pattern untouched', () => {
    const counts = new Map([[WHITE, 400], [PEARL, 300], [BLACK, 200]]);
    const remap = reduceColors(counts, lab, { limit: 30, mergeFloor: 0 });

    assert.deepEqual(names(remap), { white: 'white', pearl: 'pearl', black: 'black' });
});

test('merge chains are path-compressed to a surviving color', () => {
    const counts = new Map([[WHITE, 10], [PEARL, 9], [CREAM, 8], [SNOW, 7], [BLACK, 100]]);
    const remap = reduceColors(counts, lab, { limit: 2 });

    const survivors = new Set(remap.values());
    for (const [from, to] of remap) {
        assert.ok(survivors.has(to), `${palette[from].name} -> ${palette[to].name} must be a survivor`);
        assert.equal(remap.get(to), to, `${palette[to].name} must map to itself`);
    }
});

test('GEN-7: reduction is a function of its input alone', () => {
    const build = () => new Map([[WHITE, 400], [PEARL, 400], [CREAM, 200], [BLACK, 200], [RED, 200], [BLUE, 9]]);

    const first = reduceColors(build(), lab, { limit: 3 });
    const second = reduceColors(build(), lab, { limit: 3 });
    assert.deepEqual(names(first), names(second));

    // Equal counts must not leave the outcome to map iteration order: the same
    // counts inserted in the reverse order reduce identically.
    const reversed = new Map([...build()].reverse());
    assert.deepEqual(names(reduceColors(reversed, lab, { limit: 3 })), names(first));
});

test('degenerate inputs are handled rather than thrown at', () => {
    assert.equal(reduceColors(new Map(), lab, { limit: 5 }).size, 0);

    const single = reduceColors(new Map([[RED, 10]]), lab, { limit: 1 });
    assert.deepEqual(names(single), { red: 'red' });

    // A limit below 1 cannot be honoured; one color is the floor.
    const impossible = reduceColors(new Map([[RED, 10], [BLUE, 5]]), lab, { limit: 0, mergeFloor: 0 });
    assert.equal(distinct(impossible), 1);
});
