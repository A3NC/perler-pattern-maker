import { srgbByteToLinear } from '../lib/oklab';
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
 * This module lives in src/pipeline/ rather than src/lib/ for the same reason
 * color-match.ts does: the downsampler is a swappable strategy, and GEN-6's "no
 * edit outside the pipeline module" should read literally. Pure and DOM-free
 * either way, so it tests in bare Node (NFR-4).
 *
 * **Invariant both strategies hold, and the one the R1/R3 speck bug broke: every
 * colour this module emits is a weighted mean over an actual population of the
 * cell's own pixels.** Never one pixel, never an extrapolation. A cell's colour
 * must not be at the mercy of a single tail sample.
 */
export interface CellColors {
    width: number;
    height: number;
    /** Linear RGB, three entries per cell, row-major. */
    linear: Float64Array;
    /** Mean coverage per cell, 0..1. Multiply by 255 for the GEN-1 alpha rule. */
    alpha: Float64Array;
}

/** GEN-6's second axis: the strategies below are interchangeable at this shape. */
export type Downsampler = (source: SourcePixels, outWidth: number, outHeight: number) => CellColors;

/**
 * Rec. 709 luminance, on *linear* RGB. Only the contrast-preserving strategy
 * uses it, to split a cell's pixels into a dark population and a light one.
 */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * D18's constants -- the tuning surface, deliberately small. Same species as
 * MERGE_FLOOR (reduce.ts), MIN_CODE_FONT_PX (M1) and the guide pitch thresholds
 * (M10): judgment calls in one place, covered by tests that assert behaviour
 * rather than the numbers. Calibrate against R1-R6 *as a set* -- R4 and R5 are
 * the guard against over-aggression, because a classifier decisive enough to
 * rescue R3's outlines will start posterizing photo edges.
 */
export interface ContrastTuning {
    /**
     * How close the cell's luminance spread has to be to a genuine two-level
     * split before the two-population model is allowed to speak. Measured as the
     * cell's variance over the variance a true two-point population with the
     * same coverage and the same extremes would have: 1 for a clean line against
     * a fill, 1/3 for a uniform gradient across the same range. Below this, keep
     * the plain mean -- a gradient has half its pixels under the mean and would
     * otherwise read exactly like a thick line.
     *
     * **Has a ceiling, measured 2026-09-21.** Raising it tightens the gate, which
     * is the right lever against photo posterizing -- but past ~0.725 the gate
     * starts flapping on marginal cells, and a *single* stray pixel can flip a
     * cell's verdict between "line" and "plain mean". On the face fixture in
     * downscale.test.ts that is a 0.475 jump in OkLab from one pixel in sixteen,
     * which reads on screen as a gap in an outline. 0.725 was the last safe value
     * and 0.750 the first unsafe one; the test pins the property, not the number.
     *
     * Note the normaliser is the cell's Y_max - Y_min, not the gap between the
     * two population means. Substituting the population gap inverts the measure:
     * a gradient then scores 1.33, *above* a true two-point, and the gate stops
     * discriminating in the direction it was built for.
     */
    bimodalGate: number;
    /**
     * How much darker the dark population is than the cell as a whole, in
     * **perceptual lightness** -- cbrt of linear luminance, which is the gray-axis
     * form of OkLab's L (see oklab.ts: both rows of the first matrix sum to 1, so
     * a neutral gray's L is exactly cbrt(linear)). Below it there is no line in
     * this cell, just shading or noise.
     *
     * This was measured in linear light until 2026-09-21, and that was the third
     * appearance of the gamma mistake this milestone keeps finding. A fixed linear
     * threshold is not a fixed perceptual one. Measured across the tonal range, an
     * identical 30-byte step spans 0.0091 (in shadow) to 0.1036 (in highlight) of
     * linear luminance -- an 11.4x swing for the same visual step -- against
     * 0.0850 to 0.0488 in cbrt, a 1.74x swing. So the shipped 0.02 sat on top of
     * dark shading and cell-to-cell flapping followed, which is what "jagged, like
     * bad shading" looks like on screen.
     *
     * The decisive case: a dark shadow edge (bytes 45/75) reads 0.0221 in linear
     * while a genuine dark outline (a 0.64-coverage line of byte 20 on byte 70)
     * reads 0.0195. **The shading has more linear contrast than the line**, so in
     * linear light no threshold can order them at all -- the gate was simultaneously
     * too permissive for dark shading and too strict for dark outlines. In cbrt
     * they are 0.0670 and 0.1070, correctly ordered with room between.
     *
     * Honest about what this does not do: lines beat shading by only ~1.35x at the
     * same tone, and the bands still overlap *across* tones -- a hard step in deep
     * shadow (0.0850) outscores a faint line in a highlight (0.0613). The change
     * narrows the problem, it does not close it. The usable window against the
     * cases measured is roughly 0.085 (above every 30-byte shading step, at any
     * tone) to 0.107 (below a dark outline on a dark fill). Tune inside it by eye:
     * raise against remaining jaggedness in shading, lower if dark outlines go
     * missing.
     *
     * Note this is the one threshold that moved. bimodalGate stays in linear light
     * on purpose: it is a *shape* test (is this distribution two-lumped), and its
     * 1.0-vs-1/3 identities are a property of the linear formulation. Magnitudes
     * need perceptual units; shape ratios do not.
     */
    lineDarkeningMin: number;
    /**
     * The dark coverage at or above which a cell is lineart rather than fill.
     * It sits below 0.5, and that asymmetry is the whole dark-minority bias,
     * expressed as one number instead of a dark-only branch. Raising it is the
     * first move against blooming; lowering it rescues thinner lines at the cost
     * of straddled ones growing to two beads.
     */
    darkCoverageMin: number;
}

