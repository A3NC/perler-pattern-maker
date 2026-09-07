# Perler Pattern Generator — Specification

_Last updated: 2026-09-07 · Status: v1 in progress_

## Purpose

A browser-based web app that turns an uploaded image into a Perler bead pattern: a grid of
bead-sized cells, each assigned a real Perler bead color, with the color code shown on each cell
and a bead-count list for shopping and sorting.

## Who and why

**Who:** People who make Perler bead art and want to work from their own images rather than
pre-existing patterns. Skews young and craft-oriented.

Most users are expected to upload **non-pixel artwork** — drawings, digital illustrations, logos,
character art — typically a single subject on a blank or solid-color canvas. A large minority
upload **photos**. Both matter; artwork is the majority case and drives the defaults.

**Why:** Perler beads can only reproduce pixel art, not continuous-tone images. Converting an
arbitrary image into a bead-accurate grid lets people make art of whatever they want, and tells
them which specific bead colors to buy and where to place them.

## Core scenarios

**S1 — Artwork to pattern (primary, majority case).** Someone has a drawing or digital
illustration — a character, an animal, an object — sitting on a blank white canvas. They upload it,
set a finished width, and get a pattern of the *subject*, with the blank canvas excluded rather
than reproduced as hundreds of white beads. Flat color regions in the artwork stay flat in the
pattern.

Excluding the background is the point of SET-7, which is **[v2]**. In v1 the user achieves the same
result by cropping tight (IN-5) and erasing leftover background cells (EDIT-2), and gets it for
free if their file already has a transparent background (GEN-1). See Decision log D13.

**S2 — Photo to pattern (significant minority).** An amateur maker wants bead art of their dog.
They upload a photo, crop to the dog's face, set a finished width, and get a pattern that is
recognizably their dog, buildable with a realistic number of colors. Harder than S1: photos have
no flat regions and no clean background.

**S3 — Fixing the conversion (secondary, but required).** The generated pattern gets some cells
wrong — a stray background color in the dog's ear, a muddy patch where the eyes should be, white
canvas beads the crop didn't catch. The user paints over individual cells with palette colors to
correct them, without regenerating.

**S4 — Drawing from scratch (deferred).** A pixel artist wants to draw directly in a canvas where
their color choices snap to their bead palette. Deferred: this is a paint program that shares only
the palette code with S1–S3. See Decision log D6.

## Scope

### Non-goals

- Web app only. Not a native mobile app. (Must still work in a phone browser.)
- No user accounts, login, or homepage.
- No social features: no DMs, no public posting or browsing of patterns.
- No text-to-image generation. All output derives from the user's uploaded image.
- No user-defined or hand-built palettes. Palettes are fixed, official Perler color sets. See PAL-1.
- No server-side processing. All image data stays in the browser.

### Deferred (not "won't" — just not in v1)

**Planned for v2:** the advanced settings panel and everything in it — background removal (SET-7),
subject auto-trim (SET-8), pixel-art passthrough (SET-9) — plus palette switching, undo/redo, flood
fill, gridlines, and a legend in the export.

**Later, undated:** drawing from scratch (S4), user-facing algorithm selection, a multi-project
library, printable multi-page PDF export.

## Requirements

**How to read this.** Each requirement has an ID, a version marker, a statement, and a **Check:**
line describing how to verify it. A requirement is done when its Check passes. Checkboxes track
implementation status.

Markers: **[v1]** = required for first release · **[v2]** = next release · **[later]** = deferred.

### Input — IN

- [ ] **IN-1 [v1]** Accept a single image file via file picker, in PNG, JPEG, GIF, WebP, or BMP.
  **Check:** One valid file of each listed format uploads and produces a preview.
- [ ] **IN-2 [v1]** Reject non-image files with a specific, readable error naming the problem.
  **Check:** Uploading a `.txt`, a `.pdf`, and a zero-byte file each shows a distinct message that
  says what was wrong (not "an error occurred"), and the app stays usable afterward.
- [ ] **IN-3 [v1]** Reject corrupted or truncated image files with a readable error.
  **Check:** Upload a JPEG truncated to 50% of its bytes and a file renamed from `.txt` to `.png`.
  Both produce an error mentioning that the file could not be read as an image. No blank screen,
  no console-only failure.
