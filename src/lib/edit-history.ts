import type { Stroke } from './pattern-edit';

/**
 * Stroke-scoped undo/redo (EDIT-7). Holds strokes and a cursor; it never touches
 * a Pattern itself, so it stays pure and testable in bare Node (NFR-4) --
 * applying what it hands back is applyEdits' job, through the one function paint
 * also goes through.
 *
 * In-memory only, deliberately: SAVE-1 is pattern, settings and edits, not
 * history, so M7's scope is unchanged by this (D19).
 */

/**
 * How many recorded cells the stack may hold in total.
 *
 * Bounded by cells rather than by stroke count, because the two are unrelated
 * here: a fill at NFR-3's 50,000-cell limit is *one* stroke holding 50,000
 * records, so "keep the last 50 strokes" is anywhere between a few hundred
 * records and a hundred megabytes. A cell budget bounds the memory whatever the
 * strokes look like.
 *
 * A judgment call like MERGE_FLOOR and MIN_CODE_FONT_PX, so the tests assert the
 * eviction *behavior* and never this number: 200,000 records is roughly 10 MB as
 * plain objects, which is four full-grid fills of history.
 */
export const DEFAULT_CELL_BUDGET = 200000;

export interface EditHistory {
    /** Record a completed stroke. Empty strokes are ignored. */
    push(stroke: Stroke): void;
    /** The stroke to revert, or null at the bottom of the stack. */
    undo(): Stroke | null;
    /** The stroke to re-apply, or null at the top. */
    redo(): Stroke | null;
    canUndo(): boolean;
    canRedo(): boolean;
    clear(): void;
    /** Strokes currently held, undone ones included. For tests and diagnostics. */
    size(): number;
    /** Cells currently held, which is what the budget bounds. */
    recordedCells(): number;
}

export function createEditHistory(cellBudget = DEFAULT_CELL_BUDGET): EditHistory {
    let strokes: Stroke[] = [];
    /** Strokes currently applied to the pattern; also the index of the next redo. */
    let cursor = 0;
    let cells = 0;

    function recount(): void {
        cells = strokes.reduce((total, stroke) => total + stroke.length, 0);
    }

    /**
     * Drop oldest strokes until the budget is met, never dropping the only
     * stroke left: a single fill can exceed the budget on its own, and the one
     * thing that must always work is undoing what was just done.
     */
    function evict(): void {
        while (cells > cellBudget && strokes.length > 1) {
            const dropped = strokes.shift() as Stroke;
            cells -= dropped.length;
            cursor -= 1;
        }
    }

    return {
        push(stroke: Stroke): void {
            if (stroke.length === 0) return;

            // The truncation rule. A new edit made after undoing invalidates
            // every stroke past the cursor: their `prev` values describe a state
            // the pattern will never be in again, so replaying them would write
            // garbage. Discard the tail before pushing (EDIT-7's Check).
            if (cursor < strokes.length) {
                strokes = strokes.slice(0, cursor);
                recount();
            }

            strokes.push(stroke);
            cells += stroke.length;
            cursor = strokes.length;
            // Only reachable from here: eviction with the cursor mid-stack would
            // have to decide what redoing past a dropped stroke means.
            evict();
        },

        undo(): Stroke | null {
            if (cursor === 0) return null;
            cursor -= 1;
            return strokes[cursor];
        },

        redo(): Stroke | null {
            if (cursor >= strokes.length) return null;
            const stroke = strokes[cursor];
            cursor += 1;
            return stroke;
        },

        canUndo: () => cursor > 0,
        canRedo: () => cursor < strokes.length,

        clear(): void {
            strokes = [];
            cursor = 0;
            cells = 0;
        },

        size: () => strokes.length,
        recordedCells: () => cells
    };
}
