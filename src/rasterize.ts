import { requireElement } from './dom';
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
 * Decode the image into pixels for the pipeline to average down (GEN-4).
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
export function imageToPixels(image: HTMLImageElement, gridWidth: number, gridHeight: number): SourcePixels {
    const scale = Math.min(
        1,
        (gridWidth * SUPERSAMPLE) / image.width,
        (gridHeight * SUPERSAMPLE) / image.height,
        Math.sqrt(MAX_INTERMEDIATE_PIXELS / (image.width * image.height))
    );

    // Never below the bead grid -- that would make the box filter upscale -- and
    // never above the source, which would be the blurry upscale D4 forbids.
    const width = Math.min(image.width, Math.max(gridWidth, Math.round(image.width * scale)));
    const height = Math.min(image.height, Math.max(gridHeight, Math.round(image.height * scale)));

    canvas.width = width;
    canvas.height = height;

    // Smoothing on, unlike the pre-M2 build: this draw is a reduction, and a
    // reduction with smoothing off is point sampling -- the aliasing GEN-4
    // exists to remove. At a 1:1 draw the setting has no effect either way.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Clear first (prevents transparency ghosting), then draw.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
}
