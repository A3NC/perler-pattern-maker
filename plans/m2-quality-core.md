# M2 — Quality core: perceptual matching + color limit

_Tactical plan · written 2026-09-15, the day M2 started · originally due **Fri 2026-09-18**
(`schedule.md`), extended for D18 — see "Lineart preservation" and Order of work_

_Delete this file at milestone close and move the `CLAUDE.md` pointer to the next one. Scope and
order live in `plan-v1.md`; what must be true lives in `specs.md`. This file only answers "how do I
get through M2."_

## What this milestone closes

GEN-2 (OkLab matching), GEN-3 (color limit), GEN-4 (area averaging), GEN-6 (replaceable pipeline),
GEN-7 (determinism), GEN-8 (the R1–R6 review), SET-4 (the color-limit control).

**The timebox is the point.** `plan-v1.md`'s risk table says M2's failure mode is an endless tuning
loop, and the R1–R6 review is the stopping rule. The six images are already committed in
`test_img/`. When they pass, stop — even if it feels improvable. M5's editor is the escape valve.

## Why gamma appears twice

This is the one non-obvious thing in the milestone, and getting it wrong makes the two halves of M2
blame each other.

- **Matching.** OkLab's input is *linear* RGB. Its `L` axis is approximately `cbrt(linear)`, which
  is exactly what makes `rgb(20,20,20)` read as clearly-not-black rather than nearest-to-black.
  That specific failure is what GEN-2 was written against.
- **Averaging.** An sRGB byte is not proportional to light — 128 is about 21% of 255's light, not
  50%. So averaging encoded bytes averages the wrong quantity: half-black/half-white comes out 128
  when the perceptually correct answer is **188**. Every blend lands too dark, which shows up as
  muddy shading in R3 — and looks like a matcher bug when it is a downscale bug.

So the order is fixed: linearize each source pixel **once** (a 256-entry table, since inputs are
bytes), average in linear light, convert the cell average straight to OkLab. Never re-encode to
bytes in between.

## Decisions taken up front

Both are recorded as **D17** in `specs.md`; restated here because they shape the code.

- **Reduction is a greedy perceptual merge, not frequency ranking.** Ranking by count keeps all four
  of a white canvas's near-whites (all frequent — R2's stated failure) and drops the ~40 beads that
  make up a dog's eyes (rank ~60 — R4's stated requirement). Ranking by `count × ΔE to nearest
  survivor` inverts both.
- **The merge also runs below the limit, behind a ΔE floor.** Reduction only fires when the distinct
  count exceeds the limit, but flat artwork often lands under 30 colors, so R2's speckle would
  otherwise never be touched. One mechanism, two stopping rules; `MERGE_FLOOR = 0` reduces it to
  pure limit behavior.

## Lineart preservation — D18

_Added 2026-09-15, out of the human review of steps 1–4. This was not in the milestone as planned.
It is absorbed rather than deferred because R3's Check — "outlines survive as continuous lines, not
dashes" — is **[v1]**, so GEN-8 cannot pass while it fails, and GEN-8 is this milestone's own
stopping condition. Closing M2 with its defining Check failing would make the R1–R6 review
decorative rather than a gate._

**The defect.** Lineart beside a solid fill washes out. Measured against `test_img/R3.png`: the
source is 1556 px wide, so at the 100 × 100 design target one bead cell spans ~15.6 source pixels,
and a line of ~10 px or less covers **~0.64 of a cell**. Straddling a cell boundary it splits
roughly **0.40 / 0.24**, so `f_dark` in practice lands between **0.25 and 0.65**. The line does not
disappear — it survives as cells whose average is a large-minority mixture, which the matcher
correctly matches to a bead far lighter than the line's own colour. Reported worst on light fills,
where losing a high-contrast outline is most visible. Note that all three stages behave correctly —
this is not a bug in any one of them, which is why it needs a deliberate answer rather than a fix.

**`SUPERSAMPLE` is not a lever.** That 0.64 is line width over source pixels per cell, and the
supersample factor divides both, cancelling out of `rasterize.ts`'s scale. The ratio is a property
of the artwork and the chosen bead grid; nothing in the decode path moves it.

