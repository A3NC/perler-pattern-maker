import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    MIN_CROP_PX,
    clampCrop,
    cropFromPoints,
    fullImageCrop,
    hitTestCrop,
    moveCrop,
    resizeCrop
} from './crop';
import type { CropRect } from './crop';

const IMAGE_W = 400;
const IMAGE_H = 300;

function rect(x: number, y: number, width: number, height: number): CropRect {
    return { x, y, width, height };
}

function clamp(r: CropRect): CropRect {
    return clampCrop(r, IMAGE_W, IMAGE_H);
}

/** Every operation must return something a later operation can be handed. */
function assertInsideImage(r: CropRect): void {
    assert.ok(Number.isInteger(r.x) && Number.isInteger(r.y), `non-integer origin ${JSON.stringify(r)}`);
    assert.ok(Number.isInteger(r.width) && Number.isInteger(r.height), `non-integer size ${JSON.stringify(r)}`);
    assert.ok(r.x >= 0 && r.y >= 0, `origin outside image ${JSON.stringify(r)}`);
    assert.ok(r.x + r.width <= IMAGE_W, `right edge past image ${JSON.stringify(r)}`);
    assert.ok(r.y + r.height <= IMAGE_H, `bottom edge past image ${JSON.stringify(r)}`);
    assert.ok(r.width >= MIN_CROP_PX && r.height >= MIN_CROP_PX, `below the floor ${JSON.stringify(r)}`);
}

test('the default crop is the whole image', () => {
    assert.deepEqual(fullImageCrop(IMAGE_W, IMAGE_H), rect(0, 0, IMAGE_W, IMAGE_H));
});

test('a degenerate image still yields a usable rectangle', () => {
    assert.deepEqual(fullImageCrop(0, -5), rect(0, 0, 1, 1));
});

test('clamping pulls each edge back inside the image', () => {
    assertInsideImage(clamp(rect(-50, -50, 100, 100)));
    assert.deepEqual(clamp(rect(-50, -50, 100, 100)), rect(0, 0, 100, 100));
    assert.deepEqual(clamp(rect(380, 290, 100, 100)), rect(300, 200, 100, 100));
    assert.deepEqual(clamp(rect(0, 0, 9999, 9999)), rect(0, 0, IMAGE_W, IMAGE_H));
});

test('clamping rounds to whole source pixels', () => {
    assert.deepEqual(clamp(rect(10.4, 10.6, 100.5, 99.5)), rect(10, 11, 101, 100));
});

test('a crop cannot be driven below the minimum on either axis', () => {
    assertInsideImage(clamp(rect(10, 10, 0, 0)));
    assertInsideImage(clamp(rect(10, 10, 1, 2)));
});

test('an image smaller than the minimum is its own floor', () => {
    const tiny = clampCrop(rect(0, 0, 1, 1), 4, 3);
    assert.deepEqual(tiny, rect(0, 0, 4, 3));
});

test('moving preserves the size exactly', () => {
    const start = rect(100, 100, 120, 80);
    const moved = moveCrop(start, 25, -30, IMAGE_W, IMAGE_H);
    assert.deepEqual(moved, rect(125, 70, 120, 80));
});

test('moving into a corner slides and stops -- it never shrinks', () => {
    const start = rect(100, 100, 120, 80);
    for (const [dx, dy] of [[-9999, -9999], [9999, 9999], [-9999, 9999], [9999, -9999]]) {
        const moved = moveCrop(start, dx, dy, IMAGE_W, IMAGE_H);
        assert.equal(moved.width, start.width, `width changed moving by ${dx},${dy}`);
        assert.equal(moved.height, start.height, `height changed moving by ${dx},${dy}`);
        assertInsideImage(moved);
    }
});

test('each corner resizes toward its own anchor and leaves the anchor fixed', () => {
    const start = rect(100, 100, 120, 80);
    const right = start.x + start.width;
    const bottom = start.y + start.height;

    const nw = resizeCrop(start, 'nw', { x: 60, y: 50 }, IMAGE_W, IMAGE_H);
    assert.deepEqual(nw, rect(60, 50, right - 60, bottom - 50));

    const ne = resizeCrop(start, 'ne', { x: 300, y: 50 }, IMAGE_W, IMAGE_H);
    assert.deepEqual(ne, rect(start.x, 50, 300 - start.x, bottom - 50));

    const sw = resizeCrop(start, 'sw', { x: 60, y: 250 }, IMAGE_W, IMAGE_H);
    assert.deepEqual(sw, rect(60, start.y, right - 60, 250 - start.y));

    const se = resizeCrop(start, 'se', { x: 300, y: 250 }, IMAGE_W, IMAGE_H);
    assert.deepEqual(se, rect(start.x, start.y, 300 - start.x, 250 - start.y));
});

