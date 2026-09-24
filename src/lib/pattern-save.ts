import { MAX_PATTERN_CELLS, MAX_PATTERN_DIMENSION, validatePalette } from './pattern-utils';
import type { CropRect } from './crop';
import type { Pattern, PaletteColor } from '../types';

/**
 * The autosave's stored shapes (SAVE-1, D23), and the only code that reads or
 * writes them. DOM-free and IndexedDB-free: `src/state/save-store.ts` moves
 * these records in and out of storage and decides nothing.
 *
 * `Pattern` is not reshaped to suit storage. It is converted to a separate,
 * versioned record and back, so M5's editor, M6's export and this file all
 * keep agreeing on the one shape the app actually uses.
 *
 * Two records rather than one, because the pattern is rewritten after every
 * stroke and the image never is: putting a multi-megabyte blob in the
 * per-stroke record would ask the browser to store it again on every edit.
 * `generation` ties the two together, so a pair that disagrees is detectable.
 */

export const SAVE_VERSION = 1;

/** The settings that *produced* the pattern, captured at Generate (D23). */
export interface SavedSettings {
    targetWidth: number;
    beadSize: number;
    colorLimit: number;
}

export interface SavedPatternRecord {
    version: typeof SAVE_VERSION;
    /** One id per Generate, shared with the image record written beside it. */
    generation: string;
    /** ISO timestamp, shown in the restore message. */
    savedAt: string;
    settings: SavedSettings;
    width: number;
    height: number;
    /** The distinct colors the pattern uses, as full records, in first-seen order. */
    colors: PaletteColor[];
    /**
     * One entry per cell, row-major: an index into `colors`, or -1 for empty.
     * A typed array because IndexedDB structured-clones it as-is -- 100 KB at
     * NFR-3's hard limit and no stringify -- and the palette is far inside Int16.
     */
    cells: Int16Array;
}

export interface SavedImageRecord {
    version: typeof SAVE_VERSION;
    generation: string;
    /** The uploaded file's own bytes, never re-encoded, so a HEIC stays HEIC. */
    file: Blob;
    /** Kept because `readImageFile`'s messages name the file. */
    name: string;
    type: string;
    /** Integer source pixels, as `crop.ts` keeps it. Clamped again after decode. */
    crop: CropRect;
}

export type DecodedPattern =
    | { ok: true; pattern: Pattern; settings: SavedSettings; generation: string; savedAt: string }
    | { ok: false; reason: string };

export type DecodedImage =
    | { ok: true; file: Blob; name: string; type: string; crop: CropRect; generation: string }
    | { ok: false; reason: string };