**Correct averaging costs line fidelity, and that is the finding worth keeping.** A black line
covering 0.64 of a cell against a fill of byte 220 averages to **79** in gamma-encoded sRGB and to
**139** in linear light — a deviation from the fill of 141 bytes against 81, so the pre-M2 build's
gamma-naive averaging preserved dark lines nearly twice as well as the correct version does. That
139 is the washout quantified: the cell that should read as a dark line reads as a mid tone instead.
Linear-light averaging lightens any mixture containing a dark minority. This is not an argument for
reverting — gamma-space averaging is wrong
for the gradients and shading that are most of R3 and all of R4/R5 — but it explains why this
surfaced at step 3 rather than step 2, and it is exactly the sort of thing that gets rediscovered
painfully later.

**Diagnosed 2026-09-16 — the cheap cause is ruled out.** The test was to set the color limit to the
palette size *and* `mergeFloor` to 0 and regenerate, which separates two very differently priced
causes:

- *Line returns* → Phase A is merging the faint line color into the fill. The fix is cheap: lower
  `MERGE_FLOOR`, or exempt a merge that would eliminate a color outright rather than thin it.
- *Line still washed out* → it died at averaging, and needs the downsampler below.

**Result: the second.** Lowering `MERGE_FLOOR` does not bring the line back, so `reduce.ts` is not
the cause and step 5 is unconditional. Worth carrying into `specs.md` at close — it is the evidence
that the new downsampler had to be built rather than tuned around.

### The strategy

A box average is right for photos — it is what an optical reduction does. For lineart it is the
wrong question: not "what is the average light in this cell" but "what is the dominant visual
content of this cell." That is why pixel-art downscalers do not use box filters. So the downsampler
becomes a strategy the way the matcher is, with `ACTIVE_DOWNSAMPLER` mirroring `ACTIVE_MATCHER`, and
`boxAverage` one identifier away for A/B.

Per cell, alongside the existing alpha-weighted linear colour mean, accumulate linear luminance
`Y = 0.2126r + 0.7152g + 0.0722b`:

- `Y_min`, **and the linear RGB of the pixel that set it** — the dark level and its colour
- `Y_max`, **and the linear RGB of the pixel that set it** — the light level and its colour
- `ΣwαY²` — the second moment, for the bimodality gate

Both endpoints carry colour because the output below reconstructs a mixture of the two. Deriving the
light colour algebraically from the mean and the dark — `light = (mean − f·dark) / (1 − f)` — blows
up as `f_dark → 1` and can leave the gamut; storing it is one more triple.

`Y_mean` comes free from the colour mean already being accumulated. Coverage of the dark population
follows from a two-point model:

```
f_dark ≈ (Y_max − Y_mean) / (Y_max − Y_min)
```

Clamp to [0, 1], and guard `Y_max − Y_min → 0` — a uniform cell has no two populations to weigh.

**Output is a contrast-stretched mixture, biased toward dark.** When the gates below pass, the cell
is rebuilt from its two endpoints with the coverage put through an S-curve first:

```
S(f) = σ(k · (logit(f) − logit(t)))
out  = S(f_dark) · darkLinear + (1 − S(f_dark)) · lightLinear
```

`t` is the coverage at which the curve crosses 0.5; `k` is how sharply it separates. At `k = 1` and
`t = 0.5`, `S` is the identity and this collapses to the plain two-point reconstruction. With
`t = 0.35, k = 4` the three observed cases land at:

| `f_dark` | `S(f_dark)` | reads as |
|---|---|---|
| 0.64 — line aligned with a cell | 0.99 | decisively dark |
| 0.40 — straddle, strong side | 0.70 | a clearly dark bead |
| 0.24 — straddle, weak side | 0.11 | near the fill |

**What matters is the separation between the two straddle cells, not the absolute darkness of
either.** The strong side becomes a distinctly dark bead; the weak side lands near enough the fill
that Phase A collapses it. A straddled line therefore resolves to a single bead width, with
reduction finishing the job rather than undoing it, and with no second pass over the cell grid.

**`t` must sit below 0.5, and a symmetric curve is actively wrong here.** A curve centred on 0.5
pushes every cell toward its own dominant end, which at `f_dark = 0.40` means *lighter* — it erases
the line harder than the plain mean does. The sub-0.5 midpoint is what creates the bias toward dark,
and it is where the dark-minority asymmetry now lives.

