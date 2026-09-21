import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    boxAverage,
    contrastPreserving,
    contrastPreservingWith,
    type CellColors,
    type Downsampler
} from './downscale';
import { linearToOklab, linearToSrgbByte, oklabDistance, srgbByteToLinear } from '../lib/oklab';
import { isTransparentAlpha } from '../lib/pattern-utils';
import type { SourcePixels } from '../types';

/** Build SourcePixels from [r,g,b,a] quadruples, row-major. */
function pixels(width: number, height: number, quads: number[][]): SourcePixels {
    return { data: Uint8ClampedArray.from(quads.flat()), width, height };
}

function cellLinear(cells: CellColors, index: number): [number, number, number] {
    const base = index * 3;
    return [cells.linear[base], cells.linear[base + 1], cells.linear[base + 2]];
}

/** The cell's colour as an sRGB byte. Only meaningful for the gray fixtures below. */
function cellByte(cells: CellColors, index: number): number {
    return linearToSrgbByte(cellLinear(cells, index)[0]);
}

function luminance([r, g, b]: [number, number, number]): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

/** A light fill, the polarity D18 was written against. R3 loses outlines on exactly this. */
const FILL_BYTE = 220;
const FILL = [FILL_BYTE, FILL_BYTE, FILL_BYTE, 255];
const FILL_LINEAR = srgbByteToLinear(FILL_BYTE);

/** Repeat a pixel n times, for building coverage fixtures by count. */
function repeat(quad: number[], n: number): number[][] {
    return Array.from({ length: n }, () => quad);
}

/**
 * The cases where the two strategies must agree: a cell with no luminance spread
 * has no two populations to weigh, so D18's reconstruction never engages, and
 * alpha is accumulated identically either way. The blending tests below stay
 * box-only on purpose -- turning a clean two-level cell into something other
 * than its mean is the whole point of the contrast-preserving path.
 */
const BOTH: [string, Downsampler][] = [
    ['boxAverage', boxAverage],
    ['contrastPreserving', contrastPreserving]
];

test('half black and half white averages to 188, not 128', () => {
    // The fact the whole step rests on. Averaging the encoded bytes would give
    // 128, a visibly darker gray, and that error lands on every blend in the
    // pattern -- which reads as muddy shading and gets blamed on the matcher.
    const cells = boxAverage(pixels(2, 1, [BLACK, WHITE]), 1, 1);
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
    const cells = boxAverage(pixels(8, 1, stripes), 4, 1);

    for (let cell = 0; cell < 4; cell += 1) {
        const [r] = cellLinear(cells, cell);
        assertClose(r, 0.5, `cell ${cell} should be the flat blend`);
    }
});

for (const [name, downsample] of BOTH) {
    test(`${name}: colour is weighted by alpha, so transparent pixels do not darken an edge`, () => {
        // Half the cell is opaque red, half is fully transparent. An unweighted
        // average would give half-brightness red; the right answer is red at full
        // strength, covering half the cell. This is the halo problem in Q8.
        const cells = downsample(pixels(2, 1, [RED, CLEAR]), 1, 1);
        const [r, g, b] = cellLinear(cells, 0);

        assertClose(r, 1, 'red stays at full strength');
        assertClose(g, 0, 'green');
        assertClose(b, 0, 'blue');
        assertClose(cells.alpha[0], 0.5, 'coverage is still one half');
    });

    test(`${name}: mean coverage decides emptiness under the existing alpha rule (GEN-1)`, () => {
        const mostlyClear = downsample(pixels(4, 1, [RED, CLEAR, CLEAR, CLEAR]), 1, 1);
        assertClose(mostlyClear.alpha[0], 0.25, 'quarter covered');
        assert.ok(isTransparentAlpha(mostlyClear.alpha[0] * 255), 'a quarter-covered cell is empty');

        const mostlyOpaque = downsample(pixels(4, 1, [RED, RED, RED, CLEAR]), 1, 1);
        assertClose(mostlyOpaque.alpha[0], 0.75, 'three quarters covered');
        assert.ok(!isTransparentAlpha(mostlyOpaque.alpha[0] * 255), 'a three-quarter cell is a bead');
    });

    test(`${name}: a 1:1 scale returns the source unchanged`, () => {
        const source = pixels(2, 2, [RED, WHITE, BLACK, [0, 128, 64, 255]]);
        const cells = downsample(source, 2, 2);

        assert.deepEqual(cellLinear(cells, 0), [1, 0, 0]);
        assert.deepEqual(cellLinear(cells, 1), [1, 1, 1]);
        assert.deepEqual(cellLinear(cells, 2), [0, 0, 0]);
        assertClose(cellLinear(cells, 3)[1], srgbByteToLinear(128), 'green channel survives exactly');
    });

    test(`${name}: an output larger than the source keeps hard edges (R6)`, () => {
        // Every cell falls inside one source pixel, so this is exact
        // nearest-neighbour. No blurring, which is what D4 forbids on upscale.
        const cells = downsample(pixels(2, 1, [BLACK, WHITE]), 4, 1);

        assert.deepEqual(
            [0, 1, 2, 3].map((cell) => cellLinear(cells, cell)[0]),
            [0, 0, 1, 1]
        );
    });

    test(`${name}: rejects a degenerate target`, () => {
        assert.throws(() => downsample(pixels(1, 1, [RED]), 0, 1), /at least 1 x 1/);
        assert.throws(() => downsample(pixels(1, 1, [RED]), 2.5, 1), /at least 1 x 1/);
    });
}

