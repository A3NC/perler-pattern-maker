import { getContrastColor } from '../contrast';
import { requireElement } from '../dom';
import {
    gridlineIndices,
    rulerLabelStep,
    shouldDrawGridlines,
    shouldDrawRuler
} from '../lib/guides';
import {
    CODE_FONT_RATIO,
    MAX_CELL_SIZE_PX,
    ZOOM_STEP,
    clampCellSize,
    fitCellSize,
    cellAtClientPoint,
    shouldDrawCodes,
    visibleCellRange,
    zoomedScrollOffset
} from '../lib/viewport';
import type { CellPosition, CellRange } from '../lib/viewport';
import type { Pattern } from '../types';

// The canvas pattern view (D1), replacing the element-per-bead grid.
//
// Container model (settled at step 2, per the plan's size targets): the canvas
// is sized to the *container*, never to the pattern. #grid-wrapper survives as
// an empty spacer sized to the full pattern, which is what gives
// .output-container something to scroll natively; the canvas sits inside it as
// a `position: sticky` overlay pinned to the visible corner, and every scroll
// redraws just the cell range under it. At VIEW-2's maximum zoom a
// pattern-sized canvas would be 4688 x 4688 for the 100 x 100 design target
// alone -- past mobile canvas area caps -- so this is a precondition for zoom,
// not a later optimization. It is also what made raising that ceiling free.
//
// Every length in this module is a CSS pixel. The canvas backing store is the
// one exception -- sized by devicePixelRatio in layout(), with the density
// applied once at the context so the draw loop never sees it.

const outputContainer = requireElement('outputContainer');
const zoomControls = requireElement('zoomControls');
const toggleTextBtn = requireElement<HTMLInputElement>('toggleTextBtn');
const toggleGridBtn = requireElement<HTMLInputElement>('toggleGridBtn');

/** How much of a cell's width a code may fill before the font is shrunk to fit. */
const CODE_MAX_WIDTH_RATIO = 0.86;

// A gridline crosses many cells, so contrast.ts's per-cell choice cannot apply:
// there is no single bead colour to contrast against. Drawn instead as a
// dark/light pair one CSS pixel apart, so one half of the rule always reads.
const GRID_RULE_DARK = 'rgba(0, 0, 0, 0.55)';
const GRID_RULE_LIGHT = 'rgba(255, 255, 255, 0.6)';

// Ruler chrome is fixed-size: it labels the view, not the beads, so unlike code
// text it does not scale with zoom. rulerLabelStep is what stops it colliding.
const RULER_FONT_PX = 10;
const RULER_BAND_PX = 15;
const RULER_PADDING_PX = 3;
const RULER_BACKGROUND = 'rgba(255, 255, 255, 0.86)';
const RULER_TEXT = '#1F2937';

interface View {
    pattern: Pattern;
    /** Empty, pattern-sized: drives the container's native scrollbars. */
    spacer: HTMLDivElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    /**
     * Canvas size in CSS px, set by layout(). Kept on the view because
     * canvas.width/.height are device pixels once the backing store is scaled
     * by devicePixelRatio, and the draw loop needs the CSS lengths: reading the
     * backing store there would widen the visible cell range by dpr on each
     * axis and draw four times the cells per frame at dpr 2.
     */
    width: number;
    height: number;
    /** Current zoom, expressed as the on-screen size of one bead in CSS px. */
    cellSize: number;
    /** Fit-to-container cell size: VIEW-2's zoom-out floor. */
    minCellSize: number;
    /** Longest bead code in this pattern, which is what the code font has to fit. */
    widestCode: string;
}

/** An in-flight drag, anchored at the offsets the pointer went down on. */
interface Pan {
    pointerId: number;
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
}

let view: View | null = null;
let pan: Pan | null = null;
let redrawHandle = 0;

/**
 * What a drag on the canvas does. M5's editor owns the choice; the view owns
 * the consequences, because both of them belong to the canvas element this
 * module creates and replaces on every generate.
 */
let pointerMode: PointerMode = 'pan';

export type PointerMode = 'pan' | 'paint';

export function showProcessing(): void {
    view = null;
    outputContainer.innerHTML = 'Processing...';
}

export function clearPattern(): void {
    view = null;
    outputContainer.innerHTML = '';
}