An earlier draft of this decision made the output a decisive pick of the dark level, on the grounds
that any blend would be a faint shade near the fill and be merged away. That held at `f_dark ≈ 1/8`;
at 0.40 a blend is a genuine mid tone that survives reduction comfortably. The conclusion survives —
the cell does end up much darker — but it rests on the separation argument above, not on Phase A.

**Fallback, if straddled lines still come out two beads wide** after `t` and `k` are tuned: one more
pass over the cell grid in which only the local maximum of `f_dark` among adjacent candidates takes
the dark end. Bounded (one pass over ≤50k cells), same interface, still pure. Recorded because it
has an observable that would make you reach for it, not as a design to weigh up front.

### The three decisions, settled

- **Dark minorities only, not any minority.** Symmetric preservation is more principled and would
  also rescue white highlights on dark fills, but it sharpens every edge in a photo — fur, foliage,
  JPEG fringing — which is where R4/R5 want honest optical averaging. Dark-only is targeted at the
  reported failure and matches the overwhelming artwork convention. Recorded as an asymmetry we
  chose, not one we failed to notice. It is expressed as `t < 0.5` — one number, rather than a
  dark-only branch.
- **One-pass min/max/mean, not two-pass below-the-mean.** Two-pass gives a dark *level* that no
  single pixel can set, but it buys less than it appears: it still needs the same bimodality gate
  and the same contrast threshold, so it removes no constants, and it roughly doubles the loop that
  already puts the hard limit at 288 ms. The one-pass estimator's noise failure also points the
  safe way — a spuriously dark pixel *grows* the denominator, shrinking `f_dark`, so noise makes it
  under-detect and fall back toward today's behaviour rather than inventing an outline. Blooming is
  the worse defect. The measured geometry makes this choice easier than it looked: at 0.64 coverage
  the dark run is several pixels wide in the intermediate buffer, so `Y_min` is set by a populated
  level rather than a lone outlier. `Y_max` is the fill, a large well-populated region, which is a
  second reason dark-on-light is the safer polarity — but both endpoints are now well fed.
- **Absorbed into M2, date moves.** M3 is an S and the schedule carries two buffer days.

### D18 revised — 2026-09-21, out of the R1–R6 review

The soft S-curve and the min/max endpoints both went. Two defects drove it, and they turned out to
be one mechanism.

**The specks.** Isolated beads coloured unlike anything in the source: a green **B25** on R3's face
among correct skin tones, a saturated **G20** inside R1's muted **G7** regions. The reconstruction
mixed the cell's *single darkest and single lightest pixel*, so at the ends of the curve a cell's
colour collapsed onto essentially one of them — the point sampling GEN-4 exists to remove,
reintroduced and aimed at the least representative pixel available. Two reasons a tail sample is the
worst possible choice: luminance selection is hue-biased (green carries 0.7152 of `Y`, so a
chroma-fringe pixel reliably won the light slot — that is B25), and extremes are more saturated than
the bulk they came from (that is G20, which is not an alien hue at all — same hue family as G7, same
lightness, chroma 0.145 against 0.097).

**B25 is the decisive evidence and worth keeping.** `#4E846D` has G > R and B > R; every tone on that
face runs R > G > B, and a convex combination cannot reverse channel ordering. So no mixture of skin
and shadow can reach it — one of the two endpoint pixels must itself have been green. Reproduced in
Node before any fix: a 16-pixel cell of 6 dark-feature + 9 skin + 1 green fringe emitted linear
`(0.095, 0.139, 0.063)`. Confirmed against the real images by the `boxAverage` A/B, the same shape as
the `MERGE_FLOOR` diagnostic: specks gone.

**The greys.** Cells holding part of a line came out as blends. D18's separation argument — the two
halves of a straddle land far enough apart that reduction collapses the weak one — did not survive
the review; it read as grey rather than as line-versus-fill. Note reduction could never have cleaned
either defect up: `reduceColors` sees only `Map<paletteIndex, count>` and never cell positions, so a
merge recolours 100% of a colour's cells or none — isolated specks are structurally impossible from
it. Worse, G20↔G7 is ΔE 0.058, ~2.9× `MERGE_FLOOR`, and D17's Phase B deliberately *protects* rare
perceptually-isolated colours. The fix had to be upstream, which is the general lesson.

