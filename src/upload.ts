import {
    MAX_SOURCE_DIMENSION,
    classifyImageFile,
    tooLargeMessage,
    undecodableMessage
} from './lib/image-file';
import type { RejectReason, SniffedFormat } from './lib/image-file';

/**
 * Turn a picked file into a decoded image (IN-1 … IN-4, IN-6).
 *
 * The decision-making is not here: `src/lib/image-file.ts` classifies the
 * file's bytes, and this module is only the browser half -- read two byte
 * windows, ask, then decode. The split exists because `img.onerror` carries no
 * reason at all, so the specific message has to be decided before the decode
 * from evidence in the file itself.
 */

/** How much of the header the classifier needs. A JPEG's SOF can sit deep. */
const HEAD_BYTES = 64 * 1024;
/** Enough to hold any end-of-file marker plus an encoder's trailing padding. */
const TAIL_BYTES = 64;

/** A rejection with a machine-readable reason, so callers need not match strings. */
export class UploadError extends Error {
    readonly reason: RejectReason;

    constructor(reason: RejectReason, message: string) {
        super(message);
        this.name = 'UploadError';
        this.reason = reason;
    }
}

export async function readImageFile(file: File): Promise<HTMLImageElement> {
    const head = await readSlice(file, 0, HEAD_BYTES);
    const tail = await readSlice(file, Math.max(0, file.size - TAIL_BYTES), file.size);

    const verdict = classifyImageFile({
        name: file.name,
        type: file.type,
        size: file.size,
        head,
        tail
    });
    if (!verdict.ok) {
        throw new UploadError(verdict.reason, verdict.message);
    }

    return decodeImage(file, verdict.format);
}

/**
 * Two small reads rather than the whole file. A failure here is not a bad
 * image -- the file has moved, or is a cloud placeholder that has not
 * materialized yet, which is common enough on iCloud Drive and OneDrive to
 * deserve its own message rather than "could not be decoded".
 */
async function readSlice(file: File, start: number, end: number): Promise<Uint8Array> {
    try {
        return new Uint8Array(await file.slice(start, end).arrayBuffer());
    } catch {
        throw new UploadError(
            'unreadable',
            'That file could not be read from disk. It may have been moved or renamed, or it may '
            + 'still be downloading from cloud storage.'
        );
    }
}

/**
 * Decode through an object URL rather than a data URL: `readAsDataURL`
 * base64-encodes the entire file into a string, a third larger than the file,
 * and holds it live for the length of the decode -- real waste at IN-6's
 * ceiling. The URL is revoked either way.
 *
 * `decode()` rejects properly instead of firing an information-free event, but
 * the message still comes from `format`, since the rejection says only that
 * something failed.
 */
async function decodeImage(file: File, format: SniffedFormat): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file);
    const image = new Image();

    try {
        image.src = url;
        await image.decode();
    } catch {
        throw new UploadError('undecodable', undecodableMessage(format));
    } finally {
        URL.revokeObjectURL(url);
    }

    // Backstop for a header the classifier could not parse -- an exotic BMP, a
    // JPEG whose frame header sat past the read window, or a format with no
    // parser at all. Safari has also been known to resolve decode() on an
    // image that produced no pixels.
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        throw new UploadError('undecodable', undecodableMessage(format));
    }
    if (image.naturalWidth > MAX_SOURCE_DIMENSION || image.naturalHeight > MAX_SOURCE_DIMENSION) {
        throw new UploadError(
            'too-large',
            tooLargeMessage({ width: image.naturalWidth, height: image.naturalHeight })
        );
    }

    return image;
}
