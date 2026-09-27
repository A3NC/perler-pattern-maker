# Perler Pattern Generator

**Demo:** https://perler-pattern-maker-three.vercel.app/

A browser app that turns an image into a Perler bead pattern: a grid of real Perler colors, with
the bead code on each cell and a shopping list of how many beads of each color you need.

Everything runs in your browser. There is no backend and no account, and your image is never
uploaded anywhere.

## For graders: where everything is

| Submission element | Where |
|---|---|
| Project description | [What it does](#what-it-does), below |
| Setup, run, test | [Setup](#setup) · [Running it](#running-it) · [Testing](#testing) |
| Where the implementation falls short of the spec | [Known issues](#known-issues-against-the-spec) |
| Specification and system architecture | [`SPEC.md`](SPEC.md). See [System architecture](SPEC.md#system-architecture) and [Requirements](SPEC.md#requirements) |
| Requirement-by-requirement checklist | [Requirements checklist](#requirements-checklist), below |
| Dev environment config | `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `vite.config.ts`, `pixi.toml`, `.gitignore`, `.gitattributes` (see [Setup](#setup)) |
| Implementation code | `src/`, `index.html`, `public/colors_221.json` |
| Testing code | `src/**/*.test.ts`: **217 unit tests in 18 files**. Browser checks in `scripts/ui-check/` |

## What it does

1. **Upload an image**: PNG, JPEG, GIF, WebP or BMP. A file the app can't use is turned away with
   a specific reason, such as a text file renamed to `.png`, a download that was cut off, or an
   image that's too large.
2. **Crop** to the part you want. This matters more than it sounds: cropping gives each bead more
   of the picture, and it trims the blank canvas around a drawing.
3. **Choose a size**: a width in inches, a bead size (Standard 5 mm or Mini 2.6 mm), and a maximum
   number of colors. The bead grid and total bead count update as you change them, before you
   generate.
4. **Generate.** Each bead cell is matched to the nearest Perler color *as your eye sees it*
   (OkLab), not by raw RGB, and extra colors are merged away until the pattern fits your limit.
5. **View** the pattern: zoom, pan, and turn bead codes and gridlines (with numbered rulers) on and
   off.
6. **Fix it by hand** with a brush, eraser and flood fill, with undo and redo. Alt-click any bead
   to pick up its color.
7. **Shop from the bead list**: every color used and its count, sortable by count or name.
8. **Download a PNG** with gridlines, codes, and row and column numbers. It's meant for reading on
   a screen, not for printing.
9. **Refresh without losing work.** The pattern, its settings and the source image are saved in
   your browser automatically.

Limits: images up to 8000 px per side, and patterns up to 300 beads per side and 50,000 beads in
total. The interface uses a light, pixel-art sky theme. There is no dark mode yet.

## Setup

### 1. Prerequisites

| Tool | Version | Needed for | Check with |
|---|---|---|---|
| Node.js (includes npm) | **22 or newer** | Everything | `node -v` |
| Google Chrome | Current | Only the optional browser checks in `scripts/ui-check/` | — |
| Python 3 | Any 3.x, standard library only | Only the optional palette helper `helper.py` | `python3 --version` |

To get Node 22, either install it from https://nodejs.org, or use `nvm`. The repo's `.nvmrc` pins
the version:

```bash
nvm install    # reads .nvmrc
nvm use
```

### 2. Install dependencies

```bash
git clone <this repo>
cd <repo folder>
npm install    # installs exactly what package-lock.json lists
```

`npm install` sets up the whole dev environment. There are no environment variables, API keys or
databases to configure.

### 3. Verify the setup

```bash
npm run check  # type check plus all 217 unit tests; should end with "217 passed"
```

### What each config file does

| File | Purpose |
|---|---|
| `package.json` | Scripts (below), dev dependencies (Vite, TypeScript, Vitest), and `engines: node >= 22` |
| `package-lock.json` | Exact dependency versions, for reproducible installs |
| `.nvmrc` | Node version for `nvm` |
| `tsconfig.json` | TypeScript compiler settings (strict mode, ES2022, browser DOM types) |
| `vite.config.ts` | Build config. `base: './'` makes the built site work from any folder |
| `pixi.toml` | Optional conda workspace for the Python helper only. npm manages the web app, not pixi |
| `.gitignore`, `.gitattributes` | Keep `node_modules/`, `dist/` and screenshot output out of git; normalize line endings |

## Running it

```bash
npm run dev    # then open the URL it prints (usually http://localhost:5173/)
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server that reloads on save |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests only |
| `npm run typecheck` | TypeScript type check only |
| `npm run check` | Type check plus unit tests. This is the full gate |

Use `npm run dev`. Opening `index.html` directly, or serving the project folder with a plain file
server, won't work, because the source is TypeScript. The page then stays on "Loading color
palette..." with Generate disabled, and the browser console says why. To use your own server, run
`npm run build`, then serve `dist/` (for example `python3 -m http.server 8000 --directory dist`).

Sample images to try are in `test_img/` (R1–R6, the reference set from SPEC.md).

## Testing

### Unit tests: 217 tests in 18 files

Run them with `npm test`, or `npm run check` to include the type check. They run in Node with
[Vitest](https://vitest.dev/) and need no browser. Each test file sits **next to the module it
tests**, in `src/lib/` and `src/pipeline/`, the two folders that hold all the deterministic logic
(requirement NFR-4).

| Test file | Tests | Covers |
|---|---:|---|
| `src/lib/image-file.test.ts` | 24 | File-type sniffing, truncation, size ceiling, HEIC (IN-1 … IN-6) |
| `src/lib/pattern-utils.test.ts` | 10 | Palette validation, grid dimensions, size limits (PAL-4, SET-1, SET-2, SET-5, NFR-3) |
| `src/lib/crop.test.ts` | 17 | Crop geometry: clamping, moving, resizing, hit testing (IN-5) |
| `src/lib/viewport.test.ts` | 17 | Zoom limits, centre-fixed zoom, visible cells, code legibility (VIEW-2, VIEW-3, VIEW-5) |
| `src/lib/guides.test.ts` | 11 | Gridlines and ruler labels (VIEW-6, VIEW-7) |
| `src/lib/cell-path.test.ts` | 8 | Brush strokes join into continuous lines (EDIT-1) |
| `src/lib/pattern-edit.test.ts` | 7 | Paint, erase, stroke recording, tallies (EDIT-2, EDIT-4) |
| `src/lib/palette-query.test.ts` | 9 | Color picker search and nearest colors (EDIT-3) |
| `src/lib/edit-history.test.ts` | 7 | Undo/redo stack and its memory bound (EDIT-7) |
| `src/lib/flood-fill.test.ts` | 9 | Flood fill (EDIT-8) |
| `src/lib/regenerate.test.ts` | 5 | When Generate asks before erasing hand edits (D28) |
| `src/lib/export-layout.test.ts` | 19 | PNG export geometry, fixed cell size (OUT-1, OUT-3, GEN-5) |
| `src/lib/pattern-save.test.ts` | 20 | Autosave format round-trips and rejects bad records (SAVE-1) |
| `src/lib/oklab.test.ts` | 7 | OkLab color conversion (GEN-2, GEN-4) |
| `src/pipeline/color-match.test.ts` | 6 | Nearest-color matching, swappable matcher (GEN-2, GEN-6) |
| `src/pipeline/downscale.test.ts` | 25 | Area-averaged downscaling, transparency (GEN-1, GEN-4, SET-3) |
| `src/pipeline/reduce.test.ts` | 7 | Color reduction to the limit, deterministic ties (GEN-3, SET-4, GEN-7) |
| `src/pipeline/generate.test.ts` | 9 | The whole pipeline, bead counts, determinism (GEN-3, GEN-7, SET-3, OUT-4) |

### Browser checks (optional)

`scripts/ui-check/` drives headless Chrome to check things a unit test can't reach. These scripts
need Chrome installed (set `CHROME=/path/to/chrome` if it isn't at the macOS default path) and the
dev server running in a second terminal (`npm run dev`). They are not part of `npm run check` for
that reason. Output goes to `scripts/ui-check/out/`.

| Command | What it checks |
|---|---|
| `npm run ui:audit` | No overflow, 44 px touch targets, WCAG AA contrast and focus rings, in six screen states at 1280 and 390 px (UI-1, UI-2, UI-4, UI-5, UI-6). Exits non-zero on failure |
| `npm run ui:e2e` | Full walk at both widths: upload → crop → generate → brush, eraser, undo/redo, eyedropper, fill → export → reload and restore → regenerate → rejected file |
| `npm run ui:export-hash` | Two exports of the same pattern are byte-identical (OUT-3) |
| `npm run ui:focus` | Screenshot of every control while focused (UI-4) |
| `npm run ui:file-picker` | The upload control's behaviour |
| `npm run ui:fonts` | Which font faces Chrome actually painted |
| `npm run ui:review` | Renders `test_img/R1–R6` for the reference-image review (GEN-8), which a person judges |

### Manual checks

A few requirements are judged by a person, and their procedure is in SPEC.md: the reference-image
review (GEN-8, [Done looks like](SPEC.md#done-looks-like)), the interface review (UI-7), the theme
(UI-8), and the network-off test (SAVE-2).

## Requirements checklist

Every requirement in [`SPEC.md`](SPEC.md#requirements) has an ID and a **Check:** line saying how to
verify it. All 55 **[v1]** requirements are ticked. The table lists each one with its fastest route to
verification. "App" means try it in `npm run dev`; test files are in the [Testing](#testing) table.

| ID | Requirement | How to verify |
|---|---|---|
| **Input** | | |
| IN-1 | Accept PNG, JPEG, GIF, WebP, BMP | `image-file.test.ts`; app: upload one |
| IN-2 | Reject non-image files with a specific error | `image-file.test.ts`; `ui:e2e` (rejected file) |
| IN-3 | Reject corrupted or truncated files | `image-file.test.ts` |
| IN-4 | Say so when the browser can't decode a file (e.g. HEIC in Chrome) | `image-file.test.ts`; app: upload a `.heic` in Chrome |
| IN-5 | Preview (with crop) before generating | `crop.test.ts`; app |
| IN-6 | Reject images above the size ceiling | `image-file.test.ts` |
| **Settings** | | |
| SET-1 | Target width in inches | `pattern-utils.test.ts`; app |
| SET-2 | Bead size: Standard 5 mm / Mini 2.6 mm | `pattern-utils.test.ts`; app |
| SET-3 | Grid size and bead count shown before Generate | `downscale.test.ts`, `generate.test.ts`; app |
| SET-4 | Maximum color count (default 30) | `reduce.test.ts`, `generate.test.ts`; app: set 12, count the bead list |
| SET-5 | Reject sizes over the limits with a message | `pattern-utils.test.ts`; app: enter a huge width |
| **Palette** | | |
| PAL-1 | Palettes are fixed; no color editing | App: no such control exists |
| PAL-2 | 221-color palette loads by default | App: status line reads "Default palette loaded (221 colors)" |
| PAL-3 | Readable error if the palette fails to load | Rename `public/colors_221.json`, reload: error shown, Generate disabled |
| PAL-4 | Palette entries validated | `pattern-utils.test.ts` |
| **Generation** | | |
| GEN-1 | One color per cell; transparent → empty, not counted | `downscale.test.ts`; app: `test_img/R1.PNG` |
| GEN-2 | Perceptual (OkLab) matching | `oklab.test.ts`, `color-match.test.ts` |
| GEN-3 | Merge colors down to the limit | `reduce.test.ts`, `generate.test.ts` |
| GEN-4 | Average source pixels per cell | `downscale.test.ts`, `oklab.test.ts` |
| GEN-5 | Flat, hard-edged cells | `export-layout.test.ts`; app: zoom in |
| GEN-6 | Pipeline is one replaceable unit | `color-match.test.ts`; `src/pipeline/generate.ts` |
| GEN-7 | Deterministic output | `generate.test.ts`, `reduce.test.ts`; `ui:export-hash` |
| GEN-8 | Recognizable, intentional-looking pixel art | `ui:review` on R1–R6, judged by eye (v1 bar, D30) |
| **Pattern view** | | |
| VIEW-1 | Rendered on one canvas | App / `src/render/canvas-view.ts` |
| VIEW-2 | Zoom and pan | `viewport.test.ts`; app |
| VIEW-3 | Bead codes on cells, toggleable | `viewport.test.ts`; app |
| VIEW-4 | Codes legible on dark and light beads | App: zoom in on dark and light cells |
| VIEW-5 | Codes hide when cells get too small | `viewport.test.ts`; app: zoom out |
| VIEW-6 | Gridlines every 10 cells, toggleable | `guides.test.ts`; app |
| VIEW-7 | Row and column numbers on the edges | `guides.test.ts`; app |
| **Editing** | | |
| EDIT-1 | Brush | `cell-path.test.ts`; `ui:e2e` |
| EDIT-2 | Eraser | `pattern-edit.test.ts`; `ui:e2e` |
| EDIT-3 | Color picker | `palette-query.test.ts`; `ui:e2e` |
| EDIT-4 | Edits update the bead list immediately | `pattern-edit.test.ts`; app |
| EDIT-5 | Pan without painting | App: pan tool |
| EDIT-7 | Undo/redo for strokes, erases and fills | `edit-history.test.ts`; `ui:e2e` |
| EDIT-8 | Flood fill | `flood-fill.test.ts`; `ui:e2e` |
| **Output** | | |
| OUT-1 | PNG export with codes | `export-layout.test.ts`; app: Download PNG |
| OUT-2 | Export includes hand edits | `ui:e2e`; app |
| OUT-3 | Export independent of zoom | `export-layout.test.ts`; `ui:export-hash` |
| OUT-4 | Bead list: code, swatch, count, sortable | `generate.test.ts`; app |
| **Persistence** | | |
| SAVE-1 | Autosave pattern, settings and edits | `pattern-save.test.ts`; `ui:e2e` (reload-restore); app: refresh |
| SAVE-2 | Nothing leaves the browser | App: DevTools Network tab, offline after load |
| **User interface** | | |
| UI-1 | No clipping or horizontal scroll at 390 px | `ui:audit` |
| UI-2 | Controls reflow to one column | `ui:audit` |
| UI-3 | Spacing, radii, type come from scales | `src/styles.css` `:root` |
| UI-4 | Visible keyboard focus | `ui:audit`, `ui:focus` |
| UI-5 | WCAG AA contrast | `ui:audit` |
| UI-6 | 44 × 44 px targets at 390 px | `ui:audit` |
| UI-7 *(v2, done early)* | Looks intentionally designed | Interface review U1–U5 in SPEC.md |
| UI-8 | Light-mode sky theme | App |
| **Non-functional** | | |
| NFR-1 | Static, free to host | `npm run build`, serve `dist/`; the Vercel demo |
| NFR-2 | Generation doesn't freeze the page | App: largest pattern. See [known issues](#known-issues-against-the-spec) |
| NFR-3 | Size limits (300 per side, 50,000 beads) | `pattern-utils.test.ts` and others |
| NFR-4 | Logic tested without a browser | `npm test` |
| NFR-5 | Works at 1280 px and 390 px | `ui:audit`, `ui:e2e` (both widths) |

EDIT-6 was retired. The unticked items in SPEC.md are all marked **[v2]** or **[later]** and are
out of scope for this release.

## How the code is organized

```
src/
  lib/        pure logic (palette, dimensions, crop, editing, undo, export layout, saving), all tested
  pipeline/   image in, pattern out: downscaling, color matching, color reduction, all tested
  state/      the live pattern, and autosave to IndexedDB
  render/     everything on screen: the canvas view, editor, crop, bead list, PNG export
  assets/     self-hosted fonts, and the hand-drawn SVG clouds and cursors
  styles.css  all styling; colors, spacing and type are variables at the top
scripts/ui-check/        the headless-Chrome interface checks
public/colors_221.json   the 221-color Perler palette
test_img/                the six reference images (R1–R6)
```

The rule that keeps this testable: anything deterministic lives in `lib/` or `pipeline/` and has a
test, and anything that touches the page stays out of those folders. The full architecture, with
a data-flow diagram, is in [SPEC.md](SPEC.md#system-architecture).

`SPEC.md` lists every requirement with how to check it, plus the reasoning behind each decision.
`plan-v1.md` lays out the milestones. `CLAUDE.md` holds detailed working notes for contributors.

## Status

**v1 is complete** (2026-09-26): all 12 milestones are done, and every v1 requirement in
`SPEC.md` passes its check.

| Milestone | What it added |
|---|---|
| M0 | Project setup (Vite + TypeScript) |
| M1 | Canvas pattern view with zoom and pan |
| M2 | Perceptual color matching and the color limit |
| M3 | Clear error messages for unusable files |
| M4 | Crop, and a live bead count before generating |
| M5 | Editor: brush, eraser, fill, undo/redo, color picker |
| M6 | PNG export |
| M7 | Autosave |
| M8 | Accessibility and layout pass, plus fonts and styling |
| M9 | Final verification, in Chrome and desktop Safari |
| M10 | Gridlines and edge rulers |
| M11 | Pixel sky theme and custom cursors |

## Known issues against the spec

Each of these is recorded in `SPEC.md`, under the ID given.

- **Conversion quality is "good, and fixable in the editor" (GEN-8, D30).** That is below the
  original bar in SPEC.md's reference-image table. Flat areas can pick up stray specks, thin
  outlines can break up, shading can be noisy, and small details (eyes, jewellery, a belt) tend to
  blend into their neighbours. Meeting the original bar needs a redesigned generator (GEN-9, v2).
- **Speed (NFR-2, D27):** the largest allowed pattern blocks the page for about 0.3 s while it
  generates, over the spec's ~150 ms target. A "Generating pattern..." message shows first, and
  the output is full quality. Running generation in a background worker is v2 (NFR-6).
- **Phones (NFR-5):** tested only in Chrome's phone emulation, not on real devices. A retest on
  real or simulated phones is v2 (NFR-7). On a phone, the editing tools also sit far above the
  canvas while you paint (UI-9).
- **Browsers:** verified in Chrome and desktop Safari 18.6. Firefox was not tested.
- **Large exports** use small codes. They are readable on a desktop screen; splitting big patterns
  into several full-size files is deferred (OUT-6).
- **Regenerating** asks before discarding hand edits only when the settings haven't changed (D28).
  Change a setting and Generate replaces the pattern, edits included.
- **Interface weak spots (UI-7):** over the size limit, Generate stays enabled beside the error, and
  a short pattern leaves empty space in the fixed-height pattern box.
