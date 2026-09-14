// Shared data types. No DOM, no imports: safe for Node-only tests (NFR-4).

/** One entry of a loaded, validated Perler palette. */
export interface PaletteColor {
    name: string;
    hex?: string;
    rgb: number[];
}

export type Palette = PaletteColor[];

/** Bead-grid size derived from target width, bead pitch, and source aspect ratio. */
export interface PatternDimensions {
    pixelWidth: number;
    pixelHeight: number;
    cellCount: number;
}

/** One row of the bead inventory (OUT-4). */
export interface ColorTally {
    name: string;
    rgb: number[];
    count: number;
}

/**
 * A generated pattern: row-major cells, one palette color each, `null` where the
 * source was transparent (GEN-1). This is the contract M1 renders, M5 edits,
 * M6 exports, and M7 serializes.
 */
export interface Pattern {
    width: number;
    height: number;
    cells: (PaletteColor | null)[];
}

/**
 * Raw RGBA pixels, structurally compatible with the DOM `ImageData` but not
 * tied to it, so the pipeline can be tested in bare Node (NFR-4).
 */
export interface SourcePixels {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}