test('a non-integer scale splits edge pixels fractionally', () => {
    // Three pixels into two cells: each cell is 1.5 px wide, so the middle pixel
    // is shared half and half. Both cells get (0 + 0.5 * 1) / 1.5 = one third.
    const cells = boxAverage(pixels(3, 1, [BLACK, WHITE, BLACK]), 2, 1);

    assertClose(cellLinear(cells, 0)[0], 1 / 3, 'left cell');
    assertClose(cellLinear(cells, 1)[0], 1 / 3, 'right cell');
});

// ---------------------------------------------------------------------------
// D18 -- lineart preservation. Every one of these pins contrastPreserving
// against boxAverage, so the photo path cannot regress without a test saying so.
// ---------------------------------------------------------------------------

test('D18: the coverage threshold is what decides lineart from fill', () => {
    // The classification is a cliff, not a curve, so the only thing to pin is its
    // direction. Both cells of the straddle fixture are gated; sending the
    // threshold to either extreme must send both the same way.
    const row = [...repeat(FILL, 15), ...repeat(BLACK, 16), ...repeat(FILL, 19)];
    const source = pixels(50, 1, row);

    const allLine = contrastPreservingWith({ darkCoverageMin: 0 })(source, 2, 1);
    assert.deepEqual([cellByte(allLine, 0), cellByte(allLine, 1)], [0, 0], 'every gated cell is line');

    const allFill = contrastPreservingWith({ darkCoverageMin: 1 })(source, 2, 1);
    assert.deepEqual(
        [cellByte(allFill, 0), cellByte(allFill, 1)],
        [FILL_BYTE, FILL_BYTE],
        'every gated cell is fill'
    );
});

test('D18: a 0.64-coverage line against a light fill comes out as the line colour', () => {
    // The defect exactly as measured on R3: a 10 px line inside a ~15.6 px cell.
    // 16 dark of 25 is that ratio at whole pixels.
    const source = pixels(25, 1, [...repeat(BLACK, 16), ...repeat(FILL, 9)]);

    // 139 is the washout quantified -- the cell that should read as a dark line
    // reads as a mid tone. Correct linear-light averaging is what produces it
    // (gamma-naive averaging gave 79), which is why this needed a decision
    // rather than a revert.
    assert.equal(cellByte(boxAverage(source, 1, 1), 0), 139, 'the box average washes the line out');

    // Not "clearly dark" -- the line's own colour, exactly. The cell is
    // classified, so it takes the dark population's mean and nothing else.
    assert.equal(cellByte(contrastPreserving(source, 1, 1), 0), 0, 'the line survives as the line');
});

