import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizePalette } from '../lib/pattern-utils';
import { generatePattern } from './generate';
import type { Palette, SourcePixels } from '../types';

const palette: Palette = normalizePalette([
    { name: 'black', hex: '#000000' },
    { name: 'white', hex: '#FFFFFF' }
]);

/** Build SourcePixels from [r,g,b,a] quadruples, row-major. */
function pixels(width: number, height: number, quads: number[][]): SourcePixels {
    return { data: Uint8ClampedArray.from(quads.flat()), width, height };
}

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

test('generatePattern maps every opaque cell to a palette color, row-major', () => {
    const { pattern, beadCount, tallies } = generatePattern(
        pixels(2, 2, [BLACK, WHITE, WHITE, BLACK]),
        palette,
        { gridWidth: 2, gridHeight: 2 }
    );

    assert.equal(pattern.width, 2);
    assert.equal(pattern.height, 2);
    assert.deepEqual(pattern.cells.map((cell) => cell?.name ?? null), ['black', 'white', 'white', 'black']);
    assert.equal(beadCount, 4);
    assert.deepEqual(Object.values(tallies).map((t) => [t.name, t.count]), [['black', 2], ['white', 2]]);
});

test('generatePattern leaves cells below the alpha threshold empty and unbilled', () => {
    const { pattern, beadCount, tallies } = generatePattern(
        pixels(2, 1, [[10, 10, 10, 127], [10, 10, 10, 128]]),
        palette,
        { gridWidth: 2, gridHeight: 1 }
    );

    assert.equal(pattern.cells[0], null, 'alpha 127 is transparent');
    assert.equal(pattern.cells[1]?.name, 'black', 'alpha 128 is opaque');
    assert.equal(beadCount, 1, 'empty cells contribute no beads (OUT-4)');
    assert.deepEqual(Object.keys(tallies), ['black']);
});

test('tallies accumulate in row-major order, which is what breaks sort ties', () => {
    // Equal counts: whichever color is seen first must stay first, because the
    // inventory sort is stable and therefore preserves insertion order.
    const { tallies } = generatePattern(
        pixels(2, 2, [WHITE, BLACK, BLACK, WHITE]),
        palette,
        { gridWidth: 2, gridHeight: 2 }
    );
    const byCount = Object.values(tallies).sort((a, b) => b.count - a.count);

    assert.deepEqual(byCount.map((t) => t.name), ['white', 'black']);
});

test('the pipeline averages the source in linear light before matching (GEN-4)', () => {
    // A 2x2 checkerboard collapsing into one cell is half the light, which is
    // sRGB 188 -- so it must land on #BCBCBC. Byte-space averaging would give
    // 128 and land on #808080, which is the whole point of the linear step.
    const grays = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'mid', hex: '#808080' },
        { name: 'light', hex: '#BCBCBC' },
        { name: 'white', hex: '#FFFFFF' }
    ]);

    const { pattern, beadCount } = generatePattern(
        pixels(2, 2, [BLACK, WHITE, WHITE, BLACK]),
        grays,
        { gridWidth: 1, gridHeight: 1 }
    );

    assert.equal(pattern.width, 1);
    assert.equal(pattern.height, 1);
    assert.equal(beadCount, 1);
    assert.equal(pattern.cells[0]?.name, 'light', 'half the light is 188, not 128');
});

test('GEN-7: the same input twice produces an identical pattern', () => {
    const source = () => pixels(4, 2, [
        BLACK, WHITE, [200, 30, 40, 255], [10, 90, 240, 255],
        WHITE, [10, 10, 10, 60], BLACK, [128, 128, 128, 255]
    ]);
    const options = { gridWidth: 3, gridHeight: 2 };

    const first = generatePattern(source(), palette, options);
    const second = generatePattern(source(), palette, options);

    assert.deepEqual(
        first.pattern.cells.map((cell) => cell?.name ?? null),
        second.pattern.cells.map((cell) => cell?.name ?? null)
    );
    assert.deepEqual(first.tallies, second.tallies);
    assert.equal(first.beadCount, second.beadCount);
});

test('GEN-3: the pattern never exceeds the color limit and leaves no cell unassigned', () => {
    const wide = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'white', hex: '#FFFFFF' },
        { name: 'red', hex: '#E03030' },
        { name: 'green', hex: '#30A030' },
        { name: 'blue', hex: '#2040C0' },
        { name: 'yellow', hex: '#E8D820' }
    ]);

    const source = pixels(3, 2, [
        [0, 0, 0, 255], [255, 255, 255, 255], [224, 48, 48, 255],
        [48, 160, 48, 255], [32, 64, 192, 255], [232, 216, 32, 255]
    ]);

    const { pattern, tallies, beadCount } = generatePattern(
        source, wide, { gridWidth: 3, gridHeight: 2, colorLimit: 2 }
    );

    const distinct = Object.keys(tallies);
    assert.ok(distinct.length <= 2, `expected at most 2 colors, got ${distinct.length}`);
    assert.ok(pattern.cells.every((cell) => cell !== null), 'no cell may be left unassigned');
    assert.equal(
        Object.values(tallies).reduce((sum, tally) => sum + tally.count, 0),
        beadCount,
        'counts must sum to the bead total (OUT-4)'
    );
});

test('a limit at or above the palette size still collapses near-duplicates (D17)', () => {
    // Two whites a hair apart, no binding limit. Phase A is what keeps a flat
    // canvas from speckling into both of them (R2).
    const whites = normalizePalette([
        { name: 'white', hex: '#FFFFFF' },
        { name: 'snow', hex: '#FEFEFE' },
        { name: 'black', hex: '#000000' }
    ]);

    const { tallies } = generatePattern(
        pixels(2, 1, [[255, 255, 255, 255], [254, 254, 254, 255]]),
        whites,
        { gridWidth: 2, gridHeight: 1, colorLimit: 3 }
    );

    assert.equal(Object.keys(tallies).length, 1, 'the two whites must read as one bead');
});
