import type { SavedSettings } from './pattern-save';

/**
 * Whether a Generate should ask before replacing the current pattern (M9). Pure
 * and DOM-free, so it tests in Node (NFR-4); `main.ts` owns the prompt.
 *
 * It asks only when **nothing has changed** and the pattern has hand edits. The
 * image and the crop need no comparison: a new upload already clears the
 * pattern, and the crop is fixed once a pattern exists (D21), so any pattern
 * still held belongs to the image and crop now loaded. That leaves the three
 * settings. When all three match the ones that produced the pattern, GEN-7 says
 * the Generate reproduces the untouched pattern exactly, so the only thing it
 * can do is erase the edits -- worth a question, since it is then either a
 * slip or a deliberate "revert to generated". A changed setting is read as
 * intent, and the pattern is replaced without asking, as it always was.
 */
export function regenerateNeedsConfirm(
    current: { settings: SavedSettings; edited: boolean } | null,
    next: SavedSettings
): boolean {
    if (!current || !current.edited) return false;
    return sameSettings(current.settings, next);
}

export function sameSettings(a: SavedSettings, b: SavedSettings): boolean {
    return a.targetWidth === b.targetWidth
        && a.beadSize === b.beadSize
        && a.colorLimit === b.colorLimit;
}

export const REGENERATE_CONFIRM_MESSAGE =
    'Generate again with the same settings? This discards your hand edits and puts back the '
    + 'pattern as it was first generated. It cannot be undone.';
