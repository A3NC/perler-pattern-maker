import { requireElement } from '../dom';
import { cellsBetween } from '../lib/cell-path';
import { createEditHistory } from '../lib/edit-history';
import { floodFillRegion } from '../lib/flood-fill';
import { srgbToOklab } from '../lib/oklab';
import { DEFAULT_CANDIDATE_COUNT, filterPalette, nearestPaletteColors } from '../lib/palette-query';
import { applyEdits, createStrokeRecorder } from '../lib/pattern-edit';
import type { Stroke, StrokeRecorder } from '../lib/pattern-edit';
import { parseHexColor } from '../lib/pattern-utils';
import type { CellPosition } from '../lib/viewport';
import { paletteToOklab } from '../pipeline/color-match';
import { getPatternState, onPatternChange, patternEdited } from '../state/pattern-state';
import type { PatternState } from '../state/pattern-state';
import { cellAtPoint, isPatternCanvas, redrawPattern, setPointerMode } from './canvas-view';
import { onBeadSelect, setSelectedBead } from './inventory';
import type { Palette, PaletteColor } from '../types';

// The correction editor (M5, EDIT-1 ... EDIT-5, EDIT-7, EDIT-8).
//
// Everything deterministic is elsewhere and tested in bare Node (NFR-4): the
// history stack, the edit primitive, the drag interpolation, the fill search and
// the palette query are all pure functions in src/lib/. What is left here is
// pointer wiring, DOM, and the decision of which pure function a gesture means.
//
// The pattern is mutated in place, on the very object canvas-view.ts renders --
// `Pattern` does not change in this milestone, so M6 exports and M7 serializes
// exactly what the editor produced, with no second model to keep in step.

type Tool = 'pan' | 'brush' | 'eraser' | 'fill';

/** An in-flight paint drag, from pointerdown to pointerup, undone as one unit. */
interface ActiveStroke {
    pointerId: number;
    recorder: StrokeRecorder;
    /** The last cell reached, so the next sample can be joined to it. */
    last: CellPosition;
}

const outputContainer = requireElement('outputContainer');
const editorControls = requireElement('editorControls');
const undoBtn = requireElement<HTMLButtonElement>('undoBtn');
const redoBtn = requireElement<HTMLButtonElement>('redoBtn');
const activeColorBtn = requireElement<HTMLButtonElement>('activeColorBtn');
const activeColorSwatch = requireElement('activeColorSwatch');
const activeColorName = requireElement('activeColorName');
const colorPicker = requireElement('colorPicker');
const pickerColorInput = requireElement<HTMLInputElement>('pickerColorInput');
const pickerFilterInput = requireElement<HTMLInputElement>('pickerFilterInput');
const pickerResults = requireElement('pickerResults');

const TOOL_BUTTONS: { tool: Tool; id: string }[] = [
    { tool: 'pan', id: 'toolPanBtn' },
    { tool: 'brush', id: 'toolBrushBtn' },
    { tool: 'eraser', id: 'toolEraserBtn' },
    { tool: 'fill', id: 'toolFillBtn' }
];

/** How an empty cell reads as a choice. Empty is a value here, not the absence of one. */
const EMPTY_LABEL = 'Empty';

let palette: Palette = [];
/** The matcher's own OkLab table, reused so "nearest" means the same thing the generator meant. */
let paletteLab: Float64Array | undefined;
const paletteByName = new Map<string, PaletteColor>();

let tool: Tool = 'pan';
/** The active color; `null` is the empty bead, which is a pickable choice (EDIT-8). */
let activeColor: PaletteColor | null = null;
const history = createEditHistory();
let stroke: ActiveStroke | null = null;

// --- painting ---------------------------------------------------------------

/** What this tool writes. The eraser is the brush with empty forced (EDIT-2). */
function paintColor(): PaletteColor | null {
    return tool === 'eraser' ? null : activeColor;
}

function cellIndex(state: PatternState, cell: CellPosition): number {
    return (cell.row * state.pattern.width) + cell.col;
}

