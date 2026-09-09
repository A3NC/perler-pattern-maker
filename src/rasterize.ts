import { requireElement } from './dom';
import type { SourcePixels } from './types';

const canvas = requireElement<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

/**
 * Draw the image down to the bead grid size and read the pixels back.
 * Still point-sampled with smoothing off: GEN-4's area averaging is M2's job.
 */
export function imageToPixels(image: HTMLImageElement, width: number, height: number): SourcePixels {
    canvas.width = width;
    canvas.height = height;

    // Turn off anti-aliasing to preserve hard edges for pixel art.
    ctx.imageSmoothingEnabled = false;
    // Legacy vendor flags, kept for behavior parity; not in the DOM types. M2 removes these.
    const legacyCtx = ctx as unknown as Record<string, unknown>;
    legacyCtx.mozImageSmoothingEnabled = false;
    legacyCtx.webkitImageSmoothingEnabled = false;
    legacyCtx.msImageSmoothingEnabled = false;

    // Clear first (prevents transparency ghosting), then draw without blurring.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
}
