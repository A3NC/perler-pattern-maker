import assert from 'node:assert/strict';
import { test } from 'vitest';
import { MAX_PATTERN_CELLS, tallyPattern } from './pattern-utils';
import { SAVE_VERSION, decodeImageRecord, decodePattern, encodePattern } from './pattern-save';
import type { SavedImageRecord, SavedPatternRecord, SavedSettings } from './pattern-save';
import type { Pattern, PaletteColor } from '../types';

const RED: PaletteColor = { name: 'P05', hex: '#ff0000', rgb: [255, 0, 0] };
const WHITE: PaletteColor = { name: 'P01', hex: '#ffffff', rgb: [255, 255, 255] };
const BLACK: PaletteColor = { name: 'P18', rgb: [0, 0, 0] };

const SETTINGS: SavedSettings = { targetWidth: 10, beadSize: 5, colorLimit: 30 };
const NOW = new Date('2026-09-24T12:00:00.000Z');

function smallPattern(): Pattern {
    return {
        width: 3,
        height: 2,
        cells: [RED, null, WHITE, BLACK, RED, null]
    };
}

function hardLimitPattern(): Pattern {
    // 250 × 200 = 50,000 cells, the NFR-3 hard limit, cycling through the
    // three colors and empty so every index kind appears.
    const width = 250;
    const height = 200;
    const choices = [RED, WHITE, null, BLACK];
    const cells = Array.from({ length: width * height }, (_, i) => choices[(i * 7) % choices.length]);
    return { width, height, cells };
}

function roundTrip(pattern: Pattern) {
    const decoded = decodePattern(encodePattern(pattern, SETTINGS, 'gen-1', NOW));
    assert.ok(decoded.ok, decoded.ok ? '' : decoded.reason);
    return decoded;
}

function assertSameCells(actual: Pattern, expected: Pattern): void {
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    assert.equal(actual.cells.length, expected.cells.length);
    for (let i = 0; i < expected.cells.length; i++) {
        const want = expected.cells[i];
        const got = actual.cells[i];
        if (want === null) {
            assert.equal(got, null, `cell ${i} should be empty`);
        } else {
            assert.ok(got, `cell ${i} should hold ${want.name}`);
            assert.equal(got.name, want.name);
            assert.deepEqual(got.rgb, want.rgb);
        }
    }
}

function validRecord(): SavedPatternRecord {
    return encodePattern(smallPattern(), SETTINGS, 'gen-1', NOW);
}

function validImage(): SavedImageRecord {
    return {
        version: SAVE_VERSION,
        generation: 'gen-1',
        file: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        name: 'cat.png',
        type: 'image/png',
        crop: { x: 4, y: 0, width: 100, height: 80 }
    };
}

test('a small pattern round-trips cell for cell, empties included', () => {
    const decoded = roundTrip(smallPattern());
    assertSameCells(decoded.pattern, smallPattern());
    assert.deepEqual(decoded.settings, SETTINGS);
    assert.equal(decoded.generation, 'gen-1');
    assert.equal(decoded.savedAt, NOW.toISOString());
});

test('a pattern at the NFR-3 hard limit round-trips', () => {
    const original = hardLimitPattern();
    assert.equal(original.cells.length, MAX_PATTERN_CELLS);
    assertSameCells(roundTrip(original).pattern, original);
});

test('tallies of a restored pattern equal the original tallies', () => {
    const original = hardLimitPattern();
    assert.deepEqual(tallyPattern(roundTrip(original).pattern), tallyPattern(original));
});

test('the color table holds each used color once, in first-seen order', () => {
    const record = validRecord();
    assert.deepEqual(record.colors.map((c) => c.name), ['P05', 'P01', 'P18']);
    assert.deepEqual([...record.cells], [0, -1, 1, 2, 0, -1]);
});

test('decoded cells of one color share one object, as a generated pattern does', () => {
    const { pattern } = roundTrip(smallPattern());
    assert.equal(pattern.cells[0], pattern.cells[4]);
});

