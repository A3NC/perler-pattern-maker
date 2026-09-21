# M5 — Correction editor

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M5 closes,
delete it and point `claude.md` at the next one._

**Milestone goal (`plan-v1.md` M5):** single-cell brush, eraser, palette color picker, flood fill,
and stroke-scoped undo/redo. Live bead counts. A pan mode that never paints by accident.

**Closes:** EDIT-1 … EDIT-5, EDIT-7, EDIT-8. Retires EDIT-6. **Origin:** D11, and D19 for the
scope change.

---

## What changed since `plan-v1.md` was written

M5's original scope was "no undo, no fill" (D7). **D19 reversed that** — read it in `specs.md`
before starting. The short version: D7 bundled two claims, and only one survived.

- *Undo isn't needed, because a one-cell brush is self-correcting.* **False, and it was false before
  M2.** EDIT-1's own Check requires dragging to paint a continuous run, so the brush was never
  one-cell. And the state being overwritten is **generated, not authored** — "paint it again"
  assumes you know what was there, which on R3/R4/R5 shaded regions you do not.
- *Fill can't ship without undo.* **True, and kept.** Fill lands only because undo does.

The strongest case for fill is **D13**, not M2: flood-fill-with-eraser over a uniform background is
the v1 story for white-canvas artwork (S1, the majority input). It works precisely because GEN-3's
Phase A makes that canvas one color — which is R2's pass condition.

---

## Ground rules

- **M1's canvas contract does not change.** The container model, the sticky canvas, and
  `devicePixelRatio` confined to `layout()` all stand. The editor consumes
  `cellAtClientPoint` — that seam is why M5 is a normal-sized milestone (D1).
- **`Pattern` does not change.** `cells` is a flat row-major `(PaletteColor | null)[]`; an edit is
  `cells[row * width + col] = color`. The pattern object held in `view.pattern` is the single
  source of truth and is mutated in place — no copy, no second model. M6 exports it and M7
  serializes it unchanged.
- **Deterministic logic is pure and tested** (NFR-4): the history stack, the fill search, the drag
  interpolation, and the tally arithmetic all go in `src/lib/`, DOM-free, tested in Node. Only
  pointer wiring and DOM live in `src/render/`.
- **No undo persistence.** SAVE-1 is pattern, settings, and edits — not history. M7's scope is
  unchanged by this milestone, and that is deliberate (D19).
- **CSS: a real class, not inline styles.** M10 left two controls styled inline in `index.html` and
  M8 owns moving them; do not make it three. Ad-hoc spacing literals in `src/styles.css` are fine
  and expected — UI-3 tokenizes them in M8. Match the file's 8-space indent.

---

## Steps

### 1. Pattern state: one owner for the live pattern and its tallies

**The problem to fix first.** After `buildPattern` runs, nothing owns the mutable state. `main.ts`
computes the stats line from a local `tallies` object and throws it away; `inventory.ts` keeps a
private `currentCounts` array; `canvas-view.ts` keeps `view.pattern`. EDIT-4 has to move all three
together, and wiring an editor into three separate holders is how the counts drift.

Add `src/state/pattern-state.ts`: holds the current `Pattern` and its `Record<string, ColorTally>`,
and exposes a subscribe-style `onChange` that re-renders the stats line and the inventory. `main.ts`
hands it the result of `generatePattern` instead of scattering it.

**Tally arithmetic goes in `src/lib/pattern-utils.ts` next to `addColorTally`:** a
`removeColorTally` twin that deletes the entry at zero rather than leaving a count-0 row — otherwise
erased colors linger in the inventory and `Colors Used` in the stats line is wrong.

**Done when:** generate still works exactly as today, with the stats line and inventory rendered
through the new owner. No editing yet. `npm run check` green.

### 2. The edit primitive and the history stack, pure and tested

`src/lib/pattern-edit.ts`:

- `interface CellEdit { index: number; prev: PaletteColor | null; next: PaletteColor | null }` —
  one record serves both directions, which is why redo costs no extra storage (D19).
- `applyEdits(pattern, tallies, edits, direction)` — writes `next` or `prev` and moves the tallies
  with it. **One function for paint, undo, and redo**, so EDIT-4 holds by construction rather than
  by three code paths agreeing.

`src/lib/edit-history.ts`:

- A stroke is a `CellEdit[]`. `push`, `undo`, `redo`, and a cursor.
- **The truncation rule is the whole bug surface:** pushing while the cursor is behind the end must
  discard the tail first, or redo replays a diff computed against a state that no longer exists.
  Test it directly.
- **Bound the stack by total recorded cells, not by stroke count.** A fill at NFR-3's 50,000-cell
  limit is one stroke holding 50,000 records (~2 MB as plain objects); fifty of those is ~100 MB on
  a phone. A cell budget bounds memory whatever the stroke size. One constant, evicting oldest
  strokes, with a test asserting the eviction *behavior* and not the number — same convention as
  `MERGE_FLOOR` and `MIN_CODE_FONT_PX`.