**What replaced them.** Each cell splits at its own mean luminance into a dark population and a light
one; `f_dark` is the actual weight fraction, not an estimate off the extremes; and the cell is
**classified rather than blended** — at or above `darkCoverageMin` it takes the dark population's
colour, below it the light population's. The fill branch returning the light population rather than
the plain mean is the part that removes the grey: a fill cell clipped by part of a line comes back as
the fill colour with the line's pixels excluded. Measured: one pixel in sixteen now moves a cell by
**under 0.05 in OkLab, down from 0.187** — less than the distance between the wrong bead and the
right one.

**Traded away, deliberately.** The min/max estimator had a useful failure direction — a spuriously
dark pixel *grew* the denominator and made the model under-detect, so noise cost you an outline
rather than inventing one. A weight fraction has no such asymmetry; an outlier nudges it by 1/N
either way. It bought robustness against the wrong thing: blooming is held by `darkCoverageMin` and
the gates, and hue noise was the defect actually appearing in the images. The test that asserted the
old direction is deleted rather than inverted.

**Also settled here:** a line too thin to reach `darkCoverageMin` in any cell now vanishes outright
instead of surviving as a faint tint. Accepted — clean fills are worth more than faint lines, and the
lever if the review disagrees is to lower the threshold and add the local-maximum pass already
recorded below.

### Constants — three, and they are the tuning surface

- `bimodalGate` — below it the cell is a smooth gradient, the two-population model does not apply,
  keep the plain mean. Expressed as the cell's luminance variance over the variance a true two-point
  population with the same coverage and the same **extremes** would have: 1 for a clean line, 1/3 for
  a uniform gradient. Normalising by the gap between the two *population means* instead inverts the
  measure — a gradient then scores 1.33, above a true two-point — so that variant must not be used.
- `lineContrastMin` — `Y_mean − Y_dark`; below it there is no line, just noise. Identical to the old
  `Y_mean − Y_min` for a true two-point cell, so the value carried over untouched.
- `darkCoverageMin` — the coverage at or above which a cell is lineart. A cliff again, as in D18's
  first draft; the name went back with it. Sits below 0.5, and that asymmetry is the entire
  dark-minority bias. Raising it is the first move against blooming.

`CONTRAST_SHARPNESS` is gone — a hard step is the `k → ∞` limit of the curve it parameterized.

Same species as `MERGE_FLOOR`, `MIN_CODE_FONT_PX` and the guide pitch thresholds: judgment calls,
each one constant in one file, covered by tests that assert behaviour rather than the number.
Calibrate against R1–R6 **as a set** — R4 and R5 are the guard against over-aggression, because a
classifier decisive enough to rescue R3's outlines will start posterizing photo edges.

## Files

### New — all pure, all Node-tested (NFR-4); `src/lib/` except the matcher, which lives in
`src/pipeline/` so GEN-6's "no edit outside the pipeline module" reads literally

**`src/lib/oklab.ts`** — the conversion and the metric.

- `LINEAR_LUT`: `Float64Array(256)` built at module load. Source channels are bytes, so
  linearization is a table read rather than a `Math.pow` per channel per pixel.
- `linearToOklab(r, g, b)` — Ottosson's two 3×3 matrices with cube roots between them. Both rows of
  the first matrix sum to 1, as does the first row of the second, which is why a gray's `L` is
  `cbrt(linear)`. That identity is the test oracle.
- `linearToSrgbByte(c)` — the inverse curve. Only the RGB comparison matcher and the tests need it.
- `oklabDistanceSquared(...)` for the hot loop; `oklabDistance(...)` for the ΔE floor, which runs a
  few hundred times total and is much easier to reason about un-squared.

**`src/pipeline/color-match.ts`** — GEN-6's replaceable unit, shaped as a factory so precomputation
happens once at palette load rather than once per cell (221 conversions, not 11M):