export function encodePattern(
    pattern: Pattern,
    settings: SavedSettings,
    generation: string,
    now: Date
): SavedPatternRecord {
    const colors: PaletteColor[] = [];
    const indexByName = new Map<string, number>();
    const cells = new Int16Array(pattern.cells.length);

    pattern.cells.forEach((color, i) => {
        if (!color) {
            cells[i] = -1;
            return;
        }
        let index = indexByName.get(color.name);
        if (index === undefined) {
            index = colors.length;
            indexByName.set(color.name, index);
            // A copy of the fields the app reads, not the palette's own object:
            // structured clone would copy it anyway, and this keeps an extra
            // field on a palette record from riding into storage.
            const stored: PaletteColor = { name: color.name, rgb: [...color.rgb] };
            if (color.hex !== undefined) stored.hex = color.hex;
            colors.push(stored);
        }
        cells[i] = index;
    });

    return {
        version: SAVE_VERSION,
        generation,
        savedAt: now.toISOString(),
        settings: { ...settings },
        width: pattern.width,
        height: pattern.height,
        colors,
        cells
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasGeneration(record: Record<string, unknown>): boolean {
    return typeof record.generation === 'string' && record.generation !== '';
}

/**
 * Read back a pattern record. Never throws: this is data the app did not write
 * in this session, and it may come from an older build, a torn write, or a hand
 * in devtools -- the same stance `image-file.ts` takes toward input it did not
 * write. Every reason is for the console; the user gets one sentence.
 */
export function decodePattern(record: unknown): DecodedPattern {
    if (!isRecord(record)) return { ok: false, reason: 'not an object' };
    if (record.version !== SAVE_VERSION) return { ok: false, reason: `unknown version ${String(record.version)}` };
    if (!hasGeneration(record)) return { ok: false, reason: 'missing generation' };
    if (typeof record.savedAt !== 'string') return { ok: false, reason: 'missing savedAt' };

    const { width, height } = record;
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
        return { ok: false, reason: 'width and height must be positive integers' };
    }
    if (width > MAX_PATTERN_DIMENSION || height > MAX_PATTERN_DIMENSION || width * height > MAX_PATTERN_CELLS) {
        return { ok: false, reason: `${width} × ${height} exceeds the pattern limits` };
    }

    const settings = record.settings;
    if (!isRecord(settings)
        || !isFinitePositive(settings.targetWidth)
        || !isFinitePositive(settings.beadSize)
        || !isFinitePositive(settings.colorLimit)) {
        return { ok: false, reason: 'invalid settings' };
    }

    const colors = record.colors;
    if (!Array.isArray(colors)) return { ok: false, reason: 'colors is not an array' };
    // An all-empty pattern has no colors, which validatePalette would refuse.
    if (colors.length > 0) {
        const errors = validatePalette(colors);
        if (errors.length > 0) return { ok: false, reason: errors[0] };
    }

    const cells = record.cells;
    if (!(cells instanceof Int16Array)) return { ok: false, reason: 'cells is not an Int16Array' };
    if (cells.length !== width * height) {
        return { ok: false, reason: `${cells.length} cells for a ${width} × ${height} pattern` };
    }

    // One object per color, shared by every cell that uses it, as a generated
    // pattern has.
    const table: PaletteColor[] = colors.map((color: PaletteColor) => {
        const restored: PaletteColor = { name: color.name, rgb: [...color.rgb] };
        if (typeof color.hex === 'string') restored.hex = color.hex;
        return restored;
    });

    const patternCells: (PaletteColor | null)[] = new Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
        const index = cells[i];
        if (index === -1) {
            patternCells[i] = null;
        } else if (index >= 0 && index < table.length) {
            patternCells[i] = table[index];
        } else {
            return { ok: false, reason: `cell ${i} refers to color ${index}` };
        }
    }

    return {
        ok: true,
        pattern: { width, height, cells: patternCells },
        settings: {
            targetWidth: settings.targetWidth,
            beadSize: settings.beadSize,
            colorLimit: settings.colorLimit
        },
        generation: record.generation as string,
        savedAt: record.savedAt
    };
}

/**
 * Read back an image record. Whether the crop fits the image is not checked
 * here -- only the decode knows the image's size -- so the caller clamps it
 * through `crop.ts` afterwards.
 */
export function decodeImageRecord(record: unknown): DecodedImage {
    if (!isRecord(record)) return { ok: false, reason: 'not an object' };
    if (record.version !== SAVE_VERSION) return { ok: false, reason: `unknown version ${String(record.version)}` };
    if (!hasGeneration(record)) return { ok: false, reason: 'missing generation' };
    // Checked structurally rather than with instanceof Blob, which Node's test
    // runner and a browser realm do not agree on.
    if (!isRecord(record.file) || typeof record.file.size !== 'number' || typeof record.file.slice !== 'function') {
        return { ok: false, reason: 'file is not a Blob' };
    }
    if (typeof record.name !== 'string' || typeof record.type !== 'string') {
        return { ok: false, reason: 'missing file name or type' };
    }

    const crop = record.crop;
    if (!isRecord(crop)
        || !isNonNegativeInteger(crop.x)
        || !isNonNegativeInteger(crop.y)
        || !isPositiveInteger(crop.width)
        || !isPositiveInteger(crop.height)) {
        return { ok: false, reason: 'invalid crop' };
    }

    return {
        ok: true,
        file: record.file as unknown as Blob,
        name: record.name,
        type: record.type,
        crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
        generation: record.generation as string
    };
}
