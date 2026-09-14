# M10 — Pattern orientation

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M10 closes,
delete it and point `claude.md` at the next one._

**Milestone goal (`plan-v1.md` M10):** gridlines every 10 cells, plus row and column numbers along
the view's edges that stay put while panning. One checkbox toggles both.

**Closes:** VIEW-6, VIEW-7. **Origin:** D16.

---

## Ground rules

- **M1's canvas contract does not change.** `Pattern` is untouched, the container model is
  untouched, and every length stays in CSS pixels — `devicePixelRatio` is applied once at the
  context in `layout()` and must not reach this work.
- **Geometry is pure and tested** (NFR-4): `src/lib/guides.ts`, DOM-free, no
  `CanvasRenderingContext2D`. M6's exporter is the second consumer, which is why the geometry is a
  module rather than inline in the draw loop.
- **No CSS change is expected.** If one proves necessary, match the file's 8-space indent and leave
  the spacing literals alone — M8 owns tokenizing them.

## The container constraints this milestone must not break

Inherited from M1 step 2 and easy to violate by accident:

- `#grid-wrapper` cannot take `overflow`, `transform`, `filter`, or `contain`. Any of them makes it
  a containing block or scroll container and the sticky canvas stops tracking the scroll.
- `#outputContainer.innerHTML` is cleared in three places (`showProcessing`, `clearPattern`,
  `renderPattern`). Anything added inside it must be rebuilt by `renderPattern`.
- `#pattern-canvas` is `position: sticky; top: 0; left: 0`. **This is what makes rulers cheap** —
  the canvas's first pixels are always at the viewport corner, so edge labels drawn there are
  sticky for free. A DOM gutter would mean changing those offsets; don't.

---

## Steps

### 1. The geometry, pure and tested

`src/lib/guides.ts`, with `guides.test.ts` alongside it:

- `GRID_INTERVAL = 10`
- `gridlineIndices(range, interval)` — the multiples of `interval` inside a `CellRange`, consuming
  what `visibleCellRange` already returns.
- `shouldDrawGridlines(cellSize, interval)` — threshold on the *line pitch* (`interval x cellSize`),
  not on cell size, following the `shouldDrawCodes` precedent.
- `rulerLabelStep(cellSize, interval)` — the smallest multiple of `interval` whose on-screen pitch
  clears a minimum, so labels thin from every 10 to every 20 or 50 instead of colliding.
- `shouldDrawRuler(patternExtentPx, viewportLengthPx)` — per-axis overflow test.

**Done when:** `npm run check` green with the new tests. No rendering yet.

### 2. Draw gridlines

In `draw()`, after the cell loop, reusing the `cols`/`rows` ranges already computed.

A gridline crosses many cells, so `src/contrast.ts` does not apply — there is no one cell color to
contrast against. Draw a **double rule**: two adjacent 1 px `fillRect`s, one dark and one light, so
the pair reads against any bead. `fillRect` also avoids `stroke`'s half-pixel centering and stays
crisp under the DPR transform.

**Done when:** Lines land on every 10th boundary in both directions and read against the darkest
and lightest palette colors (VIEW-6's Check).

### 3. Draw edge rulers

Last in `draw()`, so they sit above beads and gridlines. A translucent strip along the top and left
edges of the canvas, labels at each `rulerLabelStep` boundary.

**Only when that axis overflows** — you cannot get lost in a pattern you can see whole, and
`#grid-wrapper { margin: 0 auto }` centers the spacer in exactly that case. Per-axis, so a wide
short pattern gets a column ruler and no row ruler. This is also what bounds the strip's occlusion
of beads: it only appears when there is something to scroll.

**Done when:** Numbers identify the visible columns and rows, stay correct while panning, and are
absent when the whole pattern fits (VIEW-7's Check).

### 4. The toggle

One checkbox in `#zoomControls`, labeled "Grid", wired exactly as `toggleTextBtn` is — a `change`
listener that calls `draw()`, never a CSS class.

**One control for both layers, deliberately.** `.zoom-controls` is a `display: flex` row with no
`flex-wrap`, and at <= 640 px the global `button { width: 100% }` beats
`.zoom-controls button { width: auto }` on source order at equal specificity. The bar is already
tight at 390 px; this adds one control, not two.

**Done when:** Toggling off removes both layers and leaves colors and codes unchanged; toggling on
restores both.

---

## Milestone exit

Tick VIEW-6 and VIEW-7 in `specs.md`, mark M10 done in `plan-v1.md`, delete this file, and point
`claude.md` at the next milestone.

## Deferred out of M10 — do not build here

| Thing | Where it belongs |
|---|---|
| Gridlines in the exported PNG | M6 (D16); reuse `src/lib/guides.ts` |
| Minimap overlay | Declined in D16; reopen deliberately |
| Cursor coordinate readout | Not needed once edges are labeled. `cellAtClientPoint` already exists. **Not** in `#statusMessage` — it is `aria-live`, and a pointermove readout would announce continuously |
| Pegboard-sized (29-cell) interval | OUT-6 [later] owns pegboard sectioning |
| Independent gridline/ruler toggles | One control; the zoom bar is tight at 390 px |
| `.zoom-controls button` specificity conflict at <= 640 px | Pre-existing; M8 / UI-1 |
