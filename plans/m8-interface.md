# M8 — Interface floor (+ demo styling pass)

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M8 closes,
delete it and point `CLAUDE.md` at the next one._

**Milestone goal (`plan-v1.md` M8):** implement UI-1 … UI-6 — no clipping or horizontal scroll,
single-column reflow, spacing/radius/type scales in `:root`, visible focus rings, WCAG AA text, and
44 px targets — verified at 1280 px and 390 px. **Widened (2026-09-26):** a timeboxed styling pass
runs *after* the floor, aimed at the U1–U5 interface review, because a demo is close and the floor
is what makes styling cheap. Recorded as D25 in Step 0.

**Closes:** UI-1 … UI-6, NFR-5. **May close:** UI-7, only if U1–U5 pass inside the timebox.
**Constrained by:** D14 (floor vs. taste split), D21, D22 (the export ignores the page's styling).

---

## Ground rules

- **Floor first, styling second, never interleaved.** Tokenizing changes *structure*; styling
  changes *values* (D14). Styling before UI-3 means restyling scattered literals, then tokenizing
  the styled values. After UI-3, a change of direction is mostly edits inside `:root`.
- **The checkpoint after Step 5 is a real exit.** At that point M8's own Done-when is met. If the
  demo is closer than the styling pass will take, commit, skip Steps 6–7, and go straight to M9.
  Styling is the part that can be cut; verification is not.
- **Styling changes values and surfaces, not layout.** No element moves, no new components, no
  restructured markup. That is what keeps UI-1, UI-2 and UI-6 true through the pass, so Step 7
  re-checks them rather than redoing them. The one exception is the empty-state placeholder,
  which U1 is about directly.
- **The canvas and the export are out of bounds.** `render/guide-style.ts`, the bead-code contrast
  in `contrast.ts`, and everything `export-png.ts` draws stay exactly as they are. The page may
  change color; the pattern must not, and OUT-3's byte-identical export must not drift because a
  page token moved.
- **Token set minimal and descriptive** (UI-3's own note): name what the app already does. Color
  tokens are added only for colors that already exist as literals (grays, status colors, the
  disabled grey) — which is also what makes Step 6 a `:root` edit.
- **No new dependency, no runtime network fetch.** A web font, if chosen, is self-hosted in
  `public/` as one `woff2` with a system fallback — not a Google Fonts `<link>`, which would make
  the page's look depend on a third-party request (NFR-1's spirit, and an offline demo's reality).
- **No logic changes.** M8 is CSS and markup. If a step needs a `.ts` edit beyond swapping a label
  or an icon, stop and ask whether it belongs here. `npm run check` must still pass at every
  commit, since the tests are the proof nothing behind the page moved.

---

## Step 0 — Write D25 and pick the direction

Before any code, record in `specs.md`'s decision log:

1. **A bounded styling pass joins M8, after UI-1 … UI-6.** Why: demo impression, and D14's own
   argument that styling after the floor costs value edits, not rework. Why not a v1.1 after M9:
   M9 is what ticks UI-1 … UI-6, and restyling after it re-opens UI-5 (every color it measured)
   and re-checks UI-1/UI-6 — the plan already calls reopening those "a regression rather than a
   task."
2. **Its bounds:** timebox (~half a day of work), values-and-surfaces only, no layout moves, canvas
   and export untouched; the U1–U5 review with its stopping rule decides when it is done.
3. **UI-7 is not promoted to a v1 obligation.** M9 does not require it. If U1–U5 pass inside the
   timebox, UI-7 is ticked; if the timebox runs out first, stop where it is and UI-7 stays [v2]
   with whatever landed as its starting point.
4. D14 gets a one-line pointer to D25; `plan-v1.md` M8 gets a one-line "Widened" note.

**Pick the direction now, not while styling** — choosing by trying options in the browser is
exactly the tuning loop D14 warns about. Decide three things and write them into D25:

| Decision | Choose one |
|---|---|
| Typeface | Keep the system stack · one self-hosted sans for headings only · one self-hosted sans for everything |
| Accent | Keep indigo `#4F46E5` · one new accent (write the hex down) |
| Surfaces | Flat (borders, no shadow) · soft cards (one shadow token, one radius) |

Anything not on this table (motion, illustration, dark mode, icon redraw) is out of the pass.

**Done when:** D25 is in the log with the three choices filled in.

> **Done (2026-09-26).** Title: Jersey 10. Everything else: Pixelify Sans, bead codes staying
> monospace. Accent and flat surfaces unchanged. Both fonts are subset to Latin `woff2` in
> `src/assets/fonts/` with their OFL licenses, and not wired into CSS until Step 6. The banner is a
> later step of its own (D25). D14 carries a pointer to D25, and `plan-v1.md` M8 a "Widened" note.

## Step 1 — Baseline measurement

Measure before changing anything, so every later claim is against a number. At 1280 px and at a
real 390 px viewport, in each of U1–U5 **plus an editor state** (a paint tool active, picker open):

- **UI-1:** `document.documentElement.scrollWidth > clientWidth`, and any element whose box leaves
  its container. Known failures: the `.zoom-controls` row (~410 px against ~326 px) and
  `#sortOption` truncating "Sort by Largest Count".
- **UI-6:** every control's rendered box at 390 px. Suspects: the file input, the number inputs,
  the sort `<select>`, the two checkboxes' rows (already fixed on `m4-crop` — confirm, don't redo).
- **UI-5:** every text/background pair (Step 5 lists them). Likely failures to confirm by
  measurement, not assume: white on the disabled grey `#9CA3AF`, and grey `#9CA3AF` icons on white
  in disabled tool buttons.
- **UI-4:** tab through the page and note every control with no visible focus.

Write the results as a short table at the bottom of this file. It is the to-do list for Steps 2–5.

## Step 2 — UI-3: scales in `:root`

1. **Re-indent `styles.css` from 8 to 4 spaces in its own commit** (the project convention; the 8
   is left over from the single-file origin). Whitespace-only, so the token diff that follows is
   reviewable.
2. Inventory every `padding`, `margin`, `gap`, `border-radius` and `font-size` literal. Collapse
   them onto roughly **four spacing steps, three radii (plus a pill), three type sizes**, choosing
   the nearest existing value rather than inventing new ones.
3. Tokenize existing color literals by role: muted text, subtle text, disabled, the three status
   triples, the swatch border. The existing `--primary`/`--bg`/`--surface`/`--text`/`--border` stay.
4. Move `#placeholderText`'s inline style from `index.html` into the stylesheet — CLAUDE.md notes
   M8 owns it, and an inline style is out of reach of every token.
5. Allowed exceptions ("no scale value applies"), each with a one-line comment: the 44 px target
   minimums, crop handle geometry, the `9999px` shade, icon sizes, the swatch checkerboard.

**Done when:** a grep for those five properties outside `:root` returns only commented exceptions,
and the page looks the same as before at both widths (this step changes structure, not appearance).

> **Done (2026-09-26).** Re-indent committed alone (`2859d07`, `git diff -w` empty). 113 literals
> replaced by line-anchored, exact-match script. Scales: spacing `xs sm md lg xl 2xl` = 0.25 / 0.5 /
> 0.75 / 1 / 1.5 / 2 rem (six, because 0.75 rem is the input padding behind UI-6's 44 px); radius
> `sm md lg xl pill` = 4 / 6 / 8 / 12 / 999 px (four roles: swatch, control, panel, card); type
> `xs sm md lg` = 0.75 / 0.875 / 1 / 1.125 rem, in rem rather than px because only Jersey 10 snaps
> to a pixel grid (D25, measured). Colour tokens only for existing literals; crop overlay and
> checkerboard stay literal as artwork. The Check's grep returns two commented exceptions: the colour
> input's 2 px inset and the `sr-only` `-1px`. Also: `font-family: inherit` on form controls, and
> `#placeholderText`'s inline style moved into the stylesheet. **Re-measured:** no new failure in any
> state. At 1280 px the page is visually unchanged. At 390 px the container padding snapped
> 1.25 → 1 rem, widening content 326 → 334 px; the zoom row still overflows, 351 in 334 (was 348 in
> 326), and is Step 3's job. Visible differences: picker badges ~5 px taller, controls in the system
> font instead of Arial. `npm run check` 211/211, build clean.

## Step 3 — UI-1, UI-2, UI-6: layout at 390 px

- **Zoom row:** make the zoom buttons icon buttons in the editor bar's idiom (`tool-button`, inline
  `svg.icon`, `aria-label` + `title`), and let `.zoom-controls` wrap. Update the stale comment in
  `.editor-controls` that says the zoom row deliberately does not wrap. Folding the toggles into the
  editor bar is the other option in `plan-v1.md`; it is rejected here because it mixes view settings
  into the tool bar, and the bar already takes two rows at 390 px.
- **Sort select:** drop the redundant "Sort by " prefix (the options become "Largest count" /
  "Color name") and give the select an accessible name — a visually hidden `<label>`, as the picker
  filter already does. Let `.count-header` wrap as a backstop.
- **Export button:** keep it below the canvas (M6's reasoning holds); M8 only confirms its final
  size and spacing against the tokens.
- **UI-2:** confirm controls are full-width and in document order at 390 px, two columns at 1280 px,
  and the status message and `#dimensions` span the panel at both.
- **UI-6:** fix any control from Step 1's table under 44 × 44.

**Done when:** Step 1's UI-1/UI-2/UI-6 rows all pass at both widths in every state.

> **Done (2026-09-26).** Zoom buttons are now `tool-button`s with inline magnifier icons
> (`aria-label` + `title` "Zoom out"/"Zoom in", `type="button"`). The tool-button rules were widened
> from `.editor-controls` to `:is(.editor-controls, .zoom-controls)`, which keeps the two-class
> specificity that beats the 640 px query's full-width `button`. `.zoom-controls button` is deleted,
> the zoom row wraps as a backstop, and `.view-toggle` spaces by gap, not margin. Sort options are
> "Largest count" / "Color name" with a hidden `<label>`; `.count-header` wraps. `.bead-list` and
> `.picker-results` got a `--space-xs` inset, so the selected ring (and Step 4's focus outline) is
> inside the scroll container's padding box. Stale comments about the zoom row not wrapping were
> fixed in `styles.css` and `index.html`. **Re-measured:** no page scroll and no escaping box in any
> state at either width, apart from the crop handles (by design). The zoom row fits one line at
> 390 px (verified on screenshot). No control is under 44 × 44. UI-2 unchanged and passing. The
> list's first row sits 4 px inside it at `scrollTop` 0, and its ring is whole on the screenshot.
> The script still flags the auto-width sort select at 1280 px (100/97 px); that is its ~20 px
> arrow allowance, and the screenshot shows the full text.
>
> **Harness fix:** it used to screenshot *after* the Tab pass. Focusing the last inventory rows
> scrolls the list, which made the baseline screenshots show the list scrolled. Finding #3 still
> stands, because with 0 padding a first-row ring fell outside the scroll area even unscrolled.
> Screenshots are now taken at rest, before the Tab pass.
>
> **Left for Step 6 (cosmetic, not a floor failure):** the zoom buttons sit 16 px apart and the
> editor tools 8 px, because the zoom row's gap is sized for the checkboxes. CLAUDE.md's "six
> editor-bar icons" becomes eight across two bars; update it at close.

## Step 4 — UI-4: focus rings

- One `:focus-visible` rule: an `outline` with an offset, drawn from a `--focus-ring` token, so it
  never collides with hover (which changes background and border, never outline).
- Covers: file input, number inputs, selects, Generate, zoom buttons, both checkboxes, every editor
  tool, the active-color button, picker inputs and swatches, inventory rows, Download PNG.
- Pressed tool buttons are filled with the accent, so the ring needs its offset (or a second
  contrasting ring) to stay visible on them — check that state specifically.
- The crop handles stay non-focusable divs (CLAUDE.md: focusable no-ops would be a UI-4 bug).

**Done when:** tabbing the Check's list shows a clearly visible ring on each, distinct from hover.

> **Done (2026-09-26).** One `:focus-visible { outline: var(--focus-ring); outline-offset:
> var(--focus-offset) }`, 2 px solid `--primary` with a 2 px gap. It is indigo on `#F9FAFB`/white at
> ≥ 6:1, and the gap keeps it visible on filled indigo buttons. Selection moved **inside** the box:
> `.selected` is now the indigo border plus `inset 0 0 0 1px`, replacing the outer translucent halo,
> and `--selection-ring` is deleted. A row or swatch that is both selected and focused shows an
> inner edge and an outer ring. Hover never sets `outline`. **Verified** by Tabbing in headless
> Chrome at both widths: every stop (upload, the three settings, Generate, both zoom buttons, both
> checkboxes, every tool, active color, both picker inputs, picker swatches, Download PNG, sort,
> every inventory row) computes the app ring with `:focus-visible` true. Each was screenshotted
> focused: visible on every one, including Generate, the pressed brush and the selected+focused
> row. **One defect found and fixed:** the last inventory row's ring was clipped at the bottom,
> because focusing a row scrolls it flush with the list's edge and ignores the outline.
> `scroll-padding: var(--space-xs)` on `.bead-list` and `.picker-results` fixed it at both widths.
> Full re-measure: UI-1/UI-6/UI-5 unchanged from Step 3; `npm run check` 211/211.

## Step 5 — UI-5: contrast

Measure with WCAG relative luminance (not `contrast.ts`, which answers a different question):
body text, labels, muted/hint text on both `--bg` and `--surface`, primary button enabled and
disabled, tool buttons enabled / pressed / disabled, inventory count pill, picker badges (both
variants), `#dimensions` normal and error, and all three status variants. Fix by moving token
values, not by adding per-rule overrides. Record each pair's measured ratio in this file.

**Done when:** every pair is ≥ 4.5:1 (≥ 3:1 for large text), recorded.

> **Done (2026-09-26).** The one failure, disabled Generate (white on `#9CA3AF`, 2.54), is now
> `--disabled-text #4B5563` on `--disabled-bg #E5E7EB`, **6.10:1**. That is a light, unfilled-looking
> button rather than a darker grey slab: white on `#6B7280` would pass at 4.83, but it is a heavy
> block competing with the one primary action, and U1 wants the disabled state to read as
> deliberate. `--disabled` was split in three. Disabled tool **icons** keep `--disabled-icon
> #9CA3AF`: they are non-text, WCAG 1.4.11 exempts inactive controls, and at the text grey they would
> barely differ from enabled ones. `button:disabled` follows `button:hover` at equal specificity, so
> a hovered disabled Generate stays grey. **Placeholder** (not reachable by the harness, which reads
> element colours): Chrome's UA `#757575` measured 4.61, then pinned to `--text-muted`, 4.83 on
> `--surface`, with `opacity: 1` for Firefox.
>
> **Measured pairs, all states, both widths (WCAG relative luminance):**
>
> | Ratio | Pair | Used by |
> |---|---|---|
> | 4.63 | `#6B7280` on `#F9FAFB` | empty-pattern message, picker hint — **the tightest; re-measure after any `--bg` change** |
> | 4.83 | `#6B7280` on `#FFFFFF` | preview hint, picker empty message, input placeholder |
> | 6.10 | `#4B5563` on `#E5E7EB` | Generate, disabled |
> | 6.29 | `#FFFFFF` on `#4F46E5` / `#4F46E5` on `#FFFFFF` | primary buttons, count pills / `h1` (large, needs 3) |
> | 6.49 | `#166534` on `#DCFCE7` | success status, "in pattern" badge |
> | 6.80 | `#991B1B` on `#FEE2E2` | error status, `#dimensions` error |
> | 7.90 | `#FFFFFF` on `#4338CA` | primary button hover (computed) |
> | 8.33 / 9.37 | `#374151` on `#E5E7EB` / `#F3F4F6` | picker badge / `#dimensions` |
> | 8.49 | `#1E3A8A` on `#DBEAFE` | info status (only while the palette loads; computed) |
> | 16.98 / 17.74 | `#111827` on `#F9FAFB` / `#FFFFFF` | body, labels, stats, headings |
> | 21.00 | `#000000` on `#FFFFFF` | input and select values (UA text colour) |
>
> Layout unchanged from Step 4 in every state; `npm run check` 211/211.

### Checkpoint — M8's Done-when is met

`npm run check` passes; UI-1 … UI-6 pass at 1280 px and 390 px. **Commit.** If the demo is closer
than half a day of work away, stop here: close M8 without Steps 6–7 and start M9.

---

## Step 6 — Styling pass (timeboxed)

Apply the three choices from Step 0, in this order, stopping when the timebox ends:

1. **`:root` values** — accent, grays, radii, shadow, font. This is most of the visible change,
   and it should be most of the diff.
2. **Hierarchy between buttons.** Generate is the one primary action; zoom, export and tools are
   secondary. Today every `button` is a filled accent block, which is why U1 reads as a form.
3. **Surfaces** — the container, the controls panel, the preview area and the inventory as one
   consistent card treatment, with headings and labels on the type scale.
4. **Empty state (U1)** — the placeholder box reads as a place the pattern will appear, not a
   dashed hole: one line of guidance ("Upload an image to begin"), styled with existing tokens.
5. **Status messages (U4)** — informative, not alarming: keep the three variants, adjust their
   token values only.

Not in the pass: moving any element, new controls, animation beyond the existing transitions,
redrawing icons, dark mode, anything the canvas or the export draws.

## Step 7 — Re-verify, then review

1. **UI-5 again, in full** — every color it measured may have moved. Update the recorded ratios.
2. **UI-1 and UI-6 spot check** at both widths in every state — font and padding changes can push a
   row past 390 px or a box under 44 px.
3. **UI-4** — a new accent can make the focus ring invisible on pressed buttons.
4. **U1–U5 review** at 1280 px (U5 at 390 px) against the pass conditions in `specs.md`.
   **Stopping rule: when U1–U5 pass, stop, even if it feels improvable.** If the timebox ends first,
   stop anyway and record which states still fail under UI-7.

**Done when:** UI-1 … UI-6 still pass, and either U1–U5 pass (tick UI-7) or the timebox ended
(UI-7 stays [v2], failing states recorded).

---

## Closing M8

- Tick UI-1 … UI-6 and NFR-5 in `specs.md` (and UI-7 if Step 7 earned it), each pointing at the
  measurements recorded here.
- Update `plan-v1.md`'s status paragraph and `CLAUDE.md`'s project summary; note in CLAUDE.md's
  `styles.css` entry that the literals are now tokens and the 8-space indent is gone.
- Delete this file and move the pointer to M9.

## Outside M8, noted for the demo

A second Generate replaces the `Pattern` the editor mutates, destroying hand edits without warning
(recorded beside PAL-7 for M9). It is not interface work and does not belong here, but it is the
most likely thing to go wrong live: in the demo, finish resizing before editing, or raise it as the
first M9 item.

---

## Baseline measurements (Step 1)

_Measured 2026-09-26, headless Chrome over CDP against `npm run dev`, at 1280 × 800 (dpr 1) and
390 × 844 (dpr 2, mobile). States: U1 first load; U2 transparent 600 × 400 PNG uploaded; U3 generated
(51 × 34, 5 colors); E: brush tool active and the picker open; U4a target width 9999 (SET-5's error
in `#dimensions`); U4b a text file named `.png`. Page-level horizontal scroll: **none in any state
at either width** (`scrollWidth == clientWidth`). Every finding below was confirmed on the
screenshot, not only by the script._

**UI-1 — clipping (fails at 390 px only)**

| # | Where | Finding |
|---|---|---|
| 1 | `.zoom-controls`, U3/E/U4a | Content 348 px in a 326 px box. "Grid" runs past the panel's padding to the card edge, and both zoom buttons wrap to two lines ("- / Zoom"). Known before M8. |
| 2 | `#sortOption`, U3/E/U4a | "Sort by Largest Count" needs ~156 px of text in ~140 px; renders as "Sort by Largest Cou". Known before M8. **Not** truncated at 1280 px; the script flagged it there but the screenshot shows the full text. |
| 3 | `.bead-list`, U3/E at both widths | The selected row's 2 px ring (`box-shadow`) is cut off along its top edge, because the list is an `overflow-y: auto` scroller with no inner padding at the top. **New.** It matters for UI-4 too: a focus outline on the first or last row gets clipped the same way. |
| — | `.preview-frame`, U2 | Content 6 px wider than the frame at both widths: the crop handles hang half outside the image. **By design** (CLAUDE.md: `.crop-rect` must not be clipped); stays inside the card. Not a failure. |

**UI-2 — reflow: passes.** One full-width column in document order at 390 px, two columns at
1280 px; `#statusMessage` and `#dimensions` span the panel at both.

**UI-6 — targets: passes.** No visible control is under 44 × 44 at 390 px in any state (checkbox
rows measured as the row, since the label carries `for`). Re-check after Step 3 changes the zoom
row, and after Step 6 changes padding and fonts.

**UI-5 — contrast: one failure**

| Pair | Ratio | Where |
|---|---|---|
| `#FFFFFF` on `#9CA3AF` | **2.54 — fails 4.5** | Generate, disabled (U1 before upload; the boot guard's "App failed to start") |
| `#6B7280` on `#F9FAFB` | 4.63 | placeholder text, picker hint (lowest passing pair; little room if `--bg` darkens) |
| `#6B7280` on `#FFFFFF` | 4.83 | preview hint, picker empty message |
| `#4F46E5` on `#FFFFFF` / white on `#4F46E5` | 6.29 | `h1`; every primary button, inventory count pills |
| `#166534` on `#DCFCE7` | 6.49 | success status, "in pattern" badge |
| `#991B1B` on `#FEE2E2` | 6.80 | error status, `#dimensions` error |
| `#FFFFFF` on `#4338CA` | 7.90 | button hover |
| `#374151` on `#E5E7EB` / `#F3F4F6` | 8.33 / 9.37 | picker badge, `#dimensions` |
| `#1E3A8A` on `#DBEAFE` | 8.49 | info status (only shown while the palette loads; computed, not captured) |
| `#111827` on `#F9FAFB` / `#FFFFFF` | 16.98 / 17.74 | body, labels, stats |

Outside the Check but worth knowing: disabled tool-button **icons** are `#9CA3AF` on white, 2.54:1.
They are non-text (WCAG 1.4.11, which also exempts disabled controls) and UI-5 names text only, so
this is not a failure. Fixing the disabled grey for Generate will likely move these with it.

**UI-4 — focus: fails as written.** The stylesheet defines no focus style at all. Every control
Tabbed (upload, the three settings, Generate, both zoom buttons, both checkboxes, every tool, the
active color, both picker inputs, every picker swatch, Download PNG, the sort select, every
inventory row) shows only Chrome's default `outline: auto` ring. It is visible, but it is the
browser's, not the app's; it is 1 px blue on indigo buttons, and Safari's differs. On the inventory
rows and picker swatches, focus and selection are **similar and easy to confuse**: selection is an
indigo border plus a pale 2 px indigo halo, focus is Chrome's thin darker-blue ring, so both read as
"a bluish ring hugging the box" and are told apart only by shade. They diverge exactly during
keyboard use (Tab moves focus without changing the active color). The larger risk is Step 4: an
app ring of "2 px indigo around the element" would make them genuinely identical, so the two must
differ in shape — focus as an offset outline outside the box, selection kept inside it. Not reached by Tab and correctly so: the crop
handles (plain divs) and the canvas.

**Noted for Step 6, not a floor failure:** form controls do not inherit the page font. The file
input, number inputs, selects and every button render in the UA font (Arial-like), not the body
stack. Switching the body to Pixelify Sans will leave all of them in Arial unless the stylesheet
sets `font: inherit` on them, which belongs in Step 2's base rules so the fonts apply everywhere.

**To-do for Steps 2–5, from this table:** zoom row (#1), sort select (#2), inventory list clipping
its selected row and future focus rings (#3), disabled-button contrast, one app-defined
`:focus-visible` ring that is distinct from the selected-state shadow, and `font: inherit` on form
controls.
