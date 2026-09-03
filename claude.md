# Project Development Context

_Last reviewed: 2026-09-03_

## Project summary

This directory contains a client-side web application that converts an uploaded image into a Perler bead pattern. The user chooses a target physical width and bead size; the app calculates the required bead-grid dimensions, resizes the image, maps each visible pixel to the nearest color in a Perler palette, and displays an interactive pattern with bead codes and an inventory count.

The application is currently a functional single-page MVP. It has no build system, package manager dependencies, browser test harness, backend, persistence, or export workflow; deterministic Node tests cover reusable utility logic.

## Current repository contents

- `perler.html` — The complete application: HTML structure, inline CSS, and browser JavaScript.
- `colors_221.json` — The palette currently loaded by the app. It contains 221 records with `name`, `hex`, and precomputed `rgb` fields. This is currently the most common Perler bead color set used by the project.
- `colors.json` — A larger 291-record source palette containing `name` and `hex` only. It is not currently loaded by the app; it represents a more complete color set.
- `helper.py` — Small Python utility that converts a palette JSON file with hex colors into a new JSON file with added RGB tuples.
- `pattern-utils.mjs` — Dependency-free, browser-independent utility functions for palette normalization/validation, dimension validation, RGB matching, and inventory tallying.
- `pattern-utils.test.mjs` — Node's built-in test suite covering the deterministic pattern utility functions.
- `plan.md` — Original core requirements.
- `todo.md` — Outstanding feature ideas and notes from previous development.
- `pixi.toml` — Minimal Pixi workspace metadata; it currently declares no dependencies or tasks.
- `.gitignore`, `.gitattributes` — Local Pixi and Git configuration.

There are no browser test files or source directories beyond the files listed above; deterministic Node tests are provided in `pattern-utils.test.mjs`.

## Implemented functionality

### Input and sizing

- Uploads local raster images through an `<input type="file">` accepting `image/*`.
- Reads the image with `FileReader` and enables generation after the image has loaded.
- Accepts a target physical width in inches.
- Supports two bead sizes:
  - Standard 5 mm: `0.197` inches per bead.
  - Mini 2 mm: `0.079` inches per bead.
- Calculates grid width as `round(target width / bead size)`.
- Calculates grid height from the source image aspect ratio.

### Image processing and color mapping

- Uses a hidden HTML canvas to resize the uploaded image.
- Turns off canvas image smoothing before drawing, which is appropriate for hard-edged pixel-art input.
- Reads resized RGBA pixels with `getImageData`.
- Leaves pixels with alpha below 128 empty instead of counting them as beads.
- Maps each non-transparent pixel to the closest palette color using Euclidean distance in RGB space.
- Uses `colors_221.json` at runtime, fetched relative to the HTML file.
- Normalizes palette records so files containing only `name` and `hex` can be used, and validates non-empty unique names plus integer RGB channels in the 0–255 range before enabling generation.
- Keeps generation disabled until the default palette has loaded successfully.
- Reports palette fetch/validation failures, unreadable or undecodable image files, missing images, invalid dimensions, and oversized patterns in a visible status message.
- Enforces a safe rendering limit of 500 beads per dimension and 100,000 total cells to prevent unbounded DOM/canvas work.
- Provides deterministic utility tests in `pattern-utils.test.mjs`, runnable with Node's built-in test runner.

### Pattern display

- Creates a CSS Grid cell for every resized image pixel.
- Fills each cell with the matched bead color.
- Places the palette color name/code over the cell.
- Chooses black or white code text using a simple luminance threshold.
- Provides zoom-in and zoom-out controls.
- Uses a wrapper plus CSS transform scaling to preserve scrollbars and keep the viewport centered while zooming.
- Provides a “Show Codes” checkbox to hide or reveal all bead codes.

### Inventory display

- Counts required beads by matched palette color.
- Displays a color swatch, color name/code, and quantity for every color used.
- Sorts inventory either by largest count or alphabetically by color name.
- Hides the inventory until a pattern contains at least one visible bead.

## Important implementation notes

- `perler.html` is the source of truth for application behavior; all UI and processing logic is inline.
- The browser must load the palette through `fetch`, so opening `perler.html` directly with a `file://` URL may fail due to browser security restrictions. Use a local HTTP server.
- The current code references `colors_221.json`, not `colors.json`. The two files differ in both record count and schema.
- The previous memo in `todo.md` says Floyd–Steinberg dithering was implemented, but the current `perler.html` implementation does not contain a dithering pass. It performs direct nearest-color matching after canvas resizing. Do not describe dithering as active unless it is added to the code.
- Generation is now guarded by an explicit palette-loading state, but future palette-selection support should preserve the same readiness and validation checks.
- Color matching scans the full 221-color palette for every visible pixel. This is simple and correct for small patterns but can become slow for large target widths.
- The generation handler explicitly rejects missing/invalid dimensions, an unloaded image, an unavailable/empty palette, unsupported image files, decoding failures, and patterns exceeding the safe size limit.

## Known gaps and risks

