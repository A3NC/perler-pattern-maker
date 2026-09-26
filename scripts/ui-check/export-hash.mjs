// OUT-3 as a regression guard: the SHA-256 of the PNG export for one fixed
// input, so a styling change can prove it did not reach the export. Added at
// M11, whose Check (UI-8) wants the export byte-identical to one made before
// the theme; M9 can reuse it.
//
// Fixed input: fixtures/art.png at the app's default settings, generated at
// 1280 px. The export ignores the view's width, zoom and dpr (D22), so the
// viewport is not part of the input -- but it is pinned anyway, so a failure
// here can only mean the export changed.
//
//     node scripts/ui-check/export-hash.mjs    (with `npm run dev` running)
//
// Exports twice and prints both hashes; they must match each other (OUT-3)
// and the hash recorded before the change being checked.

import { join } from 'node:path';
import { launch, FIXTURES } from './cdp.mjs';

// The export downloads through an object URL. Wrapping createObjectURL is the
// one place the blob passes where the page can read it, without depending on
// headless Chrome's download handling.
const HOOK = String.raw`(() => {
    window.__exportHashes = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
        if (obj instanceof Blob && obj.type === 'image/png') {
            obj.arrayBuffer().then((buf) => crypto.subtle.digest('SHA-256', buf)).then((d) => {
                window.__exportHashes.push({ bytes: obj.size,
                    sha256: [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('') });
            });
        }
        return orig.call(this, obj);
    };
    return true;
})()`;

const b = await launch();
try {
    await b.setWidth(1280);
    await b.freshLoad();
    await b.upload(join(FIXTURES, 'art.png'));
    await b.generate();
    await b.evaluate(HOOK);
    for (let i = 1; i <= 2; i++) {
        await b.evaluate(`document.getElementById('exportBtn').click()`);
        await b.waitFor(`window.__exportHashes.length >= ${i}`, 15000);
    }
    const hashes = await b.evaluate('window.__exportHashes');
    for (const h of hashes) console.log(`${h.sha256}  ${h.bytes} bytes`);
    if (hashes[0].sha256 !== hashes[1].sha256) {
        console.log('\nFAIL: two exports of one pattern differ (OUT-3).');
        process.exitCode = 1;
    }
} finally {
    b.close();
}