/**
 * Finish a stroke: record it, re-tally, redraw.
 *
 * The re-tally is deliberate belt and braces. The stroke already moved the
 * tallies cell by cell through applyEdits, but a full count at NFR-3's limit is
 * about a millisecond, and paying it at every stroke boundary removes tally
 * drift as a class instead of leaving it to be noticed later (EDIT-4).
 */
function commitStroke(edits: Stroke): void {
    if (edits.length > 0) history.push(edits);
    patternEdited();
    updateHistoryButtons();
    redrawPattern();
}

function undo(): void {
    const state = getPatternState();
    if (!state || !history.canUndo()) return;

    // One function for paint, undo and redo, so the cells and the counts cannot
    // be moved by one path and forgotten by another (EDIT-7).
    applyEdits(state.pattern, state.tallies, history.undo() as Stroke, 'revert');
    patternEdited();
    updateHistoryButtons();
    redrawPattern();
}

function redo(): void {
    const state = getPatternState();
    if (!state || !history.canRedo()) return;

    applyEdits(state.pattern, state.tallies, history.redo() as Stroke);
    patternEdited();
    updateHistoryButtons();
    redrawPattern();
}

/** Alt-click: adopt the color under the pointer. Records no edit and no history. */
function eyedrop(cell: CellPosition, state: PatternState): void {
    setActiveColor(state.pattern.cells[cellIndex(state, cell)]);
    // The picker ranks against the active color once it has been eyedropped, so
    // "something like this bead, but bluer" is one gesture plus one input.
    if (activeColor) pickerColorInput.value = toHex(activeColor);
    renderPickerResults();
}

function beginEdit(event: PointerEvent): void {
    if (!isPatternCanvas(event.target) || event.button !== 0) return;

    const state = getPatternState();
    if (!state) return;

    const cell = cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;

    // The eyedropper is live in every mode, pan included -- it is the most
    // direct expression of "make this cell match that one", and it changes
    // nothing, so there is no mode in which it is unsafe.
    if (event.altKey) {
        event.preventDefault();
        eyedrop(cell, state);
        return;
    }

    if (tool === 'pan') return; // canvas-view.ts owns this drag (EDIT-5).
    event.preventDefault();

    if (tool === 'fill') {
        // One stroke, however many cells: EDIT-8's Check requires it be undoable
        // as a single action.
        const recorder = createStrokeRecorder(state.pattern, state.tallies);
        const color = paintColor();
        for (const index of floodFillRegion(state.pattern, cell.col, cell.row)) {
            recorder.paint(index, color);
        }
        commitStroke(recorder.commit());
        return;
    }

    const recorder = createStrokeRecorder(state.pattern, state.tallies);
    recorder.paint(cellIndex(state, cell), paintColor());
    stroke = { pointerId: event.pointerId, recorder, last: cell };

    // Keeps the drag alive when the pointer leaves the container mid-stroke,
    // the same reason the pan handler captures.
    outputContainer.setPointerCapture(event.pointerId);
    redrawPattern();
}

function continueEdit(event: PointerEvent): void {
    if (!stroke || event.pointerId !== stroke.pointerId) return;

    const state = getPatternState();
    if (!state) return;

    const cell = cellAtPoint(event.clientX, event.clientY);
    // Outside the pattern: hold the last cell rather than ending the stroke, so
    // a drag that strays over the ruler and back does not split in two.
    if (!cell) return;

    // EDIT-1's watch-for: pointermove reports samples, not a path. Joining
    // consecutive samples is what makes a fast drag a continuous run at any
    // zoom instead of a dotted one.
    const color = paintColor();
    for (const step of cellsBetween(stroke.last, cell)) {
        stroke.recorder.paint(cellIndex(state, step), color);
    }

    stroke.last = cell;
    redrawPattern();
}

function endEdit(event: PointerEvent): void {
    if (!stroke || event.pointerId !== stroke.pointerId) return;

    if (outputContainer.hasPointerCapture(stroke.pointerId)) {
        outputContainer.releasePointerCapture(stroke.pointerId);
    }

    const edits = stroke.recorder.commit();
    stroke = null;
    commitStroke(edits);
}

