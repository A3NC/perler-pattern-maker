// UI-4 by eye: Tabs through the page with a pattern generated, the brush
// active and the picker open, and screenshots each control while it is
// focused -- the filled buttons, the pressed tool, a row that is both selected
// and focused, and the first and last rows of the scrolling lists are the cases
// worth looking at. audit.mjs proves the ring is computed; this shows whether
// it is visible and unclipped.
//
//     node scripts/ui-check/focus-shots.mjs   → OUT/focus-<width>-<control>.png

import { join } from 'node:path';
import { launch, sleep, WIDTHS, FIXTURES } from './cdp.mjs';

const WHICH = String.raw`(() => { const el = document.activeElement; if (!el || el === document.body) return null;
    // Marked per element, so Tab wrapping round is detected even where keys repeat (every unselected swatch).
    if (el.dataset.focusVisited) return { cycle: true };
    el.dataset.focusVisited = '1';
    let key = el.id, sel = el.id ? '#' + el.id : null;
    if (el.classList.contains('file-input')) sel = '.file-button'; // its ring is drawn on the label
    const tag = (name) => { el.dataset.focusShot = name; sel = '[data-focus-shot="' + name + '"]'; key = name; };
    if (el.classList.contains('picker-swatch')) tag(el.classList.contains('selected') ? 'swatch-selected' : 'swatch-other');
    if (el.classList.contains('bead-item')) { const rows = [...el.parentElement.children]; const i = rows.indexOf(el);
        tag(i === 0 ? 'row-first' : i === rows.length - 1 ? 'row-last' : 'row-' + i); }
    return { key, sel }; })()`;

const b = await launch();
for (const w of WIDTHS) {
    await b.setWidth(w);
    await b.freshLoad();
    await b.upload(join(FIXTURES, 'art.png'));
    await b.generate();
    await b.evaluate(`document.getElementById('toolBrushBtn').click(); document.getElementById('activeColorBtn').click()`);
    await sleep(300);
    await b.focusFromTop();
    const done = new Set();
    let stops = 0;
    for (let i = 0; i < 120; i++) {
        await b.tab(); await sleep(60);
        const p = await b.evaluate(WHICH);
        if (!p || p.cycle) break;
        stops++;
        if (!p.sel || done.has(p.key)) continue; // one shot per kind of control
        done.add(p.key);
        // captureElement scrolls the control into view, which is also what focus did.
        await b.captureElement(p.sel, `focus-${w}-${p.key}.png`, { pad: 12, scale: 2 });
    }
    console.log(`${w}px: ${stops} Tab stops, ${done.size} captured`);
}
b.close();
