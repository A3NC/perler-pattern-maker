import { tallyPattern } from '../lib/pattern-utils';
import type { ColorTally, Pattern } from '../types';

/**
 * The single owner of the live pattern and its tallies (M5, step 1).
 *
 * Before this existed the mutable state was in three places: main.ts computed
 * the stats line from a local `tallies` object and dropped it, inventory.ts kept
 * a private counts array, and canvas-view.ts kept the Pattern. EDIT-4 has to
 * move all three together on every edit, and three independent holders is how
 * counts drift apart. So there is one holder and a subscribe hook, and the
 * renderers read from it rather than being handed copies.
 *
 * The Pattern object itself is mutated in place and never replaced by an edit --
 * canvas-view.ts holds the same reference, M6 exports it, M7 serializes it
 * (`Pattern` does not change in this milestone). What changes is the tally
 * record, which is rebuilt from the pattern at every stroke boundary.
 *
 * DOM-free, so the subscribers decide what rendering means.
 */
export interface PatternState {
    pattern: Pattern;
    tallies: Record<string, ColorTally>;
    /** Non-empty cells. Derived, because every non-empty cell contributes exactly one tally. */
    beadCount: number;
}

/**
 * Why the state changed. The editor needs to tell a fresh generate apart from
 * one of its own edits -- a new pattern must drop the undo history, an edit
 * must not -- and identity-comparing the Pattern to catch it would be a guess
 * dressed up as a check.
 */
export type PatternChangeReason = 'set' | 'edited' | 'cleared';

type Listener = (state: PatternState | null, reason: PatternChangeReason) => void;

let current: PatternState | null = null;
const listeners: Listener[] = [];

function beadCountOf(tallies: Record<string, ColorTally>): number {
    let total = 0;
    for (const name of Object.keys(tallies)) total += tallies[name].count;
    return total;
}

/** Subscribe to every pattern change, including generate and clear. */
export function onPatternChange(listener: Listener): void {
    listeners.push(listener);
}

function notify(reason: PatternChangeReason): void {
    for (const listener of listeners) listener(current, reason);
}

/** Install a freshly generated pattern, discarding whatever was here. */
export function setPattern(pattern: Pattern, tallies: Record<string, ColorTally>): void {
    current = { pattern, tallies, beadCount: beadCountOf(tallies) };
    notify('set');
}

export function clearPatternState(): void {
    current = null;
    notify('cleared');
}

export function getPatternState(): PatternState | null {
    return current;
}

/**
 * Announce that the held pattern was edited in place. Re-tallies from the
 * pattern rather than trusting the incremental arithmetic the stroke did --
 * a full pass is ~1 ms at NFR-3's hard limit, and it makes drift impossible
 * rather than merely unlikely.
 */
export function patternEdited(): void {
    if (!current) return;
    current.tallies = tallyPattern(current.pattern);
    current.beadCount = beadCountOf(current.tallies);
    notify('edited');
}
