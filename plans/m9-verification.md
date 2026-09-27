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
  `MAX_INTERMEDIATE_PIXELS` stays 4M unless step 1 decides otherwise, and `DEFAULT_CONTRAST_TUNING`
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
  timebox. Step 2 writes this up as D27.
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

1. **NFR-2 — decided (2026-09-26): lower `MAX_INTERMEDIATE_PIXELS` from 4M to ~1M.**
   `SUPERSAMPLE` stays 8, so every pattern up to ~15,600 cells produces the same output as today,
   including the design target and all of R1–R6. Only larger patterns lose supersampling, and
   gradually. To do:
   - measure generation at the hard limit, as M2 did, and pick the value that brings it under
     ~150 ms;
   - look at one large pattern by eye;
   - re-run `ui:export-hash`, since the fixture is under the threshold and the hash must not move;
   - update `rasterize.ts`'s comment, which says the sRGB first reduction is "confined to the
     innermost 8x8", because above the threshold that no longer holds;
   - add a log entry and tick NFR-2 with the measured timing.
2. **Regenerate over hand edits: decided in principle, needs sign-off on the design below.** Warn
   only when Generate is pressed with **nothing changed**: the same target width, bead size and
   colour limit as the pattern's own settings (already in `pattern-state.ts`), the same image and
   the same crop. Nothing else is needed for the image and crop, because a new upload already
   clears the pattern and the crop is locked after a generate (D21). By GEN-7, an unchanged
   Generate reproduces the untouched pattern exactly, so the only thing it does is erase edits.
   Warning there turns it into a deliberate "revert to generated". A Generate with changed
   settings is taken as intent and replaces the pattern without asking, as today.
   - Warn only when edits exist. `pattern-state.ts` gains an "edited since generate" flag, set by
     `patternEdited()` and cleared by `setPattern()`. Without edits, Generate simply runs.
   - After an autosave restore, the flag is unknown (history isn't saved, D23), so it's assumed
     set. A false warning there is harmless; a missing one isn't.
   - The "nothing changed" comparison is a pure function in `src/lib/` with a test.
   - Record in PAL-7's note that changed-settings regenerates still discard edits silently, by
     choice.
3. **Distinct-colour count after editing — decided: the "in pattern / new" badge is enough.**
   Record it at SET-4 and in M5's note. No requirement is added.
4. **Boot guard — decided: remove it.** Delete the inline classic script from `index.html` and
   `window.__perlerBooted` from `main.ts`. Update `claude.md`'s "How to run it" and `README.md`.
   The failure cases (`file://`, serving the source over plain HTTP, a startup throw) go back to
   hanging on "Loading color palette…", and the docs must say so. Check PAL-3 afterwards: its
   Check (a renamed palette file) is handled by `main.ts`, not the guard, so it should still pass.

**Done when:** each one has a recorded answer. Log entries are D28 onward, since D27 is step 2's.

### 2. R1–R6 review, then D27

Generate each of `test_img/R1`–`R6` at the design target (100 wide, default colour limit). Judge
each strictly against its row in "Done looks like" and the three shared pass conditions: within
the SET-4 limit, no flat region broken into noise, no checkerboard or moiré. Save the outputs to
the git-ignored `scripts/ui-check/out/` so the verdicts can be checked.

Then write **D27**:
- **GEN-8 is ticked against the rows that pass**, with the verdict for each row.
- **R3's shading clause becomes a new [v2] requirement** (GEN-9). Its evidence is already in
  D18: lines outscore shading by only ~1.35× at the same tone, the bands overlap across tones,
  and `DEFAULT_CONTRAST_TUNING` is where the work continues.
- **Facial-feature distortion stays Q10**, open as a v2 generation question. It isn't a GEN-8
  failure unless a row's own criterion names it. R4's "eyes intact" is the one to watch, and if
  it fails, it goes into D27 on the same terms.
- **Any other row that fails** is listed in D27 the same way, never passed over in silence.
- Amend "Done looks like"'s "v1 ships when … and the reference-image review below passes" so it
  points at D27. Otherwise it contradicts the tick.

**Done when:** GEN-8 is ticked with a D27 note, GEN-9 [v2] exists, and nothing in "Done looks like"
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
