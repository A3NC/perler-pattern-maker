# Version 1 — Build Plan

_Written 2026-09-07 · Scope defined by the **[v1]** requirements in `specs.md`_

## What v1 is

Upload an image → crop it → set finished width, bead size, and color limit → generate a pattern
using perceptual color matching → view it zoomable with toggleable bead codes → fix wrong cells
with a brush, eraser and fill, undoing mistakes → read the bead inventory → download a PNG with
codes on every cell.
The current pattern autosaves locally.

Everything else in `specs.md` is marked **[v2]** or **[later]** and is out of scope here.

## Starting point

_(Pre-M0 filenames, kept as history: `perler.html` is now `index.html` + `src/`, and
`pattern-utils.mjs` is now `src/lib/pattern-utils.ts`.)_

`perler.html` already covers roughly a third of v1: upload, target width, bead size, nearest-color
matching, zoom, code toggle, and bead counts. `pattern-utils.mjs` holds the reusable logic and has
real tests.

Two things in the existing build have to be **replaced**, not extended:

1. **The pattern grid.** It creates one page element per bead and zooms with CSS scaling. This
   collapses well before the size limits the spec allows, and it cannot support painting individual
   cells. (Decision D1)
2. **Color matching.** It compares colors by raw RGB distance, which does not match human
   perception. (Decision D2)

Everything else is reusable.

## Architecture decisions

Plain-language summary of what gets used and why. Each of these is settled; they are recorded here
so the reasoning survives.

| Decision | What it means | Why |
|---|---|---|
| **Vite + TypeScript, no UI framework** | Vite bundles the code and reloads the browser on save. TypeScript adds checked labels to data so mistakes surface before running. No React. | The hard parts of this project are the image algorithm and the canvas editor. A UI framework helps with neither, and React's update model actively fights per-pixel canvas drawing. TypeScript pays for itself on a spec this size. |
| **Canvas for the pattern** | The grid is painted onto one drawing surface instead of built from thousands of page elements. | Required for size, zoom, and painting. (D1) |
| **Pipeline as one replaceable module** | Image in, colored grid out, behind a single boundary. | Lets alternative algorithms be compared during tuning without touching UI code. (GEN-6, D5) |
| **Main thread for now** | Generation runs normally, not on a background thread. | At the spec's cell cap the work should finish in well under a second. Adding a background thread costs complexity for a problem that may not exist. Revisit only if measurement shows jank. (D8) |
| **Static hosting** | The built app is plain files on any free host. | Satisfies "free" and "data stays local" with no backend. (NFR-1, SAVE-2) |

## Milestones

In dependency order. Each milestone should leave the app **working** — never a half-migrated state.
Sizes are relative: S = a sitting, M = a few sittings, L = the biggest items in the plan.

---

### M0 — Project setup · S — ✅ **Done** (2026-09-08)
**Do:** Set up Vite + TypeScript. Move the code out of `perler.html` into separate files. Wire the
existing tests to run from one command. Change no behavior.

**Why first:** Everything after this is easier with reload-on-save and type checking, and doing it
later means redoing it.

**Done when:** The app behaves exactly as it does today, launched through Vite, and the test suite
runs from a single command. *(NFR-4)*

**Delivered:** `perler.html` split into `index.html` + `src/`, on Vite + TypeScript. `npm run check`
is the single gate (typecheck + 12 tests, green). Verified in-browser that `npm run dev` and
`npm run preview` both load the 221-color palette and enable Generate. Mini bead pitch corrected to
2.6 mm (Q1) — see the retired risk below.

**Deviation from "change no behavior":** `index.html` also carries an inline classic-script boot
guard. It covers failures the app structurally cannot report on its own: a `file://` open, a plain
static file server, or a throw in module-level startup each stop `src/main.ts` from executing at
all, so its own error handling never fires and the page hangs silently on "Loading color
palette..." forever. The guard
turns each into a readable message with Generate disabled (PAL-3). It changes only the failure
path; the working path is untouched. Cost: PAL-3 messaging now lives in two places, and logic sits
in `index.html` against the convention that logic lives in `src/`. Kept mainly for **M1** — that
milestone rewrites the DOM contract this app depends on, which is exactly when the silent-hang
failure recurs. Revisit at M9 and delete it if it has stopped earning its keep.

