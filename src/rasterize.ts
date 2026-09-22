import { requireElement } from './dom';
import type { CropRect } from './lib/crop';
import type { SourcePixels } from './types';

const canvas = requireElement<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

/**
 * How many source pixels per bead cell, per axis, we keep for the pipeline to
 * average over. Eight is far more than enough to summarize a cell (64 samples)
 * and keeps the buffer small.
 */
const SUPERSAMPLE = 8;

/**
 * Absolute ceiling on the intermediate buffer. IN-6 admits an 8000 px source,
 * which is a 256 MB ImageData, and NFR-5 puts a phone browser in scope.
 */
const MAX_INTERMEDIATE_PIXELS = 4_000_000;

/**
 * Decode the cropped region of the image into pixels for the pipeline to average
 * down (GEN-4, and M4's crop).
 *
 * **`crop` is in source pixels, and every measurement here must be too.** Note
 * what is *not* used below: `image.width`. Since M4 the decoded element is also
 * the on-screen preview, and `HTMLImageElement.width` reports the element's
 * *rendered* width once it is in the document -- so it silently became the
 * preview's size rather than the image's. The crop rectangle carries the only
 * numbers this function needs, and `naturalWidth` is the only safe way to ask
 * the element itself.
 *
 * This deliberately does *not* shrink to the bead grid. Averaging each cell's
 * source pixels is the pipeline's job, in linear light, where it is testable in
 * Node -- so what comes back here is an intermediate-resolution buffer, and the
 * only reduction done on this side is the one needed to bound memory.
 *
 * When the image already fits the budget -- the common case -- the draw is 1:1
 * and the pipeline's box filter sees every original pixel. When it does not, the
 * browser performs the first reduction, and it averages in gamma-encoded sRGB
 * rather than linear light. At a supersample of 8 that error is confined to the
 * innermost 8x8 of each cell and is negligible against the exact averaging done
 * over the result.
 */
export function imageToPixels(
    image: HTMLImageElement,
    gridWidth: number,
    gridHeight: number,
    crop: CropRect
): SourcePixels {
    const scale = Math.min(
        1,
        (gridWidth * SUPERSAMPLE) / crop.width,
        (gridHeight * SUPERSAMPLE) / crop.height,
        Math.sqrt(MAX_INTERMEDIATE_PIXELS / (crop.width * crop.height))
    );

    // Never below the bead grid -- that would make the box filter upscale -- and
    // never above the cropped region, which would be the blurry upscale D4
    // forbids. A crop smaller than the grid is legal and lands on the first
    // clamp: fewer source pixels than beads is a blurrier pattern, not an error.
    const width = Math.min(crop.width, Math.max(gridWidth, Math.round(crop.width * scale)));
    const height = Math.min(crop.height, Math.max(gridHeight, Math.round(crop.height * scale)));

    canvas.width = width;
    canvas.height = height;

    // Smoothing on, unlike the pre-M2 build: this draw is a reduction, and a
    // reduction with smoothing off is point sampling -- the aliasing GEN-4
    // exists to remove. At a 1:1 draw the setting has no effect either way.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Clear first (prevents transparency ghosting), then draw the cropped source
    // rectangle into the whole buffer. This nine-argument form is the entirety
    // of how the crop reaches the pipeline -- generate.ts never learns it exists.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
}
