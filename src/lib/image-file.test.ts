import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    MAX_SOURCE_DIMENSION,
    classifyImageFile,
    looksTruncated,
    readHeaderDimensions,
    sniffFormat,
    undecodableMessage
} from './image-file';
import type { FileFacts } from './image-file';

/* ------------------------------------------------------------- fixtures */

function u16be(value: number): number[] { return [(value >> 8) & 0xFF, value & 0xFF]; }
function u16le(value: number): number[] { return [value & 0xFF, (value >> 8) & 0xFF]; }
function u24le(value: number): number[] { return [value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF]; }
function u32be(value: number): number[] { return [...u16be(Math.floor(value / 0x10000)), ...u16be(value & 0xFFFF)]; }
function u32le(value: number): number[] { return [...u16le(value & 0xFFFF), ...u16le(Math.floor(value / 0x10000))]; }
function ascii(text: string): number[] { return [...text].map((char) => char.charCodeAt(0)); }
function fill(count: number, byte = 0): number[] { return new Array(count).fill(byte); }

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function png(width: number, height: number, { iend = true } = {}): number[] {
    return [
        ...PNG_SIGNATURE,
        ...u32be(13), ...ascii('IHDR'), ...u32be(width), ...u32be(height),
        8, 6, 0, 0, 0, ...fill(4),          // bit depth, color type, ..., CRC
        ...u32be(0), ...ascii('IDAT'), ...fill(4),
        ...(iend ? [...u32be(0), ...ascii('IEND'), ...fill(4)] : [])
    ];
}

/** APP0 then SOF0, the shape every baseline JPEG encoder writes. */
function jpeg(width: number, height: number, { eoi = true, padBefore = 0 } = {}): number[] {
    return [
        0xFF, 0xD8,
        ...(padBefore > 0 ? [0xFF, 0xE1, ...u16be(padBefore + 2), ...fill(padBefore)] : []),
        0xFF, 0xE0, ...u16be(16), ...ascii('JFIF\0'), ...fill(9),   // length counts itself: 2 + 14
        0xFF, 0xC0, ...u16be(17), 8, ...u16be(height), ...u16be(width), ...fill(10),
        0xFF, 0xDA, ...u16be(12), ...fill(10),
        ...fill(64, 0x7E),                  // stand-in for entropy-coded data
        ...(eoi ? [0xFF, 0xD9] : [])
    ];
}

function gif(width: number, height: number, { trailer = true } = {}): number[] {
    return [
        ...ascii('GIF89a'), ...u16le(width), ...u16le(height), 0, 0, 0,
        ...fill(32, 0x11),
        ...(trailer ? [0x3B] : [])
    ];
}

/** `chunk` picks between WebP's three incompatible header layouts. */
function webp(width: number, height: number, chunk: 'VP8X' | 'VP8L' | 'VP8 ', { declaredSize = -1 } = {}): number[] {
    let body: number[];
    if (chunk === 'VP8X') {
        body = [...ascii('VP8X'), ...u32le(10), 0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)];
    } else if (chunk === 'VP8L') {
        const bits = (width - 1) | ((height - 1) << 14);
        body = [...ascii('VP8L'), ...u32le(5), 0x2F, ...u32le(bits >>> 0)];
    } else {
        body = [...ascii('VP8 '), ...u32le(16), 0, 0, 0, 0x9D, 0x01, 0x2A, ...u16le(width), ...u16le(height), ...fill(4)];
    }
    const payload = [...ascii('WEBP'), ...body];
    const size = declaredSize >= 0 ? declaredSize : payload.length;
    return [...ascii('RIFF'), ...u32le(size), ...payload];
}

function bmp(width: number, height: number, { declaredSize = -1 } = {}): number[] {
    const total = 54 + 16;
    return [
        ...ascii('BM'), ...u32le(declaredSize >= 0 ? declaredSize : total), ...fill(4), ...u32le(54),
        ...u32le(40), ...u32le(width), ...u32le(height), ...fill(28),
        ...fill(16)
    ];
}