- [ ] **IN-4 [v1]** Detect files the browser cannot decode (notably iPhone HEIC/HEIF) and say so
  explicitly, naming the format and suggesting JPEG or PNG.
  **Check:** Upload a `.heic` in a browser without HEIC support. Error names HEIC and suggests a
  conversion, rather than reporting a generic failure. See Open question Q4.
- [ ] **IN-5 [v1]** Show a preview of the uploaded image before generation.
  **Check:** After a successful upload, the image is visible at a reasonable on-screen size and the
  Generate control becomes enabled.
- [ ] **IN-6 [v1]** Reject images above a size ceiling with a readable error rather than hanging.
  **Check:** Upload an image larger than the ceiling defined in NFR-3; an error appears within
  2 seconds and the tab does not freeze.

### Settings — SET

- [ ] **SET-1 [v1]** User sets the target finished width of the physical piece, in inches.
  Unit is labeled on screen. Height follows from the source image's aspect ratio.
  **Check:** Entering 10 inches at 5mm bead size yields a pattern ~51 beads wide, and the displayed
  height matches the image's aspect ratio within one bead. _(Partially implemented.)_
- [ ] **SET-2 [v1]** User selects bead size from a fixed list: Standard and Mini, each labeled with
  its millimeter pitch.
  **Check:** Switching from Standard to Mini at a fixed target width increases bead count per side
  by the inverse ratio of the two pitches, within one bead. _(Partially implemented; see Q1 —
  the Mini pitch currently used may be wrong.)_
- [ ] **SET-3 [v1]** Display the computed grid dimensions (width × height in beads) and total bead
  count before generating.
  **Check:** Changing target width or bead size updates the displayed dimensions immediately,
  before Generate is pressed.
- [ ] **SET-4 [v1]** User sets a maximum number of distinct colors for the output. Default 30,
  range 2 to the palette size.
  **Check:** With the limit set to 12, the generated pattern's bead list contains at most 12
  distinct colors. See Decision log D3.
- [ ] **SET-5 [v1]** Reject dimension settings that exceed the limits in NFR-3, with a message
  saying which limit was hit and what to change.
  **Check:** A setting that would produce more than the cell cap shows an error naming the cap and
  suggesting a smaller width or larger bead. _(Implemented in `pattern-utils.mjs`.)_
- [ ] **SET-6 [v2]** Optional advanced settings panel, collapsed by default, containing the
  background-removal and pixel-art options below.
  **Check:** Panel is hidden until opened; all v1 behavior is unchanged when it is never opened.
- [ ] **SET-7 [v2]** Background removal toggle, default **on**: remove a continuous solid-color
  background before conversion, so the pattern covers only the subject. This is the highest-value
  item in the advanced panel — it serves S1, the majority case. See Decision log D13.
  **Check:** All of the following, on a drawing of an object centered on a white canvas:
  - The canvas area becomes empty cells and contributes zero beads to the inventory (OUT-4).
  - White *inside* the subject — a highlight, an eye, a white shirt — is **kept**. The removal
    must spread inward from the image border, not delete every pixel matching the background
    color.
  - A background that is off-white, light gray, or a solid non-white color is removed too, using a
    color tolerance rather than an exact match.
  - A subject touching or running off the image border is not hollowed out through the contact
    point.
  - Anti-aliased or JPEG-fringed subject edges do not leave a halo of near-background beads
    outlining the subject.
  - Turning the toggle off reproduces the background as beads, i.e. v1 behavior.
- [ ] **SET-8 [v2]** After background removal, trim the empty margin so the target width (SET-1)
  applies to the subject's bounding box rather than the original canvas.
  **Check:** The same drawing exported with a tight canvas and with a large white margin produces
  the same subject dimensions in beads, within one bead. Without this, removing the background
  silently makes the finished piece smaller than the requested width.
- [ ] **SET-9 [v2]** Pixel-art input toggle, default off: skip resizing and map the source
  pixel-for-pixel, with a size safety check that errors out on oversized input per NFR-3.
  **Check:** A 32 × 32 pixel-art PNG produces a 32 × 32 pattern with the target width ignored, and
  each source pixel maps to exactly one cell.
