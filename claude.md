# Project Development Context

_Last reviewed: 2026-09-22_

## Project summary

This directory contains a client-side web application that converts an uploaded image into a Perler bead pattern. The user chooses a target physical width and bead size; the app calculates the required bead-grid dimensions, resizes the image, maps each visible pixel to the nearest color in a Perler palette, and displays an interactive pattern with bead codes and an inventory count.

`specs.md` holds the requirements (each with an ID, a version marker, and a verification Check) and the decision log. `plan-v1.md` breaks v1 into milestones M0–M10. **M0 is complete**: the app was moved from a single HTML file onto Vite + TypeScript with no behavior change, and the Mini bead pitch was corrected to 2.6 mm (spec Q1). **M1 — replacing the element-per-bead grid with canvas rendering (decision D1) — is complete** (2026-09-13): canvas rendering, zoom by redraw, drag-pan plus the screen → cell mapping, bead codes with contrast and an 18 px legibility threshold, and `devicePixelRatio` applied once at the context. Max zoom was raised late from 30 px to 46.875 px, which the container-sized canvas made free. **M10 — pattern orientation (gridlines and edge rulers, decision D16) — is complete** (2026-09-13): `src/lib/guides.ts` holds the guide geometry, `canvas-view.ts` draws gridlines as a dark/light double rule plus per-axis edge rulers whose labels thin as zoom drops, and one "Grid" checkbox toggles both by redrawing. **M2 — the quality core — is complete** (2026-09-21): OkLab matching, area averaging in linear light, greedy perceptual color reduction (D17), the SET-4 color limit, and a lineart classifier (D18), all behind the GEN-6 pipeline boundary with two one-identifier strategy switches. GEN-2, GEN-3, GEN-4, GEN-6, GEN-7 and SET-4 are ticked. **GEN-8 is deliberately unticked** — the R1–R6 review does not fully pass, and ticking it would make the gate decorative. Two items remain: dark regions blend less smoothly than before D18 (improved, not closed — the three constants in `DEFAULT_CONTRAST_TUNING` are a live tuning surface meant to be moved by eye), and facial features of drawn characters distort, which is spec Q10 and is not reachable from this pipeline at all since the bead grid is fixed before any of it runs. NFR-2 is measured and over (315 ms at the hard limit against ~150 ms), recorded for M9 per D8. **M5 — the correction editor — is complete** (2026-09-22): brush, eraser, flood fill, stroke-scoped undo/redo, a two-tier color picker, and a pan mode that never paints. EDIT-1 … EDIT-5, EDIT-7 and EDIT-8 are ticked; EDIT-6 stays retired. D19 (2026-09-21) is what widened it, moving undo and fill from v2 into v1 and reversing D7. Three things from it are worth carrying forward: `src/state/pattern-state.ts` is now the single owner of the live pattern and its tallies, so anything that needs either subscribes rather than holding a copy; **`Pattern` did not change**, so M6 exports and M7 serializes exactly what the editor mutates; and **Q10 is answered — no mirror or copy-region tool** (written up at Q10 in `specs.md`), which leaves Q10 open only as a generation question. Crop, PNG export, and autosave are still ahead; **M6 is next**, and it is the last item on the critical path.

Appearance is tracked as the **UI** requirement group, split by D14: UI-1 … UI-6 are **[v1]**
mechanical Checks built in M8 (Interface floor), while UI-7 — deliberate visual design — is
**[v2]** and gated by the U1–U5 interface review. NFR-5 and UI-1 stay unticked until M8 verifies
them, but **the specific 390 px clipping they were written against is gone**: `src/styles.css` has
carried an `@media (max-width: 640px)` block since M0, and measured in a real 390 px viewport the
page has zero horizontal overflow with nothing clipped. Earlier text here and in `specs.md` said
the file had no media queries; that was never true of the committed CSS.

### Planning docs — three layers

Each answers one question, and they are kept deliberately separate so the strategy stays readable:

| File | Question | Lifetime |
|---|---|---|
| `specs.md` | What must be true? | Whole project |
| `plan-v1.md` | In what order, and why? | Whole project |
| `plans/<milestone>.md` | How do I get through *this* milestone? | While it is in flight |