/**
 * Build the two windows exactly as upload.ts slices them, so the tests
 * exercise the real contract rather than a convenient one.
 */
function facts(body: number[], overrides: Partial<FileFacts> = {}): FileFacts {
    const bytes = Uint8Array.from(body);
    return {
        name: 'image.png',
        type: 'image/png',
        size: bytes.length,
        head: bytes.subarray(0, 65536),
        tail: bytes.subarray(Math.max(0, bytes.length - 64)),
        ...overrides
    };
}

/* ---------------------------------------------------------------- sniff */

test('each of IN-1\'s five formats is identified from its magic bytes', () => {
    assert.equal(sniffFormat(Uint8Array.from(png(4, 4))), 'png');
    assert.equal(sniffFormat(Uint8Array.from(jpeg(4, 4))), 'jpeg');
    assert.equal(sniffFormat(Uint8Array.from(gif(4, 4))), 'gif');
    assert.equal(sniffFormat(Uint8Array.from(webp(4, 4, 'VP8X'))), 'webp');
    assert.equal(sniffFormat(Uint8Array.from(bmp(4, 4))), 'bmp');
});

test('the bytes win over the extension and over the browser\'s MIME guess', () => {
    // A PNG named .jpg and reported as image/jpeg is still a PNG. The OS maps
    // extensions to types; it never looks inside the file.
    const verdict = classifyImageFile(facts(png(10, 10), { name: 'photo.jpg', type: 'image/jpeg' }));
    assert.equal(verdict.ok && verdict.format, 'png');
});

test('HEIC and AVIF are identified by their ISO-BMFF brand', () => {
    const heic = [...fill(4), ...ascii('ftypheic'), ...fill(32)];
    const avif = [...fill(4), ...ascii('ftypavif'), ...fill(32)];
    assert.equal(sniffFormat(Uint8Array.from(heic)), 'heic');
    assert.equal(sniffFormat(Uint8Array.from(avif)), 'avif');
});

test('containers that are not images at all are each told apart', () => {
    assert.equal(sniffFormat(Uint8Array.from(ascii('%PDF-1.7\n...'))), 'pdf');
    assert.equal(sniffFormat(Uint8Array.from([0x50, 0x4B, 0x03, 0x04, ...fill(16)])), 'zip');
    assert.equal(sniffFormat(Uint8Array.from(ascii('hello, this is a text file\n'))), 'text');
    assert.equal(sniffFormat(Uint8Array.from(ascii('<svg xmlns="..." viewBox="0 0 1 1">'))), 'svg');
    assert.equal(sniffFormat(Uint8Array.from([...fill(4), ...ascii('ftypisom'), ...fill(32)])), 'video');
});

test('an XML declaration ahead of the root element still reads as SVG', () => {
    const body = ascii('<?xml version="1.0" encoding="UTF-8"?>\n<svg width="10" height="10">');
    assert.equal(sniffFormat(Uint8Array.from(body)), 'svg');
});

test('unrecognized binary is unknown rather than guessed at', () => {
    assert.equal(sniffFormat(Uint8Array.from([0x1F, 0x8B, 0x08, 0x00, ...fill(16, 0xAB)])), 'unknown');
    assert.equal(sniffFormat(new Uint8Array(0)), 'unknown');
});

/* ----------------------------------------------------------- dimensions */

test('dimensions come out of each format\'s header', () => {
    assert.deepEqual(readHeaderDimensions('png', Uint8Array.from(png(640, 480))), { width: 640, height: 480 });
    assert.deepEqual(readHeaderDimensions('jpeg', Uint8Array.from(jpeg(640, 480))), { width: 640, height: 480 });
    assert.deepEqual(readHeaderDimensions('gif', Uint8Array.from(gif(640, 480))), { width: 640, height: 480 });
    assert.deepEqual(readHeaderDimensions('bmp', Uint8Array.from(bmp(640, 480))), { width: 640, height: 480 });
});

