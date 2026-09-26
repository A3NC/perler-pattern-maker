# Perler Pattern Generator — Specification

_Last updated: 2026-09-21 · Status: v1 in progress_

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
subject auto-trim (SET-8), pixel-art passthrough (SET-9) — plus palette switching and a legend in
the export. _(Gridlines were on this list until D16 moved them into v1; undo/redo and flood fill
until D19 did the same.)_

**Later, undated:** drawing from scratch (S4), user-facing algorithm selection, a multi-project
library, printable multi-page PDF export.

## Requirements

**How to read this.** Each requirement has an ID, a version marker, a statement, and a **Check:**
line describing how to verify it. A requirement is done when its Check passes. Checkboxes track
implementation status.

Markers: **[v1]** = required for first release · **[v2]** = next release · **[later]** = deferred.

### Input — IN

- [x] **IN-1 [v1]** Accept a single image file via file picker, in PNG, JPEG, GIF, WebP, or BMP.
  **Check:** One valid file of each listed format uploads and produces a preview.
  _(**Completed at M4**, having been half done at M3. M3 verified all five formats — including all
  three WebP header layouts — upload and reach a generated pattern, against real encoder output. The
  outstanding half was the preview, which is IN-5; it landed in M4 and this ticks with it.)_
- [x] **IN-2 [v1]** Reject non-image files with a specific, readable error naming the problem.
  **Check:** Uploading a `.txt`, a `.pdf`, and a zero-byte file each shows a distinct message that
  says what was wrong (not "an error occurred"), and the app stays usable afterward.
  _(Satisfied at M3. Seven distinct rejection reasons, each with its own message; a test asserts the
  messages are pairwise distinct rather than trusting them to be. `.txt`, `.pdf` and a zero-byte
  file were driven through Chrome, and recovery — a good file loading straight afterward — is
  checked after every rejection.)_
- [x] **IN-3 [v1]** Reject corrupted or truncated image files with a readable error.
  **Check:** Upload a JPEG truncated to 50% of its bytes and a file renamed from `.txt` to `.png`.
  Both produce an error mentioning that the file could not be read as an image. No blank screen,
  no console-only failure.
  _(Satisfied at M3, but **not through the decoder** — the reason this Check needed its own
  mechanism. A browser renders a JPEG truncated to 50% as a partial image and fires `onload`, so
  nothing downstream of the decode can see the problem. `looksTruncated` in `src/lib/image-file.ts`
  checks the file's own end marker instead: JPEG's `FFD9`, PNG's `IEND`, GIF's trailer, and the
  self-declared lengths in WebP and BMP. The marker is searched for within the last 64 bytes rather
  than demanded at the final byte, because a false positive refuses a file that would have worked.
  A `.txt` renamed `.png` is caught earlier and more specifically, by sniffing.)_