---

### M1 — Canvas pattern view · L — ✅ **Done** (2026-09-13)
**Do:** Replace the element-per-bead grid with canvas rendering. Implement zoom and pan by
redrawing rather than CSS scaling. Draw bead codes onto cells, keep the on/off toggle, and hide
code text automatically when cells get too small to read.

**Why here:** It unblocks both the size requirements and the entire editor. It is also the single
biggest piece of new work — do it while the rest of the app is still simple.

**Done when:** A 100 × 100 pattern renders and pans smoothly; zoom keeps the viewport center fixed;
codes are legible on the darkest and lightest palette colors and vanish when cells shrink below the
legibility threshold. *(VIEW-1 … VIEW-5)*

**Watch for:** Zoom that drifts off-center, and blurry text from ignoring the display's pixel
density. Both are standard canvas pitfalls and both are easier to fix now than later.

**Delivered:** `src/render/canvas-view.ts` replaced the element-per-bead grid. The canvas is sized
to the *container*, not the pattern — `#grid-wrapper` survives as an empty spacer driving native
scroll, with the canvas a `position: sticky` overlay pinned to the visible corner, redrawing only
the visible cell range. Zoom by redraw holds the viewport center; drag-pan moves the scroll offset;
bead codes draw with contrast-based color and hide below an 18 px legibility threshold;
`devicePixelRatio` is applied once at the context so every other length stays in CSS pixels. The
deterministic half lives in `src/lib/viewport.ts` with 29 tests, including the screen → cell
mapping M5 consumes.

**Deviation — max zoom raised late:** `MAX_CELL_SIZE_PX` went from 30 px to 46.875 px (two zoom
clicks) after hands-on use found 30 px tight for inspecting a single bead. A one-constant change
only because the container-sized canvas makes the ceiling free: per-frame cost *falls* as cells
grow (468 cells/frame at 30 px, 187 at 46.875), and only the spacer grows. Annotated on D15 rather
than rewritten into it.

**Left open, deliberately:** the code-legibility threshold (`MIN_CODE_FONT_PX = 6`) was calibrated
at 1x against upscaled text and is biased toward hiding codes too eagerly. Re-judge it when
convenient; lowering it brings codes in a click or two earlier. VIEW-4 stays unticked — M1
preserved it rather than closing it, and M9 walks it with the rest.

---

### M2 — Quality core: perceptual matching + color limit · L
**Do:** Move color matching to OkLab, precomputing each palette color's values once at load.
Average source pixels within each bead cell when downscaling — in *linear* light, since averaging
gamma-encoded bytes darkens every blend. Add the color-limit setting, reducing by greedy perceptual
merge rather than by raw frequency (D17). Put the whole thing behind the pipeline boundary. Add
tests.

**Why here:** This is the project's actual risk. It needs M1 in place so results can be seen
properly, and it needs to come before the editor so the editor isn't compensating for a bug that
has a real fix.

**Done when:** Tests cover OkLab matching and color reduction; the pattern never exceeds the color
limit; the same inputs always produce the same output; and the R1–R6 reference review in `specs.md`
passes. *(GEN-2, GEN-3, GEN-4, GEN-6, GEN-7, GEN-8, SET-4)*

**Watch for:** This is a tuning task with no finish line and no error message. Timebox it. The
reference review is the stopping condition — when R1–R6 pass, stop, even if it feels improvable.
The editor in M5 is the escape valve for whatever remains.

