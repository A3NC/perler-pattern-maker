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

**The defect.** Thin lineart beside a solid fill disappears. A 1–2 px outline occupies a small
fraction of a bead cell, the cell average is dominated by the fill, the matcher correctly matches
that average, and the line is gone. Reported worst on light fills, where losing a high-contrast
outline is most visible. Note that all three stages behave correctly — this is not a bug in any one
of them, which is why it needs a deliberate answer rather than a fix.

**Correct averaging costs line fidelity, and that is the finding worth keeping.** A dark line
covering an eighth of a cell against a fill of byte 220 averages to **193** in gamma-encoded sRGB
and to **207** in linear light. Linear-light averaging lightens any mixture containing a dark
minority, so the pre-M2 build's gamma-naive averaging preserved thin dark lines about twice as well
as the correct version does. That is not an argument for reverting — gamma-space averaging is wrong
for the gradients and shading that are most of R3 and all of R4/R5 — but it explains why this
surfaced at step 3 rather than step 2, and it is exactly the sort of thing that gets rediscovered
painfully later.

**Diagnose before building — two minutes, and it changes what gets built.** Set the color limit to
the palette size *and* `mergeFloor` to 0, then regenerate:

- *Line returns* → Phase A is merging the faint line color into the fill. The fix is cheap: lower
  `MERGE_FLOOR`, or exempt a merge that would eliminate a color outright rather than thin it.
- *Line still gone* → it died at averaging, and needs the downsampler below.

Expect mostly the second, with Phase A complicit at the lightest fills. Do not skip this: the two
causes have very different costs and only one of them needs new code.

### The strategy

A box average is right for photos — it is what an optical reduction does. For lineart it is the
wrong question: not "what is the average light in this cell" but "what is the dominant visual
content of this cell." That is why pixel-art downscalers do not use box filters. So the downsampler
becomes a strategy the way the matcher is, with `ACTIVE_DOWNSAMPLER` mirroring `ACTIVE_MATCHER`, and
`boxAverage` one identifier away for A/B.

Per cell, alongside the existing alpha-weighted linear colour mean, accumulate linear luminance
`Y = 0.2126r + 0.7152g + 0.0722b`:

- `Y_min`, **and the linear RGB of the pixel that set it** — the dark level and its colour
- `Y_max`
- `ΣwαY²` — the second moment, for the bimodality gate

`Y_mean` comes free from the colour mean already being accumulated. Coverage of the dark population
follows from a two-point model:

```
f_dark ≈ (Y_max − Y_mean) / (Y_max − Y_min)
```

**Output is decisive, not blended.** When the gates below pass, the cell takes the dark level
outright instead of a mix. This is not a stylistic preference: a blend produces a faint intermediate
shade sitting near the fill, and a faint intermediate shade near the fill is precisely what Phase A
merges away — the work would be undone one stage later. A decisive pick lands far enough from the
fill to survive reduction, and it produces the crisp single-bead runs the artwork wanted.

### The three decisions, settled

- **Dark minorities only, not any minority.** Symmetric preservation is more principled and would
  also rescue white highlights on dark fills, but it sharpens every edge in a photo — fur, foliage,
  JPEG fringing — which is where R4/R5 want honest optical averaging. Dark-only is targeted at the
  reported failure and matches the overwhelming artwork convention. Recorded as an asymmetry we
  chose, not one we failed to notice.
- **One-pass min/max/mean, not two-pass below-the-mean.** Two-pass gives a dark *level* that no
  single pixel can set, but it buys less than it appears: it still needs the same bimodality gate
  and the same contrast threshold, so it removes no constants, and it roughly doubles the loop that
  already puts the hard limit at 288 ms. The one-pass estimator's noise failure also points the
  safe way — a spuriously dark pixel *grows* the denominator, shrinking `f_dark`, so noise makes it
  under-detect and fall back toward today's behaviour rather than inventing an outline. Blooming is
  the worse defect. The vulnerable endpoint here is `Y_min`; `Y_max` is the fill, a large
  well-populated region, which is a second reason dark-on-light is the safer polarity.
- **Absorbed into M2, date moves.** M3 is an S and the schedule carries two buffer days.

### Constants — three, and they are the tuning surface

`BIMODAL_GATE` (below it, the cell is a smooth gradient, the two-point model does not apply, keep
the plain mean), `DARK_COVERAGE_MIN` (below it, the line only grazes the cell — leave it as fill, or
outlines bloom), and `LINE_CONTRAST_MIN` (`Y_mean − Y_min`; below it there is no line, just noise).

Same species as `MERGE_FLOOR`, `MIN_CODE_FONT_PX` and the guide pitch thresholds: judgment calls,
each one constant in one file, covered by tests that assert behaviour rather than the number.
Calibrate against R1–R6 **as a set** — R4 and R5 are the guard against over-aggression, because a
bias strong enough to rescue R3's outlines will start sharpening photo texture.

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
5. **Lineart preservation (D18)** (~3–4 h). Run the two-minute diagnostic first. If Phase A is the
   cause, adjust `MERGE_FLOOR` and stop. Otherwise: move `downscale.ts` into `src/pipeline/`, add
   `ACTIVE_DOWNSAMPLER` with `boxAverage` and `contrastPreserving`, calibrate the three constants.
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

- A cell of seven-eighths light fill and one-eighth dark line comes out dark, not fill. The defect,
  as a test.
- A uniform fill cell is untouched — no false positive, which is the assertion that stops blooming.
- A smooth gradient cell keeps its plain mean (`BIMODAL_GATE`). Half its pixels are below the mean,
  so without the gate a gradient reads exactly like a thick line.
- A single stray dark pixel in 64 does not trigger (`DARK_COVERAGE_MIN`).
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
  beads wide eat the artwork's interior and close up small features; a missing outline at least
  leaves the fill clean. If R1 or R3 starts thickening, raise `DARK_COVERAGE_MIN` before touching
  anything else.
- **Under one-pass, the dark colour is a single pixel's hue.** The estimator is robust about *how
  much* is dark and fragile about *what colour* it is. If outlines come out hue-noisy — a black line
  speckling into three near-blacks — that is the specific signal to swap in the two-pass
  below-the-mean version, which replaces the level with a population mean. That swap is contained:
  same interface, same three constants, same gate.
- **The editor is not the escape valve for lineart.** The plan calls M5 M2's safety net, and for
  stray cells it is. Redrawing every outline in a drawing by hand is the user doing the algorithm's
  job. Do not let M5 be the reason step 5 gets cut.

## Doc updates at close

- `specs.md`: **add D18** (the lineart decision, including the finding that correct linear averaging
  costs line fidelity — that is the part worth surviving); tick GEN-2, GEN-3, GEN-4, GEN-6, GEN-7,
  SET-4; append the shipped note to D17 the way D16 carries M10's; update NFR-4's parenthetical test
  inventory; answer Q2 if the review settled it. Record the NFR-2 measurements against NFR-2 itself
  — M9 needs them to decide whether D8 still holds.
- `plan-v1.md`: mark M2 done with a **Delivered** block in the shape M1 and M10 use.
- `CLAUDE.md`: project summary, the `src/lib/` file list, and the active-tactical-plan pointer.
- Delete this file, per the one-plan-at-a-time rule.
