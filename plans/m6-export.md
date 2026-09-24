# M6 — PNG export

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M6 closes,
delete it and point `CLAUDE.md` at the next one._

**Milestone goal (`plan-v1.md` M6):** render the current pattern to an image at a fixed cell size
independent of screen zoom, with codes on every cell and gridlines visible, and download it.

**Closes:** OUT-1, OUT-2, OUT-3 — and possibly **GEN-5**, see step 6. **Origin:** D9 (v1 export is
a PNG with codes baked into every cell). **A new decision, D22, is written in step 0** — the
gridline clause in M6's Do contradicts D16 as it currently reads.

---

## What changed since `plan-v1.md` was written

M6's paragraph dates from 2026-09-07. Five milestones have closed since, and four things they left
behind shape this one.

- **Gridlines are now in scope, and D16 says otherwise.** D16's third bullet reads "The export stays
  deferred. Gridlines baked into the exported PNG remain out of v1 … and M6 decides." The edit to
  M6's Do ("and gridlines visible") *is* that decision — but it is currently recorded nowhere except
  a one-line diff to `plan-v1.md`. Step 0 writes it down before any code does, the same rule D16
  itself set for reopening a deferral.
- **The geometry already exists.** `src/lib/guides.ts` was written in M10 with M6 named as its
  second consumer. `gridlineIndices` over the full range `{start: 0, end: width - 1}` is the export's
  gridline list, unchanged. Reuse it; don't write a second one.
- **OUT-2 is free.** `pattern-state.ts` owns the live `Pattern`, and every edit mutates that object
  in place. Export reads `getPatternState()` at click time and draws what is there. No subscription,
  no copy, no edit awareness.
- **`Pattern` is still the contract.** M5 and M4 both left it unchanged. M6 must too — M7 serializes
  exactly this shape next.

---

## Ground rules

- **The export is a pure function of the `Pattern`.** Nothing from the view reaches it: not
  `cellSize`, not scroll offsets, not `devicePixelRatio`, not the Show Codes or Grid checkboxes.
  OUT-3's Check (pixel-identical at two zoom levels) is then true by construction rather than by
  care, and the layout function's signature is what enforces it — it takes no argument a zoom
  could arrive through.
- **The toggles are ignored on purpose.** OUT-1 says codes on *every* cell, and M6's Do says
  gridlines *visible*; a file whose contents depend on a checkbox the user may have forgotten is the
  opposite of OUT-3's "predictable". The on-screen toggles are about the screen.
- **No `devicePixelRatio` anywhere in the export.** One export pixel is one image pixel. Applying
  dpr would make the file differ between a laptop and an external monitor, and between browser zoom
  levels — which is a zoom level, and OUT-3's Check would catch it.
- **Deterministic geometry is pure and tested** (NFR-4): sizing, cell rectangles, margins, font
  size, gridline and label positions go in `src/lib/export-layout.ts`, DOM-free. The canvas calls,
  `toBlob` and the download live in `src/render/export-png.ts`, which decides nothing.
- **Integer everything.** The export cell size is an integer, so every cell edge lands on a pixel
  and adjacent cells share an edge exactly. The view needs `Math.round` on both edges because its
  cell size is fractional; the export should need none. This is also most of GEN-5.
- **CSS: raw literals fine**, 8-space indent, as M4 and M5 did. UI-3 tokenizes in M8.

---

## Steps

### 0. Record D22 before writing code

In `specs.md`:

- **D22 — Gridlines ship in the export, with edge numbers in a margin.** Reverses the third bullet
  of D16. Reasoning to record: D16 deferred the export to M6 rather than deciding against it, and
  its own argument for pairing gridlines with numbers ("uniform lines give local structure without
  absolute position") applies just as much to a downloaded image. An image viewer has none of the
  app's sticky rulers, so once you zoom into the file, "where am I" is answered by the numbers
  baked into it or not at all.
- **The export is a screen reference, not a print artifact.** v1's legibility bar is: *every code
  is readable when the file is zoomed in on a screen.* Record the reasoning in D22 so it is not
  relitigated: printing a large pattern legibly is not reachable with one file. Fitted to a page, a
  300-cell row is under 1 mm per cell. At true bead scale a code is ~2.6 mm (Mini) to 5 mm
  (Standard) wide, which is too small to read at Mini and needs many pages at either. A printer
  scales the PNG to the paper on its own, and that is acceptable for small patterns and a known
  limitation for large ones.
- **Printing large patterns is deferred past v1.** Splitting a pattern into several page-sized
  files (with numbering in whole-pattern coordinates), zip delivery, and embedding a print DPI
  were all considered and deferred. Add a note to OUT-6 that
  splitting into multiple PNGs is a cheaper first step than the PDF, and that its hard part is
  delivering many files (a zip), not the geometry.
- **Scope line:** gridlines every `GRID_INTERVAL` cells plus a frame, column numbers along the top
  and row numbers down the left, in a margin *outside* the cells. **Not** a legend, not the grid
  dimensions, not a title — those are OUT-5 and stay **[v2]**. The margin is the thin end of OUT-5's
  wedge; say so in the entry so widening it later is a logged decision.
- Annotate D16's third bullet with a pointer to D22 (don't rewrite it — the file keeps history
  inline, as D15 and D21 do).
- Add a parenthetical to OUT-1 noting that gridlines and edge numbers are included per D22, and
  that its Check's "legible at 100% zoom in an image viewer" is read as *legible when zoomed in on a
  screen*. The Check's wording currently asks for more than D22 promises. Annotate it rather than
  quietly testing something different from what it says.

> **Decided (2026-09-24):** edge numbers ship, and they go in a margin *outside* the cells, never
> over them. The on-screen rulers can cover beads because you can pan them out of the way. A file
> cannot be panned, so a label drawn over a cell would hide that cell's code for good. Record this
> in D22.

**Done when:** D22 exists, D16 and OUT-1 point at it. No code yet.

### 1. Spike: measure the canvas size ceiling — before choosing a cell size

**This is the milestone's one real unknown, and it has the same shape as M3's.** A canvas that is
too large does not throw. Depending on the browser it silently draws nothing, or `toBlob` calls
back with `null`, or the tab is killed for memory. Like `img.onerror`, the failure carries no
reason — so the limit has to be respected *before* the draw, not detected after it.

The numbers that make it real:

| Pattern | Cells | At 32 px/cell | Pixels |
|---|---|---|---|
| NFR-3 design target, 100 × 100 | 10,000 | 3,200 × 3,200 | ~10.2 M |
| NFR-3 hard limit, e.g. 300 × 166 | ~50,000 | 9,600 × 5,312 | ~51 M |
| NFR-3 hard limit, at 18 px/cell | ~50,000 | 5,400 × 2,988 | ~16.1 M |

**The screen-only bar (step 0) is what makes a smaller cell acceptable.** The file is read by
zooming into it in a viewer, and zooming magnifies pixels. So the question is not "how big is the
code at 100%" but "does the code have enough pixels to be recognizable once magnified". That puts
the floor at a minimum *glyph height in image pixels*, well below 32 px cells — which is what gives
the phone ceiling a chance of admitting the hard limit at all.

iOS Safari is widely reported to cap canvas area around 16.7 M pixels (4096²), and NFR-5 puts a
phone in scope. Desktop Chrome and Firefox go much higher. **Don't take any of those numbers on
trust — measure them**, the way M3 measured HEIC rather than assuming it:

- A throwaway page (not committed) that fills a canvas of N × N, calls `toBlob`, and reports
  whether the blob is non-null and whether a corner pixel read back correctly. Step N up.
- Run it in desktop Chrome, desktop Safari, and the phone browser.
- Record the largest safe area per browser in this file, under a "Measured" note.

Then pick the policy, in this order of preference:

1. **One fixed cell size that fits everywhere** — if the phone's ceiling admits the hard limit at a
   legible cell size. Unlikely, per the table.
2. **Fixed cell size, deterministic step-down.** `EXPORT_CELL_PX` (≈32) is the preference; if the
   export would exceed `EXPORT_MAX_PIXELS`, step down a short ladder of integer sizes until it fits.
   The chosen size depends only on the pattern's width and height, so OUT-3 still holds exactly —
   "predictable" means the same pattern always gives the same file, not that every pattern gets the
   same cell. A floor at the legibility minimum (see step 2), below which the export refuses.
3. **Refuse with a message naming the reason** for anything under the floor. A PNG whose codes
   nobody can read fails OUT-1 anyway; a clear refusal is better than an illegible file or a silent
   blank one.