/** Build the canvas view and open at minimum zoom, whole pattern visible. */
export function renderPattern(pattern: Pattern): void {
    outputContainer.innerHTML = '';

    const spacer = document.createElement('div');
    spacer.id = 'grid-wrapper';

    const canvas = document.createElement('canvas');
    canvas.id = 'pattern-canvas';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not provide a 2D canvas context to draw the pattern.');

    spacer.appendChild(canvas);
    outputContainer.appendChild(spacer);

    const minCellSize = fitCellSize(
        pattern.width,
        pattern.height,
        outputContainer.clientWidth,
        outputContainer.clientHeight
    );

    view = {
        pattern,
        spacer,
        canvas,
        ctx,
        // Filled by the layout() below, which is what measures the container.
        width: 0,
        height: 0,
        cellSize: minCellSize,
        minCellSize,
        widestCode: widestCodeIn(pattern)
    };

    layout();
    applyPointerMode();
    outputContainer.scrollLeft = 0;
    outputContainer.scrollTop = 0;
    draw();

    zoomControls.style.display = 'flex';
}

function applyPointerMode(): void {
    // Re-applied here as well as in setPointerMode: renderPattern builds a new
    // canvas element on every generate, and the class lives on the element.
    view?.canvas.classList.toggle('painting', pointerMode === 'paint');
}

/**
 * Gate drag-to-pan, and hand touch over to the right consumer (EDIT-5).
 *
 * The touch half is the trap. beginPan deliberately ignores touch because the
 * canvas sits in a native scroll container that already pans it -- which means
 * that in a paint mode a touch-drag would scroll instead of painting. The fix is
 * `touch-action: none` on the canvas, and it has to come back off in pan mode or
 * native touch scrolling is gone. Both live on the .painting class.
 */
export function setPointerMode(mode: PointerMode): void {
    pointerMode = mode;
    applyPointerMode();
}

/** The bead under a screen point, or null outside the pattern. M5's seam (D1). */
export function cellAtPoint(clientX: number, clientY: number): CellPosition | null {
    if (!view) return null;
    const rect = view.canvas.getBoundingClientRect();

    return cellAtClientPoint({
        clientX,
        clientY,
        canvasLeft: rect.left,
        canvasTop: rect.top,
        scrollLeft: outputContainer.scrollLeft,
        scrollTop: outputContainer.scrollTop,
        cellSize: view.cellSize,
        patternWidth: view.pattern.width,
        patternHeight: view.pattern.height
    });
}

/**
 * Whether an event landed on the pattern itself. The editor's listeners sit on
 * the container alongside the pan ones, and a pointerdown on the container's
 * native scrollbar targets the container too -- which maps to a perfectly valid
 * cell and would paint one.
 */
export function isPatternCanvas(target: EventTarget | null): boolean {
    return view !== null && target === view.canvas;
}

/** Repaint after an edit. Coalesced to one draw per frame, like scrolling. */
export function redrawPattern(): void {
    queueRedraw();
}

/** Resize the spacer to the zoomed pattern and the canvas to the container. */
function layout(): void {
    if (!view) return;
    const { pattern, spacer, canvas, ctx, cellSize } = view;

    spacer.style.width = `${pattern.width * cellSize}px`;
    spacer.style.height = `${pattern.height * cellSize}px`;

    // Measured after the spacer resizes, so these already account for a
    // scrollbar that just appeared or vanished.
    const width = Math.max(1, Math.round(Math.min(pattern.width * cellSize, outputContainer.clientWidth)));
    const height = Math.max(1, Math.round(Math.min(pattern.height * cellSize, outputContainer.clientHeight)));

    // The backing store is device pixels; everything else in this module --
    // cellSize, scroll offsets, the visible range, the code font, the step 3
    // coordinate mapping -- stays in CSS pixels, and density is applied exactly
    // once, by the transform below. Folding dpr into cellSize instead would
    // push it back through the zoom math, the mapping, and the legibility
    // threshold, which is why it is deliberately confined to these four lines.
    //
    // Read fresh each layout: devicePixelRatio changes with browser zoom and
    // with a move to a different display, and both paths reach us through
    // handleResize.
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    // Assigning width/height resets the context to its defaults, transform
    // included, so this has to follow the resize rather than be set up once.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    view.width = width;
    view.height = height;
}