test('all three WebP header layouts are read', () => {
    assert.deepEqual(readHeaderDimensions('webp', Uint8Array.from(webp(640, 480, 'VP8X'))), { width: 640, height: 480 });
    assert.deepEqual(readHeaderDimensions('webp', Uint8Array.from(webp(640, 480, 'VP8L'))), { width: 640, height: 480 });
    assert.deepEqual(readHeaderDimensions('webp', Uint8Array.from(webp(640, 480, 'VP8 '))), { width: 640, height: 480 });
});

test('a BMP stored top-down reports its height as a magnitude', () => {
    const topDown = bmp(64, 64);
    topDown.splice(22, 4, ...u32le(0xFFFFFFC0));        // -64 as int32
    assert.deepEqual(readHeaderDimensions('bmp', Uint8Array.from(topDown)), { width: 64, height: 64 });
});

test('a JPEG whose frame header is past the window returns null, not an error', () => {
    // A large EXIF block alone can push SOF0 beyond 64 KB. The post-decode
    // backstop in upload.ts covers this case; here it must simply not throw.
    const withHugeExif = jpeg(640, 480, { padBefore: 70000 });
    assert.equal(readHeaderDimensions('jpeg', Uint8Array.from(withHugeExif).subarray(0, 65536)), null);
});

test('malformed headers return null rather than throwing', () => {
    assert.equal(readHeaderDimensions('png', Uint8Array.from(PNG_SIGNATURE)), null);
    assert.equal(readHeaderDimensions('jpeg', Uint8Array.from([0xFF, 0xD8, 0xFF, 0xFF, 0xFF])), null);
    assert.equal(readHeaderDimensions('webp', Uint8Array.from(ascii('RIFF____WEBPnope'))), null);
    // A header claiming a zero side is corrupt, and is reported as unknown.
    assert.equal(readHeaderDimensions('png', Uint8Array.from(png(0, 480))), null);
});

test('formats with no header parser are simply unknown', () => {
    assert.equal(readHeaderDimensions('heic', Uint8Array.from([...fill(4), ...ascii('ftypheic')])), null);
});

/* ----------------------------------------------------------- truncation */

test('a file cut short of its end marker is detected', () => {
    assert.equal(looksTruncated('jpeg', ...windows(jpeg(8, 8, { eoi: false }))), true);
    assert.equal(looksTruncated('png', ...windows(png(8, 8, { iend: false }))), true);
    assert.equal(looksTruncated('gif', ...windows(gif(8, 8, { trailer: false }))), true);
});

test('a complete file is not flagged', () => {
    assert.equal(looksTruncated('jpeg', ...windows(jpeg(8, 8))), false);
    assert.equal(looksTruncated('png', ...windows(png(8, 8))), false);
    assert.equal(looksTruncated('gif', ...windows(gif(8, 8))), false);
    assert.equal(looksTruncated('webp', ...windows(webp(8, 8, 'VP8X'))), false);
    assert.equal(looksTruncated('bmp', ...windows(bmp(8, 8))), false);
});

test('trailing padding after the end marker is tolerated', () => {
    // Searching a window rather than demanding the final byte: a false positive
    // here refuses a file that would have worked.
    assert.equal(looksTruncated('jpeg', ...windows([...jpeg(8, 8), ...fill(20)])), false);
    assert.equal(looksTruncated('gif', ...windows([...gif(8, 8), ...fill(8)])), false);
});

test('self-declared lengths catch truncation where there is no end marker', () => {
    assert.equal(looksTruncated('webp', ...windows(webp(8, 8, 'VP8X', { declaredSize: 9999 }))), true);
    assert.equal(looksTruncated('bmp', ...windows(bmp(8, 8, { declaredSize: 9999 }))), true);
    // A BMP that writes 0 for its own size is not evidence of anything.
    assert.equal(looksTruncated('bmp', ...windows(bmp(8, 8, { declaredSize: 0 }))), false);
});

