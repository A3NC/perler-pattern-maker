# M4 — Crop

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M4 closes,
delete it and point `claude.md` at the next one._

**Milestone goal (`plan-v1.md` M4):** preview the uploaded image with a draggable, resizable crop
rectangle, feed the cropped region to the pipeline, and show the resulting grid dimensions live as
the crop changes.

**Closes:** IN-5, SET-3, **and IN-1** — see below. **Origin:** D13 (crop is the v1 substitute for
background removal) and the "Constraints and hunches" entry naming crop as the user's most
effective quality lever. **D21** was written during this plan and governs step 6.

---

## What changed since `plan-v1.md` was written

M4's paragraph was written on 2026-09-07. M3 and M5 have both closed since, and three things they
left behind change this milestone's shape.

- **IN-1 is M4's to tick, not M3's.** M3 verified all five formats upload and generate, but IN-1's
  Check also asks for a preview, and the preview is IN-5. M3 deliberately built no placeholder.
  So M4 closes three requirements.
- **The decoded image element is the preview.** `readImageFile` revokes its object URL in a
  `finally` as soon as `decode()` resolves. The returned `HTMLImageElement` keeps its bitmap and is
  safe to put in the page — but a *second* `<img>` pointed at that same URL will fail to load.
  Reuse the element; do not re-create one from `file`.
- **`pattern-state.ts` is not involved.** It owns the live pattern and its tallies, which exist only
  after Generate. A crop rectangle is an *input*, it is settings-shaped, and it belongs beside
  target width and bead size. Don't wire it through the pattern owner.

Also on this branch already, from the phone pass: the view toggles are sized to a 44 px row and
`button` carries `touch-action: manipulation`. That is recorded in `plan-v1.md` under M8. Don't
redo it, and don't extend it — the rest of the 390 px work found there is M8's.

**On the reduced scope in `schedule.md`** ("drag-a-box, mouse only, no handles, no touch"): that
file is explicitly not authoritative, and `plan-v1.md`'s Done-when requires both handles and touch.
Treat the cut as the *staging order* instead — step 4 builds the new-box drag first and the handles
second, so if the milestone runs long there is a working crop at every point. This is the M1 risk
row's discipline (zoom before pan before code LOD) applied again.

---

## Ground rules

- **One representation: integer source pixels.** The crop rect is `{x, y, width, height}` in the
  decoded image's own pixel space. That is what `drawImage` consumes and what
  `calculateDimensions` needs, so the only place a conversion happens is at the gesture boundary,
  where the view divides by the display scale. Storing normalized fractions instead would mean
  rounding twice — once for the preview and again for the draw — and the two roundings are exactly
  what "the generated pattern matches the cropped region" is checking.
- **The pipeline boundary does not move.** The crop is applied during rasterization, as a source
  rectangle handed to `drawImage`. It is not a pipeline stage, `generate.ts` never learns it exists,
  and `SourcePixels` and `Pattern` are unchanged. M6 and M7 inherit nothing from this milestone.
- **Deterministic geometry is pure and tested** (NFR-4): clamping, moving, resizing, and hit-testing
  go in `src/lib/crop.ts`, DOM-free, tested in Node. Only pointer wiring and element positioning
  live in `src/render/`.
- **The preview is DOM, not a second canvas, and that is not a contradiction of D1.** D1 refused one
  element per bead — up to 50,000 of them, zoomed by CSS transform. A crop overlay is one rectangle
  and four handles. Real elements get their sizing, hit area, and hover states from CSS rather than
  from a redraw loop, and the dimming mask outside the rect is one `box-shadow` property. There is
  no per-frame drawing here at all.
- **CSS: real classes, raw literals fine.** Match the file's 8-space indent. UI-3 tokenizes the
  whole stylesheet in one pass in M8; hand-tokenizing the preview block early just makes it
  inconsistent in a second way. Same rule M5 followed for the editor bar.

---

## Steps

### 1. The live dimensions readout (SET-3) — before any crop UI