**Delivered (2026-09-21):** OkLab matching (`src/lib/oklab.ts`, `src/pipeline/color-match.ts`),
area averaging in linear light (`src/pipeline/downscale.ts`), greedy perceptual reduction
(`src/pipeline/reduce.ts`), and the SET-4 control. `npm run check` is green at 88 tests, up from 40.
Two GEN-6 switches ship, both one identifier: `ACTIVE_MATCHER` and `ACTIVE_DOWNSAMPLER`. **GEN-2,
GEN-3, GEN-4, GEN-6, GEN-7 and SET-4 are ticked; GEN-8 is deliberately not.** D18 (lineart) was
absorbed mid-milestone and is the reason the L ran long.

**Closed with GEN-8 unticked, on purpose.** The R1–R6 review does not fully pass, and ticking it
would make the gate decorative — which this milestone's own plan warned against. Two items remain,
and only one of them is M2-shaped. **(1)** Dark regions blend less smoothly than before D18 (R3's
"shading resolves into a few clean bands, not noise"). Improved by moving the contrast gate into
perceptual lightness, not closed: lines outscore shading by only ~1.35× at the same tone and the
bands overlap across tones, so no single threshold separates them everywhere. The three constants in
`DEFAULT_CONTRAST_TUNING` are the surface and are meant to be moved by eye. **(2)** Facial features
of drawn characters distort — **Q10**, and not reachable from anywhere in this pipeline, since the
grid is fixed before any of it runs.

**What the milestone cost that the plan did not predict:** the review found two defects *after*
D18 shipped, each needing its own diagnosis — colour specks traced to reconstructing cells from
single extreme pixels, and dark-region jaggedness traced to a threshold measured in the wrong
space. Both are written up in `specs.md` D18. The transferable part is that both were confirmed by a
cheap A/B before any code was written, the same way the `MERGE_FLOOR` diagnostic ruled out Phase A.

**NFR-2 is over and stays over:** 65 ms at the design target, 315 ms at the hard limit, against
~150 ms. Recorded against NFR-2 for M9 to weigh, per D8.

---

### M3 — Input handling and errors · S
**Do:** Specific, readable errors for non-images, corrupted files, unsupported formats (name HEIC
explicitly), and oversized images. Enforce the source-image size ceiling.

**Why here:** Cheap, and it converts the most common user experience of failure from "the app is
broken" into "the app told me what was wrong." It is also how you will diagnose other people's bug
reports.

**Done when:** A `.txt`, a truncated JPEG, a `.txt` renamed to `.png`, a zero-byte file, a `.heic`,
and an oversized image each produce a distinct, specific message, and the app stays usable after
each. *(IN-1 … IN-4, IN-6)*

---

### M4 — Crop · M
**Do:** Preview the uploaded image with a draggable, resizable crop rectangle. Feed the cropped
region to the pipeline. Show the resulting grid dimensions live as the crop changes.

**Why here:** Cropping is a quality feature disguised as a convenience one. For photos it
multiplies the detail available per bead; for artwork it is **the v1 substitute for background
removal** — the only way a user gets a pattern of their drawing rather than of their drawing plus
600 white beads. Since artwork is the majority input (spec S1/D12), this milestone carries more
weight than its size suggests. It needs the pipeline settled (M2) to hand off cleanly.

**Done when:** Crop works with both mouse and touch; the generated pattern matches the cropped
region; dimensions update as the crop is adjusted. Cropping tight to a subject on a white canvas
produces a pattern with a visibly small white margin, and the remainder is erasable in M5.
*(IN-5, SET-3)*

---

### M5 — Correction editor · M (large) — ✅ **Done** (2026-09-22) — **scope widened by D19**
**Do:** Single-cell brush, eraser, flood fill, and a palette color picker. Stroke-scoped undo and
redo. Live bead-count updates. A pan mode that never paints by accident.

**Scope change, 2026-09-21:** this milestone read "no undo, no fill" until D19 reversed D7. Its
tactical plan, `plans/m5-editor.md`, was deleted at the milestone's close; D19 in `specs.md` is the
surviving record of why the scope moved.

