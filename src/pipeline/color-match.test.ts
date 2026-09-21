import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ACTIVE_MATCHER, oklabMatcher, rgbMatcher } from './color-match';
import { srgbByteToLinear } from '../lib/oklab';
import { findClosestColor, normalizePalette } from '../lib/pattern-utils';
import type { Palette } from '../types';

/** Match by sRGB bytes, doing the linearization the pipeline does. */
function matchBytes(matcher: { match(r: number, g: number, b: number): number }, r: number, g: number, b: number): number {
    return matcher.match(srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b));
}

const mixed: Palette = normalizePalette([
    { name: 'black', hex: '#000000' },
    { name: 'white', hex: '#FFFFFF' },
    { name: 'red', hex: '#FF0000' },
    { name: 'green', hex: '#00FF00' },
    { name: 'blue', hex: '#0000FF' },
    { name: 'slate', hex: '#708090' },
    { name: 'tan', hex: '#D2B48C' },
    { name: 'gray45', hex: '#2D2D2D' }
]);

test('GEN-2: the two matchers disagree on dark tones, and OkLab is the right one', () => {
    // GEN-6's Check and GEN-2's Check in one assertion. rgb(20,20,20) is visibly
    // not black, but sRGB distance puts it nearer #000000 (3 * 20^2 = 1200) than
    // #2D2D2D (3 * 25^2 = 1875) because gamma encoding compresses the dark end.
    // Perceptually the gap is 0.191 to black against 0.106 to #2D2D2D.
    const palette = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'gray45', hex: '#2D2D2D' }
    ]);

    assert.equal(palette[matchBytes(rgbMatcher(palette), 20, 20, 20)].name, 'black');
    assert.equal(palette[matchBytes(oklabMatcher(palette), 20, 20, 20)].name, 'gray45');
});

test('the OkLab matcher resolves exact palette colors to themselves', () => {
    const matcher = oklabMatcher(mixed);
    mixed.forEach((color, index) => {
        const [r, g, b] = color.rgb as [number, number, number];
        assert.equal(matchBytes(matcher, r, g, b), index, `${color.name} should match itself`);
    });
});

test('the RGB matcher reproduces findClosestColor exactly', () => {
    // Behavior parity is what makes it a usable A/B baseline: any difference seen
    // during the R1-R6 review is the algorithm, not the plumbing. The re-encode
    // from linear back to bytes is exact for anything that came from a byte.
    const matcher = rgbMatcher(mixed);
    for (let r = 0; r < 256; r += 17) {
        for (let g = 0; g < 256; g += 17) {
            for (let b = 0; b < 256; b += 17) {
                assert.equal(
                    mixed[matchBytes(matcher, r, g, b)].name,
                    findClosestColor(r, g, b, mixed).name,
                    `rgb(${r},${g},${b})`
                );
            }
        }
    }
});

test('both matchers always return an in-range palette index', () => {
    for (const factory of [oklabMatcher, rgbMatcher]) {
        const matcher = factory(mixed);
        for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [128, 64, 200], [7, 250, 3]]) {
            const index = matchBytes(matcher, r, g, b);
            assert.ok(Number.isInteger(index) && index >= 0 && index < mixed.length, `index ${index}`);
        }
    }
});

test('both matchers refuse an empty palette', () => {
    assert.throws(() => oklabMatcher([]), /No palette is available/);
    assert.throws(() => rgbMatcher([]), /No palette is available/);
    assert.equal(oklabMatcher(mixed).name, 'oklab');
    assert.equal(rgbMatcher(mixed).name, 'rgb');
});

test('ACTIVE_MATCHER ships as OkLab', () => {
    // Tuning means flipping this identifier back and forth (GEN-6). This is the
    // guard that it does not get left on the legacy algorithm.
    assert.equal(ACTIVE_MATCHER(mixed).name, 'oklab');
});