- [ ] **SET-10 [later]** User-facing algorithm selector. Held back past the rest of the advanced
  panel because it requires a known-best default that does not exist yet; until then the algorithm
  is fixed and switchable only in code. See Decision log D5.

### Palettes — PAL

- [ ] **PAL-1 [v1]** Palettes are fixed, official Perler color sets shipped with the app. Users
  select among them; they never define, edit, or extend a palette.
  **Check:** No UI exists for adding, editing, or removing a color.
- [ ] **PAL-2 [v1]** The 221-color set is the default and loads automatically on startup.
  **Check:** On a fresh page load with no interaction, the app reports the 221-color palette as
  active. _(Implemented — loads `colors_221.json`.)_
- [ ] **PAL-3 [v1]** If the palette file fails to load or fails validation, show a readable error
  and disable generation rather than generating against a broken palette.
  **Check:** Rename the palette file and reload: an error names the palette load failure and
  Generate stays disabled. _(Implemented.)_
- [ ] **PAL-4 [v1]** Every palette entry has a unique color code/name and a valid RGB triple;
  invalid palette data is reported as a validation error listing the bad entries.
  **Check:** `pattern-utils.test.mjs` covers duplicate names, missing names, and out-of-range RGB.
  _(Implemented and tested.)_
- [ ] **PAL-5 [v2]** User switches among the shipped palettes from a dropdown. Fewer than ten sets
  are expected; known sizes are 144, 221 (default), and 291.
  **Check:** Selecting a different palette and regenerating produces bead codes drawn only from
  that palette, and the palette's name and color count are displayed.
- [ ] **PAL-6 [v2]** Palettes other than the default must be sourced and converted to the app's
  palette format (name, hex, rgb) before PAL-5 ships. `colors.json` (291 entries, name and hex
  only) is a partial source and needs RGB values added; `helper.py` performs that conversion.
  **Check:** Each shipped palette file passes PAL-4 validation.
- [ ] **PAL-7 [v2]** Changing the palette after a pattern exists warns that the pattern will be
  regenerated and manual edits lost, and requires confirmation.
  **Check:** With hand-edited cells present, switching palette prompts before discarding them.

### Generation — GEN

- [ ] **GEN-1 [v1]** Produce a grid of the computed dimensions in which every cell holds exactly
  one palette color, or is marked empty where the source is transparent.
  **Check:** For a source image with a transparent region, the corresponding cells render as empty
  and are excluded from the bead count. _(Partially implemented.)_
  Note: this already solves S1 for artwork saved with a transparent background. SET-7 exists for
  artwork flattened onto an opaque canvas, which is the more common export.
- [ ] **GEN-2 [v1]** Color matching uses a perceptual color space (OkLab), not raw RGB distance.
  **Check:** Unit test: a mid-gray and a saturated color pair where RGB distance and OkLab distance
  disagree resolves to the OkLab-nearest palette entry. Visual: dark tones and skin tones no longer
  snap to visibly wrong hues. See Decision log D2. _(Currently RGB — must be replaced.)_
- [ ] **GEN-3 [v1]** Reduce the output to at most the SET-4 color limit by keeping the most-used
  colors and remapping the rest to their nearest kept color.
  **Check:** Distinct color count in the bead list is ≤ the limit, and no cell is left unassigned.
- [ ] **GEN-4 [v1]** Downscaling averages source pixels within each bead cell before palette
  matching, so that detail is summarized rather than point-sampled.
  **Check:** A source image with fine alternating stripes produces blended cells, not an aliased
  moiré pattern. See Decision log D4.
- [ ] **GEN-5 [v1]** Each cell's assigned color is flat and hard-edged — no gradient, blur, or
  anti-aliasing within or between cells.
  **Check:** Zoom to a cell boundary in the rendered pattern and in the exported PNG: adjacent
  cells meet at a hard edge with exactly two colors present.
- [ ] **GEN-6 [v1]** The conversion pipeline is a single replaceable unit, so alternative
  algorithms can be swapped in without touching UI code.
  **Check:** A second algorithm can be added and selected by changing one identifier, with no
  edits outside the pipeline module.
