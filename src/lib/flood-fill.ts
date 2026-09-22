import type { Pattern } from '../types';

/**
 * The contiguous region of same-colored cells reachable from one cell (EDIT-8),
 * as pattern indices in ascending row-major order.
 *
 * Three decisions, all load-bearing:
 *
 * **Match on the color's name, not object identity.** PAL-4 makes names unique,
 * and the pattern holds references to palette entries that are shared but need
 * not be -- M7 will deserialize a pattern whose cells are fresh objects. Name
 * matching also gives `null` matching `null` for free, which is what makes
 * fill-with-empty work across a background (EDIT-8's Check, and D13's v1 story
 * for white-canvas artwork).
 *
 * **Exact match only, no tolerance** (D19, refused deliberately). A tolerance
 * would be one more judgment constant in the family that already holds
 * MERGE_FLOOR, MIN_CODE_FONT_PX and DEFAULT_CONTRAST_TUNING. A background that
 * comes out as several near-whites is an R2/GEN-3 defect and is fixed upstream;
 * fill is cheap here precisely *because* GEN-3 Phase A collapses that canvas to
 * one color.
 *
 * **Iterative, never recursive.** A region at NFR-3's 50,000-cell limit would
 * overflow the call stack long before it finished.
 *
 * Pure and DOM-free (NFR-4). 4-neighbour, so a diagonal seam separates regions.
 */
export function floodFillRegion(pattern: Pattern, col: number, row: number): number[] {
    const { width, height, cells } = pattern;
    if (col < 0 || row < 0 || col >= width || row >= height) return [];

    const origin = (row * width) + col;
    const targetName = cells[origin]?.name ?? null;

    const visited = new Uint8Array(width * height);
    const region: number[] = [];
    const stack: number[] = [origin];
    visited[origin] = 1;

    while (stack.length > 0) {
        const index = stack.pop() as number;
        region.push(index);

        const cellCol = index % width;
        const cellRow = (index - cellCol) / width;

        if (cellCol > 0) consider(index - 1);
        if (cellCol < width - 1) consider(index + 1);
        if (cellRow > 0) consider(index - width);
        if (cellRow < height - 1) consider(index + width);
    }

    function consider(neighbour: number): void {
        if (visited[neighbour]) return;
        visited[neighbour] = 1;
        if ((cells[neighbour]?.name ?? null) !== targetName) return;
        stack.push(neighbour);
    }

    // Sorted rather than left in stack order, so the recorded stroke is a
    // function of the pattern and the origin alone -- the same determinism
    // GEN-7 asks of the pipeline, for the same reason: reproducible tests.
    return region.sort((a, b) => a - b);
}
