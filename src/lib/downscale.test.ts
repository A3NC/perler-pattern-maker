import assert from 'node:assert/strict';
import { test } from 'vitest';
import { areaAverage } from './downscale';
import { linearToSrgbByte, srgbByteToLinear } from './oklab';
import { isTransparentAlpha } from './pattern-utils';
import type { SourcePixels } from '../types';

/** Build SourcePixels from [r,g,b,a] quadruples, row-major. */
function pixels(width: number, height: number, quads: number[][]): SourcePixels {
    return { data: Uint8ClampedArray.from(quads.flat()), width, height };
}

function cellLinear(cells: { linear: Float64Array }, index: number): [number, number, number] {
    const base = index * 3;
    return [cells.linear[base], cells.linear[base + 1], cells.linear[base + 2]];
}

function assertClose(actual: number, expected: number, message: string, tolerance = 1e-9): void {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${message}: expected ${expected} +/- ${tolerance}, got ${actual}`
    );
}

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];

test('half black and half white averages to 188, not 128', () => {
    // The fact the whole step rests on. Averaging the encoded bytes would give
    // 128, a visibly darker gray, and that error lands on every blend in the
    // pattern -- which reads as muddy shading and gets blamed on the matcher.
    const cells = areaAverage(pixels(2, 1, [BLACK, WHITE]), 1, 1);
    const [r, g, b] = cellLinear(cells, 0);

    assertClose(r, 0.5, 'linear red');
    assertClose(g, 0.5, 'linear green');
    assertClose(b, 0.5, 'linear blue');
    assert.equal(linearToSrgbByte(r), 188, 'the midpoint of black and white');
});

test('fine stripes blend to a flat tone instead of aliasing (GEN-4)', () => {
    // Eight alternating pixels into four cells: every cell straddles one black
    // and one white pixel, so all four come out identical. Point sampling would
    // have produced 0 or 1 per cell depending on phase -- the moiré GEN-4 names.
    const stripes = [BLACK, WHITE, BLACK, WHITE, BLACK, WHITE, BLACK, WHITE];
    const cells = areaAverage(pixels(8, 1, stripes), 4, 1);

    for (let cell = 0; cell < 4; cell += 1) {
        const [r] = cellLinear(cells, cell);
        assertClose(r, 0.5, `cell ${cell} should be the flat blend`);
    }
});

test('colour is weighted by alpha, so transparent pixels do not darken an edge', () => {
    // Half the cell is opaque red, half is fully transparent. An unweighted
    // average would give half-brightness red; the right answer is red at full
    // strength, covering half the cell. This is the halo problem in Q8.
    const cells = areaAverage(pixels(2, 1, [RED, CLEAR]), 1, 1);
    const [r, g, b] = cellLinear(cells, 0);

    assertClose(r, 1, 'red stays at full strength');
    assertClose(g, 0, 'green');
    assertClose(b, 0, 'blue');
    assertClose(cells.alpha[0], 0.5, 'coverage is still one half');
});

test('mean coverage decides emptiness under the existing alpha rule (GEN-1)', () => {
    const mostlyClear = areaAverage(pixels(4, 1, [RED, CLEAR, CLEAR, CLEAR]), 1, 1);
    assertClose(mostlyClear.alpha[0], 0.25, 'quarter covered');
    assert.ok(isTransparentAlpha(mostlyClear.alpha[0] * 255), 'a quarter-covered cell is empty');

    const mostlyOpaque = areaAverage(pixels(4, 1, [RED, RED, RED, CLEAR]), 1, 1);
    assertClose(mostlyOpaque.alpha[0], 0.75, 'three quarters covered');
    assert.ok(!isTransparentAlpha(mostlyOpaque.alpha[0] * 255), 'a three-quarter cell is a bead');
});

test('a non-integer scale splits edge pixels fractionally', () => {
    // Three pixels into two cells: each cell is 1.5 px wide, so the middle pixel
    // is shared half and half. Both cells get (0 + 0.5 * 1) / 1.5 = one third.
    const cells = areaAverage(pixels(3, 1, [BLACK, WHITE, BLACK]), 2, 1);

    assertClose(cellLinear(cells, 0)[0], 1 / 3, 'left cell');
    assertClose(cellLinear(cells, 1)[0], 1 / 3, 'right cell');
});

test('a 1:1 scale returns the source unchanged', () => {
    const source = pixels(2, 2, [RED, WHITE, BLACK, [0, 128, 64, 255]]);
    const cells = areaAverage(source, 2, 2);

    assert.deepEqual(cellLinear(cells, 0), [1, 0, 0]);
    assert.deepEqual(cellLinear(cells, 1), [1, 1, 1]);
    assert.deepEqual(cellLinear(cells, 2), [0, 0, 0]);
    assertClose(cellLinear(cells, 3)[1], srgbByteToLinear(128), 'green channel survives exactly');
});

test('an output larger than the source keeps hard edges (R6)', () => {
    // Every cell falls inside one source pixel, so this is exact
    // nearest-neighbour. No blurring, which is what D4 forbids on upscale.
    const cells = areaAverage(pixels(2, 1, [BLACK, WHITE]), 4, 1);

    assert.deepEqual(
        [0, 1, 2, 3].map((cell) => cellLinear(cells, cell)[0]),
        [0, 0, 1, 1]
    );
});

test('rejects a degenerate target', () => {
    assert.throws(() => areaAverage(pixels(1, 1, [RED]), 0, 1), /at least 1 x 1/);
    assert.throws(() => areaAverage(pixels(1, 1, [RED]), 2.5, 1), /at least 1 x 1/);
});