```ts
export interface Matcher { readonly name: string; match(lr: number, lg: number, lb: number): number }
export type MatcherFactory = (palette: Palette) => Matcher;

export const oklabMatcher: MatcherFactory = ...   // closes over a flat Float64Array of 3 × 221 lab values
export const rgbMatcher: MatcherFactory = ...     // re-encodes to bytes, delegates to findClosestColor
export const ACTIVE_MATCHER: MatcherFactory = oklabMatcher;   // GEN-6: the one identifier
```

Keep `findClosestColor` and `colorDistanceSquared` in `src/lib/pattern-utils.ts`, and keep their
tests. They are not dead code once OkLab lands — they are the second algorithm GEN-6's Check
demands ("selected by changing one identifier") and the A/B baseline D5 wants during tuning.
`rgbMatcher` is a thin wrapper over them.

Store the palette's lab values as a flat `Float64Array` (3 per color), not an array of objects. At
the 50,000-cell hard limit this loop runs 11M distance evaluations; it is the one place in the app
where property lookups are worth avoiding.

**`src/pipeline/downscale.ts`** — GEN-4. Written in `src/lib/` at step 3; **moves to
`src/pipeline/` at step 5**, when it grows the strategy switch, for the same reason `color-match.ts`
lives there: a swappable algorithm belongs where GEN-6's "no edit outside the pipeline module"
reads literally.

- `areaAverage(source: SourcePixels, outWidth, outHeight): CellColors`
- Exact fractional-coverage box filter, so the non-integer ratios that are the normal case weight
  edge pixels by their actual overlap instead of binning them.
- **Alpha-weighted.** `getImageData` returns unassociated alpha and transparent pixels usually carry
  RGB 0, so an unweighted average drags edge cells dark — the halo Q8 describes. Accumulate
  `w·α·linear` and divide by `Σw·α`; the cell's own alpha is `Σw·α / Σw`.
- Cell emptiness reuses `isTransparentAlpha` on the mean alpha, keeping GEN-1's alpha-128 rule in
  one place rather than two.
- Returns linear values. Never re-encodes.
- **Step 5 adds `ACTIVE_DOWNSAMPLER`**, with `boxAverage` (the above, unchanged) and
  `contrastPreserving` (D18). The `CellColors` return shape is identical for both, so
  `generate.ts` does not branch and the switch is one identifier.

**`src/pipeline/reduce.ts`** — GEN-3, in two phases so each is independently testable.

- *Phase A (floor).* While some color's nearest-survivor ΔE < `MERGE_FLOOR`, merge the closest pair,
  smaller count into larger. This is the near-duplicate collapse.
- *Phase B (limit).* While distinct > limit, drop `argmin(count × ΔE to nearest survivor)`.
- Returns a survivor map over palette indices, **path-compressed**: if `a` merges into `b` and `b`
  later merges into `c`, `a` must resolve to `c` and not to a color that no longer exists.
- Every `argmin` tie-breaks on ascending palette index. GEN-7 is a requirement, not a happy
  accident — test it rather than assuming `Object.values` order holds.
- Naive full recompute per iteration is 221² × ≤219 ≈ 10M ops, single-digit milliseconds. Do not
  build a heap.

### Changed

**`src/rasterize.ts`** — becomes DOM decode only; all the math moves behind the pipeline boundary.

- `imageToPixels(image, maxPixels)` returns *intermediate-resolution* pixels, not grid-sized ones.
- Intermediate size is the source, capped so neither side exceeds `SUPERSAMPLE (8) ×` the grid side
  and the total stays under a pixel budget (~4M). IN-6 permits an 8000 px source, which is a 256 MB
  `ImageData`, and NFR-5 puts a phone browser in scope.
- Only that capping draw uses browser smoothing (`imageSmoothingQuality = 'high'`). When the source
  is already under the cap — the common case — it is a 1:1 draw and our own filter is exact over
  every source pixel. Worth a comment that the capped path leaves the innermost 8×8 to the browser's
  gamma-naive averaging; at that ratio the residual is negligible.
- Delete the `moz`/`webkit`/`ms` smoothing flags. The file's own comment already says M2 removes
  them.

**`src/pipeline/generate.ts`** — the sequence becomes: area-average → match each non-empty cell →
tally → reduce → remap cells → rebuild tallies.

