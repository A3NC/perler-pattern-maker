# M9 — Final verification

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination. When M9 closes,
delete it and update `claude.md` to say v1 is done._

**Milestone goal (`plan-v1.md` M9):** verify that the bead inventory totals match the non-empty
cell count, check usability at 1280 px and 390 px, re-run the R1–R6 reference review, and walk the
full **[v1]** requirement list, ticking every Check.

**Done when:** every **[v1]** requirement in `specs.md` passes its Check, or has been moved out of
v1 by a logged decision. *(OUT-4, NFR-5, UI-1 … UI-6, UI-8, "Done looks like")*

**Started:** 2026-09-26.

---

## Ground rules

- **This is verification, not development.** Don't change the pipeline. `SUPERSAMPLE` stays 8,
  `MAX_INTERMEDIATE_PIXELS` stays 4M (D27), and `DEFAULT_CONTRAST_TUNING`
  and `MERGE_FLOOR` are frozen. That's what makes the R1–R6 review in step 2 final rather than one
  more round of tuning.
- **A failing Check gets one of two answers.** Either a small, mechanical fix, meaning a wrong
  label, a missing guard, or a one-line bug, plus a test when the fix is in `src/lib/` or
  `src/pipeline/`. Or a decision in the log that moves the item to **[v2]**, with the evidence.
  **It never gets a tick it did not earn.** That rule is why GEN-8 was left open at M2.
- **Nothing visual changes.** UI-1 … UI-8 were verified on the themed page at M11. A styling edit
  here reopens them (D25, D26). If one is unavoidable, re-run `npm run ui:audit` and
  `npm run ui:export-hash` after it.
- Work on the `m9-verification` branch, not `main`.

## Already decided (2026-09-26)

- **GEN-8's two failures move to v2** instead of getting another tuning pass. M2 already spent its
  timebox. Step 2 writes this up as the GEN-8 decision.
- **Q11 (formerly the second Q10) is resolved: 50,000 cells for both bead sizes.** A 58 cm Mini
  piece is a rare edge case, not a v1 exception. NFR-3 is ticked on its Check as written.
- **`SUPERSAMPLE` stays 8.** Going to 4 would trade linear-light averaging and lineart detection
  for speed across every pattern size. That isn't worth it for an overrun that only happens at
  the hard limit.
- **Renumbering:** the D15 size question became **Q11**. Feature alignment keeps **Q10**, which
  every existing reference already cites, and Q9 was moved above it so the list reads in order.

---

## Steps

### 0. Baseline

Before any change, record:
- `npm run check`: green, and the test count.
- `npm run build`: clean.
- With `npm run dev` running: `npm run ui:audit` green, and `npm run ui:export-hash`. The two hashes
  must match each other, and match the baseline recorded at M11.

**Done when:** all four are recorded here, under "Results".

### 1. Open decisions: settle them first, because each one changes what gets verified

1. **NFR-2: done (2026-09-26), under D27.** This reversed the first call to lower
   `MAX_INTERMEDIATE_PIXELS`: measured, the buffer barely moved the time (see Results), and quality
   wins at every size. The buffer stays at 4M, `SUPERSAMPLE` stays 8, and the pruned matcher is
   not shipped. Generate now paints "Generating pattern..." one frame before the synchronous run.
   NFR-2 is ticked, and the hard-limit clause is NFR-6 [v2] (a worker).
2. **Regenerate over hand edits: done (2026-09-26), under D28.** Built as designed:
   `src/lib/regenerate.ts` plus 5 tests, `PatternState.edited`, and a native `confirm()` in
   `main.ts`, asked after validation and before the paint frame. PAL-7's note records that
   changed-settings regenerates still discard edits, by choice. Verified in headless Chrome (see
   Results).
3. **Distinct-colour count after editing: done (2026-09-26).** The "in pattern / new" badge is
   enough. Recorded at SET-4 and in M5's note in `plan-v1.md`. No requirement is added.
4. **Boot guard: done (2026-09-26), under D29.** Removed from `index.html`, along with
   `window.__perlerBooted` in `main.ts`, and the harness waits on DOM state instead. The docs say
   what a page stuck on "Loading color palette..." means. PAL-3 is re-checked in step 3.

**Done when:** each one has a recorded answer. Log entries take the next free D-number in the order they are written: NFR-2 became D27.

### 2. R1–R6 review, then the GEN-8 decision

Generate each of `test_img/R1`–`R6` at the design target (100 wide, default colour limit). Judge
each strictly against its row in "Done looks like" and the three shared pass conditions: within
the SET-4 limit, no flat region broken into noise, no checkerboard or moiré. Save the outputs to
the git-ignored `scripts/ui-check/out/` so the verdicts can be checked.

