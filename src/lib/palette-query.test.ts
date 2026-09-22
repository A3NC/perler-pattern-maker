import assert from 'node:assert/strict';
import { test } from 'vitest';
import { srgbToOklab } from './oklab';
import { DEFAULT_CANDIDATE_COUNT, filterPalette, nearestPaletteColors } from './palette-query';
import type { Palette } from '../types';

const PALETTE: Palette = [
    { name: 'A1', hex: '#FFFFFF', rgb: [255, 255, 255] },
    { name: 'P17', hex: '#0000FF', rgb: [0, 0, 255] },
    { name: 'P19', hex: '#0000EE', rgb: [0, 0, 238] },
    { name: 'P18', hex: '#000000', rgb: [0, 0, 0] },
    { name: 'H1', hex: '#FF0000', rgb: [255, 0, 0] }
];

test('an empty filter returns the whole palette, with original indices', () => {
    const all = filterPalette(PALETTE, '   ');
    assert.equal(all.length, PALETTE.length);
    assert.deepEqual(all.map((entry) => entry.index), [0, 1, 2, 3, 4]);
});

test('the filter matches code fragments, case-insensitively', () => {
    assert.deepEqual(filterPalette(PALETTE, 'p1').map((e) => e.color.name), ['P17', 'P19', 'P18']);
    assert.deepEqual(filterPalette(PALETTE, 'h').map((e) => e.color.name), ['H1']);
    assert.deepEqual(filterPalette(PALETTE, 'zzz'), []);
});

test('the filter also matches hex, so a pasted value finds its bead', () => {
    assert.deepEqual(filterPalette(PALETTE, '#0000ff').map((e) => e.color.name), ['P17']);
});

test('ranking puts the exact palette color first at distance zero', () => {
    const ranked = nearestPaletteColors(PALETTE, srgbToOklab(0, 0, 255));

    assert.equal(ranked[0].color.name, 'P17');
    assert.ok(ranked[0].distance < 1e-12);
    // The near-identical blue is second; everything unrelated ranks below both.
    assert.equal(ranked[1].color.name, 'P19');
    assert.deepEqual(ranked.slice(2).map((entry) => entry.color.name).sort(), ['A1', 'H1', 'P18']);
});

test('ranking is ascending by distance and never reorders to favour anything else', () => {
    const ranked = nearestPaletteColors(PALETTE, srgbToOklab(30, 30, 200));
    for (let i = 1; i < ranked.length; i += 1) {
        assert.ok(ranked[i].distance >= ranked[i - 1].distance);
    }
});

test('a precomputed OkLab table gives identical results to computing one', () => {
    // color-match.ts already builds this table for the matcher; the picker's
    // notion of "close" must be the generator's, not a second implementation.
    const lab = new Float64Array(PALETTE.length * 3);
    PALETTE.forEach((color, i) => {
        const [r, g, b] = color.rgb as [number, number, number];
        const entry = srgbToOklab(r, g, b);
        lab[i * 3] = entry.L;
        lab[i * 3 + 1] = entry.a;
        lab[i * 3 + 2] = entry.b;
    });

    const target = srgbToOklab(10, 20, 220);
    assert.deepEqual(
        nearestPaletteColors(PALETTE, target, { lab }),
        nearestPaletteColors(PALETTE, target)
    );
});

test('a filtered candidate set is what gets ranked, so text and color compose', () => {
    const candidates = filterPalette(PALETTE, 'p1');
    const ranked = nearestPaletteColors(PALETTE, srgbToOklab(255, 255, 255), { candidates });

    assert.deepEqual(ranked.map((entry) => entry.color.name), ['P17', 'P19', 'P18']);
    assert.ok(!ranked.some((entry) => entry.color.name === 'A1'), 'the filter still excludes');
});

test('the limit caps the result, and defaults to the documented count', () => {
    assert.equal(nearestPaletteColors(PALETTE, srgbToOklab(0, 0, 0), { limit: 2 }).length, 2);
    assert.ok(DEFAULT_CANDIDATE_COUNT > PALETTE.length);
    assert.equal(nearestPaletteColors(PALETTE, srgbToOklab(0, 0, 0)).length, PALETTE.length);
});

test('equal distances break on the lower palette index', () => {
    const twins: Palette = [
        { name: 'Z9', rgb: [12, 34, 56] },
        { name: 'A1', rgb: [12, 34, 56] }
    ];
    const ranked = nearestPaletteColors(twins, srgbToOklab(12, 34, 56));
    assert.deepEqual(ranked.map((entry) => entry.index), [0, 1]);
});