export const DEFAULT_CONTRAST_TUNING: ContrastTuning = {
    bimodalGate: 0.725,   // 0.75 flaps on marginal cells -- see the ceiling note above
    lineDarkeningMin: 0.09,
    darkCoverageMin: 0.3
};

/**
 * The plain area average: the right answer for photographs, because it is what
 * an optical reduction does. Unchanged since step 3, and the A/B baseline the
 * D18 tests assert against so the photo path cannot regress without a test
 * saying so.
 */
export const boxAverage: Downsampler = (source, outWidth, outHeight) =>
    downsample(source, outWidth, outHeight, null);

/**
 * D18. Lineart beside a solid fill washes out under a box average, and all three
 * stages behave correctly while it happens -- which is why this is a deliberate
 * answer rather than a fix.
 *
 * The geometry, measured on test_img/R3.png: the source is 1556 px wide, so at
 * the 100 x 100 design target one cell spans ~15.6 source pixels and a 10 px
 * line covers ~0.64 of a cell. Straddling a boundary it splits roughly
 * 0.40 / 0.24. The line never disappears; it survives as cells whose average is
 * a large-minority mixture, which the matcher correctly resolves to a bead far
 * lighter than the line's own colour. Correct linear-light averaging makes this
 * worse, not better -- a black line over 0.64 of a byte-220 fill averages to 79
 * in gamma-encoded sRGB and 139 in linear light -- so this is the price of the
 * step-3 fix, not a regression to undo.
 *
 * SUPERSAMPLE is not a lever: 0.64 is line width over source pixels per cell,
 * and the supersample factor divides both. Nor is reduction: lowering
 * MERGE_FLOOR to 0 with the limit at the palette size does not bring the line
 * back, which is what ruled Phase A out.
 *
 * So for lineart the box filter asks the wrong question. Not "what is the
 * average light in this cell" but "what is the dominant visual content of it" --
 * which is why pixel-art downscalers do not use box filters. Each cell is split
 * at its own mean luminance into a dark population and a light one, and then
 * **classified, not blended**: at or above darkCoverageMin the cell is the line
 * and takes the dark population's colour, below it the cell is fill and takes
 * the light population's colour. Nothing in between, which is what keeps a
 * straddled line one bead wide with a clean fill beside it.
 *
 * The fill branch returning the *light population* rather than the plain mean is
 * the part that matters: a fill cell clipped by part of a line comes back as the
 * fill colour with the line's pixels excluded, instead of a grey blend of the
 * two.
 *
 * ## Why populations, and not the two extreme pixels (revised 2026-09-21)
 *
 * The first version of this reconstructed each cell from its single darkest and
 * single lightest pixel, mixed by an S-curve on coverage. The R1-R6 review found
 * isolated beads coloured unlike anything in the source -- a green B25 on R3's
 * face among correct skin tones, a saturated G20 inside R1's muted G7 regions.
 * Both are one mechanism: the extremes of ~64 samples are *tail values*, and at
 * the ends of the curve the cell's colour collapsed onto essentially one of
 * them. That is the point sampling GEN-4 exists to remove, reintroduced and
 * aimed at the least representative pixel available. Tail samples are hue-noisy
 * -- luminance selection is hue-biased too, since green carries 0.7152 of Y, so
 * a chroma-fringe pixel reliably won the light slot -- and more saturated than
 * the bulk they came from, which is the quieter G20 signature.
 *
 * Population means fix both at once, and the measured cost is one pixel in
 * sixteen moving a cell by under 0.05 in OkLab instead of 0.187 -- less than the
 * distance between the wrong bead and the right one.
 *
 * What was traded away: the old min/max estimator had a useful failure
 * direction, since a spuriously dark pixel *grew* the denominator of f_dark and
 * made the model under-detect. Coverage is now a straight weight fraction, which
 * an outlier nudges by 1/N in either direction, so that fail-safe is gone. It
 * bought robustness against the wrong thing -- blooming is controlled by
 * darkCoverageMin and the gates, and hue noise was the defect actually showing
 * up in the images.
 */
