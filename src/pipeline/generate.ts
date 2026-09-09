import { addColorTally, findClosestColor, isTransparentAlpha } from '../lib/pattern-utils';
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
 * M2 replaces the matching inside this module with OkLab (GEN-2) and adds the
 * color limit (GEN-3). Callers should not need to change.
 *
 * Cells are row-major and `null` where the source was transparent, matching the
 * alpha < 128 rule the app has always used. Tallies accumulate in that same
 * row-major order, which is what decides how equal counts break ties once the
 * inventory is sorted -- do not reorder this loop.
 */
export function generatePattern(source: SourcePixels, palette: Palette): GeneratedPattern {
    const { data } = source;
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
        const matchedColor = findClosestColor(r, g, b, palette);
        addColorTally(tallies, matchedColor);
        cells.push(matchedColor);
    }

    return {
        pattern: { width: source.width, height: source.height, cells },
        tallies,
        beadCount
    };
}
