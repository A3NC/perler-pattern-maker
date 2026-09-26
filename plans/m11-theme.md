# M11 — Sky theme

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination. When M11 closes,
delete it and point `CLAUDE.md` at M9._

**Milestone goal (`plan-v1.md` M11):** the light-mode sky theme. A dithered pixel sky with clouds
outside the card, navy body text, one AA-passing blue accent, and a pixel arrow and hand cursor.

**Closes:** UI-8. **Re-verifies:** UI-1, UI-4, UI-5, UI-6, UI-7 (U1–U5). **Origin:** D26.
**Timebox:** half a day. Steps are ordered so that stopping early leaves the core done.

---

## Ground rules

- **Page chrome only.** Do not touch `canvas-view.ts`, `guide-style.ts`, `contrast.ts` or
  `export-png.ts`. The canvas's colours and the PNG export are outside D26's bounds, and OUT-3
  needs the export byte-identical.
- **A change of look is an edit to `:root`** (UI-3). New colours are tokens. Rules read tokens,
  including the cursor declarations. Match the file's four-space indent and comment style.
- **Drawn, not supplied.** Clouds and cursors are hand-written SVG (`<rect>`s on a pixel grid,
  `shape-rendering="crispEdges"`) in `src/assets/`, imported through `url()` like D25's fonts. Vite
  inlines small files as data URIs and hashes the rest, so a bad path fails the build. No bitmaps
  and no third-party URLs.
- **Light mode only.** Add no `prefers-color-scheme` block. v1 has one mode, and a future dark
  mode gets its own theme (D26).
- **No layout change unless the background forces one**, and each one is re-audited.

## Constraints this milestone must not break

- **`--bg` has two jobs today.** It is the body's background *and* the background of the inner
  panels, the dashed empty state, and several sunken rows. User requirement: inner surfaces keep
  their pre-M11 colours. So the sky gets **new tokens**, and `--bg` keeps its value.
- **No `transform`, `filter` or `contain` on `body`, `.container` or `#grid-wrapper`.** Any of them
  on an ancestor makes a `position: fixed` sky scroll with that ancestor. On `#grid-wrapper` they
  also break M1's sticky canvas and M10's free rulers.
- **Every piece of text sits inside `.container`** (checked in `index.html`: the body holds only
  the card and two scripts). So no text is measured against the sky. If a step puts text on the
  sky, it needs 4.5:1 against `#d3effe` as well as white.
- **The canvas's own cursors live in two places.** `.painting` sets `crosshair` and the canvas sets
  `grab`/`grabbing` in `styles.css`, and `crop-view.ts` writes an inline `style.cursor`. The
  crosshair and the crop cursors stay native (D26). Grab and grabbing are drawn in step 4b.

---

## Steps

### 0. Baseline

`npm run dev`, then `npm run ui:audit` and `ui:focus`, so any later failure is known to be M11's.
Screenshot U1–U5 at both widths as "before".

**Export a pattern from a fixed image and settings, and keep its SHA-256.** Step 5 compares
against it, and that comparison is UI-8's OUT-3 check.

**Done (2026-09-26), on `39a3cb5`:**
- `ui:audit` passes at both widths in all six states, over 122 Tab stops. The lowest contrast
  pairs are `#6b7280` on `#f9fafb` at 4.63, `#6b7280` on white at 4.83, and `#4b5563` on
  `#e5e7eb` at 6.10. The only "verify" line is the sort select's known over-report at 1280 px
  (~123 of ~120 px). M8 recorded it as a false positive on an auto-width select.
- `ui:focus`: 36 Tab stops at each width, 25 captured.
- Audit and focus screenshots are in `scripts/ui-check/out/m11-before/`, which is git-ignored and
  kept locally for step 5's side-by-side.
- **Export baseline:** `fixtures/art.png` at default settings gives
  `42ac415bdf8c4b392a6e643a6e04d4871767c924ec52ac17dbc321766ed93d85` (88,021 bytes). It is
  identical across both exports in a run and across two fresh runs. It comes from the new
  `npm run ui:export-hash` (`scripts/ui-check/export-hash.mjs`), which hooks `URL.createObjectURL`
  to hash the blob in the page, so it does not depend on headless download handling.

### 1. Colour tokens (core)

All in `:root`:

| Token | Now | M11 starting value | Measured against |
|---|---|---|---|
| `--primary` | `#4F46E5` | `#3d70b2` (hue of `#6893cb`, darker) | white 5.05, `--surface-sunken` 4.59, `--bg` 4.83 |
| `--primary-hover` | `#4338CA` | `#335d94` | white 6.70 |
| `--text` | `#111827` | `#06266d` | white 13.95, `--border` 11.26 |
| `--text-subtle` | `#374151` | `#3a4e78` (navy-tinted) | `--border` 6.68, used by the picker badges |
| `--text-muted` | `#6B7280` | `#496297` (navy-tinted) | `--bg` 5.78, `--border` 4.88 |
| `--sky-top` / `--sky-bottom` | (new) | `#d3effe` / `#FFFFFF` | not text |

