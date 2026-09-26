import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizePalette } from '../lib/pattern-utils';
import { countBeads, generatePattern } from './generate';
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
    // A ramp collapsing into one cell carries half the light, which is sRGB 188
    // -- so it must land on #BCBCBC. Byte-space averaging would give 128 and land
    // on #808080, which is the whole point of the linear step.
    //
    // The fixture is a gradient rather than the obvious 50/50 checkerboard
    // because D18's downsampler treats a clean two-level cell as lineart and
    // rebuilds it from its endpoints -- correctly, and by design. A ramp falls
    // through the bimodality gate to the plain mean, which is the path this
    // Check is about. downscale.test.ts pins the checkerboard itself.
    const grays = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'mid', hex: '#808080' },
        { name: 'light', hex: '#BCBCBC' },
        { name: 'white', hex: '#FFFFFF' }
    ]);

    // Eight levels evenly spaced in *linear* light from 0.05 to 0.95, encoded
    // back to bytes. The uneven byte spacing is the gamma curve made visible.
    const ramp = [63, 117, 150, 176, 198, 217, 234, 249].map((b) => [b, b, b, 255]);

    const { pattern, beadCount } = generatePattern(
        pixels(8, 1, ramp),
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

test('SET-3: countBeads excludes transparent cells rather than returning width x height', () => {
    // Left half opaque, right half clear: a 4 x 2 grid over it is 8 cells and 4 beads.
    const row = [BLACK, BLACK, BLACK, BLACK, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const source = pixels(8, 2, [...row, ...row]);

    assert.equal(countBeads(source, 4, 2), 4);
    assert.equal(countBeads(source, 4, 2), generatePattern(source, palette, { gridWidth: 4, gridHeight: 2 }).beadCount);
});

test('SET-3: countBeads agrees exactly with generatePattern at fractional scales', () => {
    // The readout sits above the stats line, so "close" is not good enough: a
    // cell whose mean coverage lands on the threshold must decide the same way
    // in both. Alpha is drawn from a band around 128 so plenty of cells do, and
    // the grid sizes are chosen so no scale divides the source evenly.
    let seed = 0x5eed;
    const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };

    const width = 37;
    const height = 23;
    const quads: number[][] = [];
    for (let i = 0; i < width * height; i += 1) {
        const roll = random();
        const alpha = roll < 0.2 ? 0 : roll < 0.4 ? 255 : 96 + Math.floor(random() * 64);
        quads.push([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), alpha]);
    }
    const source = pixels(width, height, quads);

    for (const [gridWidth, gridHeight] of [[5, 3], [7, 11], [13, 9], [36, 22], [37, 23], [50, 31]]) {
        const { beadCount } = generatePattern(source, palette, { gridWidth, gridHeight });
        assert.equal(countBeads(source, gridWidth, gridHeight), beadCount, `${gridWidth} x ${gridHeight}`);
    }
});