export function contrastPreservingWith(tuning: Partial<ContrastTuning> = {}): Downsampler {
    const settings: ContrastTuning = { ...DEFAULT_CONTRAST_TUNING, ...tuning };
    return (source, outWidth, outHeight) => downsample(source, outWidth, outHeight, settings);
}

export const contrastPreserving: Downsampler = contrastPreservingWith();

/**
 * GEN-6's one identifier for this stage, mirroring ACTIVE_MATCHER. Flip it to
 * boxAverage to get the plain area average back -- the guaranteed-unchanged
 * route, the A/B baseline during the R1-R6 review, and the diagnostic that
 * localized the speck bug to this module -- with no edit anywhere else. Both
 * strategies return the same CellColors shape, so generate.ts does not branch.
 */
export const ACTIVE_DOWNSAMPLER: Downsampler = contrastPreserving;

/** Scratch entries are [alpha-weight, linear r, g, b, luminance]. */
const SCRATCH_STRIDE = 5;

/**
 * Both strategies in one pass over the cell geometry, because they share the
 * fractional-coverage box filter exactly and differ only in what they do once a
 * cell has closed. `tuning` null is the plain average; every line of the extra
 * accounting is behind that check, so the photo path pays one predictable branch
 * per pixel and none of the luminance work.
 *
 * The contrast path needs a second look at the cell's pixels, because the split
 * point is the cell's own mean and that is not known until the first pass ends.
 * Rather than re-read and re-linearize the source, pass 1 caches each visible
 * pixel into a scratch buffer sized for the largest possible cell footprint and
 * reused across every cell -- so pass 2 is comparisons and multiply-adds over
 * data already in cache, with no LUT reads.
 */