Then write the **GEN-8 decision** (next free D-number):
- **GEN-8 is ticked against the rows that pass**, with the verdict for each row.
- **R3's shading clause becomes a new [v2] requirement** (GEN-9). Its evidence is already in
  D18: lines outscore shading by only ~1.35× at the same tone, the bands overlap across tones,
  and `DEFAULT_CONTRAST_TUNING` is where the work continues.
- **Facial-feature distortion stays Q10**, open as a v2 generation question. It isn't a GEN-8
  failure unless a row's own criterion names it. R4's "eyes intact" is the one to watch, and if
  it fails, it goes into the decision on the same terms.
- **Any other row that fails** is listed in the decision the same way, never passed over in silence.
- Amend "Done looks like"'s "v1 ships when … and the reference-image review below passes" so it
  points at the decision. Otherwise it contradicts the tick.

**Done when:** GEN-8 is ticked with a note citing the decision, GEN-9 [v2] exists, and nothing in "Done looks like"
contradicts either.

### 3. Walk the unticked [v1] Checks

Each one gets run as its Check says, and its result goes in its note:

| ID | How |
|---|---|
| PAL-1 | Inspect the UI and markup: no control adds, edits or removes a colour. |
| PAL-2 | Fresh load with IndexedDB cleared: the app reports the 221-colour palette. |
| PAL-3 | Rename `public/colors_221.json`, reload: a named load error, Generate disabled. Also a broken JSON file. Restore it afterwards. |
| PAL-4 | The Check names `pattern-utils.test.mjs`, which is now `.ts`. Confirm it covers duplicate names, missing names and out-of-range RGB, and fix the filename in the Check. |
| GEN-1 | R1 (transparent background): transparent cells render empty and are left out of the bead count. |
| VIEW-4 | Paint one cell in the palette's darkest colour and one in its lightest, then zoom until codes show: both readable, on screen and in the PNG. |
| OUT-4 | Inventory counts sum to the non-empty cell count, and to SET-3's pre-generate total, on R1 and on a hand-edited pattern. Sorting works. |
| NFR-1 | `npm run build && python3 -m http.server 8000 --directory dist`: the full flow works from plain static files. |
| NFR-2 | Per step 1. |
| NFR-3 | Settings above 300 per side and above 50,000 cells are each refused with SET-5's message. The design target meets VIEW-1 and NFR-2. |

**Done when:** each row is ticked or moved to [v2] by a decision.

### 4. Re-walk the ticked [v1] list

The plan says to walk the *full* list, and later milestones touched earlier ones. That's what the
automated gates are for: `npm run check` covers NFR-4 and every tested requirement, and `ui:audit`
covers UI-1, UI-4, UI-5 and UI-6. Then do one end-to-end pass by hand at 1280 px and at 390 px:
upload → crop → generate → edit (brush, erase, fill, undo/redo, eyedropper) → export → refresh
(restore) → regenerate at a new size → reject a bad file. Anything that has regressed goes back to
step 3's rule.

**Done when:** the gates are green and the manual pass finds nothing, or what it found is fixed.

### 5. Safari and a phone

These were recorded for M9 by M6, M7, M8 and M11, and measured in headless Chrome only:
- M6's `EXPORT_MAX_PIXELS` budget, at the hard-limit export (desktop Safari and an iPhone);
- M7's IndexedDB `Blob` storage, including a HEIC upload → refresh → restore round trip in Safari;
- M11's SVG cursors, and the sky's `round()` and `color-mix()`;
- NFR-5 on a physical phone at ~390 px: every v1 control reachable, touch paint and pan;
- two tabs on one save: last write wins, as D23 says. This was reasoned about but never driven.

**Needs the user:** Safari's Develop → "Allow Remote Automation" if this is driven through
WebDriver, and a phone by hand. A failure here is fixed only if it's one constant (as M6 predicted
for the export budget). Otherwise it's recorded against NFR-5 as a known limitation.

**Done when:** each item has a measured result, or has an explicit "not measured" note that the
user agreed to.

### 6. Close

- Every [v1] box in `specs.md` is ticked or moved by a decision. No bare unticked [v1] remains.
- `plan-v1.md`: mark M9 done, with a Delivered block, and update the status paragraph.
- `claude.md`: M9 done, v1 complete, and no tactical plan open.
- `README.md`: reflect v1 as shipped.
- Delete this file.

---

## Results

_Filled in as the steps run._

**Step 0 (2026-09-26).**
- `npm run check`: green, 211 tests.
- `npm run build`: clean.
- `ui:audit`: green, 122 Tab stops. Lowest contrast is 5.05:1 (`#3d70b2` on white). The only
  "verify" lines are the known auto-width over-report on `#sortOption`.
- `ui:export-hash`: `42ac415b…93d85`, 88,021 bytes, twice. This matches M11's baseline.

