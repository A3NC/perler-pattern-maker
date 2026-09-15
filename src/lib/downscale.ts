import { srgbByteToLinear } from './oklab';
import type { SourcePixels } from '../types';

/**
 * GEN-4: summarize the source pixels inside each bead cell instead of
 * point-sampling one of them.
 *
 * Two properties make this correct rather than merely averaged:
 *
 *   - **Linear light.** An sRGB byte is not proportional to light -- 128 carries
 *     about 21% of 255's light, not 50% -- so averaging encoded bytes darkens
 *     every blend. Half black and half white is 188, not 128. Channels are
 *     linearized on the way in and stay linear on the way out, because the next
 *     step (OkLab matching) wants them linear too. Nothing here re-encodes.
 *   - **Alpha weighting.** getImageData returns unassociated alpha, and fully
 *     transparent pixels usually carry RGB 0. Averaging them as if they were
 *     black drags the edge of a subject dark -- the halo Q8 describes. Colour is
 *     accumulated weighted by alpha and divided by the alpha total, so invisible
 *     pixels contribute nothing to the hue.
 *
 * Coverage is fractional, so a non-integer scale -- the normal case, since the
 * bead grid rarely divides the image evenly -- weights edge pixels by how much
 * of the cell they actually occupy rather than binning them to one side.
 *
 * When the output is larger than the source (small pixel art against a bigger
 * grid) each cell falls inside a single source pixel and the result is exact
 * nearest-neighbour: hard edges survive, which is what R6 needs.
 *
 * Pure and DOM-free, so it tests in bare Node (NFR-4).
 */
export interface CellColors {
    width: number;
    height: number;
    /** Linear RGB, three entries per cell, row-major. */
    linear: Float64Array;
    /** Mean coverage per cell, 0..1. Multiply by 255 for the GEN-1 alpha rule. */
    alpha: Float64Array;
}

export function areaAverage(source: SourcePixels, outWidth: number, outHeight: number): CellColors {
    const { data, width: srcWidth, height: srcHeight } = source;

    if (!Number.isInteger(outWidth) || !Number.isInteger(outHeight) || outWidth < 1 || outHeight < 1) {
        throw new Error('Downscale target must be at least 1 x 1 whole cells.');
    }
    if (srcWidth < 1 || srcHeight < 1) {
        throw new Error('Source pixels have invalid dimensions.');
    }

    const linear = new Float64Array(outWidth * outHeight * 3);
    const alpha = new Float64Array(outWidth * outHeight);

    const scaleX = srcWidth / outWidth;
    const scaleY = srcHeight / outHeight;

    for (let cy = 0; cy < outHeight; cy += 1) {
        const y0 = cy * scaleY;
        const y1 = (cy + 1) * scaleY;
        const syStart = Math.floor(y0);
        const syEnd = Math.min(srcHeight, Math.ceil(y1));

        for (let cx = 0; cx < outWidth; cx += 1) {
            const x0 = cx * scaleX;
            const x1 = (cx + 1) * scaleX;
            const sxStart = Math.floor(x0);
            const sxEnd = Math.min(srcWidth, Math.ceil(x1));

            let weightSum = 0;
            let alphaSum = 0;
            let rSum = 0;
            let gSum = 0;
            let bSum = 0;

            for (let sy = syStart; sy < syEnd; sy += 1) {
                const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
                if (wy <= 0) continue;
                const rowOffset = sy * srcWidth;

                for (let sx = sxStart; sx < sxEnd; sx += 1) {
                    const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
                    if (wx <= 0) continue;

                    const weight = wx * wy;
                    const i = (rowOffset + sx) * 4;
                    const weightedAlpha = weight * (data[i + 3] / 255);

                    weightSum += weight;
                    alphaSum += weightedAlpha;
                    rSum += weightedAlpha * srgbByteToLinear(data[i]);
                    gSum += weightedAlpha * srgbByteToLinear(data[i + 1]);
                    bSum += weightedAlpha * srgbByteToLinear(data[i + 2]);
                }
            }

            const cell = cy * outWidth + cx;
            alpha[cell] = weightSum > 0 ? alphaSum / weightSum : 0;

            // Divide colour by the alpha total, not the weight total: a cell that
            // is one-third opaque red is *red*, not a third of the way to black.
            // A fully transparent cell keeps linear 0 and will be an empty bead
            // anyway, so its colour is never read.
            if (alphaSum > 0) {
                const base = cell * 3;
                linear[base] = rSum / alphaSum;
                linear[base + 1] = gSum / alphaSum;
                linear[base + 2] = bSum / alphaSum;
            }
        }
    }

    return { width: outWidth, height: outHeight, linear, alpha };
}
