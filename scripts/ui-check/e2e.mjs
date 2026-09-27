// M9's end-to-end walk, at 1280 and 390 px: upload, crop, generate, then brush, eraser,
// undo/redo, eyedropper and fill, then export, reload-restore, regenerate at a new size, and a
// rejected file. Cell-level results are read from the autosave record, so an edit is checked
// against the Pattern itself rather than against pixels on the canvas. A regenerate confirm
// (D28) is auto-accepted.
//
//     node scripts/ui-check/e2e.mjs    (with `npm run dev` running)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep, FIXTURES } from './cdp.mjs';

const IMG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test_img');
const b = await launch(); const ev = (s) => b.evaluate(s);
const txt = (id) => ev(`document.getElementById('${id}').textContent.trim().replace(/\\s+/g,' ')`);
const fails = []; const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails.push(name); };
const mouse = async (type, x, y, mods = 0) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mods });
const clickAt = async (x, y, mods = 0) => { await mouse('mouseMoved', x, y, mods); await mouse('mousePressed', x, y, mods); await mouse('mouseReleased', x, y, mods); await sleep(150); };
const rect = (sel) => ev(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const saved = () => ev(`new Promise(res => { const q = indexedDB.open('perler-autosave'); q.onsuccess = () => { const g = q.result.transaction('slot').objectStore('slot').get('pattern'); g.onsuccess = () => { const p = g.result; if (!p) return res(null); let n = 0; for (const c of p.cells) if (c >= 0) n++; res({ w: p.width, h: p.height, nonEmpty: n, cells: Array.from(p.cells), colors: p.colors.map(c => c.name) }); }; }; })`);
const invSum = () => ev(`[...document.querySelectorAll('#beadList .color-count')].reduce((a, e) => a + Number(e.textContent.replace(/[^0-9]/g, '')), 0)`);
const colorAt = (s, i) => s.cells[i] < 0 ? null : s.colors[s.cells[i]];
try {
  for (const width of [1280, 390]) {
    console.log(`\n== ${width} px ==`);
    await b.setWidth(width); await b.freshLoad();
    await ev(`window.confirm = () => true; true`);
    // upload + crop: drag a new box over the middle of R1
    await b.upload(join(IMG, 'R1.PNG'));
    const before = await txt('dimensions');
    const f = await rect('#previewFrame');
    await mouse('mouseMoved', f.x + f.w * 0.2, f.y + f.h * 0.2); await mouse('mousePressed', f.x + f.w * 0.2, f.y + f.h * 0.2);
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', f.x + f.w * (0.2 + 0.06 * k), f.y + f.h * (0.2 + 0.075 * k));
    await mouse('mouseReleased', f.x + f.w * 0.68, f.y + f.h * 0.8); await sleep(300);
    const after = await txt('dimensions');
    ok('crop changes the readout', before !== after, `${before} → ${after}`);
    await b.generate(); await sleep(300);
    let s = await saved();
    ok('generate matches the readout', after.includes(`${s.w} × ${s.h}`) && after.replace(/,/g, '').includes(`${s.nonEmpty} beads`), `${s.w}×${s.h}, ${s.nonEmpty} beads`);
    ok('crop preview hidden after generate', await ev(`(() => { const e = document.getElementById('previewFrame'); return !e.offsetParent; })()`));
    // zoom in so cells are big, find a filled cell near the centre
    for (let i = 0; i < 6; i++) { await ev(`document.getElementById('zoomInBtn').click(); true`); await sleep(50); }
    // brush: pick the least-used inventory colour, paint one cell
    const target = await ev(`(() => { const rows = [...document.querySelectorAll('#beadList > *')]; const last = rows[rows.length - 1]; last.click(); return document.getElementById('activeColorName').textContent.trim(); })()`);
    await ev(`document.getElementById('toolBrushBtn').click(); true`);
    const s0 = await saved();
    const c2 = await rect('#pattern-canvas'); await clickAt(c2.x + c2.w / 2, c2.y + c2.h / 2); await sleep(400);
    const s1 = await saved();
    const changed = s1.cells.map((v, i) => colorAt(s1, i) !== colorAt(s0, i) ? i : -1).filter(i => i >= 0);
    ok('brush paints one cell the active colour', changed.length === 1 && colorAt(s1, changed[0]) === target, `${changed.length} cell(s), active ${target}`);
    ok('inventory follows the edit', (await invSum()) === s1.nonEmpty, `${await invSum()} vs ${s1.nonEmpty}`);
    // eraser
    await ev(`document.getElementById('toolEraserBtn').click(); true`);
    await clickAt(c2.x + c2.w / 2, c2.y + c2.h / 2); await sleep(400);
    const s2 = await saved();
    ok('eraser empties the cell', colorAt(s2, changed[0]) === null && s2.nonEmpty === s1.nonEmpty - 1);
    // undo twice, redo once
    await ev(`document.getElementById('undoBtn').click(); true`); await sleep(300);
    ok('undo restores the painted cell', colorAt(await saved(), changed[0]) === target);
    await ev(`document.getElementById('undoBtn').click(); true`); await sleep(300);
    const s3 = await saved();
    ok('second undo restores the original', colorAt(s3, changed[0]) === colorAt(s0, changed[0]) && s3.nonEmpty === s0.nonEmpty);
    await ev(`document.getElementById('redoBtn').click(); true`); await sleep(300);
    ok('redo reapplies the paint', colorAt(await saved(), changed[0]) === target);
    // eyedropper: alt-click a different cell, active colour becomes that cell's
    const sE = await saved();
    await clickAt(c2.x + c2.w / 2 + 3 * (c2.w / 30), c2.y + c2.h / 2, 1 /* Alt */); await sleep(300);
    const picked = await txt('activeColorName');
    const sE2 = await saved();
    ok('eyedropper records no edit', JSON.stringify(sE2.cells) === JSON.stringify(sE.cells));
    ok('eyedropper sets the active colour', picked !== '--', `now ${picked}`);
    // fill: fill the painted cell's region with the picked colour
    await ev(`document.getElementById('toolFillBtn').click(); true`);
    const sF0 = await saved();
    await clickAt(c2.x + c2.w / 2, c2.y + c2.h / 2); await sleep(400);
    const sF = await saved();
    const filled = sF.cells.filter((v, i) => colorAt(sF, i) !== colorAt(sF0, i)).length;
    ok('fill changes a region in one stroke', filled >= 1, `${filled} cells`);
    await ev(`document.getElementById('undoBtn').click(); true`); await sleep(300);
    ok('one undo reverts the whole fill', JSON.stringify((await saved()).cells) === JSON.stringify(sF0.cells));
    // export
    await ev(`window.__png = 0; const o = URL.createObjectURL; URL.createObjectURL = function (x) { if (x instanceof Blob && x.type === 'image/png') window.__png = x.size; return o.call(this, x); }; true`);
    await ev(`document.getElementById('exportBtn').click(); true`); await b.waitFor('window.__png > 0', 15000);
    ok('export produces a PNG', true, `${await ev('window.__png')} bytes, status "${await txt('statusMessage')}"`);
    // refresh → restore
    const sR0 = await saved();
    await b.send('Page.reload'); await sleep(2500);
    await ev(`window.confirm = () => true; true`);
    const sR = await saved();
    ok('reload restores the edited pattern', /Restored/.test(await txt('statusMessage')) && JSON.stringify(sR.cells) === JSON.stringify(sR0.cells), await txt('statusMessage'));
    ok('restored inventory matches', (await invSum()) === sR.nonEmpty);
    // regenerate at a new size, crop kept
    await ev(`(() => { const i = document.getElementById('targetWidth'); i.value = '8'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`); await sleep(300);
    const rd = await txt('dimensions');
    await ev(`document.getElementById('generateBtn').click(); true`); await b.waitFor(`/generated/.test(document.getElementById('statusMessage').textContent)`, 10000); await sleep(300);
    const sN = await saved();
    ok('regenerate at a new size uses the kept crop', rd.includes(`${sN.w} × ${sN.h}`) && sN.w !== sR.w, `${rd} → ${sN.w}×${sN.h}`);
    // reject a bad file: pattern and image stay
    await b.upload(join(FIXTURES, 'not-an-image.png')); await sleep(800);
    const sB = await saved();
    ok('rejected file changes only the status line', JSON.stringify(sB.cells) === JSON.stringify(sN.cells) && !!(await ev(`document.getElementById('pattern-canvas')`)) && (await txt('fileName')) === 'R1.PNG', `"${await txt('statusMessage')}" | file: ${await txt('fileName')}`);
    ok('no horizontal overflow', await ev(`document.documentElement.scrollWidth <= innerWidth`));
  }
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nAll end-to-end checks pass.');
  if (fails.length) process.exitCode = 1;
} finally { b.close(); }