**Tally correctness anchor:** maintain tallies incrementally during a stroke (cheap, per cell), then
**re-tally the whole pattern at stroke end and after every undo and redo**. A full re-tally at the
hard limit is ~1 ms and it removes drift as a class. Test: after N random strokes plus undos, the
incremental tallies equal a full re-tally.

**Done when:** tests cover apply/inverse round-trips, the truncation rule, cell-budget eviction, and
the tally agreement property. No DOM yet.

### 3. Drag interpolation and flood fill, pure and tested

Both in `src/lib/`, both consumed by step 5.

- `cellsBetween(from, to)` — Bresenham between two cell positions. **This is EDIT-1's named
  watch-for:** pointermove reports positions with gaps, so a fast drag skips cells unless
  consecutive points are connected. Test a steep diagonal and a long fast jump, not just adjacent
  cells.
- `floodFillRegion(pattern, origin)` — 4-neighbour region of cells matching the origin's color.
  **Match on `color?.name ?? null`, not object identity** — names are unique per PAL-4, and `null`
  matching `null` is what makes fill-with-empty work on the background. **Exact match only, no
  tolerance** (D19): a tolerance value is a judgment constant, and this project has been bitten
  three times by that shape. If a background comes out as several near-whites, that is an R2/GEN-3
  defect — fix it upstream.
  **Iterative stack, never recursion:** a 50,000-cell region would overflow the call stack.

**Done when:** `npm run check` green with the new tests. Still no DOM.

### 4. Editor chrome

A new `<div class="editor-controls">` sibling after `#zoomControls`, hidden until edit mode is on —
the same `display: none` mechanism `.zoom-controls` already uses until a pattern exists.

- Tools: brush, eraser, fill, pan. Plus undo and redo buttons — **redo gets a visible button**
  (D19); the bar is new, so it is not competing with the zoom row for space.
- **`flex-wrap: wrap`, which `.zoom-controls` does not have.** UI-6 wants 44 × 44 px targets at
  390 px; six controls is ~264 px of target plus gaps against roughly 340 px of usable width. Let it
  wrap rather than discovering this in M8. (The zoom row itself stays inline at 390 px —
  `.zoom-controls button { width: auto }` outranks the media query's `button { width: 100% }` on
  specificity, media queries adding none. Leave that alone; it is M8's, and it is why a *second* bar
  is the right answer rather than more controls in the first.)
- Undo and redo disable at the ends of the stack, so the stack's state is visible.
- The active-color swatch lives here too, as the affordance that opens the picker in step 5.

**The buttons are not the layout problem — the picker is**, and it has its own step. 221 swatches do
not go in a toolbar.

**Done when:** every control renders, wraps at 390 px, meets 44 px, and is inert.

### 5. Color picker (EDIT-3) — two tiers, built in that order

**The picker is a query, not a value.** This is the design decision the rest of the step follows
from: the user supplies something approximate, the interface answers with real beads ranked by
perceptual distance, and the user makes the final pick from named, coded palette entries. Nothing
downstream ever consumes a continuous color.

Two consequences worth stating, because they are what make this cheap:
- **The fidelity of the input is irrelevant**, so use the native `<input type="color">`. Free,
  accessible, works on a phone, and no custom color wheel is needed or wanted.
- **Ranking is already built.** `oklab.ts` plus the precomputed palette values in `color-match.ts`
  are what `findClosestColor`'s OkLab twin already does; keep the top ~12 instead of the argmin.
  Side effect worth having: the picker's notion of "close" is then the *same* as the generator's, so
  the bead the pipeline would have chosen ranks first.

**Tier 1 — the colors already in the pattern.** Straight from the tallies, so at most the SET-4
limit and typically ≤ 30. Always visible; no disclosure, no search. This is the fast path and it
covers nearly every correction, because the common intent is "make this cell match the one next to
it." Picking from it **adds zero new colors to the shopping list.**

Reuse what exists: `#beadList` already renders swatch-and-code rows (`.bead-item`, `.color-swatch`,
`.color-name`), so clicking an inventory row to set the active color makes the existing UI the
primary picker rather than a second one built beside it.

**The eyedropper belongs to this tier** — alt-click a cell sets the active color from that cell. It
is the same interaction as tier 1 with the pattern itself as the source, and it is the most direct
expression of the dominant intent. Its canvas handler is wired in step 6 with the other tools; only
the active-color state belongs here. Not a new requirement — it is an input method for EDIT-3, so
record it in the Delivered block rather than adding an ID.

**Tier 2 — the query panel over the full 221.** One result list, three ways to fill the query:
the native color input, a text filter over code and name ("P17", "cobalt"), and the eyedropper.
Results are the ~12 nearest by OkLab ΔE, each as a swatch with its code.

