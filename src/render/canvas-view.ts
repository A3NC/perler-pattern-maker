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
}

let view: View | null = null;
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

    view = { pattern, spacer, canvas, ctx, cellSize: minCellSize, minCellSize };

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

/** Repaint the cells under the canvas at the current scroll offset. */
function draw(): void {
    if (!view) return;
    const { pattern, canvas, ctx, cellSize } = view;

    const scrollLeft = outputContainer.scrollLeft;
    const scrollTop = outputContainer.scrollTop;

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

    // Step 4 wires toggleTextBtn, once there are codes to toggle.
}
