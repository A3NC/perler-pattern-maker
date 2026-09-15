/**
 * OkLab (Björn Ottosson, 2020): a perceptual color space in which plain
 * Euclidean distance approximates perceived difference. This is the space
 * GEN-2 and decision D2 call for, replacing raw sRGB distance.
 *
 * Why raw RGB distance fails, both of which GEN-2 names:
 *   - Gamma. An sRGB byte is not proportional to light -- 128 carries about
 *     21% of 255's light, not 50% -- so equal numeric steps near black are
 *     much larger perceptual steps than near white. RGB distance therefore
 *     snaps dark tones to black.
 *   - Channel weighting. RGB distance weights all three channels equally, but
 *     the eye resolves green differences far better than blue ones, so the
 *     accuracy budget is spent in the wrong place and skin tones drift.
 *
 * OkLab's axes: L is perceptual lightness (0 black, 1 white), a is green-red,
 * b is blue-yellow. Distance is ordinary Euclidean -- no CIEDE2000-style
 * correction terms -- which is what lets M2 also *average* and *merge* in this
 * space rather than only measuring in it.
 *
 * Pure and dependency-free, so it tests in bare Node (NFR-4).
 */

/** A color in OkLab. Not part of the durable Pattern contract; internal to matching. */
export interface Oklab {
    L: number;
    a: number;
    b: number;
}

/**
 * The sRGB transfer function, on 0..1. This is the step that turns an encoded
 * channel back into something proportional to light, and it is the one every
 * other function here depends on being applied exactly once.
 */
function srgbToLinearUnit(c: number): number {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Linearization is a table read, not a pow. Source channels arrive as bytes out
 * of a Uint8ClampedArray, so there are only 256 possible inputs, and the
 * downscale pass (GEN-4) calls this a few million times per generate.
 */
const LINEAR_LUT = new Float64Array(256);
for (let byte = 0; byte < 256; byte += 1) {
    LINEAR_LUT[byte] = srgbToLinearUnit(byte / 255);
}

/**
 * Linear light for one sRGB byte. Expects an integer 0..255 -- which is what
 * every caller has, since pixels come from a Uint8ClampedArray.
 */
export function srgbByteToLinear(byte: number): number {
    return LINEAR_LUT[byte];
}

/**
 * The inverse curve, back to a byte. Only the RGB comparison matcher (GEN-6's
 * second algorithm) and the tests need this -- the real pipeline goes from
 * linear straight into OkLab and never re-encodes, because re-encoding is
 * exactly the round trip that darkens averaged colors.
 */
export function linearToSrgbByte(linear: number): number {
    const clamped = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
    const encoded = clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
}

/**
 * Linear sRGB to OkLab: a 3x3 into LMS cone response, cube roots, then a second
 * 3x3 into L/a/b.
 *
 * Both of the first matrix's rows sum to 1, as does the second matrix's first
 * row, which is why a neutral gray's L is simply cbrt(linear). The tests use
 * that identity as an oracle -- it is also a cheap check that neither matrix
 * has been transposed.
 */
export function linearToOklab(r: number, g: number, b: number): Oklab {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

/** Convenience for sRGB bytes. The pipeline itself averages first, so it calls linearToOklab. */
export function srgbToOklab(r: number, g: number, b: number): Oklab {
    return linearToOklab(srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b));
}

/**
 * Squared distance, taken as six loose numbers rather than two Oklab objects.
 * This is the innermost loop of palette matching -- 11M evaluations at NFR-3's
 * hard limit -- and the palette side of it lives in a flat Float64Array, so
 * there are no objects to destructure there anyway.
 */
export function oklabDistanceSquared(
    L1: number, a1: number, b1: number,
    L2: number, a2: number, b2: number
): number {
    const dL = L2 - L1;
    const da = a2 - a1;
    const db = b2 - b1;
    return dL * dL + da * da + db * db;
}

/**
 * True perceptual distance. Used by the reduction pass (GEN-3), where it runs a
 * few hundred times in total and where an un-squared value is far easier to
 * reason about -- MERGE_FLOOR is a threshold a human has to pick.
 */
export function oklabDistance(
    L1: number, a1: number, b1: number,
    L2: number, a2: number, b2: number
): number {
    return Math.sqrt(oklabDistanceSquared(L1, a1, b1, L2, a2, b2));
}
