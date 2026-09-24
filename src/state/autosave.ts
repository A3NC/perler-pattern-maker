import { SAVE_VERSION, decodeImageRecord, decodePattern, encodePattern } from '../lib/pattern-save';
import type { SavedImageRecord, SavedSettings } from '../lib/pattern-save';
import type { CropRect } from '../lib/crop';
import type { Pattern } from '../types';
import { showStatus } from '../status';
import { deleteImage, deleteSlot, readSlot, writePattern, writeSlot } from './save-store';
import { onPatternChange } from './pattern-state';

/**
 * Autosave (SAVE-1, D23): one `pattern-state` subscriber that mirrors the live
 * pattern into IndexedDB, and the loader that reads it back at startup.
 *
 * It is a subscriber rather than something the editor or main.ts remembers to
 * call, so a generate, a stroke, an undo, a redo and a clear all reach the save
 * by the path they already reach the stats line and the inventory. Undo history
 * is never written (D19, D23).
 */

/** The image a pattern was generated from, as main.ts holds it. */
export interface SaveSource {
    file: File;
    crop: CropRect;
}

export type SavedSession =
    | { kind: 'none' }
    /** The slot held something unusable. It has already been deleted. */
    | { kind: 'invalid'; reason: string }
    | {
        kind: 'restored';
        pattern: Pattern;
        settings: SavedSettings;
        savedAt: string;
        /** Null when there was no image record, or it could not be used (the pattern still restores). */
        image: SaveSource | null;
        /** Why the image was dropped, when there was one and it was. For the console. */
        imageProblem?: string;
    };

const UNAVAILABLE_MESSAGE = 'Autosave is unavailable in this browser, so this pattern will not survive '
    + 'a reload. Download a PNG to keep it.';

/** The generate the stored records belong to. Edits reuse it; a new generate replaces it. */
let generation = '';
/** Writes run one at a time, in order, so a quick stroke → undo cannot land out of order. */
let queue: Promise<void> = Promise.resolve();
/** The pattern whose edit is queued but not yet written; further edits to it coalesce. */
let pendingEditOf: Pattern | null = null;
/** Report a failure once, then stay quiet until a write succeeds again. */
let failureReported = false;

function newGeneration(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * `reportFailure` is true only for writes that carry a pattern. A failed delete
 * costs nothing the user made -- there is no pattern on screen to lose -- and
 * reporting it would put an autosave error over a successful upload's status,
 * since every new upload clears the pattern and with it the slot.
 */
function enqueue(job: () => Promise<void>, reportFailure: boolean): void {
    queue = queue.then(job).then(
        () => {
            if (reportFailure) failureReported = false;
        },
        (error: unknown) => {
            console.error('Autosave failed:', error);
            if (reportFailure && !failureReported) {
                failureReported = true;
                showStatus(UNAVAILABLE_MESSAGE, 'error');
            }
        }
    );
}

/**
 * Start mirroring. `currentSource` is read at each generate, since the file and
 * crop live in main.ts and the crop-view; it returns null when there is no
 * image to save, and then the slot holds the pattern alone.
 */
export function initAutosave(currentSource: () => SaveSource | null): void {
    onPatternChange((state, reason) => {
        if (reason === 'cleared' || !state) {
            generation = '';
            pendingEditOf = null;
            enqueue(() => deleteSlot(), false);
            return;
        }

        if (reason === 'set') {
            // Captured now, not when the write runs: by then the user may have
            // uploaded something else, and this record describes this generate.
            generation = newGeneration();
            pendingEditOf = null;
            const source = currentSource();
            const patternRecord = encodePattern(state.pattern, state.settings, generation, new Date());
            const imageRecord: SavedImageRecord | null = source && {
                version: SAVE_VERSION,
                generation,
                file: source.file,
                name: source.file.name,
                type: source.file.type,
                crop: { ...source.crop }
            };
            enqueue(() => writeSlot(patternRecord, imageRecord), true);
            return;
        }

        // 'edited' fires at stroke boundaries, undo and redo -- never per
        // pointermove. The pattern is encoded when the write *runs*, so several
        // edits queued behind a slow write collapse into one write of the latest
        // cells; and it is skipped if a newer generate or a clear got there
        // first, since that write already describes what is on screen.
        if (pendingEditOf === state.pattern) return;
        pendingEditOf = state.pattern;
        const editOf = state.pattern;
        const editGeneration = generation;
        const settings = state.settings;
        enqueue(async () => {
            if (pendingEditOf !== editOf || generation !== editGeneration) return;
            pendingEditOf = null;
            await writePattern(encodePattern(editOf, settings, editGeneration, new Date()));
        }, true);
    });
}

/**
 * Read the slot back. Never rejects: anything unusable is deleted and reported
 * as `invalid`, and storage that cannot be read at all is `none` -- it has
 * nothing to restore, and the first save will report the failure itself.
 *
 * The image is returned as a `File` but not decoded: decoding is `upload.ts`'s
 * job, and a restored image goes through the same M3 gate a fresh upload does.
 */
export async function loadSavedSession(): Promise<SavedSession> {
    let slot;
    try {
        slot = await readSlot();
    } catch (error) {
        console.error('Autosave could not be read:', error);
        return { kind: 'none' };
    }

    if (slot.pattern === undefined) {
        // An image without its pattern is a leftover, never something to show.
        if (slot.image !== undefined) enqueue(() => deleteImage(), false);
        return { kind: 'none' };
    }

    const decoded = decodePattern(slot.pattern);
    if (!decoded.ok) {
        enqueue(() => deleteSlot(), false);
        return { kind: 'invalid', reason: decoded.reason };
    }

    let image: SaveSource | null = null;
    let imageProblem: string | undefined;
    if (slot.image !== undefined) {
        const decodedImage = decodeImageRecord(slot.image);
        if (!decodedImage.ok) {
            imageProblem = decodedImage.reason;
        } else if (decodedImage.generation !== decoded.generation) {
            // A torn save: the pattern belongs to a different generate than the
            // image, and pairing them would regenerate from the wrong picture.
            imageProblem = 'image belongs to a different generate';
        } else {
            image = {
                file: new File([decodedImage.file], decodedImage.name, { type: decodedImage.type }),
                crop: decodedImage.crop
            };
        }
    }

    return {
        kind: 'restored',
        pattern: decoded.pattern,
        settings: decoded.settings,
        savedAt: decoded.savedAt,
        image,
        imageProblem
    };
}
