// The upload control (U2, D21, UI-4, UI-6): the styled picker must name the
// loaded image, keep naming it after a rejected pick, name it again after an
// autosave restore, open the chooser from the keyboard and the mouse, and wrap
// a long name rather than clip it.
//
//     node scripts/ui-check/file-picker.mjs   → prints checks; exits non-zero on a failure

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep, WIDTHS, OUT, FIXTURES } from './cdp.mjs';

const art = join(FIXTURES, 'art.png');
const longName = join(OUT, 'IMG_20260926_141512_a_very_long_photo_name_from_a_phone.png');
copyFileSync(art, longName);

const b = await launch();
let chooserOpened = 0;
b.on('Page.fileChooserOpened', () => chooserOpened++);

let failures = 0;
const check = (label, ok, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
const shownName = () => b.evaluate(`document.getElementById('fileName').textContent`);
const opensChooser = async (act) => {
    await b.send('Page.setInterceptFileChooserDialog', { enabled: true });
    chooserOpened = 0; await act(); await sleep(300);
    await b.send('Page.setInterceptFileChooserDialog', { enabled: false });
    return chooserOpened > 0;
};

for (const w of WIDTHS) {
    console.log(`${w}px`);
    await b.setWidth(w);
    await b.freshLoad();
    check('placeholder before any upload', (await shownName()) === 'No image yet');
    const box = await b.evaluate(`(() => { const r = document.querySelector('.file-button').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
    check('button at least 44 tall (UI-6)', box[1] >= 44, box.join(' × '));

    await b.upload(art);
    check('names the uploaded file', (await shownName()) === 'art.png');
    await b.upload(join(FIXTURES, 'not-an-image.png'));
    check('a rejected pick leaves the name alone (D21)', (await shownName()) === 'art.png',
        await b.evaluate(`document.getElementById('statusMessage').textContent.slice(0, 40)`));

    await b.focusFromTop();
    await b.tab(); await sleep(100);
    const focus = await b.evaluate(`({ id: document.activeElement.id, fv: document.activeElement.matches(':focus-visible'),
        ring: getComputedStyle(document.querySelector('.file-button')).outlineStyle })`);
    check('Tab lands on the input, ring drawn on the button (UI-4)', focus.id === 'imageUpload' && focus.fv && focus.ring === 'solid', JSON.stringify(focus));
    check('Enter opens the chooser', await opensChooser(() => b.key('Enter', 'Enter', 13, '\r')));
    await b.evaluate(`document.getElementById('imageUpload').focus()`);
    check('Space opens the chooser', await opensChooser(() => b.key(' ', 'Space', 32, ' ')));
    const at = await b.evaluate(`(() => { const r = document.querySelector('.file-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    check('a click on the button opens the chooser', await opensChooser(async () => {
        for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    }));

    await b.upload(longName);
    const long = await b.evaluate(`(() => { const n = document.getElementById('fileName'); return { fits: n.scrollWidth <= n.clientWidth, page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }; })()`);
    check('a long name wraps, never clips or scrolls the page (UI-1)', long.fits && long.page <= long.client, JSON.stringify(long));
    await b.captureElement('.file-picker', `file-picker-${w}-long.png`, { pad: 10, scale: 2 });

    await b.upload(art);
    await b.generate();
    await sleep(500); // let the autosave write land
    await b.send('Page.reload', {}); await sleep(300);
    await b.waitFor(`window.__perlerBooted && document.getElementById('beadList').children.length > 0`, 10000);
    check('an autosave restore names the file again', (await shownName()) === 'art.png');
}
b.close();
console.log(failures ? `\n${failures} failure(s)` : '\nAll file-picker checks pass');
process.exit(failures ? 1 : 0);