1. **Background removal is not implemented.** White or near-white backgrounds are currently treated as real beads. Transparent source pixels are skipped only when the uploaded image already contains alpha transparency.
2. **No selectable scaling or quantization algorithms.** There is no UI or implementation for nearest-neighbor versus dithering, area averaging, or pixel-art-specific handling.
3. **No editing tools.** Users cannot draw, erase, pick colors, drag/pan, or change individual cells after generation.
4. **No auto-border.** The app does not add a border around the generated pattern.
5. **No original/pattern comparison toggle.** Only the generated grid is shown after processing.
6. **No export or persistence.** Patterns cannot be downloaded, saved, loaded, or shared.
7. **No dedicated landing page or tutorial.** The app opens directly on the maker interface.
8. **UI polish is incomplete.** The current styling is a generic responsive card with an indigo palette; the alternative/creative visual direction in `todo.md` has not been implemented.
9. **Browser verification is still manual.** Deterministic utility tests now exist, but there are no browser, accessibility, or performance tests.
10. **Large-pattern performance needs attention.** DOM creation for every cell and repeated full-palette RGB scans may make very large patterns slow or memory-heavy.
11. **Palette selection is currently fixed.** `colors_221.json` is the active and most common set. More complete sets contain additional colors, while other Perler bead sets contain fewer colors. A future UI toggle can let users choose among supported palette sets; each set should be documented and validated before it is exposed.
12. **Palette provenance should be documented.** The available palette files differ in record count and schema, so future work should document their source and licensing.

## Prioritized future roadmap

### Priority 0 — Reliability and maintainability

- [x] Add explicit palette-loading state and disable generation until the palette request succeeds.
- [x] Add user-visible errors for palette fetch failures, invalid dimensions, unsupported/corrupt images, and patterns that exceed a safe size limit.
- [x] Validate that each palette record has a unique code/name and valid RGB values.
- [x] Keep `colors_221.json` as the current default palette, and preserve a path for selecting other documented palette sets in a future toggle. This may include the more complete `colors.json` set and smaller sets added later.
- [x] Normalize every selectable palette to the same runtime schema (`name`, `hex`, and `rgb`) and validate records before use.
- [ ] Extract the inline UI JavaScript into a separate module only if the project grows; reusable deterministic logic already lives in `pattern-utils.mjs`.
- [x] Add deterministic tests for dimension calculation, RGB distance, color matching, palette validation, and inventory counts. Transparency remains covered by the browser smoke-test checklist until a browser test harness is introduced.

The Priority 0 reliability work is complete for the current no-build MVP. Run `node --test pattern-utils.test.mjs` after changes to the pure utility logic.

### Priority 1 — Improve pattern fidelity

- Implement optional background removal before resizing, with a clear threshold/tolerance control and correct handling of source alpha.
- Add selectable resize/quantization modes, at minimum:
  - direct nearest-neighbor mapping,
  - area-average sampling for photographic images,
  - Floyd–Steinberg dithering as an explicit opt-in mode.
- Add a mode for already-pixelated input so existing square pixels are not unnecessarily blurred or reinterpreted.
- Consider caching or precomputing palette data, and profile large grids before optimizing the matching algorithm.

### Priority 1 — Improve the maker experience

- Add a polished visual system with intentional typography, color themes, and responsive controls.
- Add an original-image/pattern toggle.
- Add a clear pattern summary including physical width, physical height, grid dimensions, and bead count.
- Improve keyboard navigation, focus states, labels, status announcements, and contrast.
- Make the zoom/pan interaction robust on very large and very small patterns, including touch input if appropriate.

### Priority 2 — Post-generation editing

- Add a one-cell brush, eraser, color picker, palette selector, and drag/pan tool.
- Snap manually chosen colors to the closest available Perler color.
- Recompute the inventory after every edit.
- Add optional automatic border generation with configurable border color and thickness.

### Priority 2 — Export and persistence

- Add export for a printable pattern, a palette/inventory list, and a plain data format for reloading.
- Define a stable pattern schema containing dimensions, bead size, selected algorithm, palette identity, cells, and metadata.
- Add save/load support using browser storage or local file import/export; do not introduce a backend unless a sharing requirement appears.

### Priority 3 — Product expansion

- Add a homepage explaining the workflow and linking to the maker.
- Add example patterns and a short usage guide.
- Consider shareable pattern URLs only after a persistence format and privacy model are defined.

## Local development and manual verification

From this directory, start a static server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/perler.html` in a browser. A typical manual smoke test is:

1. Confirm the page loads without console errors and the palette request succeeds.
2. Upload a small opaque image and verify the Generate button becomes enabled.
3. Generate with both Standard and Mini bead sizes; verify dimensions and aspect ratio.
4. Verify every visible cell has a palette color and code, while transparent source pixels remain empty.
5. Toggle “Show Codes,” zoom in/out, and test scrolling on a pattern larger than the viewport.
6. Change inventory sorting and verify counts sum to the visible bead total.
7. Repeat with a PNG containing transparency and with a white-background image to document current behavior.
8. Test invalid/empty input and generation before palette loading once validation is added.

To regenerate RGB fields in a palette file:

```bash
python3 helper.py colors.json colors_with_rgb.json
```

The helper expects exactly two positional arguments: input JSON path and output JSON path. It does not currently validate malformed hex values, duplicate names, or output overwrite policy.

## Guidance for future AI contributors

- Read `perler.html`, `plan.md`, and `todo.md` before changing behavior.
- Treat this document as a status map, not as a substitute for inspecting the code.
- Preserve the client-side/no-build setup unless a requested feature clearly requires a dependency or backend.
- Keep palette selection and schema explicit; do not silently switch between the 221- and 291-record files.
- When changing image-processing behavior, document whether transparency, aspect ratio, smoothing, and physical bead dimensions are affected.
- Update the implemented/gaps sections when a roadmap item is completed, and add or update tests for logic that can be tested without a browser.
- Do not claim a feature is implemented based only on historical notes in `todo.md`; verify it exists in the current source.