**Build this first, because it is the instrument for everything after it.** Once the readout is
live, "does the crop reach the pipeline" is answerable by dragging a handle and watching a number,
rather than by generating a pattern and squinting at it.

A `refreshDimensions()` that reads target width, bead size, and the current crop source — which is
the whole image until step 3 gives it a rectangle — calls `calculateDimensions`, and writes
`W × H beads · N beads total` into a readout in the control panel. Wire it to `input` on
`#targetWidth` and `change` on `#beadSize`, and call it once after a successful upload.

- **Its own element, not `#stats`.** `#stats` is a `pattern-state` subscriber describing the pattern
  that *exists*; this line describes the one that *would be generated*. Two different tenses in one
  element is how they end up contradicting each other. A `.span-full` block inside `.controls`.
- **`calculateDimensions` throws on over-limit, and that is the feature.** Catch it and put the
  message in the readout. SET-5's Check wants the limit named *before* Generate is pressed, and
  until now the only way to see it was to press Generate.
- **Leave Generate's enablement alone.** It still reports through `showStatus` on click. Adding a
  second gate would mean two places deciding what a valid setting is, and M3's status flow is
  freshly verified.
- Nothing renders until an image is loaded — before that there is no aspect ratio to apply.

**Done when:** typing a width or switching bead size updates the readout immediately, an over-limit
setting shows the SET-5 message there, and no crop exists yet. `npm run check` green.

### 2. `src/lib/crop.ts` — the geometry, pure and tested

```
interface CropRect { x: number; y: number; width: number; height: number }
```

- `fullImageCrop(imageWidth, imageHeight)` — the default, and what every new upload resets to.
- `clampCrop(rect, imageWidth, imageHeight)` — inside the image, never below `MIN_CROP_PX`.
- `moveCrop(rect, dx, dy, imageWidth, imageHeight)` — **translate only.** Dragging the body into an
  edge must slide the rect and stop, never shrink it. Getting this wrong is invisible until someone
  drags to a corner and the crop quietly changes size.
- `resizeCrop(rect, handle, point, imageWidth, imageHeight)` — corner handles `nw|ne|sw|se`.
  **Clamp at the minimum size; do not flip through the opposite edge.** Flipping doubles the test
  matrix and is disorienting under a finger, where the pointer is hidden by the hand.
- `hitTestCrop(rect, point, slop)` → `'nw'|'ne'|'sw'|'se'|'body'|null`. Handles win over the body,
  and on a rect small enough that two handles' slop overlaps, resolve in a fixed order so the
  behavior is deterministic rather than whichever test ran first.
- **`slop` is passed in, in source pixels, and this inversion is the point.** "44 px" (UI-6) is a
  *screen* quantity; the geometry is in source space. The view converts once — `slop =
  44 / displayScale` — so a 4000 px photo previewed at 400 px gets a 440-source-pixel grab radius
  and the finger target is the same physical size either way. Bake a screen constant into this
  module and it is wrong at every zoom level but one.
- `MIN_CROP_PX` is a judgment constant like `MERGE_FLOOR` and `DEFAULT_CELL_BUDGET`: tests assert
  that a crop cannot go below it, never the number itself.

**Tests:** clamping at all four edges; the minimum floor; a body drag into a corner preserving
width and height exactly; a resize from each of the four corners; hit-test priority including the
overlapping-slop case.

**Done when:** `npm run check` green with the new tests. No DOM yet.

### 3. Preview and crop overlay (IN-5)

A `.preview-area` block, hidden until an upload succeeds, holding the decoded image element from
step "What changed" above, plus an overlay positioned over it.

- **Sizing and the display scale.** The image gets `max-width: 100%`, a height cap, and
  `display: block`; the overlay is positioned against its *rendered* box, so
  `displayScale = img.clientWidth / img.naturalWidth`. Recompute it on `resize` and after the
  element lands in the page — the 640 px media query changes the rendered width, and every screen
  coordinate in step 4 is divided by this number.
- **The mask is one property:** `box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45)` on the rect dims
  everything outside it. No second element, no canvas.