**Why here:** This is the safety net for M2. It needs canvas (M1) and a settled pipeline (M2).
**Strengthened by M2's review (Q10):** on drawn characters, facial features distort because where a
cell boundary falls relative to an eye decides what that eye becomes — and nothing in the pipeline
can see that, since the grid is fixed before any of it runs. So M5 is not only cleanup after a
good-enough conversion; it covers a class of defect M2 could never have reached. That makes it
load-bearing for artwork, which is the majority input (S1).

**Done when:** Dragging paints a continuous run with no skipped cells at any zoom; erased cells
leave the bead count; painting A→B decrements A and increments B; panning modifies nothing; undo
reverses a whole stroke and redo reapplies it; fill affects only the contiguous same-color region.
*(EDIT-1 … EDIT-5, EDIT-7, EDIT-8)*

**Watch for:** Skipped cells during fast drags — a drag reports positions with gaps in them, so
consecutive points have to be connected, not just painted individually. **Fill tolerance is the
scope trap now that fill itself is in** — D19 refuses it, because a speckled background is an
R2/GEN-3 defect and a tolerance value is one more judgment constant in the family that already
includes `MERGE_FLOOR` and `DEFAULT_CONTRAST_TUNING`. Also decide early, and once, whether Q10
earns a mirror or copy-region tool; D19 lowers the stakes, since "fix twelve beads twice" is only
expensive while mistakes are unrecoverable. If it does not earn its place, say so in the milestone's
Delivered block rather than leaving Q10 open.

**Delivered (2026-09-22):** All seven requirements ticked — EDIT-1 … EDIT-5, EDIT-7, EDIT-8 — and
EDIT-6 reads as retired. `npm run check` is green at 128 tests, up from 88.