- Signature grows the grid size and the limit:
  `generatePattern(source, palette, { gridWidth, gridHeight, colorLimit, mergeFloor })`.
- The `GeneratedPattern` return shape is unchanged, so `render/canvas-view.ts` and
  `render/inventory.ts` are untouched — M1's and M10's contracts hold.
- The module comment promises "callers should not need to change." That was written before the grid
  size had to move in here. Correct the comment rather than contorting the signature to preserve it.
- Preserve the row-major tally insertion order. `generate.test.ts` pins it deliberately, because it
  is what breaks ties in the inventory sort.

**`index.html` + `src/main.ts`** — the SET-4 control.

- A `.control-group` holding `<input type="number" id="colorLimit" value="30" min="2">`, inside
  `.controls`. That container is already styled, so this needs **no inline styles** — M10 left two
  inline-styled controls for M8 to clean up, and a third would be a third.
- `main.ts` sets `max` to `perlerColors.length` after the palette loads, reads the value in the
  generate handler, and passes it through.

## Order of work

Each step leaves the app working and ends somewhere you can look at R1–R6.

0. Branch `m2-quality-core`, this file committed, `CLAUDE.md` pointer moved. **(done)**
1. **`oklab.ts` + tests.** Pure, nothing wired, no visible change. **(done — 7 tests)**
2. **Matcher strategy wired into the pipeline.** First visible quality change — dark tones and skin
   tones. **(done — 6 tests; measured 38.6% of sampled colors resolving differently against the real
   palette, 47.9% in dark tones)**
3. **`downscale.ts` + the `rasterize.ts` change + tests.** **(done — 10 tests)**
4. **SET-4 control + `reduce.ts` + tests.** **(done — 9 tests; 72 green overall)**
5. **Lineart preservation (D18)** **(done 2026-09-21 — 86 green overall)**. `downscale.ts` moved
   into `src/pipeline/`; `ACTIVE_DOWNSAMPLER` selects `boxAverage` or `contrastPreserving`. Shipped
   as a two-population classifier after the review (see "D18 revised" above); the three constants
   ship at `bimodalGate 0.6`, `lineContrastMin 0.02`, `darkCoverageMin 0.35`. Tuning is injectable
   through `contrastPreservingWith` so tests pin behaviour rather than the numbers; the shipped
   defaults stay the single constant block. **Still to calibrate against R1–R6 in step 6** — these
   are defensible values from the measured geometry, not review-confirmed ones.
   One existing test changed: `generate.test.ts`'s GEN-4 linear-light Check used a 50/50
   checkerboard, which is exactly what D18 reclaims as lineart. Its fixture is an eight-level ramp
   averaging to the same half-light; `downscale.test.ts` still pins the checkerboard itself against
   `boxAverage`, so the 188-not-128 property is asserted in both places.
6. **R1–R6 review; tune `MERGE_FLOOR` and the SET-4 default** (~2–3 h). **Stop when it passes.**

## Tests to add

NFR-4 names OkLab matching and color reduction specifically; these are what let it be ticked.

**`oklab.test.ts`**

- White → `L≈1, a≈0, b≈0`; black → all zero; gray → `L ≈ cbrt(linear)`.
- **The GEN-2 disagreement fixture**, which is that Check written as code: source `rgb(20,20,20)`
  against a palette of `#000000` and `#2D2D2D`. RGB distance picks black (1200 vs 1875); OkLab
  lightness is 0.191 against 0 and 0.297, so it picks `#2D2D2D`. Assert *both*, so the test records
  why the change was made and fails loudly if matching ever silently reverts.

**`downscale.test.ts`**

- Half-black/half-white averages to linear 0.5, which re-encodes to **188, not 128**. This single
  test pins gamma correctness; the day it asserts 128, the linear-light property is gone.
