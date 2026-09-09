# M1 — Canvas pattern view

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M1 closes,
delete it and point `claude.md` at the next one._

**Milestone goal (`plan-v1.md` M1):** replace the element-per-bead grid with canvas rendering.
Zoom and pan by redrawing rather than CSS scaling. Draw bead codes onto cells, keep the on/off
toggle, and hide code text automatically when cells get too small to read.

**Closes:** VIEW-1, VIEW-2, VIEW-3, VIEW-5. Preserves VIEW-4. Enables all of EDIT (D1).

---

## Ground rules

- **Every step leaves the app working** — the rule `plan-v1.md`'s Milestones preamble sets for
  milestones, applied one level down. No step may end with a pattern that
  won't render. One step ≈ one commit.
- **`npm run check` stays green at every step.** Canvas drawing itself isn't unit-testable without
  a browser, so the deterministic parts — coordinate math, level-of-detail threshold, zoom
  clamping — go in `src/lib/` or `src/render/` as pure functions with tests (NFR-4). Anything
  touching `CanvasRenderingContext2D` stays out of those pure modules.
- **`Pattern` is the contract and does not change** (`src/types.ts`). M1 renders it; M5 edits it;
  M6 exports it. If M1 feels like it needs to change `Pattern`, stop and reconsider.
- **VIEW-6 (gridlines every 10 cells) is [v2].** Do not build it. Do not "leave a hook" for it.
- **No editing.** The brush, eraser, and picker are M5. M1 stops at the coordinate mapping M5 will
  need (step 3).

## Size targets

NFR-3 caps the pattern at **500 beads per side and 100,000 cells** (largest square 316 × 316).
VIEW-1's Check is **300 × 300 rendering and panning smoothly**, so use 300 × 300 as the working
test case and 500 × 200 as the non-square case.

---

## Steps

### 1. Draw the pattern to a canvas at fixed scale

Replace `src/render/dom-grid.ts` with `src/render/canvas-view.ts`. Draw one filled rect per cell at
a fixed cell size; skip `null` cells so they read as empty (GEN-1). No zoom, no pan, no codes yet —
the zoom buttons and the code toggle can go inert for this one step, but the app must still
generate and display a pattern.

Delete `dom-grid.ts` in this step rather than leaving it beside the new file. It is marked
**M0-only** in `claude.md` precisely so this deletion is uncontroversial.

Also remove the now-dead CSS: `#grid-wrapper`, `#pattern-grid`, `.pixel`, and
`#pattern-grid.hide-text .pixel` (`src/styles.css:102`, `:107`, `:115`, `:186`). Keep
`.output-container` and `.zoom-controls`.

**Touches:** `src/render/canvas-view.ts` (new), `src/render/dom-grid.ts` (deleted), `src/main.ts`
(imports), `src/styles.css`, `index.html` if the container markup changes.

**Done when:** A 300 × 300 pattern renders as colored cells on a canvas, empty cells show as empty,
and the bead inventory is unchanged. `npm run check` green.

> **Watch:** this is the step that changes the DOM contract between `index.html` and `src/`. If an
> element ID drifts, the boot guard reports `Missing required element: #...` in the status line
> rather than hanging — that message is the fast path to the fix, so read it before digging.

---

### 2. Zoom by redraw, viewport center fixed

Zoom changes the cell size and triggers a full redraw. It must **not** use a CSS transform — that
is exactly what D1 rules out.

VIEW-2's Check sets both ends: at maximum zoom cells and codes are comfortably readable; at minimum
zoom the whole pattern fits the viewport. Derive the minimum from the pattern and container size
rather than hardcoding it, so a 500-wide pattern can still zoom out to fit.

Keep the zoom math pure and tested: given current scale, container size, scroll offset, and a new
scale, return the new scroll offset that holds the viewport center fixed. That function belongs in
a testable module; the canvas call sites do not.

**Done when:** Zooming in and out holds the center point; minimum zoom fits a 300 × 300 pattern
entirely; maximum zoom is comfortably readable. Zoom math has unit tests.

