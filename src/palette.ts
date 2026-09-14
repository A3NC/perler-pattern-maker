import { normalizePalette, validatePalette } from './lib/pattern-utils';
import type { Palette } from './types';

const PALETTE_URL = 'colors_221.json';

/**
 * Load and validate the default 221-color palette (PAL-2). Throws on a bad
 * fetch or failed validation so the caller can disable generation (PAL-3).
 */
export async function loadPalette(url: string = PALETTE_URL): Promise<Palette> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

    // A dev server's SPA fallback answers a missing file with index.html rather
    // than a 404, so an absent palette would otherwise surface as an opaque
    // "Unexpected token '<'" parse error. Name it instead.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
        throw new Error(`${url} did not return JSON (got ${contentType || 'no content type'}) -- the file is probably missing`);
    }

    const normalizedPalette = normalizePalette(await response.json());
    const validationErrors = validatePalette(normalizedPalette);
    if (validationErrors.length > 0) {
        throw new Error(validationErrors.slice(0, 3).join(' '));
    }
    return normalizedPalette;
}
