/**
 * Crop-rectangle geometry (M4). Pure and DOM-free, so it tests in Node (NFR-4);
 * the pointer wiring that consumes it lives in `src/render/crop-view.ts`.
 *
 * **Everything here is in source pixels** -- the decoded image's own coordinate
 * space, integers. That is what `drawImage` consumes and what
 * `calculateDimensions` needs, so a coordinate is converted exactly once, at the
 * gesture boundary, by dividing the on-screen offset by the preview's display
 * scale. Normalized 0..1 fractions would be rounded twice, once for the preview
 * and again for the draw, and those two roundings are precisely what "the
 * generated pattern matches the cropped region" is checking.
 */

export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A corner grab. Only corners: eight handles do not fit a small rect at 390 px. */
export type CropHandle = 'nw' | 'ne' | 'sw' | 'se';

/** What a point on the preview is over. */
export type CropTarget = CropHandle | 'body';

/**
 * Smallest crop, per axis, in source pixels. A judgment constant in the family
 * of MERGE_FLOOR and DEFAULT_CELL_BUDGET: the tests assert that a crop cannot go
 * below it and never assert the number itself.
 *
 * Its job is only to stop a degenerate rectangle -- a zero-width crop, or one
 * the user can no longer grab. It is deliberately *not* a quality floor: a crop
 * smaller than the bead grid is legal and simply means the box filter upscales,
 * which is a blurrier pattern (D4) rather than an error.
 */
export const MIN_CROP_PX = 8;

/** Fixed order, so an argmin over corners tie-breaks deterministically (GEN-7's convention). */
const HANDLES: readonly CropHandle[] = ['nw', 'ne', 'sw', 'se'];

interface Point {
    x: number;
    y: number;
}

function clampNumber(value: number, low: number, high: number): number {
    if (!Number.isFinite(value)) return low;
    if (high < low) return low;
    return Math.min(high, Math.max(low, value));
}

/** At least 1 px each way: a zero-sized image has no crop to speak of. */
function imageExtent(imageWidth: number, imageHeight: number): Point {
    return {
        x: Math.max(1, Math.floor(Number.isFinite(imageWidth) ? imageWidth : 1)),
        y: Math.max(1, Math.floor(Number.isFinite(imageHeight) ? imageHeight : 1))
    };
}

/** The default on every new upload: the whole image. */
export function fullImageCrop(imageWidth: number, imageHeight: number): CropRect {
    const extent = imageExtent(imageWidth, imageHeight);
    return { x: 0, y: 0, width: extent.x, height: extent.y };
}

/**
 * Snap a rectangle to integers, hold it inside the image, and keep it at least
 * MIN_CROP_PX on each axis -- except on an image smaller than that, where the
 * image itself is the floor.
 */
export function clampCrop(rect: CropRect, imageWidth: number, imageHeight: number): CropRect {
    const extent = imageExtent(imageWidth, imageHeight);
    const minWidth = Math.min(MIN_CROP_PX, extent.x);
    const minHeight = Math.min(MIN_CROP_PX, extent.y);

    const width = clampNumber(Math.round(rect.width), minWidth, extent.x);
    const height = clampNumber(Math.round(rect.height), minHeight, extent.y);

    return {
        x: clampNumber(Math.round(rect.x), 0, extent.x - width),
        y: clampNumber(Math.round(rect.y), 0, extent.y - height),
        width,
        height
    };
}

/**
 * Translate, and **only** translate. Dragging the body into an edge slides the
 * rectangle and stops it there; it must never shrink, which is why the size is
 * carried over from the clamped input rather than recomputed from the moved
 * corners. Getting this wrong stays invisible until someone drags into a corner
 * and their crop quietly changes size.
 */
export function moveCrop(
    rect: CropRect,
    dx: number,
    dy: number,
    imageWidth: number,
    imageHeight: number
): CropRect {
    const extent = imageExtent(imageWidth, imageHeight);
    const base = clampCrop(rect, extent.x, extent.y);

    return {
        x: clampNumber(Math.round(base.x + dx), 0, extent.x - base.width),
        y: clampNumber(Math.round(base.y + dy), 0, extent.y - base.height),
        width: base.width,
        height: base.height
    };
}

