import { requireElement } from '../dom';
import { clampCrop, cropFromPoints, fullImageCrop, hitTestCrop, moveCrop, resizeCrop } from '../lib/crop';
import type { CropRect, CropTarget } from '../lib/crop';

/**
 * The crop preview and its rectangle (IN-5, M4).
 *
 * Holds no geometry of its own. Every gesture is turned into a point in *source
 * pixels* and handed to `src/lib/crop.ts`, which decides what it means; this
 * module only measures the display scale, positions two overlay elements, and
 * tells its subscribers the crop moved. Same division as `render/editor.ts`:
 * pointer wiring here, deterministic logic behind a tested boundary.
 */

const previewArea = requireElement('previewArea');
const previewFrame = requireElement('previewFrame');
const cropShade = requireElement('cropShade');
const cropRectEl = requireElement('cropRect');

/**
 * UI-6 wants a 44 px target, so the reach from a corner is half of that. It is a
 * *screen* number and is converted to source pixels per image before it reaches
 * `hitTestCrop` -- a 4000 px photo previewed at 400 px needs a 220-source-pixel
 * reach to give the finger the same 44 px.
 */
const HANDLE_TARGET_PX = 44;

/** Below this much screen movement, a drag outside the rectangle is a stray tap. */
const NEW_BOX_THRESHOLD_PX = 4;

interface Point {
    x: number;
    y: number;
}

interface Gesture {
    pointerId: number;
    /** `'new'` is a drag starting outside the rectangle: draw a fresh one. */
    mode: CropTarget | 'new';
    origin: Point;
    startRect: CropRect;
    started: boolean;
}

let image: HTMLImageElement | null = null;
let crop: CropRect | null = null;
/** Rendered CSS pixels per source pixel. Recomputed on show and on resize. */
let displayScale = 1;
let gesture: Gesture | null = null;
const listeners: Array<(crop: CropRect | null) => void> = [];

export function initCropControls(): void {
    previewFrame.addEventListener('pointerdown', beginGesture);
    previewFrame.addEventListener('pointermove', continueGesture);
    previewFrame.addEventListener('pointerup', endGesture);
    previewFrame.addEventListener('pointercancel', endGesture);
    // The preview is fluid and the 640 px media query changes its width, so the
    // scale every screen coordinate is divided by is not a constant.
    window.addEventListener('resize', () => {
        measure();
        paint();
    });
}

/** Called for every crop change, including the reset a new upload brings. */
export function onCropChange(listener: (crop: CropRect | null) => void): void {
    listeners.push(listener);
}

export function getCrop(): CropRect | null {
    return crop;
}

/**
 * Show a newly uploaded image, cropped to its full extent.
 *
 * `next` is the element `upload.ts` decoded, not a copy: its object URL was
 * revoked as soon as `decode()` resolved, so a second `<img>` pointed at that
 * URL would fail to load. This one keeps its bitmap and re-parents cleanly.
 */
export function showCropPreview(next: HTMLImageElement): void {
    installImage(next, fullImageCrop(next.naturalWidth, next.naturalHeight));
}

/**
 * Put back an image and the crop it was generated with (M7, D23). The crop is
 * clamped through `crop.ts` rather than trusted: it was stored, not drawn, and
 * a rectangle that no longer fits the decoded image must still come back as a
 * valid one. The caller hides the preview straight after, exactly as a generate
 * does (D21) -- the crop was already settled for this image.
 */
export function restoreCropPreview(next: HTMLImageElement, saved: CropRect): void {
    installImage(next, clampCrop(saved, next.naturalWidth, next.naturalHeight));
}

function installImage(next: HTMLImageElement, initial: CropRect): void {
    previewFrame.querySelector('img')?.remove();

    next.alt = 'Uploaded image, with the area that will become beads highlighted';
    // Without this a mouse drag on the image starts a native image drag instead
    // of a crop. `touch-action` covers the touch half; this is the mouse half.
    next.draggable = false;
    previewFrame.prepend(next);

    image = next;
    crop = initial;
    previewArea.classList.add('is-visible');
    measure();
    paint();
    emit();
}

/**
 * D21: a successful generate hides the preview for good on that image -- the
 * crop is settled once a pattern exists. The rectangle is kept rather than
 * cleared, because a regenerate at a different size must use the same framing.
 * Only a new upload brings the preview back.
 */
export function hideCropPreview(): void {
    previewArea.classList.remove('is-visible');
}

/** A rejected upload: no image, no crop, nothing left on screen to act on. */
export function clearCropPreview(): void {
    previewArea.classList.remove('is-visible');
    previewFrame.querySelector('img')?.remove();
    image = null;
    crop = null;
    gesture = null;
    emit();
}

