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
        palette
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
        palette
    );

    assert.equal(pattern.cells[0], null, 'alpha 127 is transparent');
    assert.equal(pattern.cells[1]?.name, 'black', 'alpha 128 is opaque');
    assert.equal(beadCount, 1, 'empty cells contribute no beads (OUT-4)');
    assert.deepEqual(Object.keys(tallies), ['black']);
});

test('tallies accumulate in row-major order, which is what breaks sort ties', () => {
    // Equal counts: whichever color is seen first must stay first, because the
    // inventory sort is stable and therefore preserves insertion order.
    const { tallies } = generatePattern(pixels(2, 2, [WHITE, BLACK, BLACK, WHITE]), palette);
    const byCount = Object.values(tallies).sort((a, b) => b.count - a.count);

    assert.deepEqual(byCount.map((t) => t.name), ['white', 'black']);
});
