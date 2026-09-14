# Version 1 — Build Plan

_Written 2026-09-07 · Scope defined by the **[v1]** requirements in `specs.md`_

## What v1 is

Upload an image → crop it → set finished width, bead size, and color limit → generate a pattern
using perceptual color matching → view it zoomable with toggleable bead codes → fix wrong cells
with a brush and eraser → read the bead inventory → download a PNG with codes on every cell.
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

### M1 — Canvas pattern view · L — 🔄 **In flight**
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

---

### M2 — Quality core: perceptual matching + color limit · L
**Do:** Move color matching to OkLab, precomputing each palette color's values once at load.
Average source pixels within each bead cell when downscaling. Add the color-limit setting: keep the
most-used colors, remap the rest to their nearest kept color. Put the whole thing behind the
pipeline boundary. Add tests.

**Why here:** This is the project's actual risk. It needs M1 in place so results can be seen
properly, and it needs to come before the editor so the editor isn't compensating for a bug that
has a real fix.

**Done when:** Tests cover OkLab matching and color reduction; the pattern never exceeds the color
limit; the same inputs always produce the same output; and the R1–R6 reference review in `specs.md`
passes. *(GEN-2, GEN-3, GEN-4, GEN-6, GEN-7, GEN-8, SET-4)*

**Watch for:** This is a tuning task with no finish line and no error message. Timebox it. The
reference review is the stopping condition — when R1–R6 pass, stop, even if it feels improvable.
The editor in M5 is the escape valve for whatever remains.

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

### M5 — Correction editor · M
**Do:** Single-cell brush, eraser, and a palette color picker. Live bead-count updates. A pan mode
that never paints by accident. No undo, no fill.

**Why here:** This is the safety net for M2. It needs canvas (M1) and a settled pipeline (M2).

**Done when:** Dragging paints a continuous run with no skipped cells at any zoom; erased cells
leave the bead count; painting A→B decrements A and increments B; panning modifies nothing.
*(EDIT-1 … EDIT-6)*

**Watch for:** Skipped cells during fast drags — a drag reports positions with gaps in them, so
consecutive points have to be connected, not just painted individually. Resist adding fill: it
requires undo, and undo is explicitly out of v1. *(D7)*

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

## Critical path

M0 → M1 → M2 → M5 → M6 are sequential; each genuinely needs the one before it. **M3 can be done at
any point** — slot it in whenever you want a quick, satisfying win. M4 needs M2 done. M7 needs the
pattern data settled by M5.

**M0 is done; M1 is in flight** — see `plans/m1-canvas.md` for where it stands.

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
| Scope creep from the deferred list | You start "just quickly adding" fill, or dithering, or palette switching | Each is a logged decision with a reason. Reopen it deliberately, not mid-milestone. |

## Explicitly not in v1

Background removal and subject auto-trim, pixel-art passthrough mode, palette switching (needs the
other palette files sourced first), undo/redo, flood fill, gridlines, legend in the export,
user-facing algorithm choice, printable PDF, multi-project library, draw-from-scratch mode, and
deliberate visual design (UI-7).

Reasons for each are in the `specs.md` decision log. Four worth restating:

**Background removal is out of v1 but first in line for v2** (D13). It serves the majority input
case, so this is the deferral most likely to bite. The v1 answer is crop plus eraser, and it is
free for artwork already saved with a transparent background. Expect v1 bead inventories for
drawings to be dominated by white — that is the expected behavior, and it is the evidence for
building SET-7 next. When it is built, it ships together with SET-8 (auto-trim), because removing a
background without trimming the empty margin silently makes the finished piece smaller than the
width the user asked for.

**Undo is out** because a one-cell brush makes mistakes self-correcting, and leaving it out is what
also keeps flood fill out.

**The printable PDF is out** because it is roughly a week of work hidden behind five words in the
original spec, and a PNG with codes covers the on-screen case.

**Deliberate visual design is out, but the floor under it is not** (D14). v1 still has to look
finished rather than broken: UI-1 … UI-6 are **[v1]** and get built in M8 — consistent spacing,
radius, and type scales, a working narrow layout, focus rings, AA contrast, real touch targets.
What is deferred is UI-7, the part that needs taste: typography, a color story of its own, empty
states, motion. That half has the same no-finish-line shape as M2's color tuning, so it gets the
same treatment — the U1–U5 interface review in `specs.md`, with an explicit stopping rule — and it
waits for v2 rather than running loose inside v1. Note that NFR-5 is **currently failing**: at
390 px the heading, the Generate button, and the target-width control are clipped off-screen.