- Fine alternating stripes produce uniform blended cells, not moiré (GEN-4's Check).
- A cell half transparent and half opaque red comes out red, not dark red (alpha weighting).
- Mean alpha below 128 yields an empty cell (GEN-1).
- A non-integer output ratio distributes edge-pixel weight fractionally.

**`reduce.test.ts`**

- Distinct count ≤ limit, and no cell left unassigned (GEN-3's Check).
- Merge chains path-compress: `a→b→c` resolves `a→c`.
- The same input twice is deep-equal (GEN-7); ties break by ascending palette index.
- `MERGE_FLOOR = 0` leaves an already-under-limit pattern identical.
- Two near-identical whites collapse under a floor (R2).
- **A rare, perceptually isolated color survives where frequency ranking would have dropped it** —
  D17's justification kept as an executable assertion rather than a paragraph.

**`generate.test.ts`** — update the three existing tests for the new signature; add an end-to-end
determinism test.

**`downscale.test.ts`, step 5 additions** — every one of these runs against both strategies, with
`boxAverage` asserted *unchanged* so the photo path cannot regress silently.

- A cell of ~0.64 dark line against light fill comes out clearly dark, not a mid tone. The defect
  as measured, as a test.
- **The straddle pair**: one line split 0.40 / 0.24 across two cells yields one clearly dark cell and
  one near the fill. Assert the *separation* between them, not two absolute values — that separation
  is the whole reason the remap exists, and it is what keeps a straddled line one bead wide.
- `S` is non-decreasing in `f_dark`.
- `k = 1, t = 0.5` reproduces the plain mean **within tolerance**. Note in the test that this is an
  analytic sanity check, not a bit-identical path — the guaranteed-unchanged route is
  `ACTIVE_DOWNSAMPLER = boxAverage`, since two-point reconstruction only approximates the mean.
- A uniform fill cell is untouched — no false positive, which is the assertion that stops blooming.
- A smooth gradient cell keeps its plain mean (`BIMODAL_GATE`). Half its pixels are below the mean,
  so without the gate a gradient reads exactly like a thick line.
- A cell well below the midpoint's tail stays within a small delta of the plain mean — the low-`f`
  end of the curve, which is what replaces the old stray-pixel threshold test.
- **Noise on `Y_min` shrinks `f_dark`** — assert the direction, not a number. This is the property
  the one-pass estimator was chosen for, and it is what guarantees the failure mode is a missing
  outline rather than a hallucinated one.
- A diagonal line across several cells produces a *continuous* run of dark cells with no gaps —
  R3's "not dashes", which per-cell tests cannot catch.

## Verification

1. `npm run check` — typecheck plus the suite. Expect ~60 tests, up from 40.
2. `npm run dev`, then walk `test_img/R1 … R6` at the 100 × 100 design target against the passing
   results in `specs.md`'s "Done looks like" table. Plus, for all six: distinct count within the
   SET-4 limit, no flat region split into three or more colors that read as noise, no moiré.
3. **GEN-7 by hand:** generate twice without touching settings; stats line and every inventory count
   identical.
4. **SET-4 by hand:** set the limit to 12; the inventory lists at most 12 colors.
5. **GEN-6 by hand:** flip `ACTIVE_MATCHER` to `rgbMatcher`, regenerate, confirm the old behavior
   returns with no edit outside `src/pipeline/color-match.ts`. Flip back.
6. **NFR-2 — measured at step 4, and it is over.** Node timings, excluding decode and canvas:
   **57 ms** at the 100 × 100 design target (comfortable) and **288 ms** at the 224 × 224 hard
   limit, against NFR-2's ~150 ms. Recorded rather than acted on: a worker is not M2's scope and D8
   says revisit only on evidence. This is the evidence, for M9 to weigh. Re-time after step 5, which
   adds work to the same loop.

   **Re-timed after step 5** (same harness, 221-colour palette, limit 30). Against the step-4
   baseline the downscale goes 25.3 → **30.9 ms** at the design target and 124.4 → **148.8 ms** at
   the hard limit; the full `generatePattern` is **62 ms** / **307 ms**. D18 costs about 20% of the
   downscale, ~5 ms / ~15 ms of the whole. Most of that is the classifier's second pass over each
   cell, which is cheap because pass 1 caches the linearized pixels in a reused scratch buffer —
   pass 2 reads no LUT. Well under the "roughly doubles" this was expected to cost. The step-4
   conclusion is unchanged, and so is the verdict: recorded for M9, not acted on here.

   The cost is dominated by the **downscale**, not the matching — 3.2M source pixels linearized and
   accumulated against 50k matches. So the cheap lever is `SUPERSAMPLE` in `rasterize.ts`: 8 → 4
   quarters the buffer and should clear the threshold, at some loss of averaging fidelity. One
   constant, and a better first move than a worker. Hold it until the R1–R6 review says whether that
   fidelity is doing visible work.

## Watch for

- **A tuning task with no error message.** R1–R6 is the stopping condition, and it is the reason the
  images were committed before any tuning started.
- **`MERGE_FLOOR` is a judgment call, not a measurement** — the same species as `MIN_CODE_FONT_PX`
  (M1) and the two guide pitch thresholds (M10). One constant, in one file, covered by tests that
  assert the behavior rather than the number.
- **R6 may regress slightly.** Area-averaging pixel art at a non-integer ratio blurs edges that
  point-sampling kept crisp. That is what SET-9's passthrough is for, and SET-9 is [v2]. R6 only
  demands "no worse than the source" — if it fails that, note it and move on. Do not build
  passthrough inside M2.
- **Q2 (the default color limit) will probably get an answer here.** Flat art may want 8 where a
  photo wants all 30. Record what the review shows in `specs.md`; do not build an adaptive default.
- **Do not reach for k-means.** Clustering in OkLab would beat greedy merge on photos, but it needs
  care with seeding to hold GEN-7, and it is a second open-ended tuning surface inside an already
  timeboxed milestone. GEN-6 is precisely what makes trying it cheap later.
- **Blooming is the worse defect, and step 5 is how you would cause it.** Outlines two or three
  beads wide eat the artwork's interior and close up small features; a washed-out outline at least
  leaves the fill clean. If R1 or R3 starts thickening, raise `darkCoverageMin` before touching
  anything else. The case to eyeball is the straddle pair — a line landing 0.40 / 0.24 across two
  cells is exactly where one bead becomes two. **Now a sharper risk than it was under the S-curve:**
  the classifier commits a whole cell, so a cell that tips over the threshold thickens by a full bead
  rather than a shade.
- **~~Under one-pass, the dark colour is a single pixel's hue~~ — this fired, on 2026-09-21.** It was
  logged as "less of a risk than it looked once the geometry was measured," and that judgment was
  wrong: the reasoning only covered `Y_min` being drawn from a populated dark run, and said nothing
  about `Y_max`, which is where the chroma fringing actually lived. The recorded remedy — swap in the
  two-pass population mean, same interface, same gate — was the right one and was contained exactly
  as predicted. See "D18 revised" above. **Worth keeping as a lesson about the shape of the miss, not
  just the miss:** a risk written about one endpoint silently exempted the other.
- **Photo posterization is the new over-aggression mode, and R4/R5 are where it shows.** The
  classifier commits every gated cell to one population, so a strong edge in a photograph snaps
  instead of blending — the same decisiveness that rescues R3's outlines. The two gates are the only
  guard. If R4 or R5 hardens, raise `bimodalGate` before touching `darkCoverageMin`: the complaint is
  that the model is speaking about cells it should stay quiet on, not that the threshold is wrong.

- **The editor is not the escape valve for lineart.** The plan calls M5 M2's safety net, and for
  stray cells it is. Redrawing every outline in a drawing by hand is the user doing the algorithm's
  job. Do not let M5 be the reason step 5 gets cut.

## Doc updates at close

- `specs.md`: **add D18** (the lineart decision, including the finding that correct linear averaging
  costs line fidelity, the measured ~0.64-cell geometry, and the diagnostic that ruled out Phase A —
  those are the parts worth surviving); tick GEN-2, GEN-3, GEN-4, GEN-6, GEN-7,
  SET-4; append the shipped note to D17 the way D16 carries M10's; update NFR-4's parenthetical test
  inventory; answer Q2 if the review settled it. Record the NFR-2 measurements against NFR-2 itself
  — M9 needs them to decide whether D8 still holds.
- `plan-v1.md`: mark M2 done with a **Delivered** block in the shape M1 and M10 use.
- `CLAUDE.md`: project summary, the `src/lib/` file list, and the active-tactical-plan pointer.
- Delete this file, per the one-plan-at-a-time rule.