function sourceSize(): Point {
    return {
        x: image?.naturalWidth ?? 1,
        y: image?.naturalHeight ?? 1
    };
}

/**
 * The frame shrink-wraps the image, so its box *is* the image's box -- one
 * rectangle serves both the scale and the coordinate origin. A hidden preview
 * measures zero, which would make the scale infinite, so it is left alone.
 */
function measure(): void {
    if (!image) return;
    const box = previewFrame.getBoundingClientRect();
    if (box.width <= 0 || image.naturalWidth <= 0) return;
    displayScale = box.width / image.naturalWidth;
}

function paint(): void {
    if (!crop) return;
    const left = `${crop.x * displayScale}px`;
    const top = `${crop.y * displayScale}px`;
    const width = `${crop.width * displayScale}px`;
    const height = `${crop.height * displayScale}px`;

    // Two elements, one rectangle: the shade is clipped to the image so its
    // shadow cannot cover the page, the rect is not so its handles can overhang.
    for (const element of [cropShade, cropRectEl]) {
        element.style.left = left;
        element.style.top = top;
        element.style.width = width;
        element.style.height = height;
    }
}

function emit(): void {
    for (const listener of listeners) listener(crop);
}

function setCrop(next: CropRect): void {
    crop = next;
    paint();
    emit();
}

function pointToSource(event: PointerEvent): Point {
    const box = previewFrame.getBoundingClientRect();
    return {
        x: (event.clientX - box.left) / displayScale,
        y: (event.clientY - box.top) / displayScale
    };
}

function handleSlop(): number {
    return HANDLE_TARGET_PX / 2 / displayScale;
}

function isFullImage(rect: CropRect): boolean {
    const extent = sourceSize();
    return rect.x === 0 && rect.y === 0 && rect.width === extent.x && rect.height === extent.y;
}

function beginGesture(event: PointerEvent): void {
    if (!image || !crop || gesture) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const origin = pointToSource(event);
    const target = hitTestCrop(crop, origin, handleSlop());

    // At the opening state the crop is the whole image, so every point is
    // "inside" it and a drag would mean *move* -- which clamps to a guaranteed
    // no-op, because there is nowhere for a full-image crop to go. Dragging a
    // box across the part you want is the first thing anyone tries on a fresh
    // preview, and without this it does nothing at all and reads as broken. The
    // move gesture is unavailable here, so the draw gesture takes the space.
    const mode: Gesture['mode'] = target === 'body' && isFullImage(crop) ? 'new' : target ?? 'new';

    gesture = {
        pointerId: event.pointerId,
        mode,
        origin,
        startRect: crop,
        // A new box does nothing until the pointer has travelled far enough to
        // be a drag: a stray tap must not replace the crop with an 8 px box.
        started: mode !== 'new'
    };

    previewFrame.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function continueGesture(event: PointerEvent): void {
    if (!image || !crop) return;
    if (!gesture) {
        updateCursor(event);
        return;
    }
    if (event.pointerId !== gesture.pointerId) return;

    const point = pointToSource(event);
    const extent = sourceSize();

    if (gesture.mode === 'body') {
        // Against the rectangle the gesture *started* on, not the last frame's,
        // so a long drag cannot accumulate rounding drift.
        setCrop(moveCrop(
            gesture.startRect,
            point.x - gesture.origin.x,
            point.y - gesture.origin.y,
            extent.x,
            extent.y
        ));
        return;
    }

    if (gesture.mode === 'new') {
        const threshold = NEW_BOX_THRESHOLD_PX / displayScale;
        if (!gesture.started) {
            const far = Math.abs(point.x - gesture.origin.x) > threshold
                || Math.abs(point.y - gesture.origin.y) > threshold;
            if (!far) return;
            gesture.started = true;
        }
        setCrop(cropFromPoints(gesture.origin, point, extent.x, extent.y));
        return;
    }

    setCrop(resizeCrop(gesture.startRect, gesture.mode, point, extent.x, extent.y));
}

function endGesture(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (previewFrame.hasPointerCapture(event.pointerId)) {
        previewFrame.releasePointerCapture(event.pointerId);
    }
    gesture = null;
}

/**
 * The overlay is `pointer-events: none` all the way down, so CSS cannot show
 * which handle is under the pointer -- the hit test has to say.
 */
function updateCursor(event: PointerEvent): void {
    if (!crop) return;
    const target = hitTestCrop(crop, pointToSource(event), handleSlop());
    previewFrame.style.cursor = target === 'nw' || target === 'se'
        ? 'nwse-resize'
        : target === 'ne' || target === 'sw'
            ? 'nesw-resize'
            : target === 'body'
                ? 'move'
                : 'crosshair';
}