The starting values were computed for this plan and still need measuring in the page.
`--bg`, `--surface`, `--surface-sunken` and `--border` stay as they are, per the requirement.

**The accent replaces the indigo role for role, and nothing more.** Every use of the old indigo
reads `--primary` or `--primary-hover` already: the title, Generate's fill, checkboxes
(`accent-color`), the outlined buttons' border and text, pressed tools, the focus ring, and the
selected-row edge. So changing the two tokens is the whole job. Checked while writing this plan: the indigo
appears only in those two `:root` lines, in no `.ts` file and no shadow. Four `styles.css` comments
still say "indigo" by name (the focus-ring note, the 6.29:1 outlined-button note, the pressed-tool
note), so reword them and update the ratio.
Do **not** extend the accent to anything that was not indigo: the unpressed zoom and tool buttons
stay white. Button labels set their own colour, which keeps them out of
`--text` as the requirement says.

**The remaining colours, by the "readable and fits" rule.** The status variants are where pink,
light green and white earn a place:
- error: pink background, dark red text;
- success: light green, already green;
- info: light blue, already blue.

Also decide whether the disabled button's greys take a navy tint. Keep each pair ≥ 4.5:1.

**Done when:** `ui:audit` is green at both widths. Every changed pair is recorded with its ratio,
for UI-5's note.

**Done (2026-09-26).** The starting values held. Every pair below was measured by `ui:audit` in
all six states at both widths:

| Pair | Ratio | Needs |
|---|---|---|
| accent `#3d70b2` title on white | 5.05 | 3 (large) |
| white on accent (Generate, pressed tool, count badges) | 5.05 | 4.5 |
| `--text-muted` `#496297` on `--bg` (empty-state heading) | 5.78 | 3 (large) |
| `--text-muted` on white (file name, picker placeholder) | 6.04 | 4.5 |
| disabled `#475569` on `#e5e7eb` | 6.12 | 4.5 |
| success `#166534` on `#dcfce7` (unchanged) | 6.49 | 4.5 |
| `--text-subtle` `#3a4e78` on `#e5e7eb` (picker badge) | 6.68 | 4.5 |
| error `#991b1b` on pink `#fce7f3` | 7.07 | 4.5 |
| `--text-subtle` on `#f3f4f6` (dimensions line) | 7.51 | 4.5 |
| `--text` `#06266d` on `--bg` / white | 13.35 / 13.95 | 4.5 |

The lowest pair is now the accent, at 5.05. Info (`#1e3a8a` on `#dbeafe`) is unchanged, and no
audited state shows it.

**Found while doing it:** the text and number inputs and both selects painted their value in the UA's
`#000000`. Beside navy labels that reads as a second text colour, where beside `#111827` it had not
shown. They now inherit `--text` (`input, select, textarea { color: inherit }`). Buttons are
excluded, since each button rule sets its own label colour. Also: the pink error, and the slate
tint on the disabled greys. Four comments naming indigo were reworded, and the three comments
quoting ratios were updated.

Also checked: the export hash is unchanged (`42ac415b…`), `npm run check` passes 211 tests, and
the canvas reads no colour token (only `--font-body`). On screenshots, the accent is
everywhere the indigo was, and the unpressed zoom and tool buttons are still white.

### 2. The sky (core)

Two things change:
- `html { background: var(--sky-bottom); }` as the fallback;
- `body::before { content: ""; position: fixed; inset: 0; z-index: -1; … }` carries the gradient
  and the clouds. `background-attachment: fixed` is not used, because iOS Safari ignores it (D26).
  `body` stops painting `--bg`.

- **Stepped gradient:** a `linear-gradient` with hard stops, so each band starts where the last
  ends. The blue spans roughly the top two-thirds of the window (about `66vh`; approximate, tune
  by eye) and everything below is `--sky-bottom`. Because the layer is fixed, `vh`/`%` of it is the
  window, which is what "two-thirds of a screen" means. Use about 6–10 bands from `--sky-top` to
  `--sky-bottom`, with intermediate colours
  interpolated by hand and written as tokens or inline stops. Band heights are whole multiples of
  the art pixel size. Optionally, a one-art-pixel checker row at each band edge makes it read as
  dithered pixel art rather than stripes. Judge it by eye.
- **Clouds:** two or three SVGs in `src/assets/sky/`, layered as extra `background-image`s with
  their own positions. One art pixel is 4–8 CSS px, and set `image-rendering: pixelated`.
  Clouds that fade into the white lower bands are intended (an aesthetic choice), so place them
  freely.
