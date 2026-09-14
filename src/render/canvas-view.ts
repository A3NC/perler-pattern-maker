import { getContrastColor } from '../contrast';
import { requireElement } from '../dom';
import {
    MAX_CELL_SIZE_PX,
    ZOOM_STEP,
    clampCellSize,
    fitCellSize,
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
// Drag-pan and the screen -> cell mapping are step 3; bead codes and the
// toggle are step 4; devicePixelRatio is step 6.

const outputContainer = requireElement('outputContainer');
const zoomControls = requireElement('zoomControls');
const toggleTextBtn = requireElement<HTMLInputElement>('toggleTextBtn');

/** Code text height, as a fraction of the cell. 1/3 is the old grid's 10px in 30px. */
const CODE_FONT_RATIO = 1 / 3;

/** How much of a cell's width a code may fill before the font is shrunk to fit. */
const CODE_MAX_WIDTH_RATIO = 0.86;

interface View {
    pattern: Pattern;
    /** Empty, pattern-sized: drives the container's native scrollbars. */
    spacer: HTMLDivElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
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
    const { pattern, spacer, canvas, cellSize } = view;

    spacer.style.width = `${pattern.width * cellSize}px`;
    spacer.style.height = `${pattern.height * cellSize}px`;

    // Measured after the spacer resizes, so these already account for a
    // scrollbar that just appeared or vanished.
    const width = Math.max(1, Math.round(Math.min(pattern.width * cellSize, outputContainer.clientWidth)));
    const height = Math.max(1, Math.round(Math.min(pattern.height * cellSize, outputContainer.clientHeight)));

    // CSS size and backing store are kept equal: one canvas unit is one CSS
    // pixel until step 6 introduces devicePixelRatio.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width;
    canvas.height = height;
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
    const { pattern, canvas, ctx, cellSize, widestCode } = view;

    const scrollLeft = outputContainer.scrollLeft;
    const scrollTop = outputContainer.scrollTop;

    // VIEW-3: the checkbox is the single source of truth, read fresh each
    // redraw. Step 5 adds the independent size threshold on top of it.
    const showCodes = toggleTextBtn.checked && widestCode !== '';
    if (showCodes) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        setCodeFont(ctx, cellSize, widestCode);
    }

    // Cleared rather than filled: an unpainted cell was transparent in the
    // source (GEN-1) and should read as a hole, not as a bead.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = visibleCellRange(scrollLeft, canvas.width, cellSize, pattern.width);
    const rows = visibleCellRange(scrollTop, canvas.height, cellSize, pattern.height);

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