test('dragging a corner past its anchor clamps at the minimum instead of flipping', () => {
    const start = rect(100, 100, 120, 80);
    for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
        const far = resizeCrop(start, handle, { x: 1000, y: -1000 }, IMAGE_W, IMAGE_H);
        assertInsideImage(far);
        const nearer = resizeCrop(start, handle, { x: 160, y: 140 }, IMAGE_W, IMAGE_H);
        assertInsideImage(nearer);
    }
});

test('resizing stays inside the image when the pointer leaves it', () => {
    assertInsideImage(resizeCrop(rect(100, 100, 120, 80), 'se', { x: 9999, y: 9999 }, IMAGE_W, IMAGE_H));
    assertInsideImage(resizeCrop(rect(100, 100, 120, 80), 'nw', { x: -9999, y: -9999 }, IMAGE_W, IMAGE_H));
});

test('a new box spans two points in either drag direction', () => {
    const forward = cropFromPoints({ x: 50, y: 40 }, { x: 150, y: 140 }, IMAGE_W, IMAGE_H);
    const backward = cropFromPoints({ x: 150, y: 140 }, { x: 50, y: 40 }, IMAGE_W, IMAGE_H);
    assert.deepEqual(forward, rect(50, 40, 100, 100));
    assert.deepEqual(backward, forward);
});

test('a tap rather than a drag still produces a usable box', () => {
    assertInsideImage(cropFromPoints({ x: 200, y: 150 }, { x: 201, y: 150 }, IMAGE_W, IMAGE_H));
});

test('handles win over the body, and the nearest handle wins over the others', () => {
    const r = rect(100, 100, 120, 80);
    assert.equal(hitTestCrop(r, { x: 102, y: 102 }, 10), 'nw');
    assert.equal(hitTestCrop(r, { x: 218, y: 102 }, 10), 'ne');
    assert.equal(hitTestCrop(r, { x: 102, y: 178 }, 10), 'sw');
    assert.equal(hitTestCrop(r, { x: 218, y: 178 }, 10), 'se');
    assert.equal(hitTestCrop(r, { x: 160, y: 140 }, 10), 'body');
    assert.equal(hitTestCrop(r, { x: 20, y: 20 }, 10), null);
});

test('a handle is grabbable from outside the rectangle, not only inside it', () => {
    const r = rect(100, 100, 120, 80);
    assert.equal(hitTestCrop(r, { x: 94, y: 94 }, 10), 'nw');
});

test('overlapping slop on a small rect resolves to the nearest corner, deterministically', () => {
    // Every corner is within reach here, which is the 390px case: a large screen
    // slop converted into source pixels can exceed the whole rectangle.
    const small = rect(100, 100, 12, 12);
    assert.equal(hitTestCrop(small, { x: 101, y: 101 }, 100), 'nw');
    assert.equal(hitTestCrop(small, { x: 111, y: 101 }, 100), 'ne');
    assert.equal(hitTestCrop(small, { x: 101, y: 111 }, 100), 'sw');
    assert.equal(hitTestCrop(small, { x: 111, y: 111 }, 100), 'se');
    // Dead centre is equidistant from all four: the first in fixed order wins,
    // and it wins every time rather than depending on iteration luck.
    assert.equal(hitTestCrop(small, { x: 106, y: 106 }, 100), 'nw');
});

test('repeated gestures never walk the rectangle out of the image', () => {
    let current = fullImageCrop(IMAGE_W, IMAGE_H);
    const handles = ['nw', 'ne', 'sw', 'se'] as const;
    for (let i = 0; i < 200; i += 1) {
        const point = { x: (i * 37) % 500 - 50, y: (i * 53) % 400 - 50 };
        current = resizeCrop(current, handles[i % 4], point, IMAGE_W, IMAGE_H);
        assertInsideImage(current);
        current = moveCrop(current, (i % 7) - 3, (i % 5) - 2, IMAGE_W, IMAGE_H);
        assertInsideImage(current);
    }
});
