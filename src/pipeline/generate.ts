import { ACTIVE_MATCHER } from './color-match';
import { srgbByteToLinear } from '../lib/oklab';
import { addColorTally, isTransparentAlpha } from '../lib/pattern-utils';
import type { ColorTally, PaletteColor, Palette, Pattern, SourcePixels } from '../types';

export interface GeneratedPattern {
    pattern: Pattern;
    tallies: Record<string, ColorTally>;
    beadCount: number;
}

/**
 * The GEN-6 boundary: pixels in, Pattern out. Deliberately DOM-free so it stays
 * testable in bare Node (NFR-4); rasterizing the image is rasterize.ts's job.
 *
 * Matching goes through ACTIVE_MATCHER, so swapping algorithms is one identifier
 * in color-match.ts and nothing here or above -- which is GEN-6's Check. M2 step
 * 4 adds the color limit (GEN-3) after the matching loop.
 *
 * The matcher is built per call rather than per cell: that is 221 palette
 * conversions per generate, microseconds, against 11M if it were built inside
 * the loop. It deliberately is not hoisted to palette-load time in main.ts,
 * because that would put the algorithm choice outside the pipeline module and
 * break exactly the property GEN-6 asks for.
 *
 * Cells are row-major and `null` where the source was transparent, matching the
 * alpha < 128 rule the app has always used. Tallies accumulate in that same
 * row-major order, which is what decides how equal counts break ties once the
 * inventory is sorted -- do not reorder this loop.
 */
export function generatePattern(source: SourcePixels, palette: Palette): GeneratedPattern {
    const { data } = source;
    const matcher = ACTIVE_MATCHER(palette);
    const cells: (PaletteColor | null)[] = [];
    const tallies: Record<string, ColorTally> = {};
    let beadCount = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (isTransparentAlpha(a)) {
            cells.push(null);
            continue;
        }

        beadCount++;
        // Linearize here so the matcher receives the same form the GEN-4
        // downscale will hand it in step 3 -- at which point this conversion
        // moves upstream and the averaged value arrives already linear.
        const matchedColor = palette[matcher.match(
            srgbByteToLinear(r),
            srgbByteToLinear(g),
            srgbByteToLinear(b)
        )];
        addColorTally(tallies, matchedColor);
        cells.push(matchedColor);
    }

    return {
        pattern: { width: source.width, height: source.height, cells },
        tallies,
        beadCount
    };
}