`EXPORT_MAX_PIXELS` is one conservative constant for all browsers, not a per-browser sniff —
sniffing makes the same pattern produce different files on different devices, and the phone number
is the one that binds. It is a judgment constant in the `MERGE_FLOOR` family: tests assert the
budget is respected, never the number.

If the measurement shows the phone cannot export the hard limit legibly at any size, **that is a
finding, not a bug to engineer around in M6** — record it against NFR-3 for M9, as M2 did with
NFR-2 and M3 did with IN-6's ceiling. Splitting into several files would lift it, and step 0
deferred that past v1 with OUT-6. Don't pull it back in here.

**Done when:** the limits are measured and written here, and the policy is chosen. Delete the
spike page.

> **Measured (2026-09-24).**
> - **Headless Chrome 154, macOS:** every size tried succeeded, up to **16384 × 16384 (268 M
>   pixels)** and 32768 × 1. The far-corner pixel read back correctly and `toBlob` returned a valid
>   PNG each time.
> - **Desktop Safari: not measured.** WebDriver needs "Allow remote automation" in Safari's Develop
>   settings, which was left for the user to turn on.
> - **Phone: not measured.**
> - The spike page is kept outside the repo at `/tmp/m6-spike/index.html` so it can be opened in
>   both.
>
> **Policy chosen: option 2.** One budget, `EXPORT_MAX_PIXELS` = 4096² (the reported iOS cap,
> unverified). The cell is the largest integer from 32 px down to the legibility floor (18 px) that
> fits.
> - The design target, 100 × 100, exports at 32 px: a 3260 × 3240 image.
> - The hard limit, 272 × 182 (49,504 cells), exports at 18 px: a 4956 × 3316 image (16.4 M
>   pixels), with codes still readable when magnified.
> - Nothing that generation can produce is refused under the current NFR-3 limits. The refusal path
>   exists for PAL-6 palettes with long codes, and for NFR-3 ever rising.
>
> If Safari or the phone turns out to fail below 4096², only the constant moves.

### 2. `src/lib/export-layout.ts` — the geometry, pure and tested

```ts
interface ExportLayout {
    cellSize: number;          // integer px
    marginLeft: number;        // row-number band, outside the cells
    marginTop: number;         // column-number band
    width: number;             // whole image, px
    height: number;
    codeFontPx: number;
    gridlines: { cols: number[]; rows: number[] };  // boundary indices
    labels:    { cols: number[]; rows: number[] };  // which boundaries get a number
}

function exportLayout(patternWidth: number, patternHeight: number, codeWidthPx?: …): ExportLayout
function exportCellRect(col: number, row: number, layout: ExportLayout): { x, y, w, h }
```

- **The signature is the OUT-3 guarantee.** Two integers in, a layout out. There is no parameter a
  zoom level or a dpr could arrive through, so no test is needed to prove the independence — but
  write one that calls it twice and deep-compares anyway, because it is the Check.
- **Gridlines come from `gridlineIndices`**, over `{start: 0, end: width - 1}`. That returns
  boundary 0 and every tenth, and includes the far edge only when the width is a multiple of 10.
  **Add the frame explicitly** — both far edges, always. Against a white viewer background an
  unframed pattern has no edge when its last column is white.
- **Labels every `GRID_INTERVAL`**, not `rulerLabelStep`. That function thins labels by *screen*
  pitch; at a fixed ≥ 18 px cell the pitch is ≥ 180 px and never needs thinning. Using it anyway
  would be harmless but would suggest the export depends on a zoom.
- **Margin sized to the widest number the pattern prints** — the view's `drawRulers` already
  measures `String(pattern.height)` for exactly this; the pure module takes the measured width as an
  argument rather than measuring text itself (text measurement is a canvas call).
- **Code font.** The view's `CODE_FONT_RATIO` is 1/3, and it wastes pixels here: in the view you
  zoom until the code is readable, but in the file the code's pixel count is fixed at export. So the
  export uses a larger ratio. The default palette's codes are at most three characters (checked
  against `public/colors_221.json`), so ~0.4 of the cell in bold monospace fits inside the view's
  `0.86` width cap. Keep the view's shrink-to-fit rule for longer PAL-6 codes: the renderer
  measures the widest code, and the layout scales the font.
