# Perler Pattern Generator

A browser app that turns an uploaded image into a Perler bead pattern: a grid of bead-sized cells,
each assigned a real Perler bead color, with the color code on each cell and a bead-count list for
shopping and sorting.

Everything runs client-side. There is no backend, no account, and no upload — the image never
leaves the browser.

## What it does today

1. **Upload an image** — PNG, JPEG, GIF, WebP or BMP. Files the app cannot use are turned away
   before anything is decoded, each with a message that says what was actually wrong: a PDF, a text
   file renamed to `.png`, a download that was cut off partway, an iPhone HEIC photo in a browser
   that cannot read one, an image too large to work with. The file's own bytes decide this, not its
   name or its extension — both of which are just the operating system guessing.
2. **Choose the finished size** — a physical width in inches and a bead size, Standard (5 mm) or
   Mini (2.6 mm) — and a limit on how many distinct colors the pattern may use.
3. **Generate.** The app derives the bead grid from the width, the bead pitch, and the image's
   aspect ratio, then averages the source pixels falling inside each bead cell and matches the
   result to the nearest Perler color *perceptually* — using a color space built to match how
   human eyes judge difference, rather than raw RGB distance, which does not. If the pattern
   uses more colors than the limit allows, the extras are merged away one at a time, always
   choosing the merge that costs the least visible change. Pixels that are mostly transparent
   become empty cells rather than beads.
4. **Read the pattern.** It renders on a canvas: zoom, drag to pan, toggle the bead code on each
   cell, and toggle gridlines with edge rulers numbering every tenth row and column.
5. **Fix what the conversion got wrong.** A brush paints a continuous run as you drag, an eraser
   clears cells back to empty, and a flood fill covers a whole contiguous region of one color — or
   fills it with empty, which is how you strip a plain background. Every stroke can be undone and
   redone. A separate pan mode never paints by accident, and alt-clicking any cell adopts its color.
6. **Read the bead inventory** — every color used, with its count, sortable by count or by name.
   Those rows double as the color picker, so choosing a color already in the pattern costs the
   shopping list nothing. For colors not yet in the pattern, a search panel ranks the palette by
   perceptual closeness and marks which candidates are already in use.

Guard rails: source images up to 8000 pixels per side, and patterns up to 300 beads per side and
50,000 cells total. Exceeding any of them is reported with a message that names the limit actually
hit.

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

v1 is in progress. Six of eleven milestones are done:

| | Milestone | What landed |
|---|---|---|
| **M0** | Project setup | Vite + TypeScript; Mini bead pitch corrected to 2.6 mm |
| **M1** | Canvas pattern view | Replaced the element-per-bead grid; zoom and pan by redraw |
| **M2** | Quality core | Perceptual color matching, per-cell averaging, the color limit |
| **M3** | Input handling and errors | Every rejected file gets a specific reason, decided from its bytes |
| **M5** | Correction editor | Brush, eraser, flood fill, undo/redo, two-tier color picker |
| **M10** | Pattern orientation | Gridlines and edge rulers |

**M2 is the one with a caveat worth stating.** It is closed, and it is what makes the output look
like the picture rather than like a palette — but its own quality gate is deliberately left open
rather than ticked to make the milestone look finished. Two things remain: dark and shaded regions
still band more than they should, and on drawn characters, facial features distort. The second is
not fixable anywhere in the conversion, because the bead grid is fixed before any of it runs and
where a cell boundary falls relative to an eye decides what that eye becomes. That is the honest
reason the editor exists — M5 is not only cleanup, it covers a class of defect the pipeline could
never reach.

**M3 turned out to rest on one fact:** a browser tells you an image failed to load without ever
telling you why. So the reason has to be worked out beforehand, from the file itself — which is
why a truncated download and an unreadable format produce different sentences rather than the
same shrug. A useful side effect: an image too large to handle is refused in milliseconds,
because its size is read from the file's header and nothing is ever decoded.

**M5 widened mid-project.** Undo and flood fill were both out of v1 on the reasoning that a
one-cell brush makes mistakes self-correcting; that reasoning did not survive contact with the fact
that what an edit overwrites was *generated*, not drawn by the user, so "just paint it again"
assumes knowledge they do not have. Both moved in before the milestone started rather than during
it.

**M6 — PNG export — is next**, and it is the last item on the critical path. Still ahead after
it: crop (M4), autosave (M7), the interface floor (M8), and final verification (M9).
