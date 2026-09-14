import { getContrastColor } from '../contrast';
import { requireElement } from '../dom';
import {
    CODE_FONT_RATIO,
    MAX_CELL_SIZE_PX,
    ZOOM_STEP,
    clampCellSize,
    fitCellSize,
    shouldDrawCodes,
    visibleCellRange,
    zoomedScrollOffset
} from '../lib/viewport';
import type { Pattern } from '../types';

// The canvas pattern view (D1), replacing the element-per-bead grid.
//
// Container model (settled at step 2, per the plan's size targets): the canvas
// is sized to the *container*, never to the pattern. #grid-wrapper survives as
// an empty spacer sized to the full pattern, which is what gives
// .output-container something to scroll natively; the canvas sits inside it as
// a `position: sticky` overlay pinned to the visible corner, and every scroll
// redraws just the cell range under it. At VIEW-2's 30px maximum zoom a
// pattern-sized canvas would be 3000 x 3000 for the 100 x 100 design target
// alone -- past mobile canvas area caps -- so this is a precondition for zoom,
// not a later optimization.
//
// Every length in this module is a CSS pixel. The canvas backing store is the
// one exception -- sized by devicePixelRatio in layout(), with the density
// applied once at the context so the draw loop never sees it.

const outputContainer = requireElement('outputContainer');
const zoomControls = requireElement('zoomControls');
const toggleTextBtn = requireElement<HTMLInputElement>('toggleTextBtn');

/** How much of a cell's width a code may fill before the font is shrunk to fit. */
const CODE_MAX_WIDTH_RATIO = 0.86;

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
    outputContainer.scrollLeft = 0;
    outputContainer.scrollTop = 0;
    draw();

    zoomControls.style.display = 'flex';
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
}