- [ ] **GEN-7 [v1]** Output is deterministic: same image, settings, and palette produce an
  identical pattern.
  **Check:** Generate twice without changing settings; bead counts and every cell match.
- [ ] **GEN-8 [v1]** The pattern is recognizable and reads as intentional pixel art. Verified by
  human review against the fixed reference set in "Done looks like," not by automated test.
  **Check:** See the reference-image review procedure below.

### Pattern view — VIEW

- [ ] **VIEW-1 [v1]** Render the pattern on a single drawing surface (canvas), not as one page
  element per bead.
  **Check:** A 300 × 300 pattern renders and pans smoothly. _(Current build uses one element per
  bead and must be rewritten. See Decision log D1.)_
- [ ] **VIEW-2 [v1]** Zoom in and out, and pan when the pattern exceeds the viewport.
  **Check:** At maximum zoom individual cells and codes are comfortably readable; at minimum zoom
  the whole pattern fits the viewport. Zoom keeps the viewport center fixed.
  _(Partially implemented via CSS scaling; replaced by VIEW-1.)_
- [ ] **VIEW-3 [v1]** Color codes are drawn on each cell and can be toggled off.
  **Check:** Toggling off removes all code text and leaves colors unchanged; toggling on restores
  it. _(Partially implemented.)_
- [ ] **VIEW-4 [v1]** Code text is legible against its cell color.
  **Check:** Codes on the palette's darkest and lightest colors are both readable.
  _(Implemented via contrast-based text color.)_
- [ ] **VIEW-5 [v1]** When cells are too small to fit code text, hide the text automatically rather
  than drawing unreadable overlapping glyphs.
  **Check:** Zoom out until cells are under the legibility threshold; text disappears and colors
  remain.
- [ ] **VIEW-6 [v2]** Gridlines every 10 cells to help counting, toggleable.
  **Check:** Lines align to every 10th cell boundary in both directions.

### Editing — EDIT

- [ ] **EDIT-1 [v1]** Single-cell brush: clicking or dragging over cells sets them to the currently
  selected palette color.
  **Check:** Clicking a cell changes exactly that cell; dragging paints a continuous run with no
  skipped cells at any zoom level.
- [ ] **EDIT-2 [v1]** Eraser: sets cells to empty.
  **Check:** Erased cells render as empty and leave the bead count.
- [ ] **EDIT-3 [v1]** Color picker: select the active color from the loaded palette, showing each
  color's swatch and code.
  **Check:** The selected color is visibly indicated, and painting uses it.
- [ ] **EDIT-4 [v1]** Edits update the bead count list immediately.
  **Check:** Painting one cell from color A to color B decrements A by 1 and increments B by 1.
- [ ] **EDIT-5 [v1]** Pan works while the editor is active without painting accidentally.
  **Check:** A dedicated pan mode, or a modifier/second-finger gesture, moves the view without
  modifying any cell.
- [ ] **EDIT-6 [v1]** No undo in v1. Correcting a mistake means painting the cell again.
  **Check:** Not applicable — this records a deliberate omission. See Decision log D7.
- [ ] **EDIT-7 [v2]** Undo/redo covering paint strokes and erases.
  **Check:** Undo reverses the last stroke as one unit, not one cell at a time.
- [ ] **EDIT-8 [v2]** Flood fill. Blocked on EDIT-7 — fill without undo is unsafe.
  **Check:** Fill affects only the contiguous same-color region under the cursor, and is undoable.

### Output — OUT

- [ ] **OUT-1 [v1]** Export the pattern as a downloadable PNG with the color code drawn on every
  cell.
  **Check:** The downloaded file opens as a valid PNG; every non-empty cell shows its code; codes
  are legible at 100% zoom in an image viewer.
- [ ] **OUT-2 [v1]** The export reflects the current state of the pattern, including manual edits.
  **Check:** Paint a cell, export, and confirm the exported PNG shows the edited color and code.
- [ ] **OUT-3 [v1]** Export cell size is fixed and independent of on-screen zoom, so output size is
  predictable.
  **Check:** Exporting the same pattern at two different on-screen zoom levels produces
  pixel-identical files.