function widestCodeIn(pattern: Pattern): string {
    let widest = '';
    for (const cell of pattern.cells) {
        if (cell && cell.name.length > widest.length) widest = cell.name;
    }
    return widest;
}

/**
 * Size the code font to the cell, shrinking it if the pattern's widest code
 * would spill past its cell. The default palette's codes are two or three
 * characters and never trigger the shrink; a palette loaded under PAL-6 might.
 */
function setCodeFont(ctx: CanvasRenderingContext2D, cellSize: number, widestCode: string): void {
    const fontSize = cellSize * CODE_FONT_RATIO;
    ctx.font = `bold ${fontSize}px monospace`;

    const maxWidth = cellSize * CODE_MAX_WIDTH_RATIO;
    const width = ctx.measureText(widestCode).width;
    // Text width scales linearly with font size, so one correction is exact.
    if (width > maxWidth) {
        ctx.font = `bold ${fontSize * (maxWidth / width)}px monospace`;
    }
}

/**
 * Gridlines every GRID_INTERVAL cells (VIEW-6). Two passes rather than two
 * fillStyle assignments per line, and fillRect rather than stroke -- a stroked
 * line is centred on its coordinate and needs a half-pixel offset to stay
 * crisp, while a filled rect lands on the pixel grid by construction.
 */
function drawGridlines(
    ctx: CanvasRenderingContext2D,
    cols: CellRange,
    rows: CellRange,
    cellSize: number,
    scrollLeft: number,
    scrollTop: number,
    width: number,
    height: number
): void {
    if (!shouldDrawGridlines(cellSize)) return;

    const verticals = gridlineIndices(cols).map((col) => Math.round((col * cellSize) - scrollLeft));
    const horizontals = gridlineIndices(rows).map((row) => Math.round((row * cellSize) - scrollTop));

    ctx.fillStyle = GRID_RULE_DARK;
    for (const x of verticals) ctx.fillRect(x, 0, 1, height);
    for (const y of horizontals) ctx.fillRect(0, y, width, 1);

    ctx.fillStyle = GRID_RULE_LIGHT;
    for (const x of verticals) ctx.fillRect(x + 1, 0, 1, height);
    for (const y of horizontals) ctx.fillRect(0, y + 1, width, 1);
}

/**
 * Row and column numbers along the view's edges (VIEW-7), which is what turns
 * self-similar gridlines into an absolute position. They need no sticky
 * positioning of their own: the canvas is already pinned to the visible corner
 * of the scroll area, so its first pixels are always on screen.
 *
 * Drawn per axis, and only where the pattern overflows -- see shouldDrawRuler.
 */
function drawRulers(
    ctx: CanvasRenderingContext2D,
    pattern: Pattern,
    cols: CellRange,
    rows: CellRange,
    cellSize: number,
    scrollLeft: number,
    scrollTop: number,
    width: number,
    height: number
): void {
    const showColumns = shouldDrawRuler(pattern.width * cellSize, width);
    const showRows = shouldDrawRuler(pattern.height * cellSize, height);
    if (!showColumns && !showRows) return;

    const step = rulerLabelStep(cellSize);
    ctx.font = `bold ${RULER_FONT_PX}px monospace`;

    // Sized to the widest number this pattern can print, so a three-digit row
    // index near NFR-3's 300-per-side limit is never clipped.
    const bandWidth = showRows
        ? Math.ceil(ctx.measureText(String(pattern.height)).width) + (RULER_PADDING_PX * 2)
        : 0;
    const bandHeight = showColumns ? RULER_BAND_PX : 0;

    ctx.fillStyle = RULER_BACKGROUND;
    if (showColumns) ctx.fillRect(0, 0, width, bandHeight);
    // Starts below the column band rather than at 0: overlapping fills would
    // make the shared corner visibly darker than either strip.
    if (showRows) ctx.fillRect(0, bandHeight, bandWidth, height - bandHeight);

    ctx.fillStyle = RULER_TEXT;
    ctx.textBaseline = 'middle';

    if (showColumns) {
        ctx.textAlign = 'left';
        for (const col of gridlineIndices(cols, step)) {
            const x = Math.round((col * cellSize) - scrollLeft);
            // Would land in the row band and collide with a row number.
            if (x + RULER_PADDING_PX < bandWidth) continue;
            ctx.fillText(String(col), x + RULER_PADDING_PX, bandHeight / 2);
        }
    }

    if (showRows) {
        ctx.textAlign = 'right';
        for (const row of gridlineIndices(rows, step)) {
            const y = Math.round((row * cellSize) - scrollTop);
            if (y < bandHeight) continue;
            // Sits just below its line, mirroring column labels sitting just
            // right of theirs, so a label always trails the rule it names.
            ctx.fillText(String(row), bandWidth - RULER_PADDING_PX, y + (RULER_FONT_PX / 2));
        }
    }
}