- **The card:** keep its white surface. Its shadow was tuned for a grey page and may need
  retuning against blue, and that is a token change.

**Done when:** the sky is visible outside the card at 1280 px, reaches white at roughly two-thirds
of the window, stays fixed while scrolling a long bead list, is absent inside the card, and the audit is still green.

**Done (2026-09-26).**
- **The layer:** `html` paints `--sky-bottom`. `body` has no background, since a body background
  paints *above* a negative-z-index layer and would hide it. `body::before` is `position: fixed;
  inset: 0; z-index: -1; pointer-events: none`.
- **The bands (revised the same day, at the user's request):** first eight plain bands, which
  read as stripes. Now there are **three blue bands plus white**: `--sky-top`, then
  `color-mix(in srgb, var(--sky-top) 66.667% / 33.333%, var(--sky-bottom))`, so the tokens remain the
  only sky colours. Each band is `round(22vh, 12px)` tall, so band edges land on the dither grid.
- **The dithering:** each band edge carries a 72 px ordered-dither (Bayer 2 × 2) strip: six rows of
  12 px tiles (2 × 2 art pixels of 6 px) in which the lower colour's density steps 25, 25, 50,
  50, 75, 75%. Each tile is a `conic-gradient` quadrant pattern in token colours, so no colour is
  written into an image. Above the edge, the rows paint the lower colour into the upper band.
  Below it, they paint the upper colour into the lower band in the complementary quadrants, so the
  checker runs through the edge unbroken. Quadrants nest (25 ⊂ 50 ⊂ 75%). That is 18 layers,
  generated once by a script and written out in full. `background-size` and `-repeat` list every
  layer, because a shorter list repeats cyclically.
- **The clouds moved to `body::after`**, a fixed layer of their own above the sky, so hiding them
  at ≤ 640 px is `display: none` instead of restating a 19-entry list.
- **The clouds:** `src/assets/sky/cloud-large.svg` (22 × 9) and `cloud-small.svg` (14 × 6), drawn
  as ASCII grids and converted to one `<rect>` per horizontal run. Each grid is kept in the file's
  comment. They are pure white, with art pixels at 6 px, placed at five positions in the side
  gutters, and the lowest fades into the white as intended.
- **The card** keeps its shadow; it reads well against the blue, so it was not retuned.

**Found:** at ≤ 640 px the gutter is 0.75 rem, and the clouds showed only as white slivers at the
screen edge, which read as a rendering fault. The existing media query hides the cloud layer
(`body::after { display: none }`); the sky and its dithering stay. Whether the narrow gutter should
grow is left to step 5.

**Checks:** `ui:audit` is green. No measured text background is a sky colour, so nothing sits on
the sky. The export hash is unchanged, and `npm run check` passes 211. `npm run build` inlines
both SVGs as data URIs, once per layer that uses them (five), about 4 KB before gzip. These
checks were re-run after the dither revision, with the same results.

**For M9 (Safari):** the sky depends on `round()` (Safari 15.4+) and `color-mix()` (Safari
16.2+). If either is unsupported, the band variable is invalid and the whole sky layer drops out,
leaving `html`'s white. That is the graceful failure, but it should be looked at on a real device.

### 3. The arrow cursor

`src/assets/cursors/arrow.svg`, 32 × 32 CSS px at most. That is a 16 × 16 art grid at 2 px per
art pixel: white fill, `#edf3f8` shading, `#052048` outline.

Add `--cursor-default: url(...) 1 1, default;` in `:root`, and put `cursor: var(--cursor-default)`
on `html`. The hotspot must be the arrow's tip pixel.

- **Check that inheritance does not flatten the I-beam.** `cursor` inherits. If the text and
  number inputs show the arrow, give them `cursor: text` explicitly.
- **Check that Vite rewrites a `url()` inside a custom property.** Confirm with `npm run build`
  and look in `dist/`. If it does not, write the `url()` in the rules directly and keep the
  keyword fallback.

**Done when:** the arrow shows over chrome in Chrome, the inputs show the I-beam, and the canvas
still shows crosshair, grab and the crop cursors.

**Done (2026-09-26), pending a look in a real browser.**
- **The drawing:** `src/assets/cursors/arrow.svg` is a 12 × 16 art grid at 2 px per art pixel
  (24 × 32 CSS px): `#052048` outline, white fill, `#edf3f8` shading down the inner right edge
  and the tail. It was drawn and converted like the clouds, with the grid in the file's comment
  and the rects grouped by colour. Hotspot `1 1`, the tip.
- **The token:** `--cursor-default: url(...) 1 1, default` in `:root`, and `html { cursor:
  var(--cursor-default) }`. **Vite does rewrite a `url()` inside a custom property**, in dev and
  in the build (inlined as a data URI), so the token approach holds and step 4 can reuse it.

**Found:** Chrome's UA stylesheet sets `cursor: default` on `label` and `select`, which beats
inheritance, so they showed the native arrow beside the pixel one. Fixed with a type-selector
rule early in the file, so the class rules that give a label the pointer still win. It was
found by a scan of every rendered element's computed `cursor` in U1, U2, U3 and a tool
state. After the fix:
- pixel arrow: 30 elements;
- `text`: the two number inputs and the picker filter;
- `pointer`: every clickable control (step 4);
- `not-allowed`: disabled buttons;
- `crosshair`: the crop frame and the painting canvas;
- `grab`: the pan canvas;
- `default`: only the `sr-only` file input, which nobody can hover.

**Not verifiable headless:** `Page.captureScreenshot` does not draw the mouse cursor, so the
arrow on screen needs one look by hand in the running app. `ui:audit` is green, the export hash
is unchanged, and `npm run check` passes 211.

### 4. The pointing hand (cut second if time runs out)

`src/assets/cursors/hand.svg` in the same style, hotspot on the fingertip. Add
`--cursor-pointer: url(...) x y, pointer;`, and replace the six `cursor: pointer` declarations:
`button`, `.view-toggle` checkbox and label, `.file-button`, the colour input, `.bead-item`.
Disabled controls keep `not-allowed`.

**Done when:** every clickable control shows the hand, and disabled ones show `not-allowed`.

If this step is cut, add a note to D26 and edit UI-8's Cursor bullet to say "arrow only".

### 4b. The pan hands (cut first if time runs out)

Added the same day by D26's revision: a pan targets no cell, so the hotspot-precision reason for
keeping tool cursors native does not cover it. A native grab hand beside the pixel pointing hand
would be the most visible mismatch left.

- `src/assets/cursors/grab.svg`, an open hand, and `grabbing.svg`, a fist. Both are built from
  the pointing hand's art (same palm, outline weight and shading), so the three read as one set.
  The hotspot is the palm centre, since precision does not matter here.
- Add `--cursor-grab` and `--cursor-grabbing` tokens with `grab` and `grabbing` as fallbacks,
  and swap them into the canvas's two rules in `styles.css`.
- Keep the same even-step rule for diagonals as the arrow's tail.

**Done when:** the pan-mode canvas shows the open hand, and the fist while dragging. The paint
crosshair and the crop cursors are still native.

If this step is cut, add a note to D26 and restore "grab stays native" in UI-8.

### 5. Layout the background forces, then verify

Look at U1–U5 at both widths. Likely candidates:
- at 390 px the body's side padding is 0.75 rem, so the sky is a sliver. Decide whether that is
  enough, or whether the gutter grows within UI-1;
- the card's top margin, so a cloud shows above it at 1280 px.

Anything else is out of scope. The two known UI-7 weak spots are behaviour and layout the
background does not cause, and they stay in v2.

Then:
- `npm run ui:audit` and `ui:focus` at both widths. The focus ring is now `#3d70b2`, so re-shoot
  it;
- `npm run check`, which should be untouched;
- `npm run build`, which confirms the asset URLs and that the cursors are in `dist/`;
- the export from step 0 again, which must hash byte-identical (OUT-3);
- U1–U5 by eye on fresh screenshots, plus each bullet of UI-8's Check.

**Done when:** all of the above pass.

---

## Milestone exit

- Tick UI-8 in `specs.md` with its measurements (in headless Chrome, as M8 recorded).
- Update UI-5's note with the new lowest pair.
- Add a line to UI-7's note saying U1–U5 re-passed on the theme.
- Mark M11 done in `plan-v1.md`.
- Delete this file, and point `CLAUDE.md` at `plans/m9-verification.md`.
- Record for M9, beside NFR-5, that SVG cursor rendering in Safari and on a real phone is
  unmeasured. The keyword fallback means the worst case is the native cursor.

## Deferred out of M11 — do not build here

| Thing | Where it belongs |
|---|---|
| Dark-mode theme | A future decision of its own (D26). Not an inverted sky |
| Banner replacing the title | Deferred by D25; still deferred |
| Pixel crosshair and crop cursors | Excluded by D26: a hotspot error paints the wrong bead or edge |
| Pixel crop *move* cursor | Needs no precision, but a different symbol; kept out to hold scope (D26, revised) |
| Moving or animated clouds | No motion (D26) |
| Recolouring the canvas, gridlines or export | Out of bounds; OUT-3 |
| Generate enabled beside the size-limit error; the 500 px box under a short pattern | UI-7's v2 revisit (U4, U5) |