- [ ] **OUT-4 [v1]** Show the bead inventory on screen: each required color's code, swatch, and
  count, plus the total bead count and the number of distinct colors. Sortable.
  **Check:** Counts sum to the number of non-empty cells. _(Partially implemented.)_
- [ ] **OUT-5 [v2]** Include a color legend and the grid dimensions in the exported image.
  **Check:** The exported PNG is self-sufficient — a reader who did not use the app can identify
  every code and the finished size.
- [ ] **OUT-6 [later]** Printable multi-page PDF, split into pegboard-sized sections with grid
  coordinates and a legend on each page.

### Persistence — SAVE

- [ ] **SAVE-1 [v1]** Autosave the single current pattern, its settings, and its manual edits to
  browser-local storage, so a refresh or accidental tab close does not lose work.
  **Check:** Generate, edit several cells, reload the page: the pattern and edits are restored.
- [ ] **SAVE-2 [v1]** Nothing is uploaded anywhere. All storage is browser-local.
  **Check:** With the network disabled after first load, upload, generate, edit, and export all
  work. No outbound requests appear in the network log during those actions.
- [ ] **SAVE-3 [later]** A library of multiple named projects the user can browse and return to.

### Non-functional — NFR

- [ ] **NFR-1 [v1]** Free to run and free to host: a static site with no backend and no paid
  services.
  **Check:** The built app runs correctly when served as plain static files.
- [ ] **NFR-2 [v1]** Generation completes without freezing the page.
  **Check:** At the NFR-3 cell cap, the page stays responsive; if generation exceeds ~150 ms of
  blocking, move the pipeline off the main thread. See Decision log D8.
- [ ] **NFR-3 [v1]** Hard limits: 500 beads maximum per side, 100,000 cells maximum (so the largest
  square is 316 × 316). Source images above 8000 px on a side are rejected per IN-6.
  **Check:** Settings above these limits are refused with the message required by SET-5.
  _(Implemented in `pattern-utils.mjs`.)_
- [ ] **NFR-4 [v1]** Deterministic logic is covered by automated tests that run without a browser.
  **Check:** The test suite covers palette validation, dimension calculation, OkLab matching, color
  reduction, and inventory tallying, and passes from a single command.
- [ ] **NFR-5 [v1]** Usable in a current desktop browser at 1280 px wide and in a phone browser at
  390 px wide.
  **Check:** At both widths, all v1 controls are reachable and the pattern view is usable.

## Won't build

- No user accounts, social features, or public pattern sharing. _(See Non-goals.)_
- No text-to-image generation.
- No user-created palettes.
- No server-side image processing; image data never leaves the browser.
- No smooth or interpolated output: the pattern is never presented or exported with blurred,
  gradient, or anti-aliased cells. Per GEN-4, averaging source pixels *during downscale* is both
  allowed and required — the prohibition is on soft output, not on averaging input. See D4.

## Done looks like

**v1 ships when** every requirement marked **[v1]** passes its Check, and the reference-image
review below passes.

**Reference-image review (GEN-8).** Keep six fixed test images in the repo and re-run this review
after any pipeline change. The set is weighted toward artwork because artwork is the majority input
(S1). R1–R3 must be **excellent** — they are the majority case and the easiest inputs, so anything
less is a real defect. R4–R5 must be **acceptable** — photos lose detail by nature. R6 is a
regression guard.

| # | Image | Passing result |
|---|---|---|
| R1 | Flat-color illustration or logo, transparent background | Near-exact reproduction. Flat regions stay single-colored. |
| R2 | Flat-color drawing of an object on a solid white canvas | Subject as R1. The canvas must come out as **one** uniform color, never speckled into several near-whites — that speckle would also defeat SET-7 later. |
| R3 | Shaded or painted digital artwork — soft gradients, dark outlines | Outlines survive as continuous lines, not dashes. Shading resolves into a few clean bands, not noise. |
| R4 | High-contrast photo, one subject, plain background (dog portrait) | Subject clearly identifiable from ~60 cm away. Eyes and silhouette intact. |
| R5 | Busy, low-contrast photo | Main silhouette still readable. Allowed to lose fine detail; not allowed to be unrecognizable mush. |
| R6 | Existing pixel art, downscaled | No worse than the source. No stray off-palette speckle in flat areas. |

