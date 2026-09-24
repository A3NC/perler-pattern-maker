# M7 — Autosave

_Tactical plan for the milestone in flight. Strategy lives in `plan-v1.md`; the requirements and
their Checks live in `specs.md`. This file is the route, not the destination — when M7 closes,
delete it and point `claude.md` at the next one._

**Milestone goal (`plan-v1.md` M7):** save the current pattern, its settings, and its manual edits
to browser-local storage, and restore them on load. One slot, no project list. **Widened
(2026-09-24):** the source image and its crop are saved too, so a restored pattern can still be
regenerated at a different size without re-uploading. Undo history is still not saved.

**Closes:** SAVE-1, SAVE-2. **Constrained by:** D19 (no history in the save), D21 (a new upload
discards the pattern; the crop is one-shot, the size settings are not).

---

## Ground rules

- **`Pattern` does not change.** M5 and M6 both held this line so that M7 would serialize exactly
  what the editor mutates and the export draws. The save is a *separate* stored shape with its own
  version number; `Pattern` is converted to it and back, never reshaped to suit storage.
- **IndexedDB, not `localStorage`.** Saving the image decides this. `localStorage` holds strings
  only, so an image would be base64 (+33%). A 4 MB phone photo becomes about 5.3M characters,
  which is over the ~5 MB per-origin quota on its own. IndexedDB stores the original `File` as a
  `Blob`, byte for byte, so a HEIC stays HEIC. Its quota is a share of disk. It also gives
  transactions, which is how the image and the pattern are kept from disagreeing.
- **No new dependency.** The IndexedDB wrapper is ~50 lines in `src/state/save-store.ts`: open,
  one object store, get/put/delete, and one two-key transaction. `idb-keyval` would cover less than
  that needs, because it has no multi-key transaction.
- **The format is pure and tested** (NFR-4): encoding, decoding and validation go in
  `src/lib/pattern-save.ts` with `pattern-save.test.ts`, DOM-free, with no IndexedDB. The browser
  half holds no decisions. This is the same split as `image-file.ts` / `upload.ts` and
  `export-layout.ts` / `export-png.ts`. The IndexedDB wrapper is verified in the browser, not
  mocked in Node; `fake-indexeddb` would be a dependency added to test fifty lines of glue.
- **The save is a `pattern-state` subscriber**, not something the editor or `main.ts` remembers to
  call. `pattern-state.ts` is the single owner. An edit, an undo, a generate and a clear all
  already reach every subscriber by one path, so they reach the save by the same one.
