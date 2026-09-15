import { linearToOklab, linearToSrgbByte, oklabDistanceSquared, srgbByteToLinear } from '../lib/oklab';
import { findClosestColor } from '../lib/pattern-utils';
import type { Palette, PaletteColor } from '../types';

/**
 * Palette matching as a swappable strategy -- GEN-6's "a second algorithm can be
 * added and selected by changing one identifier," and the A/B rig decision D5
 * wants for tuning.
 *
 * Matchers take *linear* RGB, not bytes. That is the form the GEN-4 downscale
 * produces, and it is the form OkLab needs, so the pipeline linearizes once and
 * hands the same values to whichever matcher is active. The RGB matcher pays a
 * re-encode for the privilege, which is the right way round: the legacy
 * algorithm absorbs the conversion cost, not the one we ship.
 *
 * They return a palette *index* rather than a PaletteColor so the reduction pass
 * (GEN-3) can work over a flat index space.
 */
export interface Matcher {
    readonly name: string;
    match(linearR: number, linearG: number, linearB: number): number;
}

export type MatcherFactory = (palette: Palette) => Matcher;

/**
 * Perceptual matching (GEN-2, decision D2). The palette's OkLab values are
 * computed once when the matcher is built -- 221 conversions instead of one per
 * cell -- and kept in a flat Float64Array rather than an array of objects,
 * because this inner loop runs up to 11M times at NFR-3's hard limit.
 */
export const oklabMatcher: MatcherFactory = (palette) => {
    if (!Array.isArray(palette) || palette.length === 0) {
        throw new Error('No palette is available for color matching.');
    }

    const count = palette.length;
    const lab = new Float64Array(count * 3);

    for (let i = 0; i < count; i += 1) {
        const [r, g, b] = palette[i].rgb as [number, number, number];
        const color = linearToOklab(srgbByteToLinear(r), srgbByteToLinear(g), srgbByteToLinear(b));
        lab[i * 3] = color.L;
        lab[i * 3 + 1] = color.a;
        lab[i * 3 + 2] = color.b;
    }

    return {
        name: 'oklab',
        match(linearR: number, linearG: number, linearB: number): number {
            const { L, a, b } = linearToOklab(linearR, linearG, linearB);

            let bestIndex = 0;
            let bestDistance = Infinity;

            for (let i = 0, j = 0; i < count; i += 1, j += 3) {
                const distance = oklabDistanceSquared(L, a, b, lab[j], lab[j + 1], lab[j + 2]);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            }

            return bestIndex;
        }
    };
};

/**
 * The pre-M2 algorithm, kept deliberately. It is not dead code: it is the second
 * algorithm GEN-6's Check requires, and the baseline to compare against while
 * tuning M2 against R1-R6.
 *
 * Re-encoding linear back to bytes round-trips exactly for any value that came
 * from a byte (oklab.test.ts pins that), so on point-sampled input this matcher
 * reproduces the old behavior exactly.
 */
export const rgbMatcher: MatcherFactory = (palette) => {
    if (!Array.isArray(palette) || palette.length === 0) {
        throw new Error('No palette is available for color matching.');
    }

    const indexOf = new Map<PaletteColor, number>();
    palette.forEach((color, index) => indexOf.set(color, index));

    return {
        name: 'rgb',
        match(linearR: number, linearG: number, linearB: number): number {
            const color = findClosestColor(
                linearToSrgbByte(linearR),
                linearToSrgbByte(linearG),
                linearToSrgbByte(linearB),
                palette
            );
            return indexOf.get(color) as number;
        }
    };
};

/**
 * GEN-6's one identifier. Flip this to rgbMatcher to get the pre-M2 behavior
 * back with no edit anywhere else, which is both the Check and the way to
 * compare the two during the R1-R6 review.
 */
export const ACTIVE_MATCHER: MatcherFactory = oklabMatcher;
