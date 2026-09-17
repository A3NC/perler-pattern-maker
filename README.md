# Perler Pattern Generator

A browser app that turns an uploaded image into a Perler bead pattern: a grid of bead-sized cells,
each assigned a real Perler bead color, with the color code on each cell and a bead-count list for
shopping and sorting.

Everything runs client-side. There is no backend, no account, and no upload — the image never
leaves the browser.

## What it does today

1. Upload an image (any format the browser can decode).
2. Choose a finished physical width in inches and a bead size — Standard (5 mm) or Mini (2.6 mm).
3. The app derives the bead-grid dimensions from the width, the bead pitch, and the image's aspect
   ratio, resizes the image to that grid, and maps each visible pixel to the nearest palette color.
   Pixels with alpha < 128 become empty cells rather than beads.
4. The pattern renders on a canvas: zoom, drag to pan, toggle bead codes, toggle gridlines and the
   edge rulers that number every tenth row and column.
5. A bead inventory lists every color used with its count, sortable by count or by name.

Guard rails: 300 beads per side and 50,000 cells total. Exceeding either is reported with a message
that names the limit that was actually hit.

## Quick start

Requires Node >= 22.

```bash
npm install
npm run dev     # Vite dev server; open the URL it prints
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with reload-on-save |
| `npm run build` | Static production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm test` | Vitest, browser-free (`npm run test:watch` to iterate) |
| `npm run typecheck` | `tsc --noEmit` — Vite strips types without checking them, so this is the only thing enforcing them |
| `npm run check` | typecheck + tests, the full gate |


## Layout

```
index.html              markup + the inline boot guard; loads src/main.ts as a module
public/colors_221.json  the default 221-color palette (name, hex, rgb), fetched at startup
src/
  main.ts               startup wiring: DOM refs, palette load, upload/generate listeners
  types.ts              PaletteColor, Palette, Pattern, PatternDimensions, ColorTally, SourcePixels
  lib/
    pattern-utils.ts    palette normalization/validation, dimension math, color matching, tallying
    viewport.ts         zoom limits, scroll offset on zoom, visible cell range, screen point → cell
    guides.ts           gridline interval, ruler label step, which boundaries are visible
  pipeline/
    generate.ts         pixels in, Pattern out — no DOM
  rasterize.ts          hidden canvas: image → SourcePixels
  render/
    canvas-view.ts      the canvas pattern view: zoom, pan, codes, gridlines, rulers
    inventory.ts        the bead-count list
  palette.ts  upload.ts  status.ts  dom.ts  contrast.ts
  styles.css            all styling, including the narrow-viewport media query
helper.py               adds RGB tuples to a hex-only palette JSON
colors.json             291-record hex-only palette; input to helper.py, not loaded by the app
```

`Pattern` — width, height, and a row-major array of cells that are either a palette color or
`null` — is the durable contract between the pipeline and everything downstream that renders,
edits, exports, or serializes it.


## Status

v1 is in progress. **M0** (Vite + TypeScript, Mini pitch corrected to 2.6 mm), **M1** (canvas
pattern view replacing the element-per-bead grid), and **M10** (gridlines and edge rulers) are
done. **M2 — the quality core: OkLab matching, per-cell area averaging, and a user-set color limit
— is in flight**; color matching in the pipeline is still nearest-RGB until it lands.

Still ahead: input-error handling, crop, the correction editor, PNG export, autosave, and the
interface floor.