- **Undo history is not saved** (D19, and EDIT-7's note). A restored pattern arrives through
  `setPattern`, whose `'set'` reason already makes the editor drop its history. That is correct,
  not a bug to fix.
- **A restored image goes through `readImageFile`**, the same M3 gate a fresh upload does. There is
  no second decode path to keep in step with the first.
- **Storage failure never breaks the app.** `indexedDB` can be missing, can fail to open (blocked
  site data, some private modes) and can reject a write with `QuotaExceededError`. Every call is
  caught; the app works exactly as it does today without it, and says so once.

---

## Step 0 — Write D23 first

As M6 wrote D22 before code: several behaviors here satisfy no Check on their own and would
otherwise ship unexplained. Record them in `specs.md`'s decision log:

1. **The image and crop are saved; undo history is not.** Say why for each. The image makes
   D21's ordinary case (regenerate at a different width) survive a reload. Without it, a reload
   leaves Generate disabled until a new upload, which by D21 discards the restored pattern. History
   stays out for D19's reason, plus two costs found while scoping M7. Its writes grow with every
   stroke. And if a history is restored against a pattern from a different moment, `applyEdits`
   writes its `prev` values blind, so it would corrupt the pattern rather than merely fail.
2. **IndexedDB, and why:** the quota arithmetic above, blobs without base64, and one transaction
   for image and pattern.
3. **The slot exists only while a pattern does, and mirrors the screen.** An upload alone saves
   nothing; the image is written with the pattern at Generate. `'cleared'` deletes the slot. A new
   upload clears the pattern (D21), so a reload after it restores nothing, rather than resurrecting
   a pattern the user watched disappear.
4. **Settings are the ones that produced the pattern**, captured at Generate, not the live inputs,
   which D21 leaves editable and which can therefore describe a pattern never generated. On
   restore they go back into the inputs.
5. **One slot, last write wins across tabs.** No `storage`-style sync, no locking. SAVE-3 is the
   multi-project answer and is **[later]**.
6. **Known limit, not fixed:** Safari deletes script-writable storage for a site after seven days
   without a visit, and any browser may evict under disk pressure. `navigator.storage.persist()`
   would help in Chrome but prompts in Firefox. Left for M9 to weigh.

**Done when:** D23 is in the log, SAVE-1 / SAVE-2 reference it, and D19's "no history in autosave"
line points at D23.1.

## Step 1 — The format, pure and tested

`src/lib/pattern-save.ts`. Two records under two keys in one object store:

```ts
interface SavedSettings { targetWidth: number; beadSize: number; colorLimit: number }

interface SavedPatternV1 {
    version: 1;
    generation: string;              // ties this record to its image record
    savedAt: string;                 // ISO; shown in the restore message
    settings: SavedSettings;
    width: number;
    height: number;
    colors: PaletteColor[];          // the distinct colors used, full records
    cells: Int16Array;               // index into `colors`, -1 for empty
}

interface SavedImageV1 {
    version: 1;
    generation: string;
    file: Blob;                      // the uploaded file's own bytes
    name: string;                    // readImageFile's messages name the file
    type: string;
    crop: CropRect;                  // integer source pixels, as crop.ts keeps it
}
```

- **Two keys, not one record,** because the pattern is rewritten after every stroke and the image
  never is. Putting the blob in the per-stroke record would ask the browser to re-store megabytes
  per stroke. `generation` is a fresh id per Generate. A restore whose two records disagree on it
  is a torn save, and the image is dropped rather than paired with the wrong pattern.
- **`Int16Array`, not a JSON array:** IndexedDB structured-clones typed arrays directly, so a
  hard-limit pattern is 100 KB with no stringify. The palette is 221 colors, far inside Int16.
- **`encodePattern(pattern, settings, generation, now)`** builds the color table in first-seen
  order and the index array.
- **Colors are stored as full records, not names looked up in the palette.** Restore then does
  not wait on the palette fetch and still works if it fails (PAL-3). The view, inventory and export
  need only `name` and `rgb`. A later palette switch (PAL-5) also cannot silently repaint a saved
  pattern.
- **`decodePattern(record: unknown)`** and **`decodeImageRecord(record: unknown)`** return
  `{ ok: true, … }` or `{ ok: false, reason }` and **never throw** — the rule `image-file.ts` set
  for input it did not write. `decodePattern` rejects:
  - an unknown `version`;
  - `width`/`height` that are not positive integers, exceed `MAX_PATTERN_DIMENSION`, or multiply
    past `MAX_PATTERN_CELLS` (reuse the constants from `pattern-utils.ts`, don't restate them);
  - `cells` that is not an `Int16Array` of length `width × height`, or holds an index outside
    `[-1, colors.length)`;
  - a color that fails `validatePalette`, which already catches duplicate names and out-of-range
    RGB;
  - settings that are not finite numbers.

  `decodeImageRecord` rejects a missing `Blob`, and a crop that is not four non-negative
  integers with positive size. Whether the crop fits the image is checked after decode, by
  clamping in `crop.ts`, since only the decode knows the size.
- Decoded cells share one object per color, as a generated pattern does.

Tests:
- Round-trip: `decodePattern(encodePattern(p, …))` reproduces width, height, and every cell's
  `name` and `rgb`, including `null` cells, for a small hand-built pattern and at the NFR-3 hard
  limit.
- Tallies from `tallyPattern` on the decoded pattern equal those of the original.
- Each rejection above has its own case, and each returns `ok: false` rather than throwing.
- Encoding is deterministic for a given pattern, generation and `now`.

**Done when:** `npm run check` green with the new tests. Nothing wired yet.

## Step 2 — Settings and the file travel with the pattern

- `setPattern(pattern, tallies, settings)`: add the generate-time settings to `PatternState`. They
  are set by `buildPattern` in `main.ts` from values it already parsed. `Pattern` is untouched.
  This keeps `pattern-state.ts` the single owner, instead of making the save hold a second piece of
  state updated in lockstep, which is the arrangement M5 step 1 removed.
- `main.ts` keeps the uploaded `File` beside `uploadedImage` (`uploadedFile`), replaced on the same
  successful-upload path, so there is one image to save and it is the one on screen.
- `crop-view.ts` gets a `restoreCropPreview(image, crop)` seam: `showCropPreview`'s work with a
  given rectangle, clamped through `crop.ts`, in place of the full-image reset. It is then hidden
  exactly as a generate hides it (D21). Nothing else in that file changes.

**Done when:** the typecheck passes and the existing tests still do.

## Step 3 — Save

`src/state/save-store.ts` (the IndexedDB wrapper) and `src/state/autosave.ts` (one
`onPatternChange` subscriber):

- `'set'`: a new `generation`, then **one transaction** putting both the image record (the
  `uploadedFile`, the current crop) and the pattern record. It is atomic, so a torn save can come
  only from a bug, not from a crash mid-write.
- `'edited'`: puts the pattern record only, with the same `generation`. It fires from
  `commitStroke`, `undo` and `redo` (`src/render/editor.ts`), i.e. at stroke boundaries, never per
  `pointermove`. A refresh mid-drag loses that one stroke; accepted.
- `'cleared'`: deletes both keys in one transaction (D23.3).
- **Writes are serialized.** Each waits on the previous one's promise, so a quick stroke → undo
  cannot land out of order and leave the older pattern stored.
- A failed write is reported once through `showStatus` ("Autosave is unavailable in this browser;
  your pattern will not survive a reload.") and not again until a write succeeds, so a quota error
  does not bury every later status message.

**Measure, don't assume.** Time the `'set'` transaction with a large photo, and an `'edited'` write
at the hard limit. Both are async, so neither should block input. Record the numbers in the
Delivered block. If a stroke-rate write ever backs up the queue, coalesce to the latest pending
pattern rather than queueing every one.

**Done when:** devtools' Application → IndexedDB shows both records after a generate, the pattern
record updating after a stroke, an undo and a redo, and both gone after a new upload.

## Step 4 — Restore

Restore is now **async**, which is the main new risk.

At startup in `main.ts`, after the controls are initialised. It runs alongside the palette load,
not after it, so restore does not depend on the fetch:

1. Read both records. `decodePattern` fails → delete the slot, say once that a saved pattern could
   not be restored, start empty.
2. **The pattern first:** `renderPattern`, then `setPattern`, then write the settings back into
   `targetWidth`, `beadSize` and `colorLimit`. Skip a `beadSize` that matches no `<option>`.
3. **Then the image**, if its record decodes and its `generation` matches:
   `new File([blob], name, { type })` → `readImageFile` → `restoreCropPreview` →
   `hideCropPreview`. Set `uploadedImage` / `uploadedFile`, then `syncControls`, so Generate is
   enabled and the "Will generate" line shows the restored crop at the restored settings.
4. **An image that fails restores the pattern alone.** This covers a decode failure, a torn save,
   or a mismatched generation. Delete the image record, keep the pattern record, and say so ("…
   restored; the source image could not be, so upload it again to regenerate"). The pattern is the
   hand-edited work SAVE-1 exists for; losing the image must not cost it.

- **The status line:** "Restored your last pattern (W × H, saved …)." The palette's own success
  message must not then overwrite it. Adjust that message's wording or ordering rather than
  dropping either.
- **Race with the user.** An upload started while restore is still decoding must win. The restore
  claims an `uploadToken` like an upload does and drops its result if the token has moved. Test it
  by uploading immediately on load with a large saved image.
- **Never a thrown error at boot.** `__perlerBooted` is set before this runs, so a rejection here
  would land in no handler at all. The whole restore is one `try`/`catch` ending in the step 1
  failure path.

**Check against identity assumptions:** the restored pattern's color objects are not the palette's
objects. Grep the editor, inventory, picker and fill for any `===` between color objects; the rule
is to compare names (flood fill already matches on `color?.name ?? null` for this reason). Fix any
found rather than re-binding restored colors to palette records, which would make restore depend
on the palette again.

**Done when:** SAVE-1's Check passes in the dev server: generate, edit several cells, reload. The
pattern, the edits, the counts and the settings come back; then change the width and regenerate
**without uploading**, and the new pattern uses the restored crop.

## Step 5 — SAVE-2, the whole flow offline

Verify the way M6 did, by driving the real app in headless Chrome over the DevTools protocol:
load, set the network offline, then upload, generate, edit, export, and assert **zero** requests in
the network log. IndexedDB is local, so the save adds none; assert that too rather than assume it.
A *reload* while offline is not part of this: without a service worker the app cannot be fetched at
all, and the Check says *after first load*. Say so in the Delivered block so it is not read as a
gap.

---

## Verification — around the thing just built

M4's lesson: test the neighbours, not only the feature.

- Reload after an undo restores the undone state; the redo tail is gone (history is not saved).
- Reload after a fill-with-empty restores the empty cells and the inventory without them.
- A regenerate at a new width, then reload, restores the new width *and* the settings that made it.
- Reload, regenerate at a new width without uploading: the crop matches the original framing
  exactly (compare against a pre-reload generate at the same width, cell for cell).
- Hard-limit pattern: reload restores it, and exporting it gives the same bytes as exporting it
  before the reload (OUT-3 — the save must not perturb a single cell).
- Formats: a restore round-trips a PNG with transparency, a JPEG with EXIF orientation 6 (M4
  verified orientation once; a Blob round trip must not undo it), and, in Safari, a HEIC.
- Corrupt the slot by hand in devtools: bad `version`, an out-of-range cell index, a non-image
  blob, mismatched `generation`. Each boots cleanly with one message. The last two keep the
  pattern and drop only the image.
- Storage blocked (Chrome: block site data for localhost): the app works exactly as before, with
  the single autosave-unavailable message.
- Upload on load while a large saved image is still restoring: the upload wins, nothing flickers
  back.
- Two tabs: confirm last-write-wins behaves as D23.5 says, and no worse.

## Milestone exit

Tick SAVE-1 and SAVE-2 in `specs.md`, mark M7 done in `plan-v1.md` with a Delivered block (the
measured write costs, the widened scope, D23), update `claude.md`'s summary and layout for the new
modules and the `crop-view.ts` seam, delete this file, and point `claude.md` at M8.

## Deferred out of M7 — do not build here

| Thing | Where it belongs |
|---|---|
| Persisting undo history | Declined in D19; costs recorded in D23.1 |
| Saving an uploaded image before any Generate | Not SAVE-1; the slot exists only with a pattern (D23.3) |
| Confirm before a regenerate or upload discards edits | Open beside PAL-7, M9's call (D21) |
| `navigator.storage.persist()`, Safari's 7-day eviction | Recorded in D23.6 for M9 |
| Multiple saved projects, named slots | SAVE-3 **[later]** |
| Cross-tab sync or locking | Not needed for one slot (D23.5) |
| Offline *reload* (service worker) | Not in SAVE-2's Check |
| `fake-indexeddb` / Node tests for the store | The store is glue; the format is what gets tests |
