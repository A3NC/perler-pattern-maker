import assert from 'node:assert/strict';
import { test } from 'vitest';
import { regenerateNeedsConfirm, sameSettings } from './regenerate';
import type { SavedSettings } from './pattern-save';

const SETTINGS: SavedSettings = { targetWidth: 10, beadSize: 5, colorLimit: 30 };

test('no pattern, nothing to lose: never asks', () => {
    assert.equal(regenerateNeedsConfirm(null, SETTINGS), false);
});

test('an unedited pattern regenerates without asking, even with unchanged settings', () => {
    assert.equal(regenerateNeedsConfirm({ settings: SETTINGS, edited: false }, { ...SETTINGS }), false);
});

test('edits plus unchanged settings asks', () => {
    assert.equal(regenerateNeedsConfirm({ settings: SETTINGS, edited: true }, { ...SETTINGS }), true);
});

test('edits plus any one changed setting does not ask: the change is the intent', () => {
    const current = { settings: SETTINGS, edited: true };
    assert.equal(regenerateNeedsConfirm(current, { ...SETTINGS, targetWidth: 10.5 }), false);
    assert.equal(regenerateNeedsConfirm(current, { ...SETTINGS, beadSize: 2.6 }), false);
    assert.equal(regenerateNeedsConfirm(current, { ...SETTINGS, colorLimit: 29 }), false);
});

test('sameSettings compares all three fields and nothing else', () => {
    assert.equal(sameSettings(SETTINGS, { ...SETTINGS }), true);
    assert.equal(sameSettings(SETTINGS, { ...SETTINGS, colorLimit: 31 }), false);
});