**Badge the candidates already present in the pattern, with their bead counts.** This is the part
that must not be dropped. Without it a user picking a blue silently adds P19 to a pattern that
already contains P17 — a new color on the shopping list they did not know they were buying, which
is the whole thing SET-4 and GEN-3 exist to prevent. With it, "P17 · 340 in pattern" ranks beside
"P19 · new" and the choice is informed. The tallies are already there, so this is a badge, not an
algorithm.

**Rank by ΔE regardless, and do not re-sort in-pattern colors to the top** — "nearest" has to keep
meaning nearest, or the list stops being trustworthy. Mark them; let the user decide.

**Note the gap this exposes.** No requirement covers the distinct-color count *after* editing —
SET-4's Check says "the **generated** pattern's bead list." The badge is the v1 answer, by making
growth visible rather than by enforcing a cap. If it proves insufficient in use, that is a spec
question for M9, not a thing to invent here.

**Staging, and it matters.** EDIT-3's Check is trivial — "the selected color is visibly indicated,
and painting uses it" — and **tier 1 plus the eyedropper satisfies it on its own.** Tier 2 is
additive. Build them in that order so the milestone can stop after tier 1 if it runs long; D19
already widened M5 and it is on the critical path. This is the M1 risk row's staging discipline
(zoom before pan before code LOD) applied to the picker.

**Done when:** tier 1 selects, the eyedropper's state path works, and EDIT-3's Check passes. Tier 2
is done when a query returns ΔE-ranked palette candidates with codes and in-pattern badges, and
picking one sets the active color.

### 6. Wire the pointer, and keep pan honest (EDIT-5)

`src/render/editor.ts` owns mode and listeners. `canvas-view.ts` keeps `view` private and gains
three small exports: `cellAtPoint(clientX, clientY)`, `getPattern()`, and `redrawPattern()`.

- `beginPan` currently fires on any left-button pointerdown on the canvas. Gate it on pan mode.
- **Touch is the trap.** `beginPan` deliberately ignores touch because the canvas sits in a native
  scroll container. In a paint mode that means a touch-drag scrolls instead of painting, so the
  canvas needs `touch-action: none` while a paint tool is active — **and needs it removed in pan
  mode**, or native touch scrolling breaks.
- One stroke = pointerdown → moves → pointerup, pushed to history as a single entry (EDIT-7's Check
  says "reverses the last stroke as one unit"). A fill is also one stroke.
- **The eyedropper (step 5) is wired here**, as alt-click. It reads a cell and writes the active
  color; it is the one canvas gesture that records no edit and pushes no history entry.
- Redraw only the affected cells where practical; a full `draw()` is an acceptable fallback.

**Keyboard:** `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`. Ignore them when focus is in an input — the
target-width and color-limit fields are text inputs with their own undo.

**Done when:** EDIT-1 … EDIT-5, EDIT-7, EDIT-8 all pass their Checks. Specifically: dragging paints
a continuous run with no skipped cells at any zoom; erased cells leave the count; A→B decrements A
and increments B; panning modifies nothing; undo reverses a whole stroke; fill affects only the
contiguous region.

### 7. Decide Q10 — once, and record it

`plan-v1.md` M5 says to decide early and once whether Q10 (facial features distorting against the
bead grid) earns a mirror or copy-region tool, and to say so in the Delivered block rather than
leaving Q10 open.

**Decide it here, not at the end.** Current recommendation is **no**: mirror needs a region
selection model that fill does not, and undo has already removed most of the risk that made
"fix twelve beads twice" expensive. If hands-on use in step 5 says otherwise, that is evidence —
but reopen it deliberately, in writing, not mid-step.

---

## Milestone exit

Tick EDIT-1 … EDIT-5, EDIT-7, EDIT-8 in `specs.md` and confirm EDIT-6 reads as retired. Record the
Q10 decision, the eyedropper, and whether tier 2 of the picker shipped in M5's Delivered block. Mark M5 done in `plan-v1.md`, delete this file, and point
`claude.md` at M6.

## Deferred out of M5 — do not build here

| Thing | Where it belongs |
|---|---|
| Fill tolerance / "similar colors" fill | Declined in D19. Speckle is an R2/GEN-3 defect |
| Global "replace color X with Y everywhere" | Not in v1. It targets M2's dark-region noise, which no editor tool realistically fixes — that is `DEFAULT_CONTRAST_TUNING` or accepted |
| Mirror / copy-region | Step 6 decides; default is no |
| Undo history in autosave | SAVE-1 is pattern + settings + edits, not history (D19) |
| Multi-cell brush sizes | Not specified; EDIT-1 is single-cell |
| A custom color wheel | The query input is native `<input type="color">`; its precision is irrelevant by design |
| Enforcing a color cap on *edited* patterns | Spec gap named in step 5; M9 decides, the badge is v1's answer |
| Tokenizing the new bar's spacing literals | M8 / UI-3 |
| Moving M10's inline-styled controls into CSS | M8; just don't add a third |
| Edits reflected in the export | M6 (OUT-2) — it reads `Pattern`, which stays the source of truth |