/**
 * Drag one corner; the opposite corner is the anchor and does not move.
 *
 * **Clamped at the minimum, never flipped through the anchor.** Flipping doubles
 * the test matrix and is disorienting under a finger, where the hand hides the
 * point being dragged.
 */
export function resizeCrop(
    rect: CropRect,
    handle: CropHandle,
    point: Point,
    imageWidth: number,
    imageHeight: number
): CropRect {
    const extent = imageExtent(imageWidth, imageHeight);
    const base = clampCrop(rect, extent.x, extent.y);
    const minWidth = Math.min(MIN_CROP_PX, extent.x);
    const minHeight = Math.min(MIN_CROP_PX, extent.y);

    const movingLeftEdge = handle === 'nw' || handle === 'sw';
    const movingTopEdge = handle === 'nw' || handle === 'ne';

    const anchorX = movingLeftEdge ? base.x + base.width : base.x;
    const anchorY = movingTopEdge ? base.y + base.height : base.y;

    // The anchor is always at least minWidth from the far side of the image --
    // `base` is inside the image and already meets the minimum -- so these
    // bounds can never cross.
    const edgeX = movingLeftEdge
        ? clampNumber(Math.round(point.x), 0, anchorX - minWidth)
        : clampNumber(Math.round(point.x), anchorX + minWidth, extent.x);
    const edgeY = movingTopEdge
        ? clampNumber(Math.round(point.y), 0, anchorY - minHeight)
        : clampNumber(Math.round(point.y), anchorY + minHeight, extent.y);

    return clampCrop(
        {
            x: Math.min(anchorX, edgeX),
            y: Math.min(anchorY, edgeY),
            width: Math.abs(anchorX - edgeX),
            height: Math.abs(anchorY - edgeY)
        },
        extent.x,
        extent.y
    );
}

/** A rectangle spanning two points, for the drag-a-new-box gesture. */
export function cropFromPoints(
    from: Point,
    to: Point,
    imageWidth: number,
    imageHeight: number
): CropRect {
    const extent = imageExtent(imageWidth, imageHeight);
    const x0 = clampNumber(Math.round(from.x), 0, extent.x);
    const y0 = clampNumber(Math.round(from.y), 0, extent.y);
    const x1 = clampNumber(Math.round(to.x), 0, extent.x);
    const y1 = clampNumber(Math.round(to.y), 0, extent.y);

    return clampCrop(
        {
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            width: Math.abs(x1 - x0),
            height: Math.abs(y1 - y0)
        },
        extent.x,
        extent.y
    );
}

/**
 * What a point grabs: a corner handle, the body, or nothing.
 *
 * **`slop` arrives in source pixels, and that inversion is the point.** UI-6's
 * 44 px is a *screen* quantity; this module is in source space. The view
 * converts once -- `slop = 44 / displayScale` -- so a 4000 px photo previewed at
 * 400 px gets a 440-source-pixel grab radius and the finger target stays the
 * same physical size. A screen constant baked in here would be right at exactly
 * one preview scale.
 *
 * Handles win over the body, and when several are in range -- a small rect with
 * a large slop, which is the 390 px case -- the nearest wins, ties going to the
 * first in HANDLES. Same shape as the argmin tie-break in `reduce.ts`.
 */
export function hitTestCrop(rect: CropRect, point: Point, slop: number): CropTarget | null {
    const reach = Math.max(0, slop);
    let best: CropHandle | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const handle of HANDLES) {
        const cornerX = handle === 'nw' || handle === 'sw' ? rect.x : rect.x + rect.width;
        const cornerY = handle === 'nw' || handle === 'ne' ? rect.y : rect.y + rect.height;
        const dx = Math.abs(point.x - cornerX);
        const dy = Math.abs(point.y - cornerY);
        if (dx > reach || dy > reach) continue;

        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            best = handle;
            bestDistance = distance;
        }
    }
    if (best) return best;

    const inside = point.x >= rect.x
        && point.x <= rect.x + rect.width
        && point.y >= rect.y
        && point.y <= rect.y + rect.height;
    return inside ? 'body' : null;
}
