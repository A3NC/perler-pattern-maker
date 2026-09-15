import assert from 'node:assert/strict';
import { test } from 'vitest';
import { findClosestColor, normalizePalette } from './pattern-utils';
import {
    linearToOklab,
    linearToSrgbByte,
    oklabDistanceSquared,
    srgbByteToLinear,
    srgbToOklab
} from './oklab';
import type { Palette, PaletteColor } from '../types';

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`
    );
}

/** Nearest palette entry by OkLab distance. Inlined here because color-match.ts is step 2. */
function nearestOklab(r: number, g: number, b: number, palette: Palette): PaletteColor {
    const source = srgbToOklab(r, g, b);
    let best = palette[0];
    let bestDistance = Infinity;

    for (const color of palette) {
        const [cr, cg, cb] = color.rgb as [number, number, number];
        const lab = srgbToOklab(cr, cg, cb);
        const distance = oklabDistanceSquared(source.L, source.a, source.b, lab.L, lab.a, lab.b);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = color;
        }
    }

    return best;
}

test('white is L=1 with no chroma, black is the origin', () => {
    const white = srgbToOklab(255, 255, 255);
    assertClose(white.L, 1, 1e-6, 'white L');
    assertClose(white.a, 0, 1e-6, 'white a');
    assertClose(white.b, 0, 1e-6, 'white b');

    const black = srgbToOklab(0, 0, 0);
    assert.deepEqual([black.L, black.a, black.b], [0, 0, 0]);
});

test('a neutral gray has L = cbrt(linear) and no chroma', () => {
    // Both rows of the first matrix sum to 1, as does the second matrix's first
    // row, so this identity holds for any gray. It is the oracle that catches a
    // transposed or mis-typed matrix, which would otherwise still look plausible.
    for (const byte of [1, 18, 64, 128, 200, 254]) {
        const linear = srgbByteToLinear(byte);
        const lab = linearToOklab(linear, linear, linear);
        assertClose(lab.L, Math.cbrt(linear), 1e-6, `gray ${byte} L`);
        assertClose(lab.a, 0, 1e-6, `gray ${byte} a`);
        assertClose(lab.b, 0, 1e-6, `gray ${byte} b`);
    }
});

test('the chroma axes point the right way', () => {
    // a is green-red, b is blue-yellow. Signs only: this guards orientation,
    // not precision, and it fails loudly if the two output rows are swapped.
    const red = srgbToOklab(255, 0, 0);
    assert.ok(red.a > 0, 'red is on the +a side');
    assert.ok(red.b > 0, 'red is warm, so +b');

    const green = srgbToOklab(0, 255, 0);
    assert.ok(green.a < 0, 'green is on the -a side');

    const blue = srgbToOklab(0, 0, 255);
    assert.ok(blue.b < 0, 'blue is on the -b side');

    const yellow = srgbToOklab(255, 255, 0);
    assert.ok(yellow.b > 0, 'yellow is on the +b side');
});

test('L increases monotonically across the gray ramp', () => {
    let previous = -Infinity;
    for (let byte = 0; byte < 256; byte += 1) {
        const linear = srgbByteToLinear(byte);
        const { L } = linearToOklab(linear, linear, linear);
        assert.ok(L > previous, `L should increase at byte ${byte}`);
        previous = L;
    }
});

test('byte -> linear -> byte round-trips exactly for every byte', () => {
    for (let byte = 0; byte < 256; byte += 1) {
        assert.equal(linearToSrgbByte(srgbByteToLinear(byte)), byte, `byte ${byte}`);
    }
});

test('half the light encodes to 188, not 128', () => {
    // The fact the whole GEN-4 downscale rests on: an sRGB byte is not
    // proportional to light, so the midpoint of black and white is 188. Averaging
    // encoded bytes would give 128 -- a visibly darker gray -- and that error
    // lands on every blend in the pattern. (The exact value is 187.52, so the
    // rounding here is not a coin flip.)
    assert.equal(linearToSrgbByte(0.5), 188);
    assert.equal(linearToSrgbByte(0), 0);
    assert.equal(linearToSrgbByte(1), 255);
});

test('GEN-2: OkLab and RGB disagree on dark tones, and OkLab is right', () => {
    // The Check written as code. Source rgb(20,20,20) is visibly not black, but
    // sRGB distance puts it nearer #000000 (3 * 20^2 = 1200) than #2D2D2D
    // (3 * 25^2 = 1875), because gamma encoding compresses the dark end.
    // Perceptually the gap is 0.191 to black against 0.106 to #2D2D2D.
    const palette = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'gray45', hex: '#2D2D2D' }
    ]);

    assert.equal(findClosestColor(20, 20, 20, palette).name, 'black', 'RGB distance picks black');
    assert.equal(nearestOklab(20, 20, 20, palette).name, 'gray45', 'OkLab picks the lighter gray');

    // Pin the lightnesses the argument rests on, so a regression says why it broke.
    assertClose(srgbToOklab(20, 20, 20).L, 0.1913, 0.001, 'L of rgb(20,20,20)');
    assertClose(srgbToOklab(45, 45, 45).L, 0.2972, 0.001, 'L of rgb(45,45,45)');
});
