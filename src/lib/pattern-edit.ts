import { addColorTally, removeColorTally } from './pattern-utils';
import type { ColorTally, PaletteColor, Pattern } from '../types';

/**
 * The edit primitive for M5's correction editor (EDIT-1, EDIT-2, EDIT-7,
 * EDIT-8). Pure and DOM-free so it tests in bare Node (NFR-4); the pointer
 * wiring that produces these records lives in src/render/editor.ts.
 *
 * `Pattern` is deliberately unchanged by this milestone: an edit is
 * `cells[index] = color` on the very object canvas-view.ts renders, M6 exports,
 * and M7 serializes. Nothing here introduces a second model of the pattern.
 */

/**
 * One cell's before and after. A single record serves both directions -- undo
 * writes `prev`, redo writes `next` -- which is why redo costs no storage the
 * data does not already carry (D19).
 */
export interface CellEdit {
    index: number;
    prev: PaletteColor | null;
    next: PaletteColor | null;
}

/** A stroke: one pointerdown-to-pointerup, or one fill, undone as a unit (EDIT-7). */
export type Stroke = CellEdit[];

export type EditDirection = 'apply' | 'revert';

/** Palette colors are compared by name, which PAL-4 guarantees is unique. */
export function sameCellColor(a: PaletteColor | null, b: PaletteColor | null): boolean {
    return (a?.name ?? null) === (b?.name ?? null);
}

/**
 * Write a stroke into the pattern and move the tallies with it.
 *
 * **One function for paint, undo, and redo.** That is what makes EDIT-4 hold by
 * construction: there is no second code path that could update the cells and
 * forget the counts, or vice versa. `direction` only chooses which end of each
 * record is the source and which is the destination.
 *
 * Reverting walks the records backwards. Within a stroke each cell appears at
 * most once when the recorder below produced it, but a hand-built stroke need
 * not be, and applying the inverse in reverse order is the only ordering that
 * is correct for both.
 */
export function applyEdits(
    pattern: Pattern,
    tallies: Record<string, ColorTally>,
    edits: readonly CellEdit[],
    direction: EditDirection = 'apply'
): void {
    const forward = direction === 'apply';

    for (let step = 0; step < edits.length; step += 1) {
        const edit = edits[forward ? step : edits.length - 1 - step];
        const from = forward ? edit.prev : edit.next;
        const to = forward ? edit.next : edit.prev;

        if (from) removeColorTally(tallies, from);
        pattern.cells[edit.index] = to;
        if (to) addColorTally(tallies, to);
    }
}

/**
 * Accumulates one stroke while the pointer is down, applying each cell as it is
 * painted so the canvas can redraw immediately.
 *
 * A drag crosses the same cell more than once -- interpolation between two
 * pointer samples overlaps the previous segment's endpoint, and a user
 * scribbles. Each index therefore gets exactly one record, whose `prev` is the
 * color the cell held when the stroke *started*; later paints only move `next`.
 * Without that, undo would replay an intermediate state rather than the state
 * before the stroke.
 */
export interface StrokeRecorder {
    /** Paint one cell. Returns true if the cell actually changed. */
    paint(index: number, color: PaletteColor | null): boolean;
    /** The recorded edits, in first-touch order, with no-ops dropped. */
    commit(): Stroke;
}

export function createStrokeRecorder(
    pattern: Pattern,
    tallies: Record<string, ColorTally>
): StrokeRecorder {
    const byIndex = new Map<number, CellEdit>();
    const order: CellEdit[] = [];

    return {
        paint(index: number, color: PaletteColor | null): boolean {
            if (!Number.isInteger(index) || index < 0 || index >= pattern.cells.length) return false;

            const current = pattern.cells[index];
            if (sameCellColor(current, color)) return false;

            const existing = byIndex.get(index);
            if (existing) {
                existing.next = color;
            } else {
                const edit: CellEdit = { index, prev: current, next: color };
                byIndex.set(index, edit);
                order.push(edit);
            }

            // Applied through the same function undo and redo use, so a stroke
            // in progress and a replayed one cannot disagree about the tallies.
            applyEdits(pattern, tallies, [{ index, prev: current, next: color }]);
            return true;
        },

        commit(): Stroke {
            // A cell painted away and back again inside one stroke is not an
            // edit; keeping it would make undo look like it did nothing.
            return order.filter((edit) => !sameCellColor(edit.prev, edit.next));
        }
    };
}