- **Four corner handles, and they must overhang.** `transform: translate(-50%, -50%)` at each
  corner with `overflow: visible` on the rect, or a crop dragged small hides its own handles inside
  itself.
- **Handles are not focusable.** There is no keyboard crop in v1 (see Deferred), and shipping
  focusable controls that do nothing would hand M8 a UI-4 problem that looks like a bug. Plain
  `<div aria-hidden="true">`, with the crop's effect communicated by step 1's readout.
- **Reset on every successful upload**, and hide the area on a rejection. M3 made re-picking a
  rejected file speak twice; a stale crop rectangle surviving into a new image would undo that
  work.
- **One visibility rule, and step 6 owns the other half of it:** the panel appears on a successful
  upload and disappears on a successful generate. Build the appearing half here and leave the
  disappearing half to step 6, where the rest of the lifecycle lives.

**Done when:** an uploaded image is visible at a sensible size at 1280 px and 390 px, with a
full-image crop rectangle drawn over it. IN-5's Check passes. Nothing drags yet.

### 4. Pointer wiring — mouse and touch

`src/render/crop-view.ts`, following `editor.ts`'s idiom: pointer events with `setPointerCapture`,
one gesture at a time, no logic of its own beyond deciding which pure function a gesture means.

- `pointerdown` → convert to source pixels → `hitTestCrop` → gesture mode. `pointermove` feeds
  `moveCrop` or `resizeCrop`. `pointerup` releases capture.
- **`touch-action: none` on the overlay and the handles.** This is M5's trap verbatim: without it a
  touch-drag scrolls the page instead of dragging the crop, and it fails only on a phone, which is
  where half of the Done-when lives.
- **A drag starting on the dimmed area outside the rect draws a new rectangle.** Cheapest gesture in
  the milestone, the most direct expression of "crop to this," and the fallback shape if the
  milestone runs long — build it before the handles.
- **After every change to the rect: reposition the overlay and call `refreshDimensions()`.** That is
  the Done-when's "dimensions update as the crop is adjusted", and it is one line because step 1
  already exists.

**Done when:** the rect can be moved, resized from all four corners, and redrawn from scratch, with
a mouse and with a finger, and the readout tracks it.

### 5. Feed the crop to the pipeline

Two call sites and no new concepts.

- `imageToPixels(image, gridWidth, gridHeight, crop)`. Every `image.width` / `image.height` in the
  scale computation becomes `crop.width` / `crop.height` — including the
  `Math.min(image.width, ...)` clamp, which exists to stop the box filter upscaling and would be
  measuring the wrong thing otherwise — and the draw becomes the nine-argument
  `drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)`.
- `main.ts` passes `crop.width, crop.height` to `calculateDimensions` instead of the image's.

**Two things to record rather than discover:**

- **SET-1's wording goes stale.** It says height follows from "the source image's aspect ratio";
  after M4 it follows from the *cropped region's*. One line of spec text, not a new requirement.
- **A crop smaller than the bead grid makes the box filter upscale**, which is the blurriness D4
  actually warned about. `MIN_CROP_PX` keeps the rect from being degenerate; a crop that is legal
  but smaller than the grid is a quality note, not an error.

**Done when:** cropping to a distinctive corner and generating produces a pattern of that corner,
at the dimensions the readout predicted.

### 6. The first Generate fixes the inputs (D21)

**Read D21 in `specs.md` before building this.** The short version: on a successful generate the
preview panel is hidden outright — no summary row — and the four settings inputs are disabled with
it. Getting a different pattern is an explicit act, not a stray click.

- **Hide the panel completely.** A summary strip earns nothing: the stats line already reports the
  pattern's size, and anything sitting between the controls and the canvas competes with the
  pattern for U3's "the pattern is the visual focus."
- **Disable the whole input set, not just the crop.** Target width, bead size and max colors each
  re-run the pipeline exactly as a crop change would, so freezing only the crop leaves the hazard
  open through the inputs still on screen and reads as arbitrary — *why can I change the width but
  not the framing?* This is the part of D21 worth not trimming.
