import type { ColorTally, PaletteColor, PatternDimensions } from '../types';

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

export const MAX_PATTERN_DIMENSION = 500;
export const MAX_PATTERN_CELLS = 100000;

export function parseHexColor(hex: unknown): number[] | null {
    if (typeof hex !== 'string' || !HEX_COLOR_PATTERN.test(hex)) {
        return null;
    }

    const normalized = hex.replace('#', '');
    return [
        Number.parseInt(normalized.slice(0, 2), 16),
        Number.parseInt(normalized.slice(2, 4), 16),
        Number.parseInt(normalized.slice(4, 6), 16)
    ];
}

/**
 * Adds an `rgb` triple to each record, from the record's own `rgb` or its `hex`.
 * Records that yield no usable RGB keep a null here and are reported by
 * validatePalette, which is the guard every caller must run before use.
 */
export function normalizePalette(records: unknown): PaletteColor[] {
    if (!Array.isArray(records)) {
        throw new Error('Palette data must be an array.');
    }

    return records.map((record, index) => {
        if (!record || typeof record !== 'object') {
            throw new Error(`Palette entry ${index + 1} is not an object.`);
        }

        const rgb = Array.isArray(record.rgb) ? [...record.rgb] : parseHexColor(record.hex);
        return {
            ...record,
            rgb
        } as PaletteColor;
    });
}

export function validatePalette(records: unknown): string[] {
    const errors: string[] = [];
    const names = new Set<string>();

    if (!Array.isArray(records) || records.length === 0) {
        return ['Palette must contain at least one color.'];
    }

    records.forEach((color, index) => {
        const entryLabel = `Palette entry ${index + 1}`;
        if (!color || typeof color !== 'object') {
            errors.push(`${entryLabel} is not an object.`);
            return;
        }

        if (typeof color.name !== 'string' || color.name.trim() === '') {
            errors.push(`${entryLabel} is missing a color code/name.`);
        } else if (names.has(color.name)) {
            errors.push(`Duplicate color code/name: ${color.name}.`);
        } else {
            names.add(color.name);
        }

        if (!Array.isArray(color.rgb) || color.rgb.length !== 3 || color.rgb.some((channel: unknown) => (
            typeof channel !== 'number' || !Number.isInteger(channel) || channel < 0 || channel > 255
        ))) {
            errors.push(`${entryLabel} (${color.name || 'unknown'}) has invalid RGB values.`);
        }
    });

    return errors;
}

export function calculateDimensions(
    targetInches: number,
    beadSizeInches: number,
    sourceWidth: number,
    sourceHeight: number,
    options: { maxDimension?: number; maxCells?: number } = {}
): PatternDimensions {
    const maxDimension = options.maxDimension ?? MAX_PATTERN_DIMENSION;
    const maxCells = options.maxCells ?? MAX_PATTERN_CELLS;

    if (!Number.isFinite(targetInches) || targetInches <= 0) {
        throw new Error('Enter a target width greater than 0 inches.');
    }
    if (!Number.isFinite(beadSizeInches) || beadSizeInches <= 0) {
        throw new Error('Choose a valid bead size.');
    }
    if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
        throw new Error('The uploaded image has invalid dimensions.');
    }

    const pixelWidth = Math.round(targetInches / beadSizeInches);
    const pixelHeight = Math.round(pixelWidth * (sourceHeight / sourceWidth));
    const cellCount = pixelWidth * pixelHeight;

    if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth < 1 || pixelHeight < 1) {
        throw new Error('The requested dimensions are too small to create a pattern.');
    }
    if (pixelWidth > maxDimension || pixelHeight > maxDimension || cellCount > maxCells) {
        throw new Error(
            `Pattern is too large. Choose a smaller width or a different bead size `
            + `(maximum ${maxDimension} × ${maxDimension} beads and ${maxCells.toLocaleString()} cells).`
        );
    }

    return { pixelWidth, pixelHeight, cellCount };
}

export function isTransparentAlpha(alpha: unknown, threshold = 128): boolean {
    return typeof alpha !== 'number' || alpha < threshold;
}

export function colorDistanceSquared(
    r1: number, g1: number, b1: number,
    r2: number, g2: number, b2: number
): number {
    return (r2 - r1) ** 2 + (g2 - g1) ** 2 + (b2 - b1) ** 2;
}

export function findClosestColor(r: number, g: number, b: number, palette: PaletteColor[]): PaletteColor {
    if (!Array.isArray(palette) || palette.length === 0) {
        throw new Error('No palette is available for color matching.');
    }

    let minDistance = Infinity;
    let closestColor: PaletteColor | null = null;

    for (const color of palette) {
        const [colorR, colorG, colorB] = color.rgb as [number, number, number];
        const distance = colorDistanceSquared(r, g, b, colorR, colorG, colorB);
        if (distance < minDistance) {
            minDistance = distance;
            closestColor = color;
        }
    }

    return closestColor as PaletteColor;
}

export function addColorTally(tallies: Record<string, ColorTally>, color: PaletteColor): void {
    if (!tallies[color.name]) {
        tallies[color.name] = {
            name: color.name,
            rgb: color.rgb,
            count: 0
        };
    }
    tallies[color.name].count += 1;
}