test('D18: a straddled line resolves to one line cell and one clean fill cell', () => {
    // 16 contiguous dark pixels across a cell boundary at 25 px per cell: 10 fall
    // in the left cell (f = 0.40) and 6 in the right (f = 0.24). This is the case
    // that decides whether a line comes out one bead wide or two -- and, before
    // the classification replaced the S-curve, the case that produced the grey
    // in-between beads the R1-R6 review reported.
    const row = [...repeat(FILL, 15), ...repeat(BLACK, 16), ...repeat(FILL, 19)];
    const source = pixels(50, 1, row);

    const box = boxAverage(source, 2, 1);
    const preserved = contrastPreserving(source, 2, 1);

    // The box average leaves two light-ish greys 20 bytes apart -- neither of them
    // a line, neither of them the fill.
    assert.ok(cellByte(box, 1) - cellByte(box, 0) < 25, 'the box average barely separates them');

    // Exactly two values across the pair, and both are colours the source
    // actually contains. No third tone between line and fill.
    assert.equal(cellByte(preserved, 0), 0, 'the strong side is the line');
    assert.equal(cellByte(preserved, 1), FILL_BYTE, 'the weak side is the untouched fill');
});

test('D18: a diagonal line survives as a continuous run of line cells (R3)', () => {
    // A 3 px band on the diagonal of a 48 px square into a 12 x 12 grid: every
    // cell on the diagonal gets 10 of its 16 pixels dark, which is the same ~0.64
    // as the measured case. R3's Check is "outlines survive as continuous lines,
    // not dashes", and no per-cell test can see a gap.
    const quads: number[][] = [];
    for (let y = 0; y < 48; y += 1) {
        for (let x = 0; x < 48; x += 1) {
            quads.push(Math.abs(x - y) <= 1 ? BLACK : WHITE);
        }
    }
    const source = pixels(48, 48, quads);

    const box = boxAverage(source, 12, 12);
    const preserved = contrastPreserving(source, 12, 12);

    for (let i = 0; i < 12; i += 1) {
        const cell = i * 12 + i;
        assert.equal(cellByte(preserved, cell), 0, `cell ${i},${i} broke the run`);
        // What the box average leaves instead: an unbroken run of mid gray, which
        // the matcher then resolves toward the fill.
        assert.ok(cellByte(box, cell) > 140, 'the box average leaves a mid tone here');
    }

    // And it does not bloom sideways. Every cell off the diagonal is the untouched
    // fill, including the ones clipped by a corner of the band -- outlines two and
    // three beads wide are the worse defect.
    for (let cy = 0; cy < 12; cy += 1) {
        for (let cx = 0; cx < 12; cx += 1) {
            if (cx === cy) continue;
            assert.equal(cellByte(preserved, cy * 12 + cx), 255, `cell ${cy},${cx} bloomed`);
        }
    }
});

test('D18: a uniform fill is untouched, so nothing is invented from nothing', () => {
    const source = pixels(16, 1, repeat(FILL, 16));
    const cells = contrastPreserving(source, 1, 1);

    assertClose(cellLinear(cells, 0)[0], FILL_LINEAR, 'a flat cell keeps its colour exactly');
});

test('D18: a smooth gradient keeps its plain mean (the bimodality gate)', () => {
    // Half a gradient's pixels sit below its mean, so without the gate a gradient
    // reads exactly like a thick line and every soft shadow grows an outline.
    const ramp = Array.from({ length: 16 }, (_, i) => {
        const byte = Math.round((i / 15) * 255);
        return [byte, byte, byte, 255];
    });
    const source = pixels(16, 1, ramp);

    const mean = cellLinear(boxAverage(source, 1, 1), 0);
    const preserved = cellLinear(contrastPreserving(source, 1, 1), 0);

    assert.deepEqual(preserved, mean, 'a gradient cell falls through to the plain mean');
});

test('D18: a stray dark pixel is excluded from the fill entirely', () => {
    // One dark pixel in sixteen is not a line, so the cell is classified fill --
    // and a fill cell returns its *light population*, not the plain mean. The
    // stray pixel contributes nothing at all. This is what replaces the old
    // stray-pixel threshold, and it is why a fill beside a line stays clean
    // instead of picking up a grey cast.
    const source = pixels(16, 1, [BLACK, ...repeat(FILL, 15)]);

    assert.ok(
        cellLinear(boxAverage(source, 1, 1), 0)[0] < FILL_LINEAR,
        'the plain average is dragged down by the stray pixel'
    );
    assertClose(
        cellLinear(contrastPreserving(source, 1, 1), 0)[0],
        FILL_LINEAR,
        'the classified fill is exactly the fill'
    );
});