**No tactical plan is open.** M2's was deleted at its close (2026-09-21) and M5's at its close (2026-09-22). Write `plans/m6-export.md` the day M6 starts, and move this pointer to it.

Only one tactical plan exists at a time. It is written the day the milestone starts (writing it earlier means guessing at work that later milestones will reshape), and at milestone close it is deleted and this pointer moves to the next one. Don't expand step-level detail into `plan-v1.md` — one screen per milestone is what keeps that file re-readable.

## Commands

Requires Node >= 22. `npm install` first.

- `npm run dev` — Vite dev server with reload-on-save
- `npm run build` — static production build into `dist/`
- `npm run preview` — serve the built output
- `npm test` — Vitest, browser-free (`npm run test:watch` to iterate)
- `npm run typecheck` — `tsc --noEmit`; Vite strips types without checking them, so this is the only thing that enforces them
- `npm run check` — typecheck + tests, the full gate

### How to run it

Use `npm run dev`. HTTP alone is **not** enough — a plain static file server (`python3 -m http.server`, `npx serve`) on the project root cannot run this app:

- `src/main.ts` is TypeScript. No browser executes TypeScript; Vite has to strip the types first. A file server just hands the file over, and Python compounds it by guessing MIME from the extension — `.ts` collides with MPEG transport stream, so it arrives as `video/mp2t` and the browser's strict module MIME check refuses it outright.
- `colors_221.json` lives in `public/`, which Vite serves at the URL root. A plain server doesn't know that convention, so the palette 404s.

To serve the app from your own static server, build first and serve the **output**, never the source: `npm run build && python3 -m http.server 8000 --directory dist`. `dist/` is compiled plain JS with the palette copied alongside, so a dumb file server is enough — at the cost of re-running the build after every edit.

Opening `index.html` as a `file://` URL fails too: browsers block `type="module"` scripts there regardless of build state.

In all three failure cases the module never executes, so `main.ts`'s own error handling cannot report it. The classic (non-module) boot guard inlined at the bottom of `index.html` exists for exactly that blind spot — it detects `file://`, script MIME rejection, and a startup throw, then writes an actionable message into the status line and leaves Generate disabled (PAL-3). Keep it inline and non-module; as a module or an external file it would fail in the very cases it reports. `src/main.ts` sets `window.__perlerBooted` at the end of its startup wiring to stand the guard down.

## Layout