**Step 1.1, NFR-2 measurement (Node, 221 colours, 223 × 223 = 49,729 cells, synthetic gradient
with lines).**
- Total generate by buffer size: 3.18M px (8×/cell, today) 318 ms; 2M 291 ms; 1.5M 263 ms;
  1M 236 ms; 0.75M 222 ms. **Lowering the buffer alone cannot reach ~150 ms.**
- By stage, at today's buffer: downsample 156 ms, match 133 ms. At 1M: downsample 75 ms, match
  147 ms. The M2 note that the downscale dominates is only half right: the brute-force OkLab match
  (221 distances per cell) is a floor of ~140 ms that does not depend on buffer size.
- A lightness-sorted, pruned nearest search returned the identical index on all 49,729 cells
  (ties broken on ascending palette index) in **17 ms against 137 ms**.
- **Browser, after the one-frame yield** (headless Chrome, 1280 px): R5 at 193 × 257 (49,601
  beads) gave one long task of 261–303 ms over 3 runs. R1 at 221 × 221 (18,463 beads) gave
  75–114 ms. "Generating pattern..." was set before the long task every time. `npm run check`
  passed (211), `ui:audit` is green, and the export hash is unchanged.

**Step 1.2 (headless Chrome, `fixtures/art.png`).** Unedited + same settings: no question.
Erased one cell + same settings: asked. Declining kept the edit and Undo. Accepting regenerated
and cleared Undo. Edited + width changed: no question. After a reload (restore): asked.
`npm run check`: 216 tests.

**Step 1.3–1.4.** The SET-4 note is recorded. With the boot guard removed, the source served by
`python3 -m http.server` stays on "Loading color palette..." with Generate disabled, as documented.
`ui:audit`, `ui:fonts` and `ui:file-picker` pass on the harness's new DOM-state waits.
`npm run check`: 216.

**Step 2, R1–R6 at the design target** (width 100, Standard, limit 30, default crop). The clean
renders are `scripts/ui-check/out/review-R*.png`: pattern on the left, one flat square per bead,
with the source beside it. **The user accepted these verdicts (2026-09-26)** and ticked GEN-8 at
"good, fixable in the editor" under D30. The original bars moved to GEN-9 [v2].
- R1 (excellent required): silhouette, transparency and face read well. The torso (shirt, shorts,
  braids) is mottled with dark specks, against "flat regions stay single-colored". Draft: **fails
  the flat-region clause**.
- R2 (excellent): the canvas is one uniform white, which passes the key clause. The brown outline
  comes out dashed in places. Draft: **passes the canvas clause, marginal on outlines**.
- R3 (excellent): dark outlines are continuous. The shading bands mostly, with some speckle in the
  hair, and the irises go muddy. Draft: **fails "shading resolves into a few clean bands"**, the
  known M2 item.
- R4 (acceptable): the dog is identifiable, but the blue eyes are nearly lost. The grey backdrop
  bands into several tones with pink and green tints. Draft: **marginal on "eyes intact"**.
- R5 (acceptable): the silhouette and face read. Draft: **passes**.
- R6 (regression guard): the structure is faithful. The violet outline shifts to blue, which is the
  palette's gamut and not the pipeline. There are fringe cells where the art's pixel grid doesn't
  line up with the bead grid, which is SET-9 [v2]. Draft: **passes**.

**Step 3 (2026-09-26, headless Chrome).** All ten rows are ticked, with each result in the
requirement's note:
- PAL-1: no palette-editing control.
- PAL-2: "221 colors" on a fresh load.
- PAL-3: a 404, malformed JSON and invalid entries were each named, with Generate disabled.
  **Fixed** a doubled ".." after validation messages.
- PAL-4: the Check's filename was corrected, and **a test was added** for missing names and
  out-of-range channels (217 tests).
- GEN-1 and OUT-4: R1 has 3,792 beads by every count, and 48 = 48 after edits. Both sorts work.
- VIEW-4: H7 and H2 codes are both readable.
- NFR-1: `dist/` works from `python3 -m http.server`, with an identical export hash.
- NFR-2: D27.
- NFR-3: both limits were refused with SET-5's message, and 221 × 221 was accepted.

**Step 4 (2026-09-26).** Gates: `npm run check` 217, `ui:audit` green (122 stops), `ui:focus`
36 stops at each width, export hash unchanged. The end-to-end walk, now `npm run ui:e2e`, passes
all 19 checks at both 1280 and 390 px: crop → readout, generate = readout, crop hidden, brush,
eraser, undo ×2, redo, eyedropper (no edit, sets the colour), fill as one undoable stroke, export,
reload-restore of the edited pattern, regenerate at a new size with the kept crop, a rejected file
leaving the pattern and file name alone, and no horizontal overflow. Nothing regressed.