function downsample(
    source: SourcePixels,
    outWidth: number,
    outHeight: number,
    tuning: ContrastTuning | null
): CellColors {
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

    // A cell spans at most ceil(scale) + 1 source pixels per axis, since its
    // edges can fall inside a pixel at both ends.
    const scratch = tuning === null
        ? null
        : new Float64Array((Math.ceil(scaleX) + 1) * (Math.ceil(scaleY) + 1) * SCRATCH_STRIDE);

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

            // The bimodality gate's inputs. Y_min and Y_max bound the cell's
            // luminance range; they no longer carry colour, which is the whole
            // point of the 2026-09-21 revision.
            let yMin = Infinity;
            let yMax = -Infinity;
            let ySquaredSum = 0;
            let cached = 0;

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

                    const r = srgbByteToLinear(data[i]);
                    const g = srgbByteToLinear(data[i + 1]);
                    const b = srgbByteToLinear(data[i + 2]);

                    weightSum += weight;
                    alphaSum += weightedAlpha;
                    rSum += weightedAlpha * r;
                    gSum += weightedAlpha * g;
                    bSum += weightedAlpha * b;

                    // Invisible pixels join no population, for the same reason
                    // they contribute no colour: a transparent pixel carrying
                    // RGB 0 is not a dark pixel.
                    if (scratch !== null && weightedAlpha > 0) {
                        const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
                        ySquaredSum += weightedAlpha * y * y;
                        if (y < yMin) yMin = y;
                        if (y > yMax) yMax = y;

                        scratch[cached] = weightedAlpha;
                        scratch[cached + 1] = r;
                        scratch[cached + 2] = g;
                        scratch[cached + 3] = b;
                        scratch[cached + 4] = y;
                        cached += SCRATCH_STRIDE;
                    }
                }
            }

            const cell = cy * outWidth + cx;
            alpha[cell] = weightSum > 0 ? alphaSum / weightSum : 0;

            // A fully transparent cell keeps linear 0 and will be an empty bead
            // anyway, so its colour is never read.
            if (alphaSum <= 0) continue;

            // Divide colour by the alpha total, not the weight total: a cell that
            // is one-third opaque red is *red*, not a third of the way to black.
            const meanR = rSum / alphaSum;
            const meanG = gSum / alphaSum;
            const meanB = bSum / alphaSum;

            const base = cell * 3;

            // Y is linear in linear RGB, so the mean of the luminances is the
            // luminance of the mean -- Y_mean costs nothing beyond this line.
            const yMean = LUMA_R * meanR + LUMA_G * meanG + LUMA_B * meanB;
            const spread = yMax - yMin;

            if (scratch !== null && tuning !== null && spread > 0) {
                // Pass 2: split the cell's pixels at its own mean luminance.
                let darkWeight = 0;
                let darkR = 0, darkG = 0, darkB = 0;
                let lightWeight = 0;
                let lightR = 0, lightG = 0, lightB = 0;

                for (let p = 0; p < cached; p += SCRATCH_STRIDE) {
                    const w = scratch[p];
                    if (scratch[p + 4] < yMean) {
                        darkWeight += w;
                        darkR += w * scratch[p + 1];
                        darkG += w * scratch[p + 2];
                        darkB += w * scratch[p + 3];
                    } else {
                        lightWeight += w;
                        lightR += w * scratch[p + 1];
                        lightG += w * scratch[p + 2];
                        lightB += w * scratch[p + 3];
                    }
                }

                // Both populations have to exist for there to be two of them.
                if (darkWeight > 0 && lightWeight > 0) {
                    darkR /= darkWeight;
                    darkG /= darkWeight;
                    darkB /= darkWeight;
                    lightR /= lightWeight;
                    lightG /= lightWeight;
                    lightB /= lightWeight;

                    // The actual weight fraction, not an estimate off the
                    // extremes. Exact by construction: the two population means
                    // weighted by this reproduce the cell mean.
                    const fDark = darkWeight / alphaSum;
                    const yDark = LUMA_R * darkR + LUMA_G * darkG + LUMA_B * darkB;

                    const variance = ySquaredSum / alphaSum - yMean * yMean;
                    const twoPointVariance = fDark * (1 - fDark) * spread * spread;

                    // cbrt, not a subtraction in linear light: see lineDarkeningMin.
                    // Twice per cell, not per pixel, so the cost is nothing.
                    if (
                        Math.cbrt(yMean) - Math.cbrt(yDark) >= tuning.lineDarkeningMin &&
                        twoPointVariance > 0 &&
                        variance >= tuning.bimodalGate * twoPointVariance
                    ) {
                        const isLineart = fDark >= tuning.darkCoverageMin;
                        linear[base] = isLineart ? darkR : lightR;
                        linear[base + 1] = isLineart ? darkG : lightG;
                        linear[base + 2] = isLineart ? darkB : lightB;
                        continue;
                    }
                }
            }

            linear[base] = meanR;
            linear[base + 1] = meanG;
            linear[base + 2] = meanB;
        }
    }

    return { width: outWidth, height: outHeight, linear, alpha };
}
