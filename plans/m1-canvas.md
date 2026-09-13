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

NFR-3 (revised by D15 on 2026-09-10) now gives two numbers: a **design target of 10,000 cells
(100 × 100)** and a **hard limit of 50,000 cells / 300 per side**. Use **100 × 100** as the working
test case and **300 × 160** as the non-square case near the hard limit.

**The canvas cannot be sized to the whole pattern — decide this at step 2, not step 6.** The
binding constraint is cells × max zoom, not cell count. At VIEW-2's readable max zoom (~30 px per
cell) even the 100 × 100 design target is a 3,000 × 3,000 CSS-pixel surface: ~36M device pixels and
~144 MB of backing store at DPR 2, over mobile Safari's canvas area cap, and NFR-5 puts 390 px in
scope. Step 6 below describes drawing only the visible cell range as a performance fallback; that
is wrong, it is a precondition, and it changes what steps 2 and 3 take as inputs.

The cheapest container model that keeps the scrollbars you already have: leave `#grid-wrapper` in
place as an **empty spacer** sized to `cols × cell` to drive native scroll, size the canvas to the
container, pin it over the scroll region, and redraw the visible range on scroll. Pure drag-pan
with no scrollbars is the simpler alternative — step 3 has you tracking an offset either way.

---

## Steps

### 1. Draw the pattern to a canvas at fixed scale

Replace `src/render/dom-grid.ts` with `src/render/canvas-view.ts`. Draw one filled rect per cell at
a fixed cell size; skip `null` cells so they read as empty (GEN-1). No zoom, no pan, no codes yet —
the zoom buttons and the code toggle can go inert for this one step, but the app must still
generate and display a pattern.

Delete `dom-grid.ts` in this step rather than leaving it beside the new file. It is marked
**M0-only** in `claude.md` precisely so this deletion is uncontroversial.

Also remove the now-dead CSS: `#pattern-grid`, `.pixel`, and `#pattern-grid.hide-text .pixel`
(`src/styles.css:107`, `:115`, `:186`). Keep `.output-container` and `.zoom-controls`. **Leave
`#grid-wrapper` alone for now** (`src/styles.css:117`) — whether it survives as the scroll spacer
is the step-2 container decision above, and deleting it here just to re-add it is churn.

**Touches:** `src/render/canvas-view.ts` (new), `src/render/dom-grid.ts` (deleted), `src/main.ts`
(imports), `src/styles.css`, `index.html` if the container markup changes.

**Done when:** A 100 × 100 pattern renders as colored cells on a canvas, empty cells show as empty,
and the bead inventory is unchanged. `npm run check` green.

> **Watch:** this is the step that changes the DOM contract between `index.html` and `src/`. If an
> element ID drifts, the boot guard reports `Missing required element: #...` in the status line
> rather than hanging — that message is the fast path to the fix, so read it before digging.

---

### 2. Zoom by redraw, viewport center fixed

Zoom changes the cell size and triggers a full redraw. It must **not** use a CSS transform — that
is exactly what D1 rules out.

**Settle the container model first** — see Size targets. Everything below assumes a canvas sized to
the container, not to the pattern.

VIEW-2's Check sets both ends: at maximum zoom cells and codes are comfortably readable; at minimum
zoom the whole pattern fits the viewport. Derive the minimum from the pattern and container size
rather than hardcoding it, so a 300-wide pattern can still zoom out to fit.

Keep the zoom math pure and tested: given current scale, container size, scroll offset, and a new
scale, return the new scroll offset that holds the viewport center fixed. That function belongs in
a testable module; the canvas call sites do not.

**Done when:** Zooming in and out holds the center point; minimum zoom fits a 100 × 100 pattern
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

**Done when:** A 100 × 100 pattern pans smoothly by drag (VIEW-1's Check). The coordinate mapping
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

Keep every drawing calculation in CSS pixels and apply density once with
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` per resize. Done that way this step is a few lines and
step 3's coordinate mapping is untouched; fold `dpr` into the cell size instead and you are back
through steps 2, 3, and 5.

Then verify the milestone's actual acceptance bar: a 100 × 100 pattern rendering and panning
smoothly, and a redraw fast enough that zoom and pan don't feel laggy. Visible-range drawing is
already a precondition from step 2, so the worst case here is bounded by container area rather than
pattern area — `fillRect` is cheap, `fillText` is not, and step 5's threshold means text only draws
when cells are large enough that few of them fit on screen.

**Done when:** Text is sharp on a HiDPI display; 100 × 100 pans smoothly; zoom and pan stay
responsive at NFR-3's 50,000-cell hard limit.

> **Watch:** `plan-v1.md` names blurry text from ignoring pixel density as the second standard
> canvas pitfall. Doing this last means every earlier step's visual judgment was made at 1x —
> re-check step 4's contrast and step 5's threshold after this lands, since both are legibility
> judgments.

---

## Milestone exit

M1 is done when `plan-v1.md`'s **Done when** holds: a 100 × 100 pattern renders and pans smoothly;
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