- **The legibility floor** is a minimum code glyph height in *image pixels*: the smallest size at
  which `A1`–style bold monospace stays recognizable when a viewer magnifies it. It is not a
  physical size, because the bar is screen-only (step 0). Give it its own constant and don't reuse
  the view's 6 px: that one decides when to *hide* codes, and this one decides whether a file is
  worth producing. Find its value by eye in step 6 (export a pattern at each candidate size and zoom
  in), then derive the cell floor from it, the way `MIN_CODE_CELL_SIZE_PX` is derived in
  `viewport.ts`.
- **Step-down and refusal from step 1** live here, as a pure function of width and height.

Tests (`export-layout.test.ts`): identical output for identical input; every cell rect has integer
edges and neighbours share an edge with no gap and no overlap; the image never exceeds
`EXPORT_MAX_PIXELS`; step-down picks the largest size that fits; below the floor it refuses (a
distinct result, not a throw the UI has to string-match); gridlines include 0 and both far edges;
a 1 × 1 and a 300 × 1 pattern lay out without degenerate margins; **no cell rect intrudes into
either margin**, so a label can never sit on a bead. Assert behavior, never the
constants.

**Done when:** `npm run check` green with the new tests.

### 3. `src/render/export-png.ts` — draw, encode, download

One exported function, `exportPatternPng(pattern): Promise<void>`, holding no decisions:

1. `exportLayout(...)`; if it refused, throw an error carrying a `reason`, like `UploadError`, so
   `main.ts` does not match on strings.
2. A **detached** `<canvas>` sized to the layout — never inserted into the document, never
   `devicePixelRatio`-scaled, no `setTransform`. Plain `HTMLCanvasElement` rather than
   `OffscreenCanvas`: older Safari lacks `OffscreenCanvas` 2D, and nothing here is off-thread.
3. **Background:** opaque white. See the empty-cell note below.
4. **Cells:** `fillRect` per non-empty cell at its integer rect. No `Math.round` — if one is
   needed, the layout is wrong.
5. **Codes on every non-empty cell**, colour from `getContrastColor` — `src/contrast.ts` already
   says M6 is its second consumer. The show-codes checkbox is not read.
6. **Gridlines**, then the **frame**, then the **edge numbers** in the margin. For visual parity with
   the screen, reuse the view's dark/light double rule. Those two colours are currently private
   constants in `canvas-view.ts`; **lift them into a tiny `src/render/guide-style.ts`** rather than
   importing from `canvas-view.ts`, which runs `requireElement` at module load and has no business
   being a dependency of the export.
7. `canvas.toBlob(cb, 'image/png')`. **A `null` blob is the silent-failure case from step 1** —
   treat it as an error with its own reason, never as "nothing to do".
8. Download: `URL.createObjectURL(blob)`, a temporary `<a download="…">`, `click()`, then
   `revokeObjectURL`. Object URL, not a data URL — the same reasoning `upload.ts` records: a data URL
   base64s the whole file into a string.
9. Release the canvas (`width = height = 0`) when done. iOS counts canvas memory against the tab
   until the element is collected, and a 16 M-pixel canvas is ~64 MB.

**Empty cells.** The view leaves them transparent, reading as holes. In a file, transparency shows
as a checkerboard in some viewers and black in others. So the export paints an opaque background
and leaves empty cells as that background with **no code**. A white bead and an empty cell are
still distinguishable, because the white bead carries its code. If that reads ambiguously once
zoomed in, a pale neutral fill for empty cells is a one-constant change; start with white and judge
it in a viewer.

**Filename:** `perler-<width>x<height>.png`. Enough to tell two exports apart; a timestamp would
make OUT-3's comparison awkward and a title is OUT-5.

**Done when:** calling it from the dev console on a generated pattern downloads a PNG that opens.

### 4. The control

- A `#exportBtn` "Download PNG" button, hidden until a pattern exists — a `pattern-state`
  subscriber (`set` → shown, `cleared` → hidden), the same lifecycle the zoom row and editor bar
  have. Wire it in `main.ts` alongside the other listeners.
- **Below the canvas, not above it.** The space over the canvas already holds the stats line, the
  zoom row and the editor bar, and `.zoom-controls` overflows at 390 px and does not wrap (recorded
  under M8). The button sits between the pattern and the bead list. It was first placed beside
  `#stats` and moved on review (2026-09-24), because the area over the canvas was too crowded. M8
  owns the final placement.