The milestone's own bound held: everything deterministic is a pure function under NFR-4, and the DOM
layer only decides which one a gesture means. New pure modules, each tested: `src/lib/pattern-edit.ts`
(the `{index, prev, next}` record, and **one `applyEdits` for paint, undo and redo** — which is why
EDIT-4 holds by construction rather than by three code paths agreeing), `src/lib/edit-history.ts`
(the stack, its truncation rule, and a **cell budget** rather than a stroke count — a fill at NFR-3's
limit is one stroke of 50,000 records, so stroke counting bounds nothing),
`src/lib/cell-path.ts` (Bresenham, EDIT-1's named watch-for), `src/lib/flood-fill.ts` (iterative,
name-matched, no tolerance), and `src/lib/palette-query.ts` (the picker's ΔE ranking, over the
matcher's own OkLab table). DOM: `src/render/editor.ts`, and `src/state/pattern-state.ts`.

**`Pattern` did not change, as promised.** M6 and M7 inherit nothing new.

**The unplanned piece was step 1, and it was the right call.** Before it, the mutable state lived in
three holders — `main.ts`'s local tallies, `inventory.ts`'s private array, `canvas-view.ts`'s
pattern — and EDIT-4 has to move all three on every edit. `pattern-state.ts` owns it, the stats line
and the inventory subscribe, and an edit reaches them by the same path a generate does. Tallies are
maintained incrementally during a stroke and then **re-tallied from the pattern at every stroke
boundary and after every undo and redo**; measured at the hard limit that costs 0.5 ms, and it
removes drift as a class rather than as a bug to be found later.

**Both tiers of the picker shipped**, not just tier 1. Tier 1 is the bead inventory itself — its rows
are real buttons now, so the existing swatch-and-code list is the primary picker rather than a second
one built beside it, and picking from it adds nothing to the shopping list. Tier 2 is the query panel:
a native `<input type="color">`, a text filter over code and hex, and ~12 candidates ranked by OkLab
ΔE. **Candidates already in the pattern are badged with their counts and deliberately not promoted**
("P17 · 302 in pattern" beside "P19 · new") — ranking has to keep meaning nearest, and the badge is
what stops a correction silently adding a color to the bead order. That exposes a real spec gap,
recorded and not invented around: **no requirement covers the distinct-color count *after* editing**
— SET-4's Check says the *generated* pattern. The badge is v1's answer; M9 decides if it is enough.

**Two things shipped that no ID names**, both recorded here rather than given requirements:
- **The eyedropper.** Alt-click adopts a cell's color. It is an input method for EDIT-3, live in
  every tool including pan, and the one canvas gesture that records no edit and pushes no history.
- **Empty is a pickable color**, pinned first in the picker. EDIT-8 asks for fill "with the palette
  color and with empty", and this is how the second half is reachable: the eraser is a tool, so
  without it there is no way to say *fill* with empty.

**Q10 is answered: no mirror, no copy-region.** Written up in full at Q10 in `specs.md`. The short
version is that no M5 tool has a selection model — fill's region comes from the pattern — and both
of those tools need one; and undo plus the eyedropper took most of the cost out of the symmetric
case. Q10 stays open as a *generation* question, which is the only place it was ever reachable from.

**The bar is icon-only** (2026-09-22, after the milestone's own work was done). Six inline `<svg>`
icons replace the Pan/Brush/Eraser/Fill/Undo/Redo labels; the active-color button keeps its bead
code, which is information rather than a label. Three things make this cheap to revisit, which is
the only reason it was done outside M8: the icons are plain inline SVG in `index.html`, so swapping
one is a paste; each draws in `currentColor`, so the pressed and disabled states need no second
artwork; and `aria-label` carries the accessible name the visible text used to. The placeholders are
drawn in the 24 px stroke style Lucide, Feather and Heroicons-outline share, so a set from that
family drops in at the same weight — **they are meant to be replaced.** UI-7 still owns whether the
bar *looks* right; this only settles that it is icons.

**Verified in a real browser, not only in Node**, since every Check here is an interaction: each of
the seven ticks was driven end to end against the dev server, including the drag-continuity Check at
three zoom levels (fit, ×3, and the 46.875 px maximum) and the 390 px layout, where the bar wraps to
two rows and all seven targets measure 44 × 44 (UI-6) — six icons on the first row, the color
button on the second. A worst-case fill — 50,000 cells, one stroke —
is ~29 ms end to end, so NFR-2's budget is untouched by this milestone.

---

### M6 — PNG export · S
**Do:** Render the current pattern to an image at a fixed cell size independent of screen zoom,
with codes on every cell, and download it.

**Why here:** Needs the finished render (M1) and edits (M5) so the export reflects real state.

**Done when:** The file opens as a valid PNG; every non-empty cell shows a legible code; manual
edits appear; exporting at two different screen zoom levels produces identical files.
*(OUT-1, OUT-2, OUT-3)*

---

### M7 — Autosave · S
**Do:** Save the current pattern, its settings, and its manual edits to browser-local storage.
Restore on load. One slot, no project list.

**Why last:** Lowest risk, and it needs the final shape of the pattern data to be settled. It
prevents the most enraging failure mode — losing an hour of hand-editing to an accidental refresh.

**Done when:** Generate, edit several cells, reload: pattern and edits come back. With the network
disabled after first load, everything still works. *(SAVE-1, SAVE-2)*

---

### M8 — Interface floor · M
**Do:** Implement UI-1 … UI-6. Collapse the control grid to one column on narrow viewports and stop
the horizontal overflow at 390 px. Replace the ad-hoc spacing, radius, and font-size literals with
scales defined in `:root`. Give every interactive control a visible focus ring, bring app text to
WCAG AA contrast, and size touch targets to 44 px at 390 px wide.

**Why here:** All of v1's UI surface exists by now — the canvas view from M1, crop from M4, editor
chrome from M5 — so nothing gets styled twice. It is also the last point where this is still cheap:
after M9 ticks the boxes, reopening them is a regression rather than a task.

**Done when:** UI-1 … UI-6 pass their Checks at both 1280 px and 390 px. *(UI-1 … UI-6, NFR-5)*

**Watch for:** This is deliberately the *mechanical* half of appearance — consistency and
breakage, not taste. The subjective half is UI-7 and is **[v2]**; if you find yourself choosing
fonts or reworking the color story, you have crossed into the tuning loop D14 exists to prevent.

---

### M9 — Final verification · M
**Do:** Verify the bead inventory totals against non-empty cell count. Check usability at 1280 px
and at 390 px wide. Re-run the R1–R6 reference review. Walk the full **[v1]** requirement list —
UI-1 … UI-6 included — and tick every Check.

**Done when:** Every **[v1]** requirement in `specs.md` passes. *(OUT-4, NFR-5, UI-1 … UI-6,
"Done looks like")*

---

### M10 — Pattern orientation · S — ✅ **Done** (2026-09-13)
**Do:** Draw gridlines every 10 cells on the pattern view, plus row and column numbers along the
top and left edges that stay put while panning. One "Grid" checkbox toggles both.

**Why here:** Not on the critical path, and not a prerequisite for anything — but hands-on use of
M1 showed that a large pattern is hard to navigate: at maximum zoom a 300 × 160 pattern shows about
0.3% of itself. Gridlines alone do not fix that (every 10-cell block looks identical), which is why
the edge numbers ship with them rather than after. Cheap now that M1's canvas exists.

**Done when:** Gridlines land on every 10th cell boundary in both directions; edge numbers identify
the visible columns and rows and stay correct while panning; both vanish and return with the
toggle. *(VIEW-6, VIEW-7)*

**Watch for:** Gridlines that disappear against the darkest or lightest beads — a line crosses many
cells, so `src/contrast.ts`'s per-cell trick does not apply.

**Delivered:** `src/lib/guides.ts` holds the geometry as pure functions — the gridline interval and
its pitch threshold, which boundaries fall inside a visible range, the adaptive ruler-label step,
and the per-axis ruler test — with 11 tests, and M6's export as the intended second consumer (D16).
`src/render/canvas-view.ts` draws gridlines as a dark/light double rule (the answer to the
watch-for: a pair reads against any bead, and `fillRect` dodges `stroke`'s half-pixel centering),
then rulers last so they sit above everything. One "Grid" checkbox toggles both by redrawing, never
by a CSS class. M1's canvas contract was untouched: no CSS change, no `Pattern` change, and
`devicePixelRatio` still applied only in `layout()`.

**Two things worth carrying forward:**
- **Rulers cost nothing to keep pinned.** The canvas is already `position: sticky` at the scroll
  corner, so labels drawn at its own edges are sticky for free — the reason this milestone stayed S
  rather than growing a DOM gutter. Anything that later gives `#grid-wrapper` an `overflow`,
  `transform`, `filter`, or `contain` breaks this along with the whole M1 view.
- **The two thresholds are judgment calls, not measurements,** like `MIN_CODE_FONT_PX` in M1: a
  14 px minimum gridline pitch and a 34 px minimum label pitch. Both are one constant each in
  `guides.ts` and both are covered by tests that assert the behavior, not the number.

---

## Critical path

M0 → M1 → M2 → M5 → M6 are sequential; each genuinely needs the one before it. **M3 can be done at
any point** — slot it in whenever you want a quick, satisfying win, the way M10 was. M4 needs M2
done. M7 needs the pattern data settled by M5.

**M0, M1, M2, M5 and M10 are done. M6 is next**, and it is the last item on the critical path. M2
closed 2026-09-21 with GEN-8 unticked (see its Delivered block); M5 closed 2026-09-22 with all seven
of its requirements ticked, and the bound D19 set for it held — every new piece is a pure, tested
function, and `Pattern` did not change, so **M6 and M7 inherit nothing new**. M6 reads the same
`Pattern` the editor has been mutating, so OUT-2 ("manual edits appear in the export") needs no work
beyond exporting what is there.

**No tactical plan is open.** Write `plans/m6-export.md` the day M6 starts, not before.

The two large items, **M1 and M2, are the project.** If time runs short, everything after them can
be trimmed; neither of them can be.

## Risks

| Risk | Signal | Response |
|---|---|---|
| M2 becomes an endless tuning loop | Days pass with output that is "better" but no milestone closes | The R1–R6 review is the stopping rule. Pass it and move on. The editor covers the rest. |
| Canvas work in M1 takes longer than expected | Zoom, pan, and text rendering each fight you | Ship zoom before pan, and pan before code-text level-of-detail. All three are separable. |
| Reference images flatter the algorithm | Everything passes but a real user's file looks bad | Pick R4 and R5 from actual phone photos and R2/R3 from real uploaded-style artwork, not curated stock images — and pick all six *before* tuning. |
| White-canvas artwork is a poor v1 experience | Patterns come out with a wide white border; inventory is mostly white | Expected, not a bug (spec D13). Make sure crop (M4) and the eraser (M5) actually make it workable, and treat background removal as the first v2 item. |
| ~~Mini bead pitch is wrong (Q1)~~ — **retired in M0** | Mini patterns came out ~30% too wide | Fixed: pitch is now 2.6 mm / 0.102 in. Confirm against a real bead strip when convenient. |
| Scope creep from the deferred list | You start "just quickly adding" dithering, palette switching, or fill *tolerance* | Each is a logged decision with a reason. Reopen it deliberately, not mid-milestone — which is what D19 did for undo and fill, before M5 started rather than inside it. |

## Explicitly not in v1

Background removal and subject auto-trim, pixel-art passthrough mode, palette switching (needs the
other palette files sourced first), legend in the export, user-facing algorithm choice, printable
PDF, multi-project library, draw-from-scratch mode, and deliberate visual design (UI-7).
_(Undo/redo and flood fill were on this list until D19 moved them into M5.)_

Reasons for each are in the `specs.md` decision log. Four worth restating:

**Background removal is out of v1 but first in line for v2** (D13). It serves the majority input
case, so this is the deferral most likely to bite. The v1 answer is crop plus eraser, and it is
free for artwork already saved with a transparent background. Expect v1 bead inventories for
drawings to be dominated by white — that is the expected behavior, and it is the evidence for
building SET-7 next. When it is built, it ships together with SET-8 (auto-trim), because removing a
background without trimming the empty margin silently makes the finished piece smaller than the
width the user asked for.

**Undo and fill are in, as of D19** — this list said the opposite until 2026-09-21. D7 rested on a
one-cell brush making mistakes self-correcting, but EDIT-1 always specified dragging, and the state
an edit overwrites is generated rather than authored, so "paint it again" assumes knowledge the user
does not have. Fill follows undo in, and its own case is D13's: flood-fill-with-empty over a uniform
background is the v1 answer for white-canvas artwork, which is the majority input.

**The printable PDF is out** because it is roughly a week of work hidden behind five words in the
original spec, and a PNG with codes covers the on-screen case.

**Deliberate visual design is out, but the floor under it is not** (D14). v1 still has to look
finished rather than broken: UI-1 … UI-6 are **[v1]** and get built in M8 — consistent spacing,
radius, and type scales, a working narrow layout, focus rings, AA contrast, real touch targets.
What is deferred is UI-7, the part that needs taste: typography, a color story of its own, empty
states, motion. That half has the same no-finish-line shape as M2's color tuning, so it gets the
same treatment — the U1–U5 interface review in `specs.md`, with an explicit stopping rule — and it
waits for v2 rather than running loose inside v1. NFR-5 and UI-1 stay unticked until M8 verifies
them, but **the specific 390 px clipping they were written against is gone** — `src/styles.css` has
carried an `@media (max-width: 640px)` block since M0, and a real 390 px viewport measures zero
horizontal overflow with nothing clipped. See the correction on NFR-5 in `specs.md`.