/** Repaint the cells under the canvas at the current scroll offset. */
function draw(): void {
    if (!view) return;
    // width/height, not canvas.width/.height: CSS pixels, which is the space
    // every calculation below works in.
    const { pattern, ctx, cellSize, widestCode, width, height } = view;

    const scrollLeft = outputContainer.scrollLeft;
    const scrollTop = outputContainer.scrollTop;

    // Two independent conditions, both read fresh each redraw: the user's
    // checkbox (VIEW-3) and whether cells are big enough to read (VIEW-5).
    // shouldDrawCodes never writes back to the checkbox -- zooming out hides
    // the codes, it does not turn the user's setting off.
    const showCodes = toggleTextBtn.checked && widestCode !== '' && shouldDrawCodes(cellSize);
    if (showCodes) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        setCodeFont(ctx, cellSize, widestCode);
    }

    // Cleared rather than filled: an unpainted cell was transparent in the
    // source (GEN-1) and should read as a hole, not as a bead.
    ctx.clearRect(0, 0, width, height);

    const cols = visibleCellRange(scrollLeft, width, cellSize, pattern.width);
    const rows = visibleCellRange(scrollTop, height, cellSize, pattern.height);

    for (let row = rows.start; row <= rows.end; row++) {
        const top = Math.round((row * cellSize) - scrollTop);
        const bottom = Math.round(((row + 1) * cellSize) - scrollTop);

        for (let col = cols.start; col <= cols.end; col++) {
            const cell = pattern.cells[(row * pattern.width) + col];
            if (!cell) continue;

            // Both edges are rounded, rather than the width: adjacent cells
            // then share an edge exactly, so fractional cell sizes leave no
            // seams and no overlap.
            const left = Math.round((col * cellSize) - scrollLeft);
            const right = Math.round(((col + 1) * cellSize) - scrollLeft);

            const [r, g, b] = cell.rgb;
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(left, top, right - left, bottom - top);

            if (showCodes) {
                // Black or white by luminance (VIEW-4), the same choice the
                // DOM grid made and the same one M6's export will make.
                ctx.fillStyle = getContrastColor(r, g, b);
                ctx.fillText(cell.name, (left + right) / 2, (top + bottom) / 2);
            }
        }
    }

    // Guides last, so they sit above the beads and their codes. One checkbox
    // drives both layers (D16): the zoom bar is already tight at 390px, and
    // gridlines without their numbers do not answer "where am I".
    if (toggleGridBtn.checked) {
        drawGridlines(ctx, cols, rows, cellSize, scrollLeft, scrollTop, width, height);
        drawRulers(ctx, pattern, cols, rows, cellSize, scrollLeft, scrollTop, width, height);
    }
}

/**
 * Zoom by redraw, holding the viewport center (VIEW-2). Never a CSS transform:
 * that is what D1 rules out, and it is what the deleted dom-grid.ts did.
 */
function setCellSize(nextCellSize: number): void {
    if (!view) return;

    const clamped = clampCellSize(nextCellSize, view.minCellSize, MAX_CELL_SIZE_PX);
    if (clamped === view.cellSize) return;

    // Captured before layout(): once the spacer resizes, the old offsets and
    // the old scroll range are gone.
    const scrollLeft = zoomedScrollOffset(
        outputContainer.scrollLeft,
        outputContainer.clientWidth,
        view.cellSize,
        clamped,
        view.pattern.width
    );
    const scrollTop = zoomedScrollOffset(
        outputContainer.scrollTop,
        outputContainer.clientHeight,
        view.cellSize,
        clamped,
        view.pattern.height
    );

    view.cellSize = clamped;

    // Spacer first, then scroll: assigning an offset the scrollable area does
    // not reach yet gets silently clamped to the old maximum.
    layout();
    outputContainer.scrollLeft = scrollLeft;
    outputContainer.scrollTop = scrollTop;
    draw();
}

