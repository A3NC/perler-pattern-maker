import { oklabDistance, srgbToOklab } from './oklab';
import type { Oklab } from './oklab';
import type { Palette, PaletteColor } from '../types';

/**
 * Tier 2 of the color picker (EDIT-3): rank the whole palette against an
 * approximate query.
 *
 * The picker is a *query*, not a value. The user supplies something rough -- a
 * native color input, a code fragment, or an eyedropped bead -- and the answer
 * is always real palette entries with real codes. Nothing downstream ever
 * consumes a continuous color, which is why the fidelity of the input does not
 * matter and no custom color wheel is wanted.
 *
 * Ranking is the same measure the generator uses: OkLab distance over the same
 * numbers (GEN-2, D2). That is deliberate rather than convenient -- it means the
 * bead the pipeline would itself have chosen ranks first, so "close" means the
 * same thing in the picker as in the pattern.
 *
 * Pure and DOM-free (NFR-4).
 */

/** How many candidates a query returns. Enough to choose from, short enough to scan. */
export const DEFAULT_CANDIDATE_COUNT = 12;

export interface PaletteCandidate {
    /** Index into the palette that was queried, not into the filtered subset. */
    index: number;
    color: PaletteColor;
    /** OkLab distance to the query. Un-squared, because it is shown to a human. */
    distance: number;
}

/**
 * Substring match over a palette entry's code/name and its hex. Case-insensitive.
 *
 * The default 221-color palette names entries by code alone ("A1", "P17"), so
 * in practice this filters by code; a palette loaded under PAL-6 may carry
 * descriptive names, and then "cobalt" works too. Returned with each entry's
 * original palette index, so ranking below never has to re-find it.
 */
export function filterPalette(palette: Palette, query: string): PaletteCandidate[] {
    const needle = query.trim().toLowerCase();
    const all = palette.map((color, index) => ({ index, color, distance: 0 }));
    if (needle === '') return all;

    return all.filter(({ color }) => (
        color.name.toLowerCase().includes(needle)
        || (color.hex ?? '').toLowerCase().includes(needle)
    ));
}

/**
 * The nearest palette entries to a target color, nearest first.
 *
 * `lab` is the caller's precomputed OkLab table (color-match.ts builds exactly
 * this for the matcher, and reusing it is the point); omit it and one is built
 * here, which keeps this module free of any pipeline import.
 *
 * Ties break on the lower palette index, the same rule reduce.ts uses, so a
 * query is a function of its inputs alone (GEN-7's spirit).
 */
export function nearestPaletteColors(
    palette: Palette,
    target: Oklab,
    options: { lab?: Float64Array; limit?: number; candidates?: PaletteCandidate[] } = {}
): PaletteCandidate[] {
    const limit = options.limit ?? DEFAULT_CANDIDATE_COUNT;
    const candidates = options.candidates ?? filterPalette(palette, '');
    const lab = options.lab;

    const ranked = candidates.map(({ index, color }) => {
        let entry: Oklab;
        if (lab) {
            entry = { L: lab[index * 3], a: lab[index * 3 + 1], b: lab[index * 3 + 2] };
        } else {
            const [r, g, b] = color.rgb as [number, number, number];
            entry = srgbToOklab(r, g, b);
        }
        return {
            index,
            color,
            distance: oklabDistance(target.L, target.a, target.b, entry.L, entry.a, entry.b)
        };
    });

    ranked.sort((a, b) => (a.distance - b.distance) || (a.index - b.index));
    return ranked.slice(0, Math.max(0, limit));
}