- [x] **IN-4 [v1]** Detect files the browser cannot decode (notably iPhone HEIC/HEIF) and say so
  explicitly, naming the format and suggesting JPEG or PNG.
  **Check:** Upload a `.heic` in a browser without HEIC support. Error names HEIC and suggests a
  conversion, rather than reporting a generic failure. See Open question Q4.
  _(Satisfied at M3, by attempting the decode rather than refusing the format — see Q4, now
  resolved, and D20. The sniffed format is carried through the decode so that a failure can be
  named; HEIC's message points at Settings > Camera > Formats.)_
- [x] **IN-5 [v1]** Show a preview of the uploaded image before generation.
  **Check:** After a successful upload, the image is visible at a reasonable on-screen size and the
  Generate control becomes enabled.
  _(Satisfied at M4, and the preview carries the crop rectangle rather than being a bare thumbnail —
  cropping is the quality lever this requirement exists to enable. Driven in Chrome at 1280 px and at
  390 px: no preview before upload, the image visible and Generate enabled after one, and the panel
  hidden again on a successful generate per D21.)_
- [x] **IN-6 [v1]** Reject images above a size ceiling with a readable error rather than hanging.
  **Check:** Upload an image larger than the ceiling defined in NFR-3; an error appears within
  2 seconds and the tab does not freeze.
  _(Satisfied at M3, with room to spare: a 12000 × 9000 PNG is refused in **15 ms** against the
  2 s allowance, because the size is read out of the file header and nothing is ever decoded. The
  8000 px ceiling is also re-checked against `naturalWidth`/`naturalHeight` after the decode, for
  the files whose header the parser declines to read — a JPEG whose frame header sits past the
  64 KB window, or a format with no parser at all.)_

### Settings — SET

- [x] **SET-1 [v1]** User sets the target finished width of the physical piece, in inches.
  Unit is labeled on screen. Height follows from the aspect ratio of the **cropped region** — the
  whole image until the user crops (M4).
  **Check:** Entering 10 inches at 5mm bead size yields a pattern ~51 beads wide, and the displayed
  height matches the cropped region's aspect ratio within one bead.
  _(Ticked at M4, and it needed nothing built for it: the arithmetic has been right since M0, but the
  Check wants the result **displayed**, which is SET-3's readout. Measured in Chrome on a 400 × 300
  source: 10 in at Standard gives 51 × 38, and 51 × 0.75 = 38.25. "The source image's aspect ratio"
  in the original wording became the crop's when M4 landed.)_
- [x] **SET-2 [v1]** User selects bead size from a fixed list: Standard and Mini, each labeled with
  its millimeter pitch.
  **Check:** Switching from Standard to Mini at a fixed target width increases bead count per side
  by the inverse ratio of the two pitches, within one bead.
  _(Ticked at M4 for the same reason as SET-1 — the Check needed a displayed number, not new
  arithmetic. Measured in Chrome: at 20 in the width goes 102 → 196 beads against a predicted
  102 × (0.197 / 0.102) = 197.0, one bead inside the tolerance. Q1 resolved — Mini is 2.6 mm /
  0.102 in as of M0.)_
- [x] **SET-3 [v1]** Display the computed grid dimensions (width × height in beads) and total bead
  count before generating. The total counts beads, not cells: transparent cells are left empty and
  are not included.
  **Check:** Changing target width or bead size updates the displayed dimensions immediately,
  before Generate is pressed. On an image with a transparent background, the displayed total equals
  the "Total Beads Required" the stats line shows after Generate.
  _(Satisfied at M4, in `#dimensions`, and it also tracks the **crop** — which is what made it the
  first thing M4 built rather than the last: with it live, "did the crop reach the pipeline" is
  answered by dragging a handle and watching a number. Deliberately a separate element from
  `#stats`: this line describes the pattern that would be generated, `#stats` the one that exists.
  **Revised by D24 (2026-09-26)**, which fixed two defects in it: the total was width × height, so
  on a transparent PNG it overstated the beads (a 51 × 38 disc read 1,938 against 730 generated),
  and it stayed on screen after Generate, repeating the stats line. It now counts exactly what a
  generate would bill, and it is hidden while the target width and bead size match the pattern on
  screen. Measured in Chrome: the disc reads 730 before Generate and 730 after, at Standard and at
  Mini.)_
- [x] **SET-4 [v1]** User sets a maximum number of distinct colors for the output. Default 30,
  range 2 to the palette size.
  **Check:** With the limit set to 12, the generated pattern's bead list contains at most 12
  distinct colors. See Decision log D3.
- [x] **SET-5 [v1]** Reject dimension settings that exceed the limits in NFR-3, with a message
  saying which limit was hit and what to change.
  **Check:** A setting that would produce more than NFR-3's hard limit shows an error naming the
  limit and suggesting a smaller width or larger bead.
  _(Ticked at M4. Implemented in `src/lib/pattern-utils.ts` since M0 — the per-side and cell limits
  report separately so the message names the one actually hit — but until SET-3's readout existed
  the only way to see it was to press Generate, and the Check reads as a property of the settings
  rather than of the attempt. `refreshDimensions` catches the same throw and shows the same message
  live. Measured in Chrome: 400 in at Standard reads "Pattern is too large: 2030 × 1523 beads
  exceeds the limit of 300 beads per side. Choose a smaller width or a larger bead size.")_
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
  _(**This is the only requirement of its shape, and it covers only the palette.** Crop, target
  width, bead size and color limit all regenerate and destroy manual edits in exactly the same way,
  and no [v1] requirement covers them — a gap, named here rather than in passing, and **open**. D21
  briefly closed it by freezing every input after the first Generate, and was narrowed the same day
  because that made the ordinary case — regenerate at a different width — worse in order to be tidy
  about the awkward one. Only the crop is one-shot now, so changing a setting and pressing Generate
  still discards hand edits silently. Whether v1 wants PAL-7's confirmation extended to the settings
  is M9's call.)_

### Generation — GEN

- [ ] **GEN-1 [v1]** Produce a grid of the computed dimensions in which every cell holds exactly
  one palette color, or is marked empty where the source is transparent.
  **Check:** For a source image with a transparent region, the corresponding cells render as empty
  and are excluded from the bead count. _(Partially implemented.)_
  Note: this already solves S1 for artwork saved with a transparent background. SET-7 exists for
  artwork flattened onto an opaque canvas, which is the more common export.
- [x] **GEN-2 [v1]** Color matching uses a perceptual color space (OkLab), not raw RGB distance.
  **Check:** Unit test: a mid-gray and a saturated color pair where RGB distance and OkLab distance
  disagree resolves to the OkLab-nearest palette entry. Visual: dark tones and skin tones no longer
  snap to visibly wrong hues. See Decision log D2.
  _(M2: `src/lib/oklab.ts` + `src/pipeline/color-match.ts`. Measured 38.6% of sampled colors
  resolving differently against the real palette, 47.9% in dark tones.)_
- [x] **GEN-3 [v1]** Reduce the output to at most the SET-4 color limit by repeatedly merging the
  color whose removal costs the least perceptual error — its bead count times its OkLab distance to
  the nearest surviving color — into that survivor. The same merge also collapses near-duplicate
  colors that fall below a ΔE floor, even when the pattern is already within the limit.
  See Decision log D17.
  **Check:** Distinct color count in the bead list is ≤ the limit, and no cell is left unassigned.
  A flat region of near-identical source colors resolves to one bead color rather than several
  (the condition R2 turns on).
- [x] **GEN-4 [v1]** Downscaling averages source pixels within each bead cell before palette
  matching, so that detail is summarized rather than point-sampled.
  **Check:** A source image with fine alternating stripes produces blended cells, not an aliased
  moiré pattern. See Decision log D4 and D18.
  _(M2: `src/pipeline/downscale.ts`. Exact fractional-coverage box filter in linear light,
  alpha-weighted. D18 adds the lineart strategy alongside it.)_
- [x] **GEN-5 [v1]** Each cell's assigned color is flat and hard-edged — no gradient, blur, or
  anti-aliasing within or between cells.
  **Check:** Zoom to a cell boundary in the rendered pattern and in the exported PNG: adjacent
  cells meet at a hard edge with exactly two colors present.
  _(Ticked at M6, which made the second half checkable. **Export:** the edge strip of all 10,000
  cells of a 100 × 100 export (the part clear of the code text) is a single colour, and cell edges
  are integers by construction. **View:** a pixel read-back of the canvas at maximum zoom, codes and
  grid off, found no blended pixel at any of 481 colour changes at dpr 1 or 959 at dpr 2. The Check
  applies *between* gridlines: every 10th boundary carries the grid rule by design (D16, D22), and
  code text is anti-aliased as text, not as cell colour.)_
- [x] **GEN-6 [v1]** The conversion pipeline is a single replaceable unit, so alternative
  algorithms can be swapped in without touching UI code.
  **Check:** A second algorithm can be added and selected by changing one identifier, with no
  edits outside the pipeline module.
  _(M2: two switches, both one identifier — `ACTIVE_MATCHER` in `color-match.ts` and
  `ACTIVE_DOWNSAMPLER` in `downscale.ts`. The second one earned itself during M2: flipping it to
  `boxAverage` is what localized the D18 color-speck bug.)_
- [x] **GEN-7 [v1]** Output is deterministic: same image, settings, and palette produce an
  identical pattern.
  **Check:** Generate twice without changing settings; bead counts and every cell match.
  _(M2: every argmin in `reduce.ts` tie-breaks on ascending palette index, and a test asserts it
  rather than trusting map iteration order.)_
- [ ] **GEN-8 [v1]** The pattern is recognizable and reads as intentional pixel art. Verified by
  human review against the fixed reference set in "Done looks like," not by automated test.
  **Check:** See the reference-image review procedure below.
  _(**Deliberately unticked at M2 close (2026-09-21).** M2 shipped its whole scope and every other
  requirement it owns, but the review did not fully pass and ticking this would make the gate
  decorative — the one thing the milestone's own plan said not to do. Two things outstanding, and
  they are different in kind. (1) Dark regions blend less smoothly than before D18: improved by
  moving the contrast gate into perceptual lightness, not closed — lines outscore shading by only
  ~1.35× at the same tone and the bands still overlap across tones, so no threshold separates them
  everywhere. This is the R3 clause "shading resolves into a few clean bands, not noise." (2) Facial
  features of drawn characters distort — see Q10, which is not M2's to fix. The three tuning
  constants are in `DEFAULT_CONTRAST_TUNING`, `src/pipeline/downscale.ts`, and are meant to be moved
  by eye.)_

### Pattern view — VIEW

- [x] **VIEW-1 [v1]** Render the pattern on a single drawing surface (canvas), not as one page
  element per bead.
  **Check:** A 100 × 100 pattern (NFR-3's design target) renders and pans smoothly, and a pattern
  at NFR-3's 50,000-cell hard limit stays usable. _(Current build uses one element per bead and
  must be rewritten. See Decision log D1.)_
- [x] **VIEW-2 [v1]** Zoom in and out, and pan when the pattern exceeds the viewport.
  **Check:** At maximum zoom individual cells and codes are comfortably readable; at minimum zoom
  the whole pattern fits the viewport. Zoom keeps the viewport center fixed.
  _(Partially implemented via CSS scaling; replaced by VIEW-1.)_
- [x] **VIEW-3 [v1]** Color codes are drawn on each cell and can be toggled off.
  **Check:** Toggling off removes all code text and leaves colors unchanged; toggling on restores
  it. _(Partially implemented.)_
- [ ] **VIEW-4 [v1]** Code text is legible against its cell color.
  **Check:** Codes on the palette's darkest and lightest colors are both readable.
  _(Implemented via contrast-based text color.)_
- [x] **VIEW-5 [v1]** When cells are too small to fit code text, hide the text automatically rather
  than drawing unreadable overlapping glyphs.
  **Check:** Zoom out until cells are under the legibility threshold; text disappears and colors
  remain.
- [x] **VIEW-6 [v1]** Gridlines every 10 cells to help counting, toggleable. Promoted from [v2];
  see Decision log D16.
  **Check:** Lines align to every 10th cell boundary in both directions, and remain visible against
  the palette's darkest and lightest colors.
  _(Implemented in M10. Geometry in `src/lib/guides.ts`, drawn by `src/render/canvas-view.ts` as a
  dark/light double rule — a line crosses many cells, so `src/contrast.ts`'s per-cell choice cannot
  apply. Lines are suppressed below a 14 px line pitch, tested on the pitch rather than the cell so
  they survive zoom-out, which is where counting help matters most.)_
- [x] **VIEW-7 [v1]** Row and column numbers along the edges of the pattern view, so the visible
  region can be located within the whole pattern. See Decision log D16.
  **Check:** Zoom in until the pattern exceeds the viewport; the numbers along the top and left
  edges identify the visible columns and rows and stay correct while panning. They are absent when
  the whole pattern already fits.
  _(Implemented in M10, per axis: `shouldDrawRuler` gives a wide short pattern a column ruler and no
  row ruler. Labels thin from every 10th to every 20th, 50th ... cell as zoom drops, so they never
  collide. They stay correct while panning for free — the canvas is already `position: sticky` at
  the scroll corner, so its own first pixels are the viewport's.)_

### Editing — EDIT

- [x] **EDIT-1 [v1]** Single-cell brush: clicking or dragging over cells sets them to the currently
  selected palette color.
  **Check:** Clicking a cell changes exactly that cell; dragging paints a continuous run with no
  skipped cells at any zoom level.
- [x] **EDIT-2 [v1]** Eraser: sets cells to empty.
  **Check:** Erased cells render as empty and leave the bead count.
- [x] **EDIT-3 [v1]** Color picker: select the active color from the loaded palette, showing each
  color's swatch and code.
  **Check:** The selected color is visibly indicated, and painting uses it.
- [x] **EDIT-4 [v1]** Edits update the bead count list immediately.
  **Check:** Painting one cell from color A to color B decrements A by 1 and increments B by 1.
- [x] **EDIT-5 [v1]** Pan works while the editor is active without painting accidentally.
  **Check:** A dedicated pan mode, or a modifier/second-finger gesture, moves the view without
  modifying any cell.
- **EDIT-6 — retired (2026-09-21).** Originally "[v1] No undo in v1. Correcting a mistake means
  painting the cell again," recording the deliberate omission argued in D7. **D19 reverses it**
  and EDIT-7 now carries the requirement. The ID is kept rather than reused so that D7 and
  `plan-v1.md`'s references still resolve.
- [x] **EDIT-7 [v1]** Undo/redo covering paint strokes, erases, and fills. Promoted from [v2]; see
  Decision log D19.
  **Check:** Undo reverses the last stroke as one unit, not one cell at a time, and redo reapplies
  it. Bead counts after an undo match the counts before the stroke. A new edit made after undoing
  discards the redone-away tail rather than leaving it replayable.
  _(In-memory only: the history is deliberately **not** persisted by SAVE-1. Both directions apply
  through one function, so EDIT-4 holds by construction rather than by separate paint and undo
  paths agreeing.)_
- [x] **EDIT-8 [v1]** Flood fill, with the palette color and with empty. Unblocked by EDIT-7 —
  fill without undo is unsafe. Promoted from [v2]; see Decision log D19.
  **Check:** Fill affects only the contiguous same-color region under the cursor, and is undoable.
  Filling with empty over a uniform background canvas clears it in one action and removes those
  beads from the inventory.
  _(Exact palette match only — no tolerance, deliberately. A background that is several near-whites
  rather than one color is an R2/GEN-3 defect and is fixed there, not absorbed by a tolerance
  constant here.)_

### Output — OUT

- [x] **OUT-1 [v1]** Export the pattern as a downloadable PNG with the color code drawn on every
  cell.
  **Check:** The downloaded file opens as a valid PNG; every non-empty cell shows its code; codes
  are legible at 100% zoom in an image viewer.
  _(M6, 2026-09-24. The export also carries gridlines every 10 cells, a frame, and row and column
  numbers in a margin outside the cells — see D22. **"Legible at 100%" is read as *legible when
  zoomed in on a screen*, per D22**, and this note records exactly what was run: a 100 × 100
  pattern exports at 32 px per cell and its codes are legible at a true 100%. The hard limit steps
  down to 18 px per cell, where the 7 px codes are readable at 100% but small, and clear once
  magnified. `file` reports both as valid PNGs. The Check's wording asks for more than D22
  promises at the hard limit, so it is annotated here rather than quietly tested against something
  else.)_
- [x] **OUT-2 [v1]** The export reflects the current state of the pattern, including manual edits.
  **Check:** Paint a cell, export, and confirm the exported PNG shows the edited color and code.
  _(M6: one cell painted E9 through the real brush. The exported pixels at that cell are exactly
  E9's `rgb(233, 112, 204)` with its code. After undo, the next export is **byte-identical** to the
  pre-edit one. Free by construction: the export reads `pattern-state.ts`'s live `Pattern`, which
  every edit mutates in place.)_
- [x] **OUT-3 [v1]** Export cell size is fixed and independent of on-screen zoom, so output size is
  predictable.
  **Check:** Exporting the same pattern at two different on-screen zoom levels produces
  pixel-identical files.
  _(M6: passed more strictly than asked. The files are **byte-identical** (same SHA-256) at fit
  zoom, at maximum zoom, with both view checkboxes off, and at `devicePixelRatio` 2, and identical
  across separate runs. "Fixed" means fixed per pattern: the cell size is a function of the
  pattern's width and height only — 32 px, stepping down to fit a pixel budget, 18 px at the hard
  limit. See D22.)_
- [ ] **OUT-4 [v1]** Show the bead inventory on screen: each required color's code, swatch, and
  count, plus the total bead count and the number of distinct colors. Sortable.
  **Check:** Counts sum to the number of non-empty cells. _(Partially implemented.)_
- [ ] **OUT-5 [v2]** Include a color legend and the grid dimensions in the exported image.
  **Check:** The exported PNG is self-sufficient — a reader who did not use the app can identify
  every code and the finished size.
- [ ] **OUT-6 [later]** Printable multi-page PDF, split into pegboard-sized sections with grid
  coordinates and a legend on each page.
  _(Considered at M6 and deferred with D22: a cheaper first step than the PDF is splitting the
  pattern into several page-sized PNGs, numbered in whole-pattern coordinates, which M6's edge
  numbers already are. The geometry is simple, since `src/lib/export-layout.ts` would take a cell
  range. **The hard part is delivery** — dozens of files from one click wants a zip, because
  browsers prompt for or drop multiple downloads — not the drawing. Splitting would also lift the
  canvas-size ceiling D22 records.)_

### Persistence — SAVE

- [x] **SAVE-1 [v1]** Autosave the single current pattern, its settings, and its manual edits to
  browser-local storage, so a refresh or accidental tab close does not lose work.
  **Check:** Generate, edit several cells, reload the page: the pattern and edits are restored.
  _(See D23: the source image and crop are saved too, in IndexedDB; undo history is not. Verified
  at M7 in headless Chrome: brush, eraser and undo, then a reload, restore the pattern cell for
  cell with matching stats, inventory and generate-time settings; regenerating from the restored
  image and crop reproduces the original pattern exactly, for a PNG and for an orientation-6
  JPEG.)_
- [x] **SAVE-2 [v1]** Nothing is uploaded anywhere. All storage is browser-local.
  **Check:** With the network disabled after first load, upload, generate, edit, and export all
  work. No outbound requests appear in the network log during those actions.
  _(Verified at M7 against the production build: offline after load, upload, generate, a brush
  stroke, undo, redo and export all succeed, and the autosave writes. The network log's only entry
  is the `blob:` URL the upload decodes through, which is in-memory and never leaves the page. A
  *reload* while offline is outside this Check: with no service worker the app cannot be fetched
  at all.)_
- [ ] **SAVE-3 [later]** A library of multiple named projects the user can browse and return to.

### User interface — UI

Covers the application shell — controls, status, layout, and chrome. The pattern view itself is
VIEW. Appearance is split deliberately: UI-1 … UI-6 are mechanical and checkable, UI-7 is the
subjective half and is held to v2. See Decision log D14.

- [ ] **UI-1 [v1]** No content is clipped, and the page never scrolls horizontally, at 390 px or
  1280 px wide.
  **Check:** At both widths, in each screen state U1–U5, no element is cut off and
  `document.documentElement.scrollWidth` does not exceed the viewport width. _(Measured 2026-09-13
  on the empty state at 390 px: `scrollWidth` equals the viewport and no element overflows. The
  clipping originally recorded here did not reproduce — `src/styles.css` has had a narrow-width
  media query since M0. Unticked because the Check covers all of U1–U5, which M8 verifies.)_
- [ ] **UI-2 [v1]** Controls reflow to a single full-width column when two columns no longer fit,
  and status messages span the control panel rather than occupying an arbitrary grid cell.
  **Check:** At 390 px every control is full-width and in document order; at 1280 px the
  two-column layout is preserved; the status message spans the panel width at both.
- [ ] **UI-3 [v1]** Spacing, corner radii, and font sizes come from defined scales rather than
  per-rule literals.
  **Check:** `src/styles.css` defines spacing, radius, and type scales as custom properties in
  `:root`, and no `border-radius`, `font-size`, `padding`, `margin`, or `gap` literal appears
  outside `:root` except where no scale value applies. _(Currently five unrelated radii, four font
  sizes mixing px and rem, six ad-hoc spacing values.)_
  **Keep the token set minimal and descriptive.** Name what the app already does — roughly four
  spacing steps, three radii, three type sizes — not what a future design system might want.
  Structure is what survives a v2 change of direction; speculative structure built for a direction
  nobody has chosen yet is the one part of this work that can genuinely be wasted.
- [ ] **UI-4 [v1]** Every interactive control has a visible keyboard focus indicator, distinct
  from its hover state.
  **Check:** Tab through upload, target width, bead size, Generate, the zoom controls, the code
  toggle, and the inventory sort; each shows a clearly visible focus ring.
- [ ] **UI-5 [v1]** App text meets WCAG AA contrast — 4.5:1 for normal text, 3:1 for large text.
  **Check:** Measure each text-on-background pair — body, labels, buttons in both enabled and
  disabled states, and all three status variants — with a contrast checker. Note that
  `src/contrast.ts` does **not** answer this: it uses a perceptual-brightness approximation to pick
  black-or-white text on bead cells (VIEW-4), not WCAG relative luminance.
- [ ] **UI-6 [v1]** Interactive controls are at least 44 × 44 px at 390 px wide.
  **Check:** Measure each control's rendered box at 390 px.
- [ ] **UI-7 [v2]** The interface reads as intentionally designed rather than as an unstyled form.
  Verified by human review against the fixed screen states in "Done looks like," not by automated
  test.
  **Check:** See the interface review procedure in "Done looks like."

### Non-functional — NFR

- [ ] **NFR-1 [v1]** Free to run and free to host: a static site with no backend and no paid
  services.
  **Check:** The built app runs correctly when served as plain static files.
- [ ] **NFR-2 [v1]** Generation completes without freezing the page.
  **Check:** At NFR-3's hard limit, the page stays responsive; if generation exceeds ~150 ms of
  blocking, move the pipeline off the main thread. See Decision log D8.
  _(**Measured at M2 close, and it is over.** Node timings excluding decode and canvas, 221-color
  palette: **65 ms** at the design target (comfortable) and **315 ms** at the hard limit, against
  the ~150 ms threshold. The cost is dominated by the downscale — ~3.2M source pixels linearized
  and accumulated against 50k matches — not by matching. Recorded rather than acted on: D8 says
  revisit only on evidence, and this is the evidence, for M9 to weigh. The cheapest lever is
  `SUPERSAMPLE` 8 → 4 in `src/rasterize.ts`, which quarters the intermediate buffer; a worker is the
  bigger move.)_
- [ ] **NFR-3 [v1]** Two size numbers, deliberately different. See Decision log D15.
  - **Design target — 10,000 cells (100 × 100).** What the app is tuned and tested against: M1's
    render and pan performance, M2's generation time, and the R1–R6 review all use a pattern of
    this size. At Standard 5 mm that is a 50 cm piece; at Mini 2.6 mm, 26 cm.
  - **Hard limit — 50,000 cells, 300 beads maximum per side** (so the largest square is
    223 × 223). Settings above this are refused.

  Source images above 8000 px on a side are rejected per IN-6.
  **Check:** Settings above the hard limit are refused with the message required by SET-5; a
  pattern at the design target meets the performance Checks in VIEW-1 and NFR-2.
  _(Enforced in `src/lib/pattern-utils.ts`.)_
- [x] **NFR-4 [v1]** Deterministic logic is covered by automated tests that run without a browser.
  **Check:** The test suite covers palette validation, dimension calculation, OkLab matching, color
  reduction, and inventory tallying, and passes from a single command.
  _(Satisfied as of M2: `npm test` is the single command and covers palette validation, dimension
  calculation, palette matching, transparency, inventory tallying, the canvas view's
  zoom/visible-range/cell-mapping math, the gridline/ruler geometry, and — added in M2 — OkLab
  conversion and distance, the matcher strategy, the GEN-4 downscale including D18's lineart
  classifier, and color reduction. 88 tests, all browser-free. Standing obligation, not a one-time
  one: M5, M6 and M7 each add deterministic logic, and the convention that keeps this true is in
  CLAUDE.md — anything touching the DOM, canvas or FileReader stays out of `src/lib/` and
  `src/pipeline/`.)_
- [ ] **NFR-5 [v1]** Usable in a current desktop browser at 1280 px wide and in a phone browser at
  390 px wide.
  **Check:** At both widths, all v1 controls are reachable and the pattern view is usable. UI-1 and
  UI-2 carry the concrete failure conditions for this. _(The 390 px clipping this was written
  against is gone — `src/styles.css` has had a narrow-width media query since M0, and the page
  measures zero horizontal overflow at 390 px. Left unticked because M8 verifies it properly,
  including with a pattern on screen.)_

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
| R1 | Flat-color illustration, transparent background | Near-exact reproduction. Flat regions stay single-colored. |
| R2 | Flat-color drawing of an object on a solid white canvas | Subject as R1. The canvas must come out as **one** uniform color, never speckled into several near-whites — that speckle would also defeat SET-7 later. |
| R3 | Shaded or painted digital artwork — soft gradients, dark outlines | Outlines survive as continuous lines, not dashes. Shading resolves into a few clean bands, not noise. |
| R4 | High-contrast photo, one subject, plain background (dog portrait) | Subject clearly identifiable from ~60 cm away. Eyes and silhouette intact. |
| R5 | Busy, low-contrast photo | Main silhouette still readable. Allowed to lose fine detail; not allowed to be unrecognizable mush. |
| R6 | Existing pixel art, downscaled | No worse than the source. No stray off-palette speckle in flat areas. |

Additional pass conditions for all six: distinct color count is within the SET-4 limit; no flat
region of the source is broken into three or more colors that read as noise; no visible checkerboard
or moiré artifacts.

**Interface review (UI-7) — gates v2, not v1.** The same procedure as above, applied to the app's
own appearance. v1 only has to pass the mechanical UI-1 … UI-6 Checks; this review is what "looks
designed" means, and it is deliberately held to v2 so it cannot become an open-ended tuning loop
inside v1 (D14). Walk these five fixed screen states at 1280 px, and U5 at 390 px.

| # | Screen state | Passing result |
|---|---|---|
| U1 | First load, nothing uploaded | Reads as a finished tool at rest, not an empty form. The primary action is obvious and its disabled state is clearly deliberate rather than broken. |
| U2 | Image uploaded, before generating | The chosen file and the settings that will be applied are both legible at a glance. Nothing shifts position jarringly from U1. |
| U3 | Pattern generated — canvas, stats, inventory | The pattern is the visual focus. Stats and inventory support it without competing for attention. |
| U4 | An error state (unsupported file, or dimensions over the NFR-3 cap) | The message is the most prominent thing on screen, reads as informative rather than alarming, and says what to do next. |
| U5 | U3 at 390 px wide | Same hierarchy as U3, reflowed. Nothing feels like a desktop layout squeezed. |

Additional pass conditions for all five: spacing follows a consistent rhythm; one accent color used
consistently for primary actions; no control visually orphaned or misaligned; type hierarchy
clearly distinguishes headings, labels, and body text.

**Stopping rule, as for R1–R6: when U1–U5 pass, stop, even if it feels improvable.**

The state list is finalized once the UI surface is settled — U3 depends on M1's canvas view, and an
editor state would depend on M5. Do not fix screenshots of these states before then.

## Constraints and hunches

- Free, static, no backend. Data stays local (SAVE-2, NFR-1).
- The realistic constraint on quality is the user's actual bead inventory: most people own on the
  order of 25 colors, not 221. Output that needs 80 colors is unbuildable, which is why SET-4/GEN-3
  exist.
- Small patterns are the common case. At 5 mm beads, a 10-inch piece is only ~51 beads wide — about
  2,600 cells, roughly a quarter of NFR-3's design target. The original caps (500 per side, 100,000
  cells) were far above anything physically buildable and were revised down in D15.
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

- **Q1 — Mini bead pitch. RESOLVED (2026-09-08).** Set to 2.6 mm (0.102 in) in M0, the commonly
  published Mini Perler pitch. Was 2 mm (0.079 in), which made every Mini pattern ~30% too many
  beads wide. At a 10 in target width, Mini now yields 98 beads across rather than 127. Worth
  confirming against a real bead strip, but no longer blocking.
- **Q2 — Default color limit.** SET-4 defaults to 30. Artwork and photos likely want very different
  values — a flat-color drawing may need only 8, while a photo portrait wants every one of the 30.
  Validate against R1–R6 and decide whether one default serves both or the limit should adapt to
  how many colors the image actually uses.
- **Q3 — Dithering.** Dithering improves gradients but adds speckle that looks like a mistake in
  physical beads and inflates the color count. Decide after the R1–R6 review whether to offer it at
  all — note it would help R4/R5 (photos) most and hurt R1/R2 (flat artwork) most, so if it ships
  it probably should not be on by default. Currently: not in v1.
- **Q4 — HEIC. RESOLVED (2026-09-22), in M3.** Measured rather than assumed, against a real HEIC
  written by `sips`: **Safari decodes it** (a 400 × 300 HEIC decoded to 400 × 300), **Chrome refuses
  it** with an `EncodingError`. So the answer is neither "most browsers do" nor "most browsers do
  not" — it splits, and it splits exactly along the platform iPhone photos come from. That rules out
  both original options: refusing HEIC up front would break the case IN-4 exists for on the very
  browser those users have, and bundling a decoder would carry significant weight for something
  Safari already does. The shipped answer is the third one, D20: attempt the decode, and use the
  sniffed format to name the failure only if it actually fails.
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
- **Q10 — Feature alignment against the bead grid. NEW (2026-09-21), from the M2 review.** On drawn
  characters, facial features do not survive the reduction as features: eyes come out asymmetrical
  and mouths distorted, because where a cell boundary happens to fall relative to an eye decides
  what that eye becomes. **No part of the M2 pipeline can address this.** Downscaling, matching and
  reduction all run *after* the grid is fixed, so none of them can see that two cells ought to match
  each other. Fixing it algorithmically means object detection or feature-aware grid alignment —
  possible, but a different kind of problem and far outside v1. Recorded because it changes what M5
  is for: until now the editor was justified as M2's safety net for stray cells (D9), and this is a
  class of defect M2 could never have reached, which makes M5 load-bearing for artwork rather than
  merely a tidy-up. Decide at M5 whether the editor needs anything specific for it — a mirror or
  copy-region tool would turn "fix twelve beads twice, symmetrically" into one action.
  _(2026-09-21: D19 lowers the stakes on this. "Twice" is only expensive while a mistake is
  unrecoverable, and undo makes it recoverable; mirror also needs a region selection model that
  fill does not. M5 still decides, and records the answer in its Delivered block either way.)_
  _(**Answered 2026-09-22, in M5: no.** The editor gets no mirror and no copy-region tool. Two
  reasons, neither of them "we ran out of time." **(1)** Every M5 tool addresses a cell, or a region
  the pattern itself defines — fill's region comes from the bead colors, so there is no selection
  model anywhere in the milestone. Mirror and copy-region both need one: an anchor, an axis or a
  destination, a marquee to draw it with, and a way to show and cancel it. That is the largest
  single thing in M5 and it would serve one requirement that does not exist. **(2)** The premise
  weakened. "Fix twelve beads twice, symmetrically" was expensive because each of the twenty-four
  was unrecoverable; with EDIT-7 it is one Cmd+Z per misjudgement, and the eyedropper makes matching
  the opposite eye's bead a single alt-click rather than a hunt through 221 codes. Q10 stays open as
  a **generation** question — nothing in the editor makes the grid fall in a better place — and
  reopening it as a tool question needs a real report of the work being painful, not the
  anticipation of it.)_
- **Q9 — Visual identity for the v2 redesign.** The current palette is Tailwind's defaults
  (indigo-600, gray-50, gray-200) carried over from the original single-file build, and the type is
  the bare system stack. Whether the v2 redesign keeps that and merely tightens it, or adopts an
  identity of its own, is undecided — and it is the choice most likely to turn UI-7 into the tuning
  loop D14 is trying to avoid.
- **Q10 — Are D15's revised size numbers right?** They are reasoned from bead pitch and plausible
  finished dimensions, not from real projects. Mini is where the hard limit is most likely to bind:
  a 78 cm mural at 2.6 mm pitch is 300 beads per side and 90,000 cells, which D15 refuses on the
  cell count even though it passes the per-side limit. Decide before M9 ticks NFR-3 whether the
  50,000-cell limit should be higher for Mini specifically, or whether refusing that piece is the
  correct answer for v1.

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
  _[Superseded, 2026-09-21, by D19 — kept because the half of it that survived is load-bearing.
  D7 bundled two claims. "Fill needs undo" stands, and is why the two move together. "A one-cell
  brush makes mistakes self-correcting" does not: EDIT-1's own Check requires dragging to paint a
  continuous run, so the brush was never one-cell, and the state an edit overwrites is generated
  rather than authored, so "paint it again" assumes knowledge the user does not have.]_
- **D8 (2026-09-07) — Keep the pipeline on the main thread for now.** At NFR-3's hard limit the
  work is 50,000 cells against 221 colors, and 10,000 at the design target, which should complete
  in well under a second with palette values precomputed. Move to a background thread only if
  measurement shows visible jank. (NFR-2) _(Cell counts updated by D15; the conclusion holds with
  more margin than before.)_
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
- **D14 (2026-09-08) — Appearance is split into a mechanical v1 floor and a subjective v2 review.**
  Leaving appearance out of the spec entirely rested on it not being checkable, but most of what
  currently reads as "crude" is not a design problem — it is inconsistency and breakage. Five
  unrelated corner radii, four font sizes mixing units, six ad-hoc spacing values, a status box
  orphaned at half-width, and content clipped off-screen at 390 px. Fixing those requires no taste,
  only one decision applied consistently, so they become ordinary Checks (UI-1 … UI-6) in v1.
  Choosing a point of view — typography, a real color story, empty states, motion — does require
  taste and has the same open-ended shape as M2's color tuning, so it is held to v2 as UI-7 and
  given M2's treatment: a fixed review set (U1–U5) with an explicit stopping rule. The subjective
  half is never split in two; it moves whole into v2. Two consequences recorded deliberately:
  - **NFR-5 is currently failing** and was untracked until now. At 390 px the heading, the Generate
    button, and the target-width control are clipped, because `src/styles.css` has no media queries
    and a hardcoded two-column control grid. This is an existing [v1] obligation, not new scope.
    _[Correction, 2026-09-13 — this premise was false when written, and is kept only because the
    rest of D14 was reasoned from it. `src/styles.css` already carried an `@media (max-width:
    640px)` block collapsing the control grid to one column; it landed in M0 (`fdaec7c`), the
    commit before this entry, which touched documentation only. Measured at a real 390 px viewport
    the page has zero horizontal overflow and nothing clipped. D14's actual decision — splitting
    mechanical UI-1 … UI-6 from subjective UI-7 — does not rest on this and stands unchanged.]_
  - **The UI-7 review set cannot be fixed yet.** U3 depends on M1's canvas view and an editor state
    would depend on M5, so the screen states are finalized only once the UI surface stops moving.
  - **The v1 floor is not invalidated by whatever v2 decides.** Tokenizing changes *structure*; a
    change of aesthetic direction changes *values*. Swapping the font, the radii, or the whole
    palette in v2 is a handful of edits in `:root` precisely because UI-3 happened first — without
    it, the same change means hunting scattered literals across the file. UI-1, UI-2, UI-4, and
    UI-6 are direction-independent outright: no redesign makes "content must not be clipped" or
    "focus must be visible" obsolete. UI-5's threshold is permanent even though the colors it
    measures are not. The floor is also what makes the UI-7 review answerable at all — "is spacing
    consistent" cannot be judged against values that were never systematic.
  - _[2026-09-26: D25 admits one timeboxed styling pass into M8, after the floor. UI-7 stays
    optional for v1.]_
- **D15 (2026-09-10) — Size limits split into a design target and a hard limit, and both lowered.**
  NFR-3's original numbers (500 per side, 100,000 cells) were not derived from physical beads. 500
  beads at Standard 5 mm pitch is a 2.5 m piece; the 316 × 316 largest square is 1.58 m. A cap no
  user can reach is not a safety limit, and it also made every performance target in the plan an
  exercise against a fictional worst case. Replaced with two numbers that answer two different
  questions — **10,000 cells (100 × 100)** for what we tune and test against, **50,000 cells and
  300 per side** for what we refuse. Four consequences recorded deliberately:
  - **M1 and M2 test against 100 × 100, not 300 × 300.** VIEW-1's Check and
    `plans/m1-canvas.md`'s size targets move with it, and M2's per-pixel OkLab conversion gets
    roughly 10× cheaper — which matters because NFR-2's 150 ms threshold is what decides whether
    D8's "main thread for now" holds.
  - **SET-5's error becomes real guidance.** Naming a threshold users actually hit is a usable
    message; naming one nobody reaches is decoration.
  - **This does not change M1's canvas architecture, which is the reason it is worth writing
    down.** The binding constraint on canvas size is cells × max zoom, not cell count. At VIEW-2's
    readable max zoom (~30 px per cell) even the 100 × 100 design target is a 3,000 × 3,000
    CSS-pixel surface — about 36M device pixels and ~144 MB of backing store at DPR 2, over mobile
    Safari's canvas area cap, and NFR-5 puts 390 px in scope. So a canvas sized to the whole
    pattern remains the wrong shape at the revised numbers, and M1 still needs a viewport-sized
    canvas drawing only the visible cell range. Lowering the cap looks like it should retire that
    problem; it does not.
    _(2026-09-13: the max zoom above was 30 px when this was written; M1 raised it to 46.875 px
    — two zoom clicks — once the viewport-sized canvas made the ceiling free. The figures here
    stand as the reasoning of the day, and the conclusion only hardens: a pattern-sized canvas for
    the 100 × 100 target would now be 4,688 × 4,688. `MAX_CELL_SIZE_PX` in `src/lib/viewport.ts`
    is the live value.)_
  - **Code updated 2026-09-10.** `src/lib/pattern-utils.ts` now enforces 300 / 50,000, and the
    per-side and cell limits throw separately so SET-5's message names the limit actually hit —
    the combined message advertised `maxDimension × maxDimension`, a combination both the old and
    the new numbers reject.

- **D16 (2026-09-13) — Gridlines move into v1, and ship with edge numbers rather than alone.**
  Hands-on use of the finished M1 canvas found a large pattern hard to navigate in two distinct
  ways: losing track of which region is on screen, and miscounting beads within a run. At maximum
  zoom a 300 × 160 pattern shows about 0.3% of itself. VIEW-6 was already specified for the second
  problem and sat at [v2]; it is promoted, and VIEW-7 is added for the first. (VIEW-6, VIEW-7, M10)

  **Four consequences recorded deliberately:**
  - **Gridlines alone would not have fixed the reported problem, which is why the two ship
    together.** Every 10-cell block looks identical, so uniform lines give local structure without
    absolute position — they answer "how many beads is that" but not "where am I". Numbers are what
    differentiate position. Shipping VIEW-6 by itself would have closed a requirement and left the
    complaint standing.
  - **VIEW-6's [v2] marker was the one deferral in this spec with no decision behind it.** Every
    other deferred item is argued — D6, D7, D9, D10, D13, D14. Gridlines reached [v2] by appearing
    in two lists (the Deferred section above, `plan-v1.md`'s "Explicitly not in v1") and were never
    revisited. `plan-v1.md`'s scope-creep rule says to reopen deferred items deliberately because
    "each is a logged decision with a reason"; this one was not. So this entry is less a reversal
    than the decision that was missing.
  - **The export stays deferred.** Gridlines baked into the exported PNG remain out of v1, next to
    the export legend, and M6 decides. The geometry lives in `src/lib/guides.ts` as pure functions
    precisely so M6 reuses it rather than reinventing it. The v1 story for a printed pattern is
    therefore unchanged — which is worth stating, because the user who reported this works from
    both the screen and paper.
    _(Decided at M6, 2026-09-24: gridlines **do** ship in the export, with edge numbers in a margin
    — see D22. The printed-pattern story is still unchanged, but now deliberately: D22 makes the
    export a screen reference.)_
  - **A minimap was considered and declined.** A thumbnail with a viewport rectangle answers "where
    am I" more directly, but needs a second canvas inside `#outputContainer`, which is cleared
    wholesale on every generate, and sticky positioning of its own. Edge numbers answer the same
    question by drawing into a canvas that is already sticky-pinned to the scroll corner — no new
    DOM and no CSS change. Recorded here so it is a logged decision if it is ever revisited.

  **Shipped in M10 (2026-09-13), as decided.** All four consequences held: the two layers ship
  together behind one "Grid" checkbox, the geometry is reusable pure functions for M6, the export is
  untouched, and no minimap was built. Two things the decision did not anticipate:
  - **One toggle, not two, and for a layout reason rather than a conceptual one.** `.zoom-controls`
    is a no-wrap flex row and the bar is already tight at 390 px, so a second checkbox would have
    cost NFR-5 more than independent control was worth. If the rulers ever want their own switch,
    M8's UI-1 work on that bar is the place it becomes cheap.
  - **"No CSS change" held, but only by putting the checkbox's inline styles in `index.html`,**
    copied from `toggleTextBtn`. That is two controls styled inline now instead of one — M8 owns
    moving both into `src/styles.css`.

- **D18 (2026-09-16, revised 2026-09-21) — Lineart cells are classified as line or fill, from
  population means, rather than averaged.** Found in the human review of M2's steps 1–4: outlines
  beside a solid fill wash out. Measured on `test_img/R3.png` — 1556 px wide, so at the 100 × 100
  design target one cell spans ~15.6 source pixels and a 10 px line covers **~0.64 of a cell**,
  splitting roughly 0.40 / 0.24 when it straddles a boundary. The line never disappears; it becomes
  a large-minority mixture that the matcher correctly resolves to a bead far lighter than the line.
  Absorbed into M2 rather than deferred because R3's Check is [v1] and GEN-8 is M2's own stopping
  condition. **Five findings worth keeping:**
  - **Correct averaging costs line fidelity, and that is not an argument for reverting.** A black
    line over 0.64 of a byte-220 fill averages to **79** in gamma-encoded sRGB and **139** in linear
    light. The pre-M2 gamma-naive build preserved dark lines nearly twice as well *by being wrong*.
    Linear-light averaging lightens any mixture containing a dark minority; it is still correct for
    the gradients that are most of R3 and all of R4/R5.
  - **Neither `SUPERSAMPLE` nor reduction is a lever.** 0.64 is line width over source pixels per
    cell, and the supersample factor divides both, so it cancels. And setting the limit to the
    palette size with `MERGE_FLOOR = 0` did not bring the line back — that diagnostic ruled out
    Phase A and made a new downsampler unavoidable. Worth repeating as a method: two very
    differently priced causes, separated by one cheap A/B before any code was written.
  - **Reconstructing a cell from its two extreme pixels is wrong, and it took shipping to see.**
    The first version mixed the single darkest and single lightest pixel by an S-curve on coverage.
    The review found beads coloured unlike anything in the source — a green B25 on a face among
    correct skin tones, a saturated G20 inside muted G7 regions. Both are one mechanism: the
    extremes of ~64 samples are *tail values*, and at the ends of the curve a cell collapsed onto
    essentially one of them, which is the point sampling GEN-4 exists to remove, aimed at the least
    representative pixel available. Luminance selection is hue-biased too (green carries 0.7152 of
    Y, so a chroma-fringe pixel reliably won the light slot). **B25 `#4E846D` has G > R while every
    tone on that face has R > G > B, and a convex combination cannot reverse channel ordering** —
    which is what proved the cell's colour came from one pixel rather than from its content. The fix
    is population means: split the cell at its own mean luminance and use the mean of each side. One
    pixel in sixteen now moves a cell by under 0.05 in OkLab, down from 0.187.
  - **Classify, do not blend.** The S-curve left cells holding part of a line reading as grey. A
    cell is now line or fill with nothing between, and — the part that removes the grey — a fill
    cell returns its *light* population rather than the plain mean, so the line's pixels are
    excluded entirely. Accepted cost: a line too thin to reach the coverage threshold in any cell
    vanishes outright instead of surviving as a tint.
  - **Threshold in perceptual lightness, not linear light.** The contrast gate shipped measuring
    `Y_mean − Y_dark` in linear light, and dark regions came back jagged. An identical 30-byte step
    spans 0.0091 in shadow to 0.1036 in highlight — an 11.4× swing for the same visible step — and,
    decisively, a dark shadow edge carried *more* linear contrast (0.0221) than a genuine dark
    outline (0.0195), so in that space no threshold could even order them. Measured on `cbrt(Y)` the
    swing is 1.74× and the ordering is correct. This is the third time M2 was caught by a
    gamma-space confusion; see "Why gamma appears three times" in the milestone plan.

  **Not closed.** Lines outscore shading by only ~1.35× at the same tone and the bands overlap
  across tones, so the three constants in `DEFAULT_CONTRAST_TUNING` are a real tuning surface, not
  settled values. GEN-8 stays unticked for this. GEN-6's `ACTIVE_DOWNSAMPLER` is what makes a
  better downsampler cheap to try later — a two-pass estimator was swapped in mid-milestone through
  exactly that seam, with no edit outside the module.

- **D17 (2026-09-15) — Color reduction merges by perceptual cost, not by frequency, and runs even
  when the pattern is already within the limit.** GEN-3 was originally worded "keep the most-used
  colors and remap the rest to their nearest kept color." Planning M2 against the R1–R6 images
  — already committed in `test_img/`, so this is measured against the actual review, not a
  hypothetical — showed frequency ranking failing two of them in opposite directions, and failing
  a third by never running at all. Reduction is therefore a greedy merge that repeatedly removes the
  color with the lowest `count × ΔE_oklab to nearest survivor`, with a second stopping rule on ΔE
  alone. GEN-3's statement moves with it. **Four consequences recorded deliberately:**
  - **Frequency keeps the wrong colors at the top.** R2's pass condition is that a white canvas
    comes out as *one* color, never speckled into several near-whites. Those near-whites are the
    most frequent colors in the image, so ranking by count keeps every one of them — frequency
    ranking is not merely unhelpful for R2, it actively protects the exact colors R2 fails on.
    Cost ranking merges them first, because the ΔE between them is nearly zero.
  - **Frequency drops the wrong colors at the bottom.** R4 requires a dog's eyes to survive. Eye
    highlights might be forty beads out of ten thousand, ranking far below the limit, and get
    remapped to whatever kept color is nearest — possibly not near at all. Cost ranking gives a
    rare color that sits far from every other color a *high* cost, so isolation protects it. This is
    the property frequency cannot express: it knows how much of a color there is, but not whether
    anything else can stand in for it.
  - **Reduction firing only at the limit leaves R2 unaddressed regardless.** A flat drawing often
    yields fewer than thirty distinct colors, so a limit-triggered pass never runs and the speckle
    survives untouched. Hence the ΔE floor: the same merge loop, with a second stopping condition
    that collapses near-duplicates independent of the count. `MERGE_FLOOR = 0` reduces the behavior
    to pure limit-based reduction, so the two are one mechanism rather than two code paths.
  - **The cost is one more tuning constant inside a timeboxed milestone.** `MERGE_FLOOR` is a
    judgment call, not a measurement — the same species as `MIN_CODE_FONT_PX` (M1) and the two
    guide pitch thresholds (M10), and handled the same way: one constant, in one file, covered by
    tests that assert the behavior rather than the number. Calibrate it against R1, R2 and R6 during
    the review and then stop.

  **A clustering approach was considered and declined.** k-means over the cell colors in OkLab,
  snapping each centroid to its nearest palette entry, would beat greedy merge on R4 and R5. It
  needs deliberate seeding to satisfy GEN-7's determinism, it is slower, and it is a second
  open-ended tuning surface inside the milestone whose named risk is an endless tuning loop. GEN-6
  exists precisely so it can be tried later as an alternative matcher without disturbing the UI.
  Recorded here so that reopening it is a logged decision, per the rule D16 set.

  **Shipped in M2 (2026-09-21)** as `src/pipeline/reduce.ts`, two phases behind one merge loop, with
  `MERGE_FLOOR` at 0.02. One thing the implementation taught that the decision did not anticipate:
  the isolation-protects-rare-colors property is double-edged. It did what D17 wanted, but it also
  protected the D18 color specks — a wrong bead that sits far from every other color is exactly the
  shape D17 defends. Reduction therefore cannot be a safety net for upstream color errors, which is
  what made the speck fix unavoidable rather than tunable.

- **D19 (2026-09-21) — Undo/redo and flood fill move into v1, reversing D7.** Reopened deliberately
  before M5 started, which is the process `plan-v1.md`'s scope-creep row asks for: each deferral is
  a logged decision, so reopening one is too. D7's two claims are separated — "fill needs undo"
  is kept and is why the two move together; "a one-cell brush is self-correcting" is discarded.
  (EDIT-6, EDIT-7, EDIT-8, M5)

  **Four consequences recorded deliberately:**
  - **D7's premise was already false, and not because of M2.** EDIT-1's Check requires dragging to
    paint a continuous run, so the brush is multi-cell as specified. More importantly the state an
    edit destroys is **generated, not authored**: the overwritten cell held a bead chosen by
    `reduce.ts` out of 221 colors. "Paint it again" works in a paint program because you know what
    you drew; here, on R3/R4/R5 shaded regions — bands of near-neighbours — the user cannot
    reconstruct it by eye. This is the argument, and it does not depend on M2's results at all.
  - **The strongest case for fill is D13, not M2's defects.** Being precise about the mapping, since
    the milestone will be judged on it: M2's open GEN-8 item (dark regions banding) is diffuse
    quality across a whole shaded region, and **no editor tool realistically fixes it** — nobody
    hand-repaints a gradient; that stays a `DEFAULT_CONTRAST_TUNING` question or an accepted one.
    Q10 is helped by undo, not by fill. What fill serves is the white-canvas background (S1, the
    majority input, and the deferral D13 calls most likely to bite): one click instead of erasing
    200+ cells. It works *because* GEN-3 Phase A makes that canvas one color, which is R2's own
    pass condition — so R2 passing is what makes fill cheap.
  - **Redo costs nothing the data does not already carry, and the real cost was misjudged as UI.**
    A record is `{index, prev, next}`: undo writes `prev`, redo writes `next`, same array. The cost
    that was briefly assumed — no room in the control bar, citing D16's note — does not survive
    looking at the markup. That note was about adding one checkbox to one nowrap flex row; the
    editor gets its own bar, which is a sibling `<div>` and hidden until edit mode the way
    `.zoom-controls` is already hidden until a pattern exists. So **redo ships with a visible
    button.** What is real is that the new bar needs `flex-wrap: wrap` to hold 44 px targets (UI-6)
    at 390 px, which `.zoom-controls` does not have.
  - **Two refusals, to keep this from becoming M2.** **No fill tolerance:** a tolerance value is a
    judgment constant, and `MERGE_FLOOR`, `MIN_CODE_FONT_PX` and `DEFAULT_CONTRAST_TUNING` are three
    standing demonstrations of what those cost here. Exact palette match only; a speckled background
    is an upstream R2/GEN-3 defect. **No history in autosave:** SAVE-1 is pattern, settings and
    edits, not history, so M7's scope is unchanged. _(Held at M7 by D23, which widened the save to
    the source image but kept history out, and records the two further costs that confirm it.)_

  **The cost, stated plainly:** M5 goes from M to a large M, on the critical path (M5 → M6). The
  bound that keeps it there is that every piece is small and testable — the history stack, the fill
  search, the drag interpolation and the tally arithmetic are all pure functions under NFR-4, and
  `Pattern` does not change, so M6 and M7 inherit nothing new.

- **D20 (2026-09-22) — Input failures are classified from the file's own bytes, before the decode.**
  Written in M3, and forced by one fact: **`img.onerror` carries no reason.** The event is empty, so
  every decode failure looks identical from the inside — a `.txt` renamed `.png`, a truncated JPEG,
  a HEIC and a genuinely damaged PNG all arrive as the same nothing. Specificity therefore cannot be
  extracted from the failure; it has to be decided *before* it, from evidence in the file.

  So `src/lib/image-file.ts` reads two byte windows — the first 64 KB and the last 64 bytes — and
  answers three questions the decoder cannot: what container is this (magic bytes, never the
  extension and never `file.type`, both of which are just the operating system's extension mapping
  and are wrong exactly when it matters), is it complete (end markers and self-declared lengths),
  and how big is it (header dimensions, so IN-6 costs no decode at all). It is pure and testable in
  Node under NFR-4; `src/upload.ts` keeps only the browser half — two slices, then a decode through
  an object URL.

  **Three things this settled that are worth not relitigating:**
  - **Sniff to label, but still attempt the decode.** Only containers no `<img>` will ever turn into
    pixels are refused up front — PDF, zip, video, plain text, SVG. HEIC, AVIF and TIFF are
    *attempted*, and the sniffed label is held back and used to word the message only if the decode
    fails. This is what Q4's measurement demanded: Safari reads HEIC and Chrome does not, so a
    static allowlist is wrong on one of them whichever way it is written. The general form — *let
    the browser answer what only the browser knows, and keep our own answer for what it cannot say*
    — is the transferable part.
  - **Truncation needs its own check, because the decoder is lenient.** See IN-3. This was the one
    place the spec's Check was not reachable by the obvious implementation, and it was cheaper to
    find by predicting it than by trusting it.
  - **A header we cannot parse is not an error.** Every parser returns `null` rather than throwing or
    guessing — a JPEG whose frame header sits past the read window, an exotic BMP — and the
    post-decode `naturalWidth` check is the backstop. A `null` that costs one extra decode is much
    cheaper than a false rejection of a file that would have worked, and that asymmetry is what
    settled the tolerance of every check in this file.

  **Deliberately not done:** no decoder is bundled (Q4), and no preview is built — IN-1's remaining
  half is IN-5's, and M4 owns it. Building a placeholder here would be building it twice.

- **D21 (2026-09-22, narrowed the same day) — Cropping is one-shot per image; the size and colour
  settings are not.** Written for M4. The preview panel appears on a successful upload and is
  **hidden outright** on a successful generate — no summary row — and only a new upload brings it
  back. The crop rectangle is kept rather than cleared, so regenerating reuses the same framing.
  Target width, bead size and maximum colours **stay live throughout**: they can be changed and the
  pattern regenerated without re-uploading.

  **This was narrowed hours after it was written, and the original is worth recording because the
  reasoning that produced it was wrong in an instructive way.** As first written, the first Generate
  disabled *every* input and a "Start over" control was the only way back. The argument was
  consistency: target width and bead size regenerate exactly as a crop change would, so freezing one
  and not the others looked arbitrary. What that missed is that the two are not the same kind of
  thing to the person using it. Re-cropping after the fact is **messy** — the preview is gone, the
  pattern is what is on screen, and reopening a crop over an image you can no longer see invites
  fiddling with framing while looking at something else. Changing a width and pressing Generate
  again is not messy at all; it is the obvious way to try a different size. Freezing both to keep
  the rule tidy made the ordinary case worse in order to be consistent about the awkward one.
  Consistency was the wrong axis to reason on.

  **Why the preview closes at all.** A panel sitting between the controls and the canvas competes
  with the pattern for U3's "the pattern is the visual focus," and the stats line already reports
  the pattern's size, so a summary strip would be cost without content.

  **What the narrowing gives up, stated plainly so it is not discovered later.** A second Generate
  calls `setPattern`, replacing the `Pattern` object M5 mutates in place — every manual edit gone,
  no warning, no undo, since history is deliberately not persisted (D19). The frozen version closed
  that by accident rather than by design. **It is open again**, and it is not M4's to close: the
  honest fix is PAL-7's shape, a confirmation naming the loss, which is **[v2]** and palette-only.
  Recorded beside PAL-7 too, and given the same treatment as NFR-2's overrun and IN-6's ceiling —
  left for M9 to weigh rather than quietly patched here.

  **Two consequences at the edges, both found by using it rather than by reading it:**
  - **A new upload discards the pattern**, not just the crop. D21 was written saying a new upload
    "resets everything"; it did not — the old pattern stayed on the page below the fold, a
    conversion of an image no longer visible anywhere, looking current and belonging to nothing.
  - **A rejected upload changes nothing but the status line** — not the loaded image, not its crop,
    not this freeze, not the pattern. This revises M3, which cleared the loaded image and disabled
    Generate after a rejection. That was right when written and is not now: with no preview on
    screen the user could not tell which image was still loaded, so refusing to generate was the
    safe reading of an ambiguous state. IN-5's preview removes the ambiguity, and with it the
    reason; what was left was a failed action costing the user their image, their crop, and their
    way back to the preview.

  Recorded because it ticks no box: it satisfies no requirement, threatens neither Check M4 closes
  (IN-5's is about the state after upload; SET-3's says *before Generate is pressed*), and would
  otherwise ship as an unexplained behavior.

- **D22 (2026-09-24) — The export carries gridlines and edge numbers, and is a screen reference,
  not a print artifact.** Written for M6. Reverses the third bullet of D16, which deferred
  gridlines in the export to M6 rather than deciding against them. (OUT-1, OUT-3, OUT-6)

  **What ships:** gridlines every `GRID_INTERVAL` cells as the view's dark/light double rule, a
  frame just outside the cells, and column numbers across the top and row numbers down the left,
  in a margin *outside* the cells. **Not** a legend, the grid dimensions, or a title — those are
  OUT-5, **[v2]**. The margin is the thin end of OUT-5's wedge. Widening it is a logged decision,
  not a tweak.

  **Why the numbers ship with the lines,** for D16's own reason: uniform gridlines give local
  structure without absolute position. An image viewer has none of the app's sticky rulers, so
  once you zoom into the file, the numbers baked into it are the only answer to "where am I".
  **Why they sit outside the cells:** the on-screen rulers can cover beads because the view pans.
  A file cannot be panned, so a label over a cell would hide that cell's code for good.

  **Why the bar is the screen.** A large pattern cannot be printed legibly as one file. Fitted to a
  page, a 300-cell row is under 1 mm per cell. At true bead scale a cell is 2.6 mm (Mini) to 5 mm
  (Standard), too small for a readable code at Mini and many pages wide at either. So v1's
  promise is **every code readable when the file is zoomed in on a screen**. A printer scaling the
  PNG to the page is acceptable for small patterns and a known limitation for large ones.
  Splitting into page-sized files, zip delivery, print DPI and true-scale output were all
  considered and deferred with OUT-6, where the note on the cheaper first step lives.

  **Three consequences recorded deliberately:**
  - **"Fixed cell size" means fixed per pattern.** An oversized canvas does not throw — it
    encodes to nothing, the same reasonless failure as M3's `img.onerror` — so the size limit is
    respected before the draw. `EXPORT_MAX_PIXELS` is one budget for every browser, 4096², the
    reported iOS canvas cap. A per-browser value would make the same pattern a different file on
    different devices. The cell is the largest integer from 32 px down to an 18 px floor (a 7 px
    code glyph) that fits. The design target exports at 32 px, the hard limit at 18 px. OUT-3
    holds exactly, because the choice depends on the pattern's size and nothing else. Nothing
    generation can produce is refused today.
  - **The budget is measured in one browser only.** Headless Chrome passed every size to 16384²,
    but desktop Safari and a phone were not measured at M6. If either fails below 4096², only the
    constant moves. Recorded for M9 beside NFR-5, the same way NFR-2's overrun and IN-6's ceiling
    were.
  - **The export ignores the view's toggles.** Codes and gridlines are always drawn. A file whose
    contents depend on a checkbox the user may have forgotten is the opposite of OUT-3's
    "predictable", and OUT-1 says every cell.

- **D23 (2026-09-24) — Autosave keeps the pattern, its settings and its source image in IndexedDB;
  never the undo history.** Written for M7, before any code. (SAVE-1, SAVE-2)

  **The goal it is sized to:** surviving an accidental refresh or tab close. It is not an archive,
  and every choice below is measured against that.

  - **The image and crop are saved.** Without them a reload restores the pattern but leaves
    Generate disabled until a new upload, and by D21 a new upload discards the pattern. So the
    ordinary case D21 protects — regenerate at a different width — would not survive the refresh
    this exists for. The crop is four integers; the image is the uploaded `File`'s own bytes, so a
    HEIC stays HEIC and a restored image goes back through the same M3 gate as a fresh upload.
  - **Undo history is not saved** — D19's refusal, and two costs found while scoping M7 that
    confirm it. Its writes grow with every stroke (up to ~2.4 MB at `DEFAULT_CELL_BUDGET`). And
    `applyEdits` writes a record's `prev` without checking it, so a history restored against a
    pattern from a different moment would repaint cells wrongly rather than fail. A restored
    pattern opens with an empty stack.
  - **IndexedDB, not `localStorage`.** The image decides it: `localStorage` holds strings, so an
    image would be base64, a third larger, and an ordinary 4 MB phone photo would exceed the
    ~5 MB per-origin quota on its own. IndexedDB stores blobs directly, has a quota measured
    against the disk, and has transactions, which is how the image and the pattern are kept from
    disagreeing.
  - **The slot exists only while a pattern does, and mirrors the screen.** An upload alone saves
    nothing; the image is written with the pattern at Generate. Clearing the pattern deletes the
    slot, so after a new upload (which clears it, D21) a reload restores nothing rather than
    resurrecting a pattern the user watched disappear.
  - **The settings saved are the ones that produced the pattern**, captured at Generate — not the
    live inputs, which D21 leaves editable and which can therefore describe a pattern that was
    never generated. A restore writes them back into the inputs.
  - **One slot, last write wins across tabs.** No cross-tab sync or locking. SAVE-3 is the
    multi-project answer and is **[later]**.
  - **Eviction is accepted, not fought.** Safari deletes a site's script-writable storage after
    seven days without a visit, and any browser may evict under disk pressure. Neither threatens
    a refresh, so `navigator.storage.persist()` — which prompts in Firefox — is not requested.
  - **Failure degrades, it never blocks.** Storage that is missing, blocked or full leaves the app
    working exactly as it did before M7, with one message saying the pattern will not survive a
    reload. An image that cannot be restored still lets the pattern restore: the hand-edited
    pattern is what SAVE-1 exists for, and losing the image must not cost it.

- **D24 (2026-09-26) — The "Will generate" readout counts beads, not cells, and is shown only while
  it differs from the pattern on screen.** A bug fix against SET-3 as M4 shipped it, which got two
  things wrong.
  - **The total was `width × height`.** The pipeline leaves a cell empty when its mean coverage is
    under the GEN-1 alpha threshold, and the stats line counts only filled cells, so on any image
    with a transparent background the two numbers disagreed. The count cannot be computed once per
    image and scaled: whether an edge cell is empty depends on the grid, since the same edge can
    cover 60% of a cell at one width and 40% at another. So the readout runs the same
    `imageToPixels` call a generate makes, then `cellCoverage`, which is only the alpha half of the
    downsample. **It must equal the generated count exactly, not approximately**, because it is
    shown directly above the number it predicts. A cell whose coverage lands on the threshold
    decides differently on a one-ulp difference, so `cellCoverage` repeats the downsample's
    accumulation order line for line, and `generate.test.ts` pins the agreement at fractional
    scales. Cost measured in Chrome on a transparent 4000 × 3000 PNG at 254 × 191: within the two
    frames the measurement itself takes, so no drag-end fallback was needed. Refreshes are still
    batched to one per animation frame, because a crop drag fires more often than that.
  - **It stayed live after Generate**, on M4's reasoning that the settings do. The "Will generate:"
    label kept the two tenses distinct, but a line restating the stats line right after Generate
    was still noise. It is now hidden while the target width and bead size equal the settings that
    produced the pattern (held by `pattern-state.ts` since D23), and shown whenever they differ.
    Deriving this from state rather than tracking a flag through each handler handles a restore, a
    failed generate, and a width changed and changed back without special cases. **Maximum colours
    does not bring it back**, since it changes neither the size nor the count. SET-5's error is
    always shown, because settings over the limit cannot match a pattern that exists.
- **D25 (2026-09-26) — A bounded styling pass joins M8, after UI-1 … UI-6; UI-7 stays optional.**
  A demo is close, and a styled interface buys a large share of its impression for little work.
  D14 held all taste to v2 so it could not become an open-ended loop inside v1; this narrows that
  for one timeboxed pass, and does not reverse it.
  - **After the floor, not before or instead.** D14's own argument sets the order: tokenizing
    changes structure, styling changes values. Styled before UI-3, the look would be built from
    scattered literals and then tokenized; styled after, a direction is mostly edits in `:root`.
  - **Inside M8, not a v1.1 after M9.** M9 is what ticks UI-1 … UI-6. Restyling after it re-opens
    UI-5 (every color it measured) and re-checks UI-1 and UI-6 — the plan already calls reopening
    those after M9 "a regression rather than a task." Styled before M9, everything is verified
    once, on the version that is demoed.
  - **Bounds.** About half a day of work. Values and surfaces only: no element moves, no new
    components, no motion beyond existing transitions, no icon redraw, no dark mode. The canvas
    (`guide-style.ts`, `contrast.ts`) and the PNG export are untouched, so OUT-3's byte-identical
    export cannot drift because a page token moved. The U1–U5 review and its stopping rule decide
    when the pass is done. M8's floor is committed first, and if the demo is too close the pass is
    skipped outright.
  - **UI-7 is not promoted to a v1 obligation.** M9 does not require it. If U1–U5 pass inside the
    timebox, UI-7 is ticked; if the timebox ends first, the pass stops where it is and UI-7 stays
    [v2] with whatever landed as its starting point.
  - **The direction, chosen before styling rather than while.** Title in **Jersey 10**, all other
    text in **Pixelify Sans**; the indigo accent and the existing flat-surface treatment are kept.
    Press Start 2P was considered for the title and rejected on width: its glyphs are a full em,
    so "Pattern Generator" at title size needs about 540 px against the ~326 px a 390 px viewport
    leaves (UI-1). Both fonts are **self-hosted** in `src/assets/fonts/` as Latin-subset `woff2`
    with their OFL licenses, not linked from Google Fonts, so the page's look never depends on a
    third-party request (NFR-1's spirit, and an offline demo). Pixelify Sans is the variable file
    (weights 400–700), so one file serves every weight the stylesheet uses; Jersey 10 has one
    weight and the title must set `font-weight: 400` rather than get a synthesized bold. **Only
    Jersey 10 snaps to a pixel grid**, measured from its outlines: one font pixel is 75 of its 1400
    units (cap height exactly 10 of them), so it is crisp at multiples of 18.67 px — 37.33 px is two
    screen pixels per font pixel, the natural title size. Pixelify Sans is pixel-*styled*, not
    grid-bound: its rows sit on a ~90.4-unit step with a −12 offset, so no font size aligns it to
    whole pixels, and its sizes are chosen for legibility. UI-3's type scale therefore stays in rem
    (it respects the user's font-size setting), and only the title gets a px value, in Step 6.
    **Bead codes stay monospace**, since `P17` against `P11` is data that has to be unambiguous.
  - **A banner is planned but is not part of this pass.** It may replace the title visually, which
    is a layout change, so it is its own step after the U1–U5 review with its own UI-1/UI-6
    re-check. The `<h1>` stays in the markup as the page's heading, visually hidden with `.sr-only`
    if the banner replaces it. Jersey 10 is applied to the title alone for the same reason: if the
    banner makes it unused, removing it is one `@font-face` and one token.