/**
 * Drag to pan (VIEW-1). The drag moves the container's scroll offset rather
 * than any drawing state, so it reuses the scroll -> redraw path already built
 * for the scrollbars, and native scrolling keeps working alongside it.
 */
function beginPan(event: PointerEvent): void {
    // Touch already pans: the canvas lives in a native scroll container, so
    // handling touch here would move the view twice per drag. Mouse and pen
    // have no such default, and that gap is what VIEW-1 is asking us to fill.
    if (!view || event.pointerType === 'touch' || event.button !== 0) return;

    // A paint tool is selected: this drag belongs to the editor (EDIT-5). Pan
    // mode is the default, so the view still pans until the user opts in.
    if (pointerMode !== 'pan') return;

    // Alt-click is the eyedropper in every mode, and a pan started under it
    // would fight the editor's own handler for the same gesture.
    if (event.altKey) return;

    // Only the pattern itself starts a pan. The listener is on the container,
    // and a pointerdown on its native scrollbar targets the container too --
    // without this, dragging the scrollbar would move the scroll offset twice,
    // once by the browser and once by us.
    if (event.target !== view.canvas) return;

    pan = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: outputContainer.scrollLeft,
        scrollTop: outputContainer.scrollTop
    };

    outputContainer.setPointerCapture(event.pointerId);
    outputContainer.classList.add('panning');
    // Suppresses the browser's own drag-select of the canvas mid-pan.
    event.preventDefault();
}

function updatePan(event: PointerEvent): void {
    if (!pan || event.pointerId !== pan.pointerId) return;

    // Measured from where the pointer went down rather than from the previous
    // move, so rounding cannot accumulate into drift over a long drag.
    outputContainer.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
    outputContainer.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
    // The resulting scroll event drives the repaint through queueRedraw.
}

function endPan(event: PointerEvent): void {
    if (!pan || event.pointerId !== pan.pointerId) return;

    if (outputContainer.hasPointerCapture(pan.pointerId)) {
        outputContainer.releasePointerCapture(pan.pointerId);
    }
    outputContainer.classList.remove('panning');
    pan = null;
}

/** Coalesce the scroll event stream into one redraw per frame. */
function queueRedraw(): void {
    if (!view || redrawHandle) return;
    redrawHandle = requestAnimationFrame(() => {
        redrawHandle = 0;
        draw();
    });
}

function handleResize(): void {
    if (!view) return;

    // The container drives both the canvas size and the zoom-out floor, so a
    // resize can leave the current cell size below the new fit.
    view.minCellSize = fitCellSize(
        view.pattern.width,
        view.pattern.height,
        outputContainer.clientWidth,
        outputContainer.clientHeight
    );
    view.cellSize = clampCellSize(view.cellSize, view.minCellSize, MAX_CELL_SIZE_PX);

    layout();
    draw();
}

export function initPatternViewControls(): void {
    requireElement('zoomInBtn').addEventListener('click', () => {
        if (view) setCellSize(view.cellSize * ZOOM_STEP);
    });
    requireElement('zoomOutBtn').addEventListener('click', () => {
        if (view) setCellSize(view.cellSize / ZOOM_STEP);
    });

    outputContainer.addEventListener('scroll', queueRedraw);
    window.addEventListener('resize', handleResize);

    // Bound to the container, not the canvas: the canvas is replaced on every
    // generate, the container is not. Pointer capture keeps a drag alive when
    // the cursor leaves the container mid-pan.
    //
    // The brush will also start with a pointerdown here. That conflict is
    // EDIT-5's to resolve, once there is a brush to conflict with.
    outputContainer.addEventListener('pointerdown', beginPan);
    outputContainer.addEventListener('pointermove', updatePan);
    outputContainer.addEventListener('pointerup', endPan);
    outputContainer.addEventListener('pointercancel', endPan);

    // VIEW-3. A redraw, not a CSS class: the codes are pixels on the canvas
    // now, so there is no text node left to hide.
    toggleTextBtn.addEventListener('change', () => draw());

    // VIEW-6 and VIEW-7, same reasoning.
    toggleGridBtn.addEventListener('change', () => draw());
}