- **The hazard being closed is real and predates M4.** A second Generate calls `setPattern`, which
  replaces the `Pattern` M5 has been mutating. Every manual edit is gone, with no warning and no
  undo — history is not persisted (D19).
- **"Start over" is the way back**, in the space the preview vacated. It re-enables the inputs and
  restores the preview **with the same image and the same crop rectangle still in place**, so it is
  a revision rather than a reset. The decoded `HTMLImageElement` is still held, so this is a class
  toggle and an `input.disabled` loop — no re-upload, no second decode, no new state machine.
- **No confirmation dialog in v1.** That is PAL-7's shape and PAL-7 is **[v2]**; a button that says
  what it discards is enough at this scale. The gap is recorded in D21 and beside PAL-7, for M9.
- Uploading a new file keeps doing what it does today: full reset, crop back to the whole image.

**This adds no requirement ID.** It is a lifecycle decision recorded as D21 and reported in the
Delivered block — the same treatment M5 gave the eyedropper. Neither Check M4 closes is threatened:
IN-5's is about the state after upload, and SET-3's says *before Generate is pressed*.

**Done when:** generating hides the preview and disables the settings; Start over brings both back
with the crop unchanged; a new upload resets everything.

### 7. Verify in a real browser, including one rotated phone photo

Every Check here is an interaction, so it gets M3's treatment rather than a test run.

- Mouse at 1280 px and touch at 390 px: move, resize from each corner, draw a new box, generate,
  confirm the region matches.
- The D21 loop: generate, confirm the preview is gone and the inputs are dead, Start over, confirm
  the crop rectangle is exactly where it was left, adjust it, generate again.
- **A photo with EXIF orientation is the named trap.** Browsers apply EXIF by default, so
  `naturalWidth`/`naturalHeight`, the `<img>` rendering, and `drawImage` should all agree in
  *oriented* space — and if they agree, the crop is correct for free. But if any one of them
  disagrees, the crop silently lands on the wrong region: no error, no exception, just the wrong
  part of the picture. Verify it with a real rotated iPhone JPEG rather than assuming.
- The S1 case end to end: crop tight to a subject on a white canvas, generate, and confirm the
  white margin is visibly small and the remainder is erasable with M5's tools. That is the D13
  story this milestone exists to make true.

---

## Milestone exit

Tick **IN-5, SET-3 and IN-1** in `specs.md`, and fix SET-1's aspect-ratio wording. Then look at
**SET-1, SET-2 and SET-5**: each is "partially implemented" only because its Check wants a
dimension displayed *before* generating, which is exactly what step 1 builds. Tick them if they
pass — but build nothing extra for them; if one does not pass, leave it and say why, the way M2 left
GEN-8. Write the Delivered block — including **D21's lifecycle, which ticks no box and is therefore
the easiest thing here to ship unrecorded** — mark M4 done in `plan-v1.md`, delete this file, and
point `claude.md` at M6.

## Deferred out of M4 — do not build here

| Thing | Where it belongs |
|---|---|
| Aspect-ratio lock, preset ratios | Not specified; nothing in v1 needs one |
| Rotation / straighten | No requirement in v1 |
| Zoom or pan inside the preview | The preview is a fit-to-width view; VIEW-2's zoom is the pattern's |
| Keyboard-driven crop | v2 with UI-7. Handles stay non-focusable so M8 inherits no no-op controls |
| Crop rectangle in autosave | SAVE-1 is pattern + settings + edits; M7 decides whether the rect is a setting |
| Background removal, subject auto-trim | SET-7 / SET-8, v2 (D13) — crop is the v1 substitute, not a down payment |
| Re-cropping without discarding the pattern | Refused by D21. Start over discards and re-crops; there is no incremental path and none is wanted |
| A confirmation dialog before Start over discards edits | PAL-7's shape, and PAL-7 is [v2]. Gap recorded in D21 for M9 |
| Tokenizing the preview's spacing literals | M8 / UI-3 |
| The zoom-row overflow and `#sortOption` truncation | M8, already recorded in `plan-v1.md` |
