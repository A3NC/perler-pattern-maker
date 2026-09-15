# Project Development Context

_Last reviewed: 2026-09-15_

## Project summary

This directory contains a client-side web application that converts an uploaded image into a Perler bead pattern. The user chooses a target physical width and bead size; the app calculates the required bead-grid dimensions, resizes the image, maps each visible pixel to the nearest color in a Perler palette, and displays an interactive pattern with bead codes and an inventory count.

`specs.md` holds the requirements (each with an ID, a version marker, and a verification Check) and the decision log. `plan-v1.md` breaks v1 into milestones M0–M10. **M0 is complete**: the app was moved from a single HTML file onto Vite + TypeScript with no behavior change, and the Mini bead pitch was corrected to 2.6 mm (spec Q1). **M1 — replacing the element-per-bead grid with canvas rendering (decision D1) — is complete** (2026-09-13): canvas rendering, zoom by redraw, drag-pan plus the screen → cell mapping, bead codes with contrast and an 18 px legibility threshold, and `devicePixelRatio` applied once at the context. Max zoom was raised late from 30 px to 46.875 px, which the container-sized canvas made free. **M10 — pattern orientation (gridlines and edge rulers, decision D16) — is complete** (2026-09-13): `src/lib/guides.ts` holds the guide geometry, `canvas-view.ts` draws gridlines as a dark/light double rule plus per-axis edge rulers whose labels thin as zoom drops, and one "Grid" checkbox toggles both by redrawing. **M2 — the quality core (perceptual matching, area averaging, the color limit) — is in flight** (started 2026-09-15); its tactical plan is `plans/m2-quality-core.md` and the two decisions taken up front are D17. The pipeline is still nearest-RGB until M2 lands, and crop, the correction editor, PNG export, and autosave are all still ahead.

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

**Active tactical plan: `plans/m2-quality-core.md`** (M2, started 2026-09-15). Delete it at milestone close and move this pointer to the next one.

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

- `index.html` — markup, plus the inline classic-script boot guard described above; loads `src/main.ts` as a module.
- `public/colors_221.json` — the default 221-color palette (`name`, `hex`, `rgb`), fetched at startup. It lives in `public/` because that is the only directory `vite build` copies into `dist/`; moving it back to the project root would work in `npm run dev` and 404 in the build.
- `src/main.ts` — startup wiring: DOM references, palette load, and the upload/generate listeners. The view and inventory modules attach their own.
- `src/lib/pattern-utils.ts` — dependency-free palette normalization/validation, dimension calculation, RGB matching, inventory tallying. Covered by `pattern-utils.test.ts`.
- `src/pipeline/generate.ts` — **the GEN-6 boundary**: pixels in, `Pattern` out, no DOM, so it stays testable in Node. M2 replaces the matching inside this module. Covered by `generate.test.ts`.
- `src/types.ts` — `PaletteColor`, `Palette`, `Pattern`, `PatternDimensions`, `ColorTally`, `SourcePixels`. `Pattern` is the durable contract: M1 renders it, M5 edits it, M6 exports it, M7 serializes it.
- `src/rasterize.ts` — hidden canvas: image → `SourcePixels`. Still point-sampled; GEN-4's area averaging is M2.
- `src/palette.ts`, `src/upload.ts`, `src/status.ts`, `src/dom.ts`, `src/contrast.ts` — palette loading, file decoding, status messages, `requireElement`, and text-contrast choice.
- `src/lib/guides.ts` — pure geometry for the pattern-view guides (VIEW-6, VIEW-7): the gridline interval and its visibility threshold, which boundaries fall inside a visible range, the adaptive ruler-label step, and the per-axis test for whether a ruler is warranted. DOM-free; M6's PNG export is the intended second consumer (D16). Covered by `guides.test.ts`.
- `src/lib/viewport.ts` — pure viewport math for the canvas view: zoom limits, the centre-fixed scroll offset on zoom, the visible cell range, the code-legibility threshold (`shouldDrawCodes`), and the screen-point → cell mapping M5 will consume. DOM-free, so it tests in Node. Covered by `viewport.test.ts`.
- `src/render/canvas-view.ts` — the canvas pattern view (D1), which replaced the M0-only `dom-grid.ts`. Draws the visible cell range with zoom, drag-pan, bead codes (skipped below the legibility threshold), and the gridlines and edge rulers from `src/lib/guides.ts`. Rulers need no positioning of their own — the canvas is already pinned to the visible corner, so its first pixels are always on screen. The canvas is sized to the *container*, never the pattern: `#grid-wrapper` is an empty spacer sized to the pattern that drives the native scrollbars, and the canvas is a `position: sticky` overlay pinned to the visible corner. Every length here is a CSS pixel; `devicePixelRatio` is confined to `layout()`, which sizes the backing store and applies the density once via `ctx.setTransform` — so the draw loop reads the CSS sizes off the view state, never `canvas.width`/`.height`.
- `src/render/inventory.ts` — the bead-count list (OUT-4).
- `src/styles.css` — all styling, moved out of the original single file. Still carries that origin: 8-space base indent and ad-hoc spacing/radius/type literals. It does have a `@media (max-width: 640px)` block for the narrow-width layout. M8 (UI-3) replaces the literals with scales; don't hand-tidy it before then.
- `colors.json` — a 291-record palette with `name` and `hex` only. Not loaded by the app and it would fail PAL-4 validation as-is; it is an input to `helper.py`, kept for PAL-6.
- `helper.py` — adds RGB tuples to a hex-only palette JSON.
- `pixi.toml` — conda workspace for the Python side only. npm owns the web app; don't try to make pixi manage Node.

## Conventions

- Four-space indentation; no linter or formatter is configured.
- Deterministic logic goes in `src/lib/` or `src/pipeline/` and gets a test (NFR-4). Anything touching the DOM, canvas, or `FileReader` stays out of those directories so the tests keep running without a browser.
- Look up elements through `requireElement` from `src/dom.ts` rather than raw `getElementById`.