// --- the active color, and the two-tier picker (EDIT-3) ----------------------

function toHex(color: PaletteColor): string {
    const [r, g, b] = color.rgb;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function setActiveColor(color: PaletteColor | null): void {
    activeColor = color;

    // The checker that marks "empty" is a background-*image* in the stylesheet,
    // and an image paints over a background-color -- so setting the color alone
    // leaves every bead showing the checker. The image has to be turned off for
    // a real color and handed back to the stylesheet for empty, which is what
    // keeps an empty bead from reading as a white one.
    if (color) {
        activeColorSwatch.style.backgroundColor = `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
        activeColorSwatch.style.backgroundImage = 'none';
    } else {
        activeColorSwatch.style.backgroundColor = '';
        activeColorSwatch.style.backgroundImage = '';
    }
    activeColorName.textContent = color ? color.name : EMPTY_LABEL;

    // Tier 1's selection indicator is the inventory row itself (EDIT-3's
    // "visibly indicated"), and tier 2's is the matching result swatch.
    setSelectedBead(color?.name ?? null);
    renderPickerResults();
}

/** A swatch row for the picker's result list. */
function pickerSwatch(
    color: PaletteColor | null,
    label: string,
    badge: string,
    inPattern: boolean
): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-swatch';
    if ((color?.name ?? null) === (activeColor?.name ?? null)) button.classList.add('selected');
    button.setAttribute('aria-pressed', String(button.classList.contains('selected')));

    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    if (color) {
        swatch.style.backgroundColor = `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
    } else {
        swatch.classList.add('active-color-swatch');
    }

    const code = document.createElement('span');
    code.className = 'picker-code';
    code.textContent = label;

    const badgeEl = document.createElement('span');
    badgeEl.className = inPattern ? 'picker-badge in-pattern' : 'picker-badge';
    badgeEl.textContent = badge;

    button.appendChild(swatch);
    button.appendChild(code);
    button.appendChild(badgeEl);
    button.addEventListener('click', () => setActiveColor(color));
    return button;
}

/**
 * Tier 2: the query panel over the whole palette.
 *
 * The result list is ranked strictly by OkLab distance and colors already in the
 * pattern are **badged, never promoted** -- "nearest" has to keep meaning
 * nearest or the ranking stops being worth trusting. The badge is what keeps the
 * shopping list honest: picking a blue when the pattern already holds P17 would
 * otherwise silently add P19 to the bead order, which is the growth SET-4 and
 * GEN-3 exist to prevent. Making it visible is v1's answer; capping the distinct
 * count *after* editing is a spec gap for M9, not something to invent here.
 */
function renderPickerResults(): void {
    if (palette.length === 0) return;

    const tallies = getPatternState()?.tallies ?? {};
    const filterText = pickerFilterInput.value;
    const candidates = filterPalette(palette, filterText);

    const [r, g, b] = parseHexColor(pickerColorInput.value) ?? [255, 255, 255];
    const ranked = nearestPaletteColors(palette, srgbToOklab(r, g, b), {
        lab: paletteLab,
        candidates,
        limit: DEFAULT_CANDIDATE_COUNT
    });

    pickerResults.innerHTML = '';

    // Empty is pinned first while no filter is typed, because it is the one
    // choice no palette query can return and the one fill-the-background needs.
    if (filterText.trim() === '') {
        pickerResults.appendChild(pickerSwatch(null, EMPTY_LABEL, 'no bead', false));
    }

    if (ranked.length === 0) {
        const message = document.createElement('span');
        message.className = 'picker-empty';
        message.textContent = `No palette color matches "${filterText.trim()}".`;
        pickerResults.appendChild(message);
        return;
    }

    for (const candidate of ranked) {
        const count = tallies[candidate.color.name]?.count ?? 0;
        pickerResults.appendChild(pickerSwatch(
            candidate.color,
            candidate.color.name,
            count > 0 ? `${count} in pattern` : 'new',
            count > 0
        ));
    }
}

function setPickerOpen(open: boolean): void {
    colorPicker.classList.toggle('is-open', open);
    activeColorBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;

    // Seed the query from the active color, so the panel opens on the beads
    // nearest what is already selected rather than on whatever is nearest white.
    // "Like this, but a bit darker" is the common reason to open it at all.
    if (activeColor) pickerColorInput.value = toHex(activeColor);
    renderPickerResults();
}

// --- chrome -----------------------------------------------------------------

function setTool(next: Tool): void {
    tool = next;
    // Pan mode hands the drag back to canvas-view and restores native touch
    // scrolling; any paint tool takes both (EDIT-5).
    setPointerMode(next === 'pan' ? 'pan' : 'paint');

    for (const entry of TOOL_BUTTONS) {
        requireElement(entry.id).setAttribute('aria-pressed', String(entry.tool === next));
    }
}

function updateHistoryButtons(): void {
    // Disabled at the ends, so the state of the stack is visible rather than
    // something the user has to probe for.
    undoBtn.disabled = !history.canUndo();
    redoBtn.disabled = !history.canRedo();
}

/**
 * The color the editor opens on. The pattern's most-used bead: always present,
 * so the shopping list does not grow before the first edit, and deterministic,
 * breaking ties on the code so the same pattern always opens the same way.
 */
function defaultColorFor(state: PatternState): PaletteColor | null {
    let best: string | null = null;

    for (const name of Object.keys(state.tallies)) {
        const tally = state.tallies[name];
        const current = best === null ? null : state.tallies[best];
        if (!current || tally.count > current.count
            || (tally.count === current.count && name.localeCompare(best as string) < 0)) {
            best = name;
        }
    }

    return best === null ? null : paletteByName.get(best) ?? null;
}

/** Hand the editor the loaded palette (PAL-2), once it is available. */
export function setEditorPalette(loaded: Palette): void {
    palette = loaded;
    paletteLab = paletteToOklab(loaded);

    paletteByName.clear();
    for (const color of loaded) paletteByName.set(color.name, color);

    renderPickerResults();
}

export function initEditorControls(): void {
    for (const entry of TOOL_BUTTONS) {
        requireElement(entry.id).addEventListener('click', () => setTool(entry.tool));
    }

    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);

    activeColorBtn.addEventListener('click', () => {
        setPickerOpen(!colorPicker.classList.contains('is-open'));
    });
    pickerColorInput.addEventListener('input', renderPickerResults);
    pickerFilterInput.addEventListener('input', renderPickerResults);

    // Tier 1: the inventory is the picker. Clicking a row adopts a color that is
    // already in the pattern, which is the common correction and costs the
    // shopping list nothing.
    onBeadSelect((tally) => setActiveColor(paletteByName.get(tally.name) ?? null));

    // On the container rather than the canvas, because the canvas is rebuilt on
    // every generate and the container is not -- the same reason the pan
    // listeners live there. Registered after them, so pan sees a pointerdown
    // first and declines it whenever a paint tool is active.
    outputContainer.addEventListener('pointerdown', beginEdit);
    outputContainer.addEventListener('pointermove', continueEdit);
    outputContainer.addEventListener('pointerup', endEdit);
    outputContainer.addEventListener('pointercancel', endEdit);

    window.addEventListener('keydown', (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;

        // The target-width, color-limit and filter fields are text inputs with
        // their own undo stacks; stealing the shortcut there would be a bug.
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
    });

    onPatternChange((state, reason) => {
        // An edit of our own: only the stack's ends can have moved.
        if (reason === 'edited') {
            updateHistoryButtons();
            return;
        }

        // A new pattern replaces the cells the history describes, so every
        // recorded `prev` now refers to a state that no longer exists.
        history.clear();
        stroke = null;
        setTool('pan');
        updateHistoryButtons();

        if (!state) {
            editorControls.classList.remove('is-active');
            setPickerOpen(false);
            setActiveColor(null);
            return;
        }

        editorControls.classList.add('is-active');
        setActiveColor(defaultColorFor(state));
    });

    setTool('pan');
    updateHistoryButtons();
}