Additional pass conditions for all six: distinct color count is within the SET-4 limit; no flat
region of the source is broken into three or more colors that read as noise; no visible checkerboard
or moiré artifacts.

## Constraints and hunches

- Free, static, no backend. Data stays local (SAVE-2, NFR-1).
- The realistic constraint on quality is the user's actual bead inventory: most people own on the
  order of 25 colors, not 221. Output that needs 80 colors is unbuildable, which is why SET-4/GEN-3
  exist.
- Small patterns are the common case. At 5 mm beads, a 10-inch piece is only ~51 beads wide, so the
  NFR-3 caps are far above typical use.
- **The majority input is the easy input.** Flat-color artwork is what this pipeline handles best:
  it already consists of large uniform regions, so downscaling and palette-snapping lose little.
  Photos are the hard case — fine texture (fur, foliage, hair) does not survive at bead resolution.
  Weighting the user base toward artwork lowers the risk on GEN-8 rather than raising it.
- The artwork case has a different failure mode from the photo case: not "unrecognizable," but
  "correct subject surrounded by 800 white beads nobody wants to buy." That is a background
  problem, not a matching problem, and it is what SET-7 and SET-8 address.
- Cropping tightly is the user's most effective quality lever for both cases — it multiplies detail
  per bead for photos and removes background for artwork — which is why crop is a v1 must
  (IN-5 / M4 in the plan).

## Open questions

- **Q1 — Mini bead pitch.** The app currently uses 2 mm for Mini beads (0.079 in). Mini Perler
  beads are commonly specified at 2.6 mm. If 2.6 is correct, every Mini pattern is currently ~30%
  too many beads wide. Measure a real bead strip and fix SET-2.
- **Q2 — Default color limit.** SET-4 defaults to 30. Artwork and photos likely want very different
  values — a flat-color drawing may need only 8, while a photo portrait wants every one of the 30.
  Validate against R1–R6 and decide whether one default serves both or the limit should adapt to
  how many colors the image actually uses.
- **Q3 — Dithering.** Dithering improves gradients but adds speckle that looks like a mistake in
  physical beads and inflates the color count. Decide after the R1–R6 review whether to offer it at
  all — note it would help R4/R5 (photos) most and hurt R1/R2 (flat artwork) most, so if it ships
  it probably should not be on by default. Currently: not in v1.
- **Q4 — HEIC.** Confirm which target browsers decode HEIC. If most do not, decide between a
  clear error (IN-4, current plan) and bundling a decoder (adds significant weight).
- **Q5 — Units.** Inches only for v1. Add centimeters, and if so, as a unit toggle or a second
  field?
- **Q6 — Palette sourcing.** Where do the 144 and 291 color sets come from, and are their color
  codes and hex values reliable enough to build patterns against? Blocks PAL-5/PAL-6.
- **Q7 — What counts as "background."** SET-7 assumes one solid region reachable from the image
  border. Undecided: artwork on a solid *colored* canvas (remove it, or is it part of the piece?),
  artwork with a drawn border or frame, and a subject that itself touches the border on multiple
  sides. Also, with the toggle defaulting to on, some users will lose a background they wanted —
  decide whether the app should say what it removed.
- **Q8 — Edge tolerance for SET-7.** Anti-aliasing and JPEG artifacts leave a fringe of
  near-background pixels around the subject. Too tight a tolerance leaves a halo of pale beads
  outlining everything; too loose eats the subject's own light edges. Whether a single tolerance
  value can serve both clean PNG exports and re-compressed JPEGs is unknown. This is the part of
  SET-7 most likely to be harder than it looks.

## Decision log

- **D1 (2026-09-07) — Render the pattern on a canvas, not one element per bead.** The current build
  creates one page element per bead and zooms with CSS scaling. That collapses well below the
  NFR-3 caps and cannot support per-cell painting. Canvas rendering is a prerequisite for VIEW-1,
  VIEW-2, VIEW-5, and all of EDIT.