test('formats we cannot check are never guessed to be truncated', () => {
    assert.equal(looksTruncated('heic', ...windows(fill(64, 0x22))), false);
    assert.equal(looksTruncated('unknown', ...windows(fill(64, 0x22))), false);
});

/** looksTruncated's (head, tail, size) triple, sliced the way upload.ts does. */
function windows(body: number[]): [Uint8Array, Uint8Array, number] {
    const f = facts(body);
    return [f.head, f.tail, f.size];
}

/* -------------------------------------------------------------- verdicts */

test('an empty file is reported as empty, not as an unrecognized format', () => {
    // Order matters and is user-visible: a zero-byte file has no signature, so
    // sniffing first would report "not an image" where IN-2 wants "empty".
    const verdict = classifyImageFile(facts([], { size: 0 }));
    assert.equal(verdict.ok, false);
    assert.equal(!verdict.ok && verdict.reason, 'empty');
});

test('every rejection reason produces its own distinct message (IN-2)', () => {
    const verdicts = [
        classifyImageFile(facts([], { size: 0 })),
        classifyImageFile(facts(ascii('%PDF-1.7 ...'))),
        classifyImageFile(facts(ascii('just some notes'))),
        classifyImageFile(facts(ascii('<svg viewBox="0 0 1 1">'))),
        classifyImageFile(facts(jpeg(8, 8, { eoi: false }))),
        classifyImageFile(facts(png(12000, 9000)))
    ];
    const messages = verdicts.map((verdict) => (verdict.ok ? 'accepted' : verdict.message));
    assert.equal(new Set(messages).size, messages.length);
    assert.equal(messages.some((message) => /error occurred/i.test(message)), false);
});

test('a text file renamed to .png is rejected without being decoded (IN-3)', () => {
    const verdict = classifyImageFile(facts(ascii('this was never a picture\n'), { name: 'sneaky.png' }));
    assert.equal(!verdict.ok && verdict.reason, 'not-an-image');
    assert.match(!verdict.ok ? verdict.message : '', /not an image/i);
});

test('HEIC and AVIF are accepted for a decode attempt, never refused outright (IN-4)', () => {
    // Safari reads HEIC. Refusing it here would break the iPhone photo case
    // this requirement exists for; the message comes later, only if the decode
    // actually fails.
    const heic = classifyImageFile(facts([...fill(4), ...ascii('ftypheic'), ...fill(64)]));
    assert.equal(heic.ok, true);
    assert.equal(heic.ok && heic.format, 'heic');
    assert.match(undecodableMessage('heic'), /HEIC/);
    assert.match(undecodableMessage('heic'), /JPEG/);
});

test('the size ceiling is enforced from the header, on either axis (IN-6)', () => {
    const max = MAX_SOURCE_DIMENSION;
    assert.equal(classifyImageFile(facts(png(max, max))).ok, true);
    const tooWide = classifyImageFile(facts(png(max + 1, 100)));
    const tooTall = classifyImageFile(facts(png(100, max + 1)));
    assert.equal(!tooWide.ok && tooWide.reason, 'too-large');
    assert.equal(!tooTall.ok && tooTall.reason, 'too-large');
    assert.match(!tooWide.ok ? tooWide.message : '', /8001 x 100/);
});

test('an unreadable header does not block a file the decoder may still handle', () => {
    const verdict = classifyImageFile(facts([...fill(4), ...ascii('ftypheic'), ...fill(64)]));
    assert.equal(verdict.ok && verdict.dimensions, null);
});

test('a valid file of each accepted format passes cleanly', () => {
    for (const body of [png(100, 80), jpeg(100, 80), gif(100, 80), webp(100, 80, 'VP8L'), bmp(100, 80)]) {
        const verdict = classifyImageFile(facts(body));
        assert.equal(verdict.ok, true, JSON.stringify(verdict));
        assert.deepEqual(verdict.ok && verdict.dimensions, { width: 100, height: 80 });
    }
});