test('encoding is deterministic for a given pattern, generation and time', () => {
    assert.deepEqual(validRecord(), validRecord());
});

test('an all-empty pattern round-trips with an empty color table', () => {
    const empty: Pattern = { width: 2, height: 2, cells: [null, null, null, null] };
    const decoded = roundTrip(empty);
    assert.deepEqual(decoded.pattern.cells, [null, null, null, null]);
});

test('the stored colors are copies, not the palette objects', () => {
    const record = validRecord();
    assert.notEqual(record.colors[0], RED);
    assert.equal('hex' in record.colors[2], false);
});

// --- rejections: each returns ok: false rather than throwing ------------------

function assertRejected(record: unknown): void {
    const decoded = decodePattern(record);
    assert.equal(decoded.ok, false);
}

test('rejects something that is not a record at all', () => {
    assertRejected(null);
    assertRejected('{"version":1}');
    assertRejected(undefined);
});

test('rejects an unknown version', () => {
    assertRejected({ ...validRecord(), version: 2 });
});

test('rejects a missing generation or timestamp', () => {
    assertRejected({ ...validRecord(), generation: '' });
    assertRejected({ ...validRecord(), savedAt: undefined });
});

test('rejects non-integer or non-positive dimensions', () => {
    assertRejected({ ...validRecord(), width: 0 });
    assertRejected({ ...validRecord(), height: 2.5 });
    assertRejected({ ...validRecord(), width: '3' });
});

test('rejects dimensions beyond the NFR-3 limits', () => {
    assertRejected({ ...validRecord(), width: 301, height: 1, cells: new Int16Array(301) });
    assertRejected({ ...validRecord(), width: 250, height: 201, cells: new Int16Array(250 * 201) });
});

test('rejects a cell count that does not match the dimensions', () => {
    assertRejected({ ...validRecord(), cells: new Int16Array(5) });
});

test('rejects cells stored as anything but an Int16Array', () => {
    assertRejected({ ...validRecord(), cells: [0, -1, 1, 2, 0, -1] });
});

test('rejects a cell index outside the color table', () => {
    assertRejected({ ...validRecord(), cells: Int16Array.from([0, -1, 1, 3, 0, -1]) });
    assertRejected({ ...validRecord(), cells: Int16Array.from([0, -2, 1, 2, 0, -1]) });
});

test('rejects colors that fail palette validation', () => {
    assertRejected({ ...validRecord(), colors: [RED, { name: 'P05', rgb: [1, 2, 3] }, BLACK] });
    assertRejected({ ...validRecord(), colors: [RED, { name: 'P01', rgb: [256, 0, 0] }, BLACK] });
    assertRejected({ ...validRecord(), colors: 'P05' });
});

test('rejects settings that are not finite positive numbers', () => {
    assertRejected({ ...validRecord(), settings: { ...SETTINGS, targetWidth: Number.NaN } });
    assertRejected({ ...validRecord(), settings: { ...SETTINGS, beadSize: '5' } });
    assertRejected({ ...validRecord(), settings: null });
});

// --- the image record ---------------------------------------------------------

test('a valid image record decodes', () => {
    const decoded = decodeImageRecord(validImage());
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.crop, { x: 4, y: 0, width: 100, height: 80 });
    assert.equal(decoded.name, 'cat.png');
    assert.equal(decoded.generation, 'gen-1');
});

test('image records reject a bad version, generation, file, or crop', () => {
    assert.equal(decodeImageRecord(null).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), version: 2 }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), generation: '' }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), file: 'bytes' }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), name: undefined }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), crop: { x: -1, y: 0, width: 1, height: 1 } }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), crop: { x: 0, y: 0, width: 0, height: 1 } }).ok, false);
    assert.equal(decodeImageRecord({ ...validImage(), crop: { x: 0.5, y: 0, width: 1, height: 1 } }).ok, false);
});