// ---------------------------------------------------------------------------
// The R1/R3 colour-speck regression, reported from the R1-R6 review: B25 (green)
// appearing on R3's face among correct skin tones, and G20 (saturated rust)
// inside R1's G7 (muted brown) regions.
//
// Both come from one mechanism. The reconstruction mixes the single darkest and
// single lightest pixel of the cell, each picked by luminance, so at the ends of
// the curve a cell's colour collapses onto essentially one source pixel -- the
// point sampling GEN-4 exists to remove, reintroduced and aimed at the most
// extreme pixel rather than a random one. Two consequences, one per symptom:
// a chroma-fringe pixel can inject a hue the cell's content does not have, and
// picking extrema inflates chroma, because a mean over ~64 pixels pulls toward
// neutral while the luminance extremes of a textured region are its most
// saturated pixels.
// ---------------------------------------------------------------------------

test('D18: a chroma-fringe pixel cannot dictate the cell hue (R3 B25 specks)', () => {
    // A feature boundary on a face: six dark pixels of a nostril or lash line
    // against nine skin pixels, plus one green-tinted fringe pixel of the kind
    // JPEG 4:2:0 and antialiasing leave along exactly such an edge. The cell is
    // genuinely bimodal, so the gate fires -- flat skin would not reach here.
    const FEATURE = [60, 40, 35, 255];
    const SKIN = [255, 209, 186, 255];      // E14
    const FRINGE = [180, 255, 170, 255];    // one pixel, and the cell's brightest
    const source = pixels(16, 1, [...repeat(FEATURE, 6), ...repeat(SKIN, 9), FRINGE]);

    // Every tone here except the stray fringe pixel runs R > G > B, and a convex
    // combination cannot reverse channel ordering. So an output with G > R proves
    // the cell's colour was taken from the fringe pixel rather than averaged over
    // a population -- which is how a face grows a green bead.
    const [r, g, b] = cellLinear(contrastPreserving(source, 1, 1), 0);
    assert.ok(r > g && g > b, `expected a warm cell, got linear rgb ${[r, g, b].join(', ')}`);

    // The plain average gets this right, which is why flipping ACTIVE_DOWNSAMPLER
    // to boxAverage is the diagnostic for the reported specks.
    const [mr, mg, mb] = cellLinear(boxAverage(source, 1, 1), 0);
    assert.ok(mr > mg && mg > mb, 'the box average stays warm');
});

test('D18: one pixel in sixteen must not dictate the cell colour (R1 G20 specks)', () => {
    // The general form of the defect, and the one that covers both reported
    // signatures. G20-in-G7 is not an alien hue -- same hue family, near-identical
    // lightness, the difference is chroma (0.145 vs 0.097). That is the same
    // mechanism wearing a quieter disguise: the single darkest and single lightest
    // pixel of ~64 samples are tail values, and a tail value is both hue-noisy and
    // more saturated than the bulk it was drawn from.
    //
    // So assert the property directly. These two cells differ by exactly one pixel
    // out of sixteen; their colours must barely move.
    const FEATURE = [60, 40, 35, 255];
    const SKIN = [255, 209, 186, 255];
    const FRINGE = [180, 255, 170, 255];

    const without = pixels(16, 1, [...repeat(FEATURE, 6), ...repeat(SKIN, 10)]);
    const with_ = pixels(16, 1, [...repeat(FEATURE, 6), ...repeat(SKIN, 9), FRINGE]);

    const lab = ([r, g, b]: [number, number, number]) => linearToOklab(r, g, b);
    const a = lab(cellLinear(contrastPreserving(without, 1, 1), 0));
    const c = lab(cellLinear(contrastPreserving(with_, 1, 1), 0));
    const moved = oklabDistance(a.L, a.a, a.b, c.L, c.a, c.b);

    // 0.05 is just under the OkLab distance between G20 and G7 (0.058): one stray
    // pixel must not move a cell far enough to change which bead it becomes.
    assert.ok(moved < 0.05, `one pixel moved the cell ${moved.toFixed(3)} in OkLab`);
});
