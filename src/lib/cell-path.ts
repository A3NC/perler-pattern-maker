import type { CellPosition } from './viewport';

/**
 * The cells a straight drag from one bead to another passes through
 * (EDIT-1's named watch-for).
 *
 * A pointermove stream reports *samples*, not a path: one fast flick across the
 * pattern can report two points twenty cells apart, and painting only the cells
 * those samples land in leaves a dotted line. Connecting consecutive samples is
 * what turns EDIT-1's "dragging paints a continuous run with no skipped cells"
 * into something true at every zoom -- and the faster the drag or the smaller
 * the cells, the more this does.
 *
 * Bresenham, in integers, inclusive of both endpoints, so consecutive segments
 * overlap by one cell. That overlap is deliberate: the stroke recorder collapses
 * a repeated index, so an inclusive result is simpler to reason about than an
 * off-by-one convention.
 *
 * Pure and DOM-free (NFR-4).
 */
export function cellsBetween(from: CellPosition, to: CellPosition): CellPosition[] {
    if (![from.col, from.row, to.col, to.row].every(Number.isFinite)) return [];

    let col = Math.floor(from.col);
    let row = Math.floor(from.row);
    const endCol = Math.floor(to.col);
    const endRow = Math.floor(to.row);

    const spanX = Math.abs(endCol - col);
    // Negative by convention: it lets one error accumulator drive both axes.
    const spanY = -Math.abs(endRow - row);
    const stepX = col < endCol ? 1 : -1;
    const stepY = row < endRow ? 1 : -1;

    let error = spanX + spanY;
    const path: CellPosition[] = [];

    for (;;) {
        path.push({ col, row });
        if (col === endCol && row === endRow) break;

        const doubled = 2 * error;
        // Both branches can fire on a perfect diagonal, which is what keeps the
        // run 8-connected rather than stepping through a corner.
        if (doubled >= spanY) {
            error += spanY;
            col += stepX;
        }
        if (doubled <= spanX) {
            error += spanX;
            row += stepY;
        }
    }

    return path;
}
