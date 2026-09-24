import type { SavedImageRecord, SavedPatternRecord } from '../lib/pattern-save';

/**
 * The autosave's IndexedDB slot (M7, D23): one database, one object store, two
 * keys. Holds no decisions -- what a record means is `src/lib/pattern-save.ts`,
 * when to write one is `src/state/autosave.ts` -- and no dependency, because
 * the one thing a small wrapper library would not cover is the two-key
 * transaction the image and the pattern are written in.
 *
 * Every function rejects rather than throws synchronously, including when
 * IndexedDB is missing or blocked, so callers have one failure path.
 */

const DB_NAME = 'perler-autosave';
const DB_VERSION = 1;
const STORE = 'slot';
const PATTERN_KEY = 'pattern';
const IMAGE_KEY = 'image';

export interface StoredSlot {
    pattern: unknown;
    image: unknown;
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
    if (!opening) {
        opening = new Promise<IDBDatabase>((resolve, reject) => {
            // Accessing `indexedDB` itself can throw where site data is blocked.
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) {
                    request.result.createObjectStore(STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
            request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'));
        });
        // A failed open must not be cached: a later call gets a fresh attempt.
        opening.catch(() => {
            opening = null;
        });
    }
    return opening;
}

/** Run `work` in one transaction and settle when it commits -- not when a request succeeds. */
async function inTransaction(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => void
): Promise<void> {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Autosave transaction failed.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Autosave transaction aborted.'));
        work(transaction.objectStore(STORE));
    });
}

/** A new generate: both records, atomically, so a crash cannot leave them disagreeing. */
export function writeSlot(pattern: SavedPatternRecord, image: SavedImageRecord | null): Promise<void> {
    return inTransaction('readwrite', (store) => {
        store.put(pattern, PATTERN_KEY);
        if (image) store.put(image, IMAGE_KEY);
        else store.delete(IMAGE_KEY);
    });
}

/** An edit: the pattern record only. The image never changes after a generate. */
export function writePattern(pattern: SavedPatternRecord): Promise<void> {
    return inTransaction('readwrite', (store) => {
        store.put(pattern, PATTERN_KEY);
    });
}

export function deleteSlot(): Promise<void> {
    return inTransaction('readwrite', (store) => {
        store.delete(PATTERN_KEY);
        store.delete(IMAGE_KEY);
    });
}

export function deleteImage(): Promise<void> {
    return inTransaction('readwrite', (store) => {
        store.delete(IMAGE_KEY);
    });
}

/** Both records as stored, unvalidated -- `pattern-save.ts` decides what they are. */
export async function readSlot(): Promise<StoredSlot> {
    const slot: StoredSlot = { pattern: undefined, image: undefined };
    await inTransaction('readonly', (store) => {
        const patternRequest = store.get(PATTERN_KEY);
        patternRequest.onsuccess = () => {
            slot.pattern = patternRequest.result;
        };
        const imageRequest = store.get(IMAGE_KEY);
        imageRequest.onsuccess = () => {
            slot.image = imageRequest.result;
        };
    });
    return slot;
}
