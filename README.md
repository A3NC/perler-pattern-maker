# Perler Pattern Generator

**Demo:** https://perler-pattern-maker-three.vercel.app/

A browser app that turns an image into a Perler bead pattern: a grid of real Perler colors, with
the bead code on each cell and a shopping list of how many beads of each color you need.

Everything runs in your browser. There is no backend and no account, and your image is never
uploaded anywhere.

## What it does

1. **Upload an image**: PNG, JPEG, GIF, WebP or BMP. A file the app can't use is turned away with
   a specific reason, such as a text file renamed to `.png`, a download that was cut off, or an
   image that's too large.
2. **Crop** to the part you want. This matters more than it sounds: cropping gives each bead more
   of the picture, and it trims the blank canvas around a drawing.
3. **Choose a size**: a width in inches, a bead size (Standard 5 mm or Mini 2.6 mm), and a maximum
   number of colors. The bead grid and total bead count update as you change them, before you
   generate.
4. **Generate.** Each bead cell is matched to the nearest Perler color *as your eye sees it*,
   rather than by raw RGB, and extra colors are merged away until the pattern fits your limit.
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
total.

The interface uses a light, pixel-art sky theme. There is no dark mode yet.

## Running it

Requires Node 22 or newer.

```bash
npm install
npm run dev     # then open the URL it prints
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server that reloads on save |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | Type check plus the full test suite |
| `npm run ui:audit` | Automated interface checks (layout, contrast, focus, touch targets) in headless Chrome, against a running dev server |

Use `npm run dev`. Opening `index.html` directly, or serving the project folder with a plain file
server, won't work, because the source is TypeScript. The page then stays on "Loading color
palette..." with Generate disabled, and the browser console says why. To use your own server, run
`npm run build` and serve `dist/`.

## How the code is organized

```
src/
  lib/        pure logic (palette, dimensions, crop, editing, undo, export layout, saving), all tested
  pipeline/   image in, pattern out: downscaling, color matching, color reduction
  state/      the live pattern, and autosave to IndexedDB
  render/     everything on screen: the canvas view, editor, crop, bead list, PNG export
  assets/     self-hosted fonts, and the hand-drawn SVG clouds and cursors
  styles.css  all styling; colors, spacing and type are variables at the top
scripts/ui-check/   the headless-Chrome interface checks
public/colors_221.json   the 221-color Perler palette
```

The rule that keeps this testable: anything deterministic lives in `lib/` or `pipeline/` and has a
test, and anything that touches the page stays out of those folders.

`specs.md` lists every requirement with how to check it, plus the reasoning behind each decision.
`plan-v1.md` lays out the milestones. `CLAUDE.md` holds detailed working notes for contributors.

## Status

**v1 is nearly done: 11 of 12 milestones are complete.** Only final verification (M9) remains.

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
| M10 | Gridlines and edge rulers |
| M11 | Pixel sky theme and custom cursors |
| **M9** | **Final verification: next** |

Known gaps, all recorded for M9 or later:

- **Conversion quality** isn't fully signed off. Dark, shaded areas band more than they should, and
  small facial features on drawn characters can distort. The editor is the fix for now.
- **Speed:** generating the largest allowed pattern takes about 315 ms, against a ~150 ms target.
- **Devices:** everything has been tested in Chrome, including its phone emulation. Safari and a
  real phone haven't been checked yet.
- **Regenerating** a pattern you've edited by hand replaces your edits without warning.
