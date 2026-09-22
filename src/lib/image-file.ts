/**
 * Byte-level classification of a picked file, before any decode is attempted
 * (IN-2, IN-3, IN-4, IN-6).
 *
 * Why this exists as pure code rather than as checks inside the upload handler:
 * `img.onerror` carries no reason. The event is empty, so every decode failure
 * looks identical from the inside. A specific message therefore cannot come
 * from the failure -- it has to come from what we knew *before* the decode, by
 * reading the file's own first and last bytes.
 *
 * Nothing here touches the DOM, a File, or a FileReader; callers hand over two
 * plain byte windows. That is what keeps it testable in Node (NFR-4) and is why
 * it lives in src/lib/.
 */

/** NFR-3's source-image ceiling, the one IN-6 rejects against. */
export const MAX_SOURCE_DIMENSION = 8000;

/**
 * What the leading bytes say the file is -- never what its name or its MIME
 * type claims, both of which are just the operating system's extension
 * mapping and are wrong exactly when it matters (a .txt renamed .png arrives
 * as `image/png`).
 */
export type SniffedFormat =
    // The five IN-1 accepts.
    | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp'
    // Images that some browsers decode and others do not. Attempted, never
    // refused outright -- Safari reads HEIC, and refusing it here would break
    // the iPhone photo case that IN-4 is written for.
    | 'heic' | 'avif' | 'tiff' | 'ico'
    // Things no <img> will ever turn into pixels.
    | 'pdf' | 'zip' | 'video' | 'svg' | 'text'
    | 'unknown';

export type RejectReason =
    | 'empty'
    | 'not-an-image'
    | 'vector'
    | 'truncated'
    | 'too-large'
    | 'undecodable'
    | 'unreadable';

/** The five formats IN-1 promises to accept. */
const SUPPORTED_LIST = 'PNG, JPEG, GIF, WebP or BMP';

export interface FileFacts {
    name: string;
    /** The browser's MIME guess. Advisory only -- see SniffedFormat. */
    type: string;
    size: number;
    /** The first bytes of the file (64 KB is enough for every header here). */
    head: Uint8Array;
    /** The last 64 bytes, for the end-of-file markers truncation removes. */
    tail: Uint8Array;
}

export interface Dimensions {
    width: number;
    height: number;
}

export type Verdict =
    | { ok: true; format: SniffedFormat; dimensions: Dimensions | null }
    | { ok: false; reason: RejectReason; message: string };

/* ------------------------------------------------------------------ bytes */

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
    if (offset + signature.length > bytes.length) return false;
    return signature.every((byte, i) => bytes[offset + i] === byte);
}

/** ASCII signature as bytes, so call sites read as the spec writes them. */
function ascii(text: string): number[] {
    return [...text].map((char) => char.charCodeAt(0));
}