> **Watch:** `plan-v1.md` flags off-center zoom drift as a standard canvas pitfall. The old
> `applyZoom` in `dom-grid.ts` got this right conceptually (ratio of scroll position to scaled
> size, applied before and after) — that logic is worth reading before rewriting it, even though
> the file is deleted.

---

### 3. Pan by drag, and the cell coordinate mapping

Drag to pan. Add the screen-point → cell-index mapping here, as a pure tested function: given a
client point, the canvas rect, the current scale, and the scroll offset, return `{col, row}` or
`null` when outside the pattern.

M1 only needs this mapping to exist and be correct. **M5 is what consumes it** — this is the
seam that makes the editor a normal-sized milestone instead of a rewrite, which is why D1 calls
canvas a prerequisite for all of EDIT.

**Done when:** A 300 × 300 pattern pans smoothly by drag (VIEW-1's Check). The coordinate mapping
round-trips correctly at several zoom levels and returns `null` outside the pattern, under test.

> **Watch:** pan and the future brush both start with a mousedown on the canvas. Don't solve that
> conflict now — EDIT-5 owns it, and solving it early means guessing at an interaction that
> doesn't exist yet.

---

### 4. Draw bead codes on cells, with the toggle

Draw each cell's code, centered, using the existing `getContrastColor` from `src/contrast.ts` so
VIEW-4 keeps passing for free. Rewire the existing `toggleTextBtn` checkbox to trigger a redraw
rather than toggling a CSS class.

**Done when:** Codes appear on cells and read correctly against both the darkest and the lightest
palette colors (VIEW-4's Check). Toggling off removes all code text and leaves the colors
unchanged; toggling on restores it (VIEW-3's Check).

---

### 5. Level-of-detail: hide codes when cells get too small

Below a legibility threshold, skip drawing text entirely — not smaller text, no text. Make the
threshold a named constant with a pure `shouldDrawCodes(cellSizePx)` helper, and test it.

**Done when:** Zooming out past the threshold makes text disappear while colors remain; zooming
back in restores it (VIEW-5's Check). The threshold helper has tests.

> **Watch:** the toggle (VIEW-3) and the automatic hide (VIEW-5) are separate conditions. Text
> draws only when the user has codes on **and** cells are large enough. Don't let the automatic
> hide silently flip the user's checkbox.

---

### 6. Device pixel ratio and the performance check

Size the canvas backing store by `devicePixelRatio` and scale the context, so text and cell edges
are crisp on a Retina display.

Then verify the milestone's actual acceptance bar: a 300 × 300 pattern rendering and panning
smoothly, and a redraw fast enough that zoom and pan don't feel laggy. If a full redraw per frame
is too slow at 100,000 cells, the first thing to try is drawing only the visible cell range, not
caching bitmaps.

**Done when:** Text is sharp on a HiDPI display; 300 × 300 pans smoothly; zoom and pan stay
responsive at the NFR-3 cap.

> **Watch:** `plan-v1.md` names blurry text from ignoring pixel density as the second standard
> canvas pitfall. Doing this last means every earlier step's visual judgment was made at 1x —
> re-check step 4's contrast and step 5's threshold after this lands, since both are legibility
> judgments.

---

## Milestone exit

M1 is done when `plan-v1.md`'s **Done when** holds: a 300 × 300 pattern renders and pans smoothly;
zoom keeps the viewport center fixed; codes are legible on the darkest and lightest palette colors
and vanish when cells shrink below the legibility threshold.

Then tick VIEW-1, VIEW-2, VIEW-3, VIEW-5 in `specs.md`, mark M1 done in `plan-v1.md`, delete this
file, and point `claude.md` at `plans/m2-quality-core.md`.

## Deferred out of M1 — do not build here

| Thing | Where it belongs |
|---|---|
| Brush, eraser, color picker, live count updates | M5 (EDIT-1 … EDIT-4) |
| Pan-vs-paint mode conflict | M5 (EDIT-5) |
| Gridlines every 10 cells | v2 (VIEW-6) |
| OkLab matching, color limit, area averaging | M2 (GEN-2, GEN-3, GEN-4) |
| PNG export of the canvas | M6 |