- **D2 (2026-09-07) — Match colors in OkLab, not RGB.** RGB distance does not match human
  perception and fails worst in dark tones and skin tones. This is a small, contained change with
  the largest single quality payoff available. (GEN-2)
- **D3 (2026-09-07) — Cap the number of distinct colors, default 30.** A photo matched against 221
  colors produces a pattern nobody owns the beads for. Buildability is part of correctness.
  (SET-4, GEN-3)
- **D4 (2026-09-07) — Corrected the original "no blurry resizing" rule.** Blurriness comes from
  smooth *upscaling*; averaging source pixels when *downscaling* is the correct behavior and
  prevents aliasing. The requirement is now flat, hard-edged output (GEN-5) plus averaged input
  (GEN-4). The original wording risked banning the right technique.
- **D5 (2026-09-07) — Algorithm choice is a developer switch in v1, not user UI.** The pipeline is
  replaceable (GEN-6) so alternatives can be compared during tuning, but exposing the choice to
  users requires a "best" default that does not exist yet. (SET-10)
- **D6 (2026-09-07) — Draw-from-scratch (S4) deferred.** It is effectively a second app sharing
  only the palette code. The editor in v1 exists to correct conversion errors (S3), which is a much
  smaller surface.
- **D7 (2026-09-07) — No undo in v1, and therefore no flood fill.** With a one-cell brush a mistake
  is self-correcting: paint it again. Undo is expensive to build correctly and becomes mandatory
  only once a tool can change many cells at once. (EDIT-6, EDIT-8)
- **D8 (2026-09-07) — Keep the pipeline on the main thread for now.** At the NFR-3 cell cap the
  work is roughly 100,000 cells against 221 colors, which should complete in well under a second
  with palette values precomputed. Move to a background thread only if measurement shows visible
  jank. (NFR-2)
- **D9 (2026-09-07) — v1 export is a PNG with codes baked into every cell.** A printable, paginated
  PDF is what serious builders eventually need, but it is roughly a week of work hidden behind one
  sentence. Deferred to OUT-6.
- **D10 (2026-09-07) — Palettes are fixed official sets; users never build their own.** Fewer than
  ten sets exist; 221 is the default, with 144 and 291 known. Switching among them is v2, and is
  blocked on sourcing reliable data for the other sets. (PAL-1, PAL-5, PAL-6, Q6)
- **D11 (2026-09-07) — The correction editor is promoted from "Should" to a v1 requirement.** It is
  the safety net for GEN-8: "good enough conversion plus the ability to fix it" is far cheaper than
  a perfect algorithm, and reaches the same outcome. (EDIT-1 through EDIT-5)
- **D12 (2026-09-07) — Primary input reframed from photos to artwork.** The majority of users are
  expected to upload non-pixel drawings and illustrations, with photos a significant minority. The
  scenarios are reordered accordingly (S1 artwork, S2 photo) and the GEN-8 reference set is
  reweighted toward artwork (R1–R3 of six). This *reduces* algorithm risk, since flat-color art is
  the easiest input for this pipeline, but it shifts the dominant failure mode from "unrecognizable
  subject" to "unwanted background reproduced in beads."
- **D13 (2026-09-07) — Background removal stays out of v1, but is promoted to the top of v2.** It
  is the highest-value item in the advanced panel because it serves S1, the majority case. Holding
  it to v2 ships the advanced panel as one coherent release rather than splitting a single toggle
  out ahead of the rest. Two consequences recorded deliberately:
  - **The v1 story for white-canvas artwork is crop plus eraser** (IN-5, EDIT-2), and it is free
    when the user's file already has a transparent background (GEN-1). Not as good, but not
    nothing — and it means v1 is still usable for S1 rather than blocked on v2.
  - **The v1 bead inventory will be dominated by white** for these images. That is expected, not a
    bug, and OUT-4 makes it visible — which is itself the evidence for prioritizing SET-7.
  Also noted: this is likely harder than "flood fill from the border and stop." The enclosed-white
  case, border-touching subjects, and anti-aliased edge halos are all specified as Checks under
  SET-7, and the tolerance question is open as Q8. And removal without SET-8's auto-trim would
  silently shrink the finished piece, so the two ship together.