- `index.html` — markup, plus the inline classic-script boot guard described above; loads `src/main.ts` as a module. It also holds M5's six **editor-bar icons as inline `<svg class="icon">`** — deliberately placeholders, in the 24 px stroke style Lucide/Feather/Heroicons-outline share. Swapping one is a paste: keep `class="icon"` and `aria-hidden="true"`, and leave the button's `aria-label` alone, because with the text labels gone that is the button's only accessible name. Icons draw in `currentColor`, which is why the pressed and disabled states need no second artwork.
- `public/colors_221.json` — the default 221-color palette (`name`, `hex`, `rgb`), fetched at startup. It lives in `public/` because that is the only directory `vite build` copies into `dist/`; moving it back to the project root would work in `npm run dev` and 404 in the build.
- `src/main.ts` — startup wiring: DOM references, palette load, and the upload/generate listeners, plus the stats line as a `pattern-state` subscriber. The view, inventory, and editor modules attach their own.
- `src/lib/pattern-utils.ts` — dependency-free palette normalization/validation, dimension calculation, RGB matching, inventory tallying. `findClosestColor` and `colorDistanceSquared` are **not** dead code after M2: they are GEN-6's required second algorithm, wrapped by `rgbMatcher`. Covered by `pattern-utils.test.ts`.
- `src/lib/oklab.ts` — OkLab conversion and distance, plus the 256-entry sRGB→linear table every pixel goes through. A neutral gray's `L` is exactly `cbrt(linear)`, which is both the test oracle and the reason gate thresholds compare cube roots. Covered by `oklab.test.ts`.
- `src/pipeline/generate.ts` — **the GEN-6 boundary**: pixels in, `Pattern` out, no DOM, so it stays testable in Node. Sequence is downsample → match → tally → reduce → remap → rebuild tallies. It does not branch on either strategy switch. Covered by `generate.test.ts`.
- `src/pipeline/color-match.ts` — GEN-2 as a factory, so the palette's OkLab values are computed once per generate rather than once per cell. **`ACTIVE_MATCHER` is one of GEN-6's two switches**; flip it to `rgbMatcher` for pre-M2 behavior. Covered by `color-match.test.ts`.
- `src/pipeline/downscale.ts` — GEN-4 and D18. `boxAverage` is the exact fractional-coverage box filter in linear light, alpha-weighted; `contrastPreserving` adds the lineart classifier. **`ACTIVE_DOWNSAMPLER` is GEN-6's other switch** — flipping it to `boxAverage` is also the standing diagnostic, and is what localized the D18 color-speck bug. The three constants in `DEFAULT_CONTRAST_TUNING` are a live tuning surface, not settled values; GEN-8 is unticked because of them. Covered by `downscale.test.ts`.
- `src/pipeline/reduce.ts` — GEN-3 and D17: Phase A collapses near-duplicates below `MERGE_FLOOR`, Phase B enforces the SET-4 limit, both by `count × ΔE to nearest survivor`. Merges are path-compressed and every argmin tie-breaks on ascending palette index (GEN-7). Operates on palette indices only — it never sees cell positions, so it cannot cause or cure a localized defect. Covered by `reduce.test.ts`.
- `src/state/pattern-state.ts` — **the single owner of the live pattern and its tallies** (M5). The stats line in `main.ts`, `render/inventory.ts` and `render/editor.ts` all subscribe through `onPatternChange` rather than holding their own copy, which is what keeps EDIT-4 true; before M5 those three each kept their own and had to be updated in lockstep. The `Pattern` object is mutated in place and never replaced by an edit. `patternEdited()` re-tallies from the pattern rather than trusting the stroke's incremental arithmetic — 0.5 ms at the hard limit, and it removes tally drift as a class.
- `src/lib/pattern-edit.ts` — the edit primitive: a `CellEdit` is `{index, prev, next}`, and **one `applyEdits` serves paint, undo and redo**, which is why EDIT-4 holds by construction. Also the stroke recorder, which keeps one record per cell holding the color that cell had when the stroke *started*. Covered by `pattern-edit.test.ts`.
- `src/lib/edit-history.ts` — the undo/redo stack (EDIT-7). Two things are load-bearing: pushing while the cursor is behind the end truncates the tail first, and the stack is bounded by **total recorded cells, not stroke count** — a fill at NFR-3's limit is one stroke of 50,000 records. `DEFAULT_CELL_BUDGET` is a judgment constant like `MERGE_FLOOR`, so the tests assert eviction behavior and never the number. Covered by `edit-history.test.ts`.
- `src/lib/cell-path.ts` — Bresenham between two cells. EDIT-1's named watch-for: pointermove reports samples, not a path, so a fast drag is dotted unless consecutive samples are joined. Covered by `cell-path.test.ts`.
- `src/lib/flood-fill.ts` — EDIT-8's region search. Iterative (a 50,000-cell region would overflow the call stack), matched on `color?.name ?? null` so `null` matches `null` and a deserialized pattern still fills, and **exact-match only — D19 refuses a tolerance**; a speckled background is an R2/GEN-3 defect. Covered by `flood-fill.test.ts`.
- `src/lib/palette-query.ts` — the color picker's ranking (EDIT-3 tier 2): text filter plus ~12 nearest by OkLab ΔE, over the same table `color-match.ts` builds for the matcher, so "close" means the same thing in the picker as in the generator. Covered by `palette-query.test.ts`.
- `src/render/editor.ts` — the editor's pointer wiring, tool state, and picker DOM. Holds no deterministic logic: it decides which pure function a gesture means and nothing else. The eyedropper (alt-click) is live in every tool and is the one canvas gesture that records no edit.
- `src/types.ts` — `PaletteColor`, `Palette`, `Pattern`, `PatternDimensions`, `ColorTally`, `SourcePixels`. `Pattern` is the durable contract: M1 renders it, M5 edits it, M6 exports it, M7 serializes it. **M5 did not change it**, deliberately.
- `src/rasterize.ts` — hidden canvas: image → `SourcePixels`. DOM decode only; all the math lives behind the pipeline boundary. Returns an *intermediate-resolution* buffer, not grid-sized: the source capped so neither side exceeds `SUPERSAMPLE (8) ×` the grid side and the total stays under ~4M pixels. Only that capping draw uses browser smoothing. `SUPERSAMPLE` 8 → 4 is the cheapest lever against NFR-2, which is currently over.
- `src/palette.ts`, `src/upload.ts`, `src/status.ts`, `src/dom.ts`, `src/contrast.ts` — palette loading, file decoding, status messages, `requireElement`, and text-contrast choice.
- `src/lib/guides.ts` — pure geometry for the pattern-view guides (VIEW-6, VIEW-7): the gridline interval and its visibility threshold, which boundaries fall inside a visible range, the adaptive ruler-label step, and the per-axis test for whether a ruler is warranted. DOM-free; M6's PNG export is the intended second consumer (D16). Covered by `guides.test.ts`.
- `src/lib/viewport.ts` — pure viewport math for the canvas view: zoom limits, the centre-fixed scroll offset on zoom, the visible cell range, the code-legibility threshold (`shouldDrawCodes`), and the screen-point → cell mapping M5 will consume. DOM-free, so it tests in Node. Covered by `viewport.test.ts`.
- `src/render/canvas-view.ts` — the canvas pattern view (D1), which replaced the M0-only `dom-grid.ts`. M5 added four small seams and changed nothing else: `cellAtPoint`, `isPatternCanvas`, `redrawPattern`, and `setPointerMode`. The last one is the subtle one — a paint tool has to gate `beginPan` **and** put `touch-action: none` on the canvas, because the canvas sits in a native scroll container that would otherwise scroll a touch-drag instead of painting; both live on the `.painting` class so pan mode gets native touch scrolling back. Draws the visible cell range with zoom, drag-pan, bead codes (skipped below the legibility threshold), and the gridlines and edge rulers from `src/lib/guides.ts`. Rulers need no positioning of their own — the canvas is already pinned to the visible corner, so its first pixels are always on screen. The canvas is sized to the *container*, never the pattern: `#grid-wrapper` is an empty spacer sized to the pattern that drives the native scrollbars, and the canvas is a `position: sticky` overlay pinned to the visible corner. Every length here is a CSS pixel; `devicePixelRatio` is confined to `layout()`, which sizes the backing store and applies the density once via `ctx.setTransform` — so the draw loop reads the CSS sizes off the view state, never `canvas.width`/`.height`.
- `src/render/inventory.ts` — the bead-count list (OUT-4), and **tier 1 of M5's color picker**: the rows are real buttons, and clicking one makes that color active. Reusing this list rather than building a second swatch-and-code list is why picking an in-pattern color costs the shopping list nothing. It reads `pattern-state.ts` rather than being handed counts.
- `src/styles.css` — all styling, moved out of the original single file. Still carries that origin: 8-space base indent and ad-hoc spacing/radius/type literals, and M5's editor bar adds more of them on purpose (UI-3 tokenizes the whole file at once in M8; hand-tokenizing one block early would just make it inconsistent in a second way). `.editor-controls` has `flex-wrap: wrap`, which `.zoom-controls` deliberately does not — seven 44 px targets do not fit on one row at 390 px, even icon-only. It does have a `@media (max-width: 640px)` block for the narrow-width layout. M8 (UI-3) replaces the literals with scales; don't hand-tidy it before then.
- `colors.json` — a 291-record palette with `name` and `hex` only. Not loaded by the app and it would fail PAL-4 validation as-is; it is an input to `helper.py`, kept for PAL-6.
- `helper.py` — adds RGB tuples to a hex-only palette JSON.
- `pixi.toml` — conda workspace for the Python side only. npm owns the web app; don't try to make pixi manage Node.

## Conventions

- Four-space indentation; no linter or formatter is configured.
- Deterministic logic goes in `src/lib/` or `src/pipeline/` and gets a test (NFR-4). Anything touching the DOM, canvas, or `FileReader` stays out of those directories so the tests keep running without a browser.
- Look up elements through `requireElement` from `src/dom.ts` rather than raw `getElementById`.