function tag(bytes: Uint8Array, offset: number, length: number): string {
    if (offset + length > bytes.length) return '';
    return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/** Unsigned, so a 4 GB size field does not come back negative. */
function u32be(bytes: Uint8Array, offset: number): number {
    return u16be(bytes, offset) * 0x10000 + u16be(bytes, offset + 2);
}

function u32le(bytes: Uint8Array, offset: number): number {
    return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000;
}

/** Signed: BMP writes a negative height for a top-down bitmap. */
function i32le(bytes: Uint8Array, offset: number): number {
    return u32le(bytes, offset) | 0;
}

function indexOfSignature(bytes: Uint8Array, signature: readonly number[]): number {
    for (let i = 0; i + signature.length <= bytes.length; i++) {
        if (matches(bytes, i, signature)) return i;
    }
    return -1;
}

/* ------------------------------------------------------------------ sniff */

const ISO_BMFF_BRANDS: Record<string, SniffedFormat> = {
    avif: 'avif', avis: 'avif',
    heic: 'heic', heix: 'heic', hevc: 'heic', hevx: 'heic',
    heif: 'heic', mif1: 'heic', msf1: 'heic',
    isom: 'video', iso2: 'video', mp41: 'video', mp42: 'video', qt: 'video', M4V: 'video'
};

/**
 * Identify the container from its magic bytes. Returns 'unknown' rather than
 * guessing -- an unknown file is still handed to the decoder, so a wrong guess
 * costs more than no guess.
 */
export function sniffFormat(head: Uint8Array): SniffedFormat {
    if (head.length === 0) return 'unknown';

    if (matches(head, 0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'png';
    if (matches(head, 0, [0xFF, 0xD8, 0xFF])) return 'jpeg';
    if (matches(head, 0, ascii('GIF87a')) || matches(head, 0, ascii('GIF89a'))) return 'gif';
    if (matches(head, 0, ascii('RIFF')) && matches(head, 8, ascii('WEBP'))) return 'webp';
    if (matches(head, 0, [0x49, 0x49, 0x2A, 0x00]) || matches(head, 0, [0x4D, 0x4D, 0x00, 0x2A])) return 'tiff';
    if (matches(head, 0, [0x00, 0x00, 0x01, 0x00])) return 'ico';
    if (matches(head, 0, ascii('%PDF-'))) return 'pdf';
    if (matches(head, 0, [0x50, 0x4B, 0x03, 0x04])) return 'zip';

    // ISO base media (HEIC, AVIF, MP4): 'ftyp' then a four-character brand.
    if (matches(head, 4, ascii('ftyp'))) {
        return ISO_BMFF_BRANDS[tag(head, 8, 4).trim()] ?? 'unknown';
    }

    // BMP is only two bytes of signature, so it is checked after everything
    // more specific has had its turn.
    if (matches(head, 0, ascii('BM'))) return 'bmp';

    return sniffTextual(head);
}

/**
 * Markup and plain text have no magic number, so they are identified by what
 * they lack: a NUL byte or any other control character. SVG is separated out
 * because it gets its own message -- an <img> will often render it, but a
 * viewBox-only SVG has no intrinsic size, so the bead dimensions that follow
 * from it are meaningless.
 */
function sniffTextual(head: Uint8Array): SniffedFormat {
    const sample = head.subarray(0, 512);
    for (const byte of sample) {
        const printable = byte >= 0x20 || byte === 0x09 || byte === 0x0A || byte === 0x0D;
        if (!printable) return 'unknown';
    }
    if (sample.length === 0) return 'unknown';

    const text = String.fromCharCode(...head.subarray(0, 1024)).toLowerCase();
    return text.includes('<svg') ? 'svg' : 'text';
}

/* ------------------------------------------------------- header dimensions */

/**
 * Pull width and height out of the header without decoding anything. This is
 * what makes IN-6 a message rather than a freeze: a 20000 x 20000 PNG is
 * refused having allocated two small byte windows, not 1.6 GB of bitmap.
 *
 * Returns null whenever the answer is not confidently in the window -- an
 * unparsed header is not an error, because upload.ts re-checks the decoded
 * image's natural size as a backstop.
 */
export function readHeaderDimensions(format: SniffedFormat, head: Uint8Array): Dimensions | null {
    switch (format) {
        case 'png':
            // IHDR is the mandatory first chunk, so its offsets are fixed.
            if (head.length < 24 || !matches(head, 12, ascii('IHDR'))) return null;
            return valid({ width: u32be(head, 16), height: u32be(head, 20) });
        case 'gif':
            if (head.length < 10) return null;
            return valid({ width: u16le(head, 6), height: u16le(head, 8) });
        case 'bmp':
            return bmpDimensions(head);
        case 'webp':
            return webpDimensions(head);
        case 'jpeg':
            return jpegDimensions(head);
        default:
            return null;
    }
}

/** A header that reports a zero or negative side is corrupt, not informative. */
function valid(dimensions: Dimensions): Dimensions | null {
    return dimensions.width > 0 && dimensions.height > 0 ? dimensions : null;
}

function bmpDimensions(head: Uint8Array): Dimensions | null {
    if (head.length < 26) return null;
    const headerSize = u32le(head, 14);
    if (headerSize === 12) {
        // BITMAPCOREHEADER: 16-bit sides.
        return valid({ width: u16le(head, 18), height: u16le(head, 20) });
    }
    // A negative height means the rows are stored top-down; the size is the
    // magnitude either way.
    return valid({ width: Math.abs(i32le(head, 18)), height: Math.abs(i32le(head, 22)) });
}

function webpDimensions(head: Uint8Array): Dimensions | null {
    const chunk = tag(head, 12, 4);
    if (chunk === 'VP8X' && head.length >= 30) {
        // Extended: two 24-bit fields, each stored as (size - 1).
        return valid({ width: u24le(head, 24) + 1, height: u24le(head, 27) + 1 });
    }
    if (chunk === 'VP8L' && head.length >= 25 && head[20] === 0x2F) {
        // Lossless: 14 bits each, packed across byte boundaries.
        const bits = u32le(head, 21);
        return valid({ width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1 });
    }
    if (chunk === 'VP8 ' && head.length >= 30 && matches(head, 23, [0x9D, 0x01, 0x2A])) {
        // Lossy keyframe: 14 bits of size plus 2 bits of scale, which we drop.
        return valid({ width: u16le(head, 26) & 0x3FFF, height: u16le(head, 28) & 0x3FFF });
    }
    return null;
}

/** DHT, JPG and DAC sit inside the SOF marker range but are not frame headers. */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
}

/**
 * Walk the segment chain to the first SOF. The fiddly part of this file: fill
 * bytes, standalone markers that carry no length, and a scan that may start
 * before any SOF is reached all have to be handled, and none of them may throw
 * or loop -- every unexpected byte pattern returns null instead.
 */
function jpegDimensions(head: Uint8Array): Dimensions | null {
    let i = 2;
    while (i + 3 < head.length) {
        if (head[i] !== 0xFF) return null;

        const marker = head[i + 1];
        // Runs of 0xFF are legal padding before a marker.
        if (marker === 0xFF) { i++; continue; }
        // Standalone markers: no length field follows.
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
        // Entropy-coded data begins; any SOF would have appeared by now.
        if (marker === 0xDA) return null;

        const length = u16be(head, i + 2);
        if (length < 2) return null;

        if (isStartOfFrame(marker)) {
            if (i + 8 >= head.length) return null;
            return valid({ height: u16be(head, i + 5), width: u16be(head, i + 7) });
        }

        i += 2 + length;
    }
    // The SOF is past our window -- an EXIF thumbnail alone can be tens of KB.
    return null;
}

/* -------------------------------------------------------------- truncation */

/**
 * Detect a file cut short mid-download (IN-3).
 *
 * This exists because the decoder will not tell us: browsers render a JPEG
 * truncated to half its bytes as a partial image and fire `onload`, so IN-3's
 * Check is unreachable through the decode path. Every format here ends with a
 * marker or declares its own length, and that is what gets checked.
 *
 * The end markers are searched for within the tail window rather than demanded
 * at the exact final byte, because some encoders and transfers append padding.
 * A false positive is worse than a miss: it refuses a file that would have
 * worked.
 */
export function looksTruncated(format: SniffedFormat, head: Uint8Array, tail: Uint8Array, size: number): boolean {
    switch (format) {
        case 'jpeg':
            // FF D9 cannot occur inside entropy-coded data: a literal 0xFF is
            // always stuffed with a following 0x00. So finding it is decisive.
            return indexOfSignature(tail, [0xFF, 0xD9]) === -1;
        case 'png':
            return indexOfSignature(tail, ascii('IEND')) === -1;
        case 'gif':
            return lastMeaningfulByte(tail) !== 0x3B;
        case 'webp':
            // RIFF declares its own payload length, excluding the 8-byte header.
            if (head.length < 8) return false;
            return size < u32le(head, 4) + 8;
        case 'bmp': {
            // bfSize is written as 0 by some encoders; only trust it when set.
            if (head.length < 6) return false;
            const declared = u32le(head, 2);
            return declared > 0 && size < declared;
        }
        default:
            return false;
    }
}

/** GIF's trailer is the final byte, but trailing NUL padding is common. */
function lastMeaningfulByte(tail: Uint8Array): number | null {
    for (let i = tail.length - 1; i >= 0; i--) {
        if (tail[i] !== 0x00) return tail[i];
    }
    return null;
}

/* ------------------------------------------------------------- the verdict */

const CONTAINER_MESSAGES: Partial<Record<SniffedFormat, string>> = {
    pdf: `That is a PDF, not an image. Open it and export a page as a PNG or JPEG, then upload that.`,
    zip: `That is a zip archive, not an image. Unpack it and upload one of the images inside.`,
    video: `That is a video file, not an image. Save a single frame as a JPEG or PNG and upload that.`,
    text: `That is a text file, not an image. Choose a ${SUPPORTED_LIST} file.`
};

/**
 * Word the failure the decoder could not explain, from what the bytes said the
 * file was. Exported because upload.ts needs it on the post-decode path and
 * every user-facing message in M3 belongs in one place.
 */
export function undecodableMessage(format: SniffedFormat): string {
    if (format === 'heic') {
        return 'This browser cannot read HEIC/HEIF photos. On an iPhone, either set '
            + 'Settings > Camera > Formats to Most Compatible, or share the photo as a JPEG, '
            + 'then upload that.';
    }
    if (format === 'avif') {
        return `This browser cannot read AVIF images. Re-save the image as a ${SUPPORTED_LIST} file.`;
    }
    if (format === 'tiff') {
        return `This browser cannot read TIFF images. Re-save the image as a ${SUPPORTED_LIST} file.`;
    }
    if (format === 'ico') {
        return `This browser could not read that icon file. Choose a ${SUPPORTED_LIST} file instead.`;
    }
    return 'That file could not be read as an image. It may be damaged, or it may not be an '
        + 'image despite its name.';
}

export function tooLargeMessage(dimensions: Dimensions): string {
    return `That image is ${dimensions.width} x ${dimensions.height} pixels, over the limit of `
        + `${MAX_SOURCE_DIMENSION} pixels per side. Resize it and try again.`;
}

/**
 * The gate every upload passes before a decode is attempted.
 *
 * The order of the checks is user-visible and is the order the Checks in
 * specs.md ask for -- a zero-byte file has no signature, so sniffing it first
 * would report "not an image" where IN-2 wants "empty". Locked by a test.
 */
export function classifyImageFile(facts: FileFacts): Verdict {
    if (facts.size === 0) {
        return {
            ok: false,
            reason: 'empty',
            message: 'That file is empty (0 bytes). Choose an image file with something in it.'
        };
    }

    const format = sniffFormat(facts.head);

    const containerMessage = CONTAINER_MESSAGES[format];
    if (containerMessage) {
        return { ok: false, reason: 'not-an-image', message: containerMessage };
    }
    if (format === 'svg') {
        return {
            ok: false,
            reason: 'vector',
            message: 'That is an SVG vector file, which has no fixed pixel size. Export it as a '
                + 'PNG at the size you want, then upload that.'
        };
    }

    if (looksTruncated(format, facts.head, facts.tail, facts.size)) {
        return {
            ok: false,
            reason: 'truncated',
            message: `That ${formatLabel(format)} file is incomplete -- it looks cut off, as if a `
                + 'download or copy did not finish. Try saving or downloading it again.'
        };
    }

    const dimensions = readHeaderDimensions(format, facts.head);
    if (dimensions && (dimensions.width > MAX_SOURCE_DIMENSION || dimensions.height > MAX_SOURCE_DIMENSION)) {
        return { ok: false, reason: 'too-large', message: tooLargeMessage(dimensions) };
    }

    // Anything left is handed to the decoder, including HEIC and AVIF: some
    // browsers read them, and the sniffed format is carried out so that if the
    // decode does fail, the caller can say which format failed.
    return { ok: true, format, dimensions };
}

const FORMAT_LABELS: Partial<Record<SniffedFormat, string>> = {
    png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', bmp: 'BMP'
};

export function formatLabel(format: SniffedFormat): string {
    return FORMAT_LABELS[format] ?? 'image';
}
