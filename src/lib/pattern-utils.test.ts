import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    MAX_PATTERN_CELLS,
    MAX_PATTERN_DIMENSION,
    addColorTally,
    calculateDimensions,
    colorDistanceSquared,
    findClosestColor,
    isTransparentAlpha,
    normalizePalette,
    parseHexColor,
    validatePalette
} from './pattern-utils';

test('parseHexColor converts six-digit hex strings', () => {
    assert.deepEqual(parseHexColor('#0aB2ff'), [10, 178, 255]);
    assert.deepEqual(parseHexColor('123456'), [18, 52, 86]);
    assert.equal(parseHexColor('#fff'), null);
});

test('normalizePalette adds RGB values when only hex is supplied', () => {
    assert.deepEqual(normalizePalette([{ name: 'white', hex: '#FFFFFF' }]), [{
        name: 'white',
        hex: '#FFFFFF',
        rgb: [255, 255, 255]
    }]);
});

test('validatePalette accepts normalized unique colors', () => {
    const palette = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'white', hex: '#FFFFFF' }
    ]);
    assert.deepEqual(validatePalette(palette), []);
});

test('validatePalette reports duplicates and malformed colors', () => {
    const palette = [
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'black', rgb: [0, 0, 0] },
        { name: 'bad', rgb: [0, 1] }
    ];
    assert.deepEqual(validatePalette(palette), [
        'Duplicate color code/name: black.',
        'Palette entry 3 (bad) has invalid RGB values.'
    ]);
});

test('calculateDimensions preserves aspect ratio', () => {
    assert.deepEqual(calculateDimensions(10, 0.197, 2, 1), {
        pixelWidth: 51,
        pixelHeight: 26,
        cellCount: 1326
    });
});

test('calculateDimensions rejects patterns beyond the NFR-3 hard limits', () => {
    // Over the per-side limit: 508 × 508.
    assert.throws(
        () => calculateDimensions(100, 0.197, 1, 1),
        /508 × 508 beads exceeds the limit of 300 beads per side/
    );
    // Within the per-side limit but over the cell limit: 250 × 250 = 62,500.
    assert.throws(
        () => calculateDimensions(49.25, 0.197, 1, 1),
        /250 × 250 is .* beads, over the limit of/
    );
    assert.equal(MAX_PATTERN_DIMENSION, 300);
    assert.equal(MAX_PATTERN_CELLS, 50000);
});

test('isTransparentAlpha identifies transparent pixels', () => {
    assert.equal(isTransparentAlpha(127), true);
    assert.equal(isTransparentAlpha(128), false);
    assert.equal(isTransparentAlpha(255), false);
});

test('findClosestColor chooses the nearest RGB color', () => {
    const palette = normalizePalette([
        { name: 'black', hex: '#000000' },
        { name: 'white', hex: '#FFFFFF' }
    ]);
    assert.equal(findClosestColor(20, 20, 20, palette).name, 'black');
    assert.equal(colorDistanceSquared(0, 0, 0, 3, 4, 0), 25);
});

test('addColorTally increments inventory counts', () => {
    const tallies = {};
    const color = { name: 'A1', rgb: [1, 2, 3] };
    addColorTally(tallies, color);
    addColorTally(tallies, color);
    assert.deepEqual(tallies, { A1: { name: 'A1', rgb: [1, 2, 3], count: 2 } });
});