- Disabled while an export runs, with "Exporting…" in the status line and a result message after —
  at the hard limit the encode is not instant (measure it in step 6). The refusal from step 1 goes
  through the same status line, naming the reason.
- A 44 × 44 target (UI-6) and a real `<button>`, so M8 inherits nothing to fix.

**Done when:** the button appears with a pattern, disappears on a new upload, and downloads.

### 5. Don't break the view

Lifting the rule colours into `guide-style.ts` is the one change to existing rendering code.
Confirm the on-screen gridlines are unchanged at fit and at maximum zoom. Nothing else in
`canvas-view.ts` should move.

### 6. Verification — in a real browser, since every Check here is a file

Driven against `npm run dev`, as M3–M5 were:

- **OUT-1, valid PNG:** `file perler-*.png` reports PNG image data; it opens in Preview and in a
  browser tab.
- **OUT-1, legible codes:** a pattern containing both the darkest and lightest palette colours
  (generate from a test image, or paint them in), opened in an image viewer and zoomed in on the
  screen. Every non-empty cell shows a readable code. Do this at the **smallest cell size the
  step-down can pick**, not only at 32 px, because that is where the floor is either right or not.
  This is also where the floor's value gets set (step 2). OUT-1's Check says "at 100% zoom". Per
  D22, the v1 bar is "zoomed in on a screen", so record which one was run.
  Printing is not checked (D22).
- **OUT-2:** paint a cell, export, and find that cell's colour and code in the file. Then undo,
  export again, and confirm it reverted — undo mutates the same object, and this proves it.
- **OUT-3, pixel-identical:** export at fit zoom and at maximum zoom; `shasum` both files. Then make
  the check strictly harder than the spec's: export again after a browser zoom change (a different
  `devicePixelRatio`) and with both view checkboxes off. All hashes equal. If PNG encoding turns out
  to vary byte-wise for identical pixels, fall back to comparing decoded pixels, and note it.
- **GEN-5, possibly ticked here:** its Check asks for a hard edge "in the rendered pattern and in
  the exported PNG". Read back the pixels across a non-gridline cell boundary with a small script —
  exactly two colours. (Gridline boundaries carry the rule by design; D22 should say the Check
  applies between gridlines.) If the view half holds too, tick GEN-5, the way M4 ticked what it had
  made checkable.
- **Size limits:** export the 100 × 100 design target and the hard limit on desktop and on the
  phone. Record time to download and file size here. On the phone, confirm either a correct file or
  the refusal message — never a blank or truncated image.
- **SAVE-2, partially:** with the network disabled after load, export still works and the network
  log is empty. SAVE-2 stays unticked until M7 (its Check includes autosave), but its export clause
  is evidence M9 can reuse.
- **Around the thing just built** — M4's lesson: after an export, the pattern, the editor, undo
  history and the view are all exactly as they were. Export a pattern, then upload a new image —
  the button hides, and a second export is not possible against the discarded pattern.

---

## Closing M6

- Tick OUT-1, OUT-2, OUT-3 in `specs.md` (and GEN-5 if step 6 earned it), each with a one-line note
  of how its Check was run.
- Write M6's **Delivered** block in `plan-v1.md`: what shipped, the measured canvas ceilings and the
  policy chosen from them, anything recorded for M9.
- Update the critical-path paragraph: M6 closes the critical path; M7 is next.
- Update `CLAUDE.md`'s summary and Layout (`export-layout.ts`, `export-png.ts`, `guide-style.ts`).
- Delete this file and move the tactical-plan pointer in `CLAUDE.md` and `plan-v1.md` to
  `plans/m7-autosave.md`, to be written the day M7 starts.

## Out of scope — say no if it comes up

- A legend, the grid dimensions, or a title in the image — OUT-5, **[v2]**.
- Pagination, pegboard-sized sections, PDF — OUT-6 / D9.
- A user-chosen export cell size or DPI. OUT-3's point is that the size is not a choice.
- Tiling past the canvas ceiling, or a hand-written PNG encoder — record the ceiling for M9 instead.
- Anything aimed at printing: splitting into page-sized files, zip delivery, print DPI metadata,
  true-scale output. Deferred past v1 by D22, and noted on OUT-6. A printer scaling the single PNG
  to the page is the v1 behavior.
- Per-cell hairlines on every boundary. They are what printed bead patterns often use, but they put
  a third colour on every cell edge, which GEN-5's Check forbids. Every-tenth gridlines only.
