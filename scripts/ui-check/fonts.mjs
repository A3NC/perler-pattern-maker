// D25's faces, checked where they are actually painted rather than where the
// CSS asks for them: Chrome reports the platform font behind each element, so
// a missing @font-face or a fallback shows up here even when the computed
// font-family looks right. Also captures the pattern canvas with codes on,
// after a fresh generate and after an autosave restore -- the canvas does not
// repaint when a web font arrives, which is what canvas-view.ts's
// `loadingdone` redraw is for.
//
//     node scripts/ui-check/fonts.mjs   → prints the faces; OUT/canvas-*.png

import { join } from 'node:path';
import { launch, sleep, FIXTURES } from './cdp.mjs';

const ELEMENTS = ['h1', '.placeholder-title', 'label[for="targetWidth"]', '#targetWidth', '#generateBtn', '#stats',
    '.bead-item .color-name', '#activeColorName', '.picker-code', '.color-count'];

const b = await launch();
await b.send('CSS.enable');
await b.setWidth(1280);
await b.freshLoad();

const report = async () => {
    const { root } = await b.send('DOM.getDocument', { depth: -1 });
    for (const sel of ELEMENTS) {
        const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        if (!nodeId) continue; // not on screen in this state
        const { fonts } = await b.send('CSS.getPlatformFontsForNode', { nodeId });
        // An input's value lives in its shadow DOM, which this call cannot see; an empty element has no text yet.
        const faces = fonts.map((f) => f.familyName + (f.isCustomFont ? ' (web font)' : ' (SYSTEM)')).join(', ');
        console.log(`  ${sel.padEnd(26)} ${faces || '(no text node)'}`);
    }
};

console.log('first load');
await report();
await b.upload(join(FIXTURES, 'art.png'));
await b.generate();
await b.evaluate(`document.getElementById('activeColorBtn').click()`); await sleep(300);
console.log('generated, picker open');
await report();

const zoomIn = async () => { for (let i = 0; i < 4; i++) { await b.evaluate(`document.getElementById('zoomInBtn').click()`); await sleep(150); } };
await zoomIn();
await b.captureElement('#outputContainer', 'canvas-generated.png', { maxHeight: 520 });

await sleep(500); // let the autosave write land
await b.send('Page.reload', { ignoreCache: true }); await sleep(300);
await b.waitFor(`window.__perlerBooted && document.getElementById('beadList').children.length > 0`, 10000);
await b.evaluate('document.fonts.ready.then(() => true)'); await sleep(300);
await zoomIn();
await b.captureElement('#outputContainer', 'canvas-restored.png', { maxHeight: 520 });
console.log('canvas captures: canvas-generated.png, canvas-restored.png (codes should be in the body face in both)');
b.close();
