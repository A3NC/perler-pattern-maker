// The R1–R6 reference review (GEN-8 at v1, GEN-9 at v2) as renders a person can judge: each
// image generated at the design target (100 wide, Standard, default colour limit and crop),
// drawn as one flat square per bead with no codes or gridlines, beside its source at the same
// size. Transparent cells are a light checker. Added at M9; the verdicts are a human's.
//
//     node scripts/ui-check/review.mjs    (with `npm run dev` running)
//
// The pattern is read from the autosave record rather than the view, so what is judged is
// exactly the Pattern the app holds, not a canvas that zoom or dpr has resampled.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep, OUT } from './cdp.mjs';

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test_img');
// 19.69 in at 5 mm is 100.0 beads: the design target's width (NFR-3).
const DESIGN_TARGET_IN = '19.69';

const RENDER = String.raw`new Promise((res) => { const q = indexedDB.open('perler-autosave'); q.onsuccess = () => {
  const g = q.result.transaction('slot').objectStore('slot').get('pattern'); g.onsuccess = () => {
    const p = g.result, S = 8, gap = 16, img = document.querySelector('.preview-frame img') || [...document.images].find(i => i.naturalWidth > 200);
    const W = p.width * S, H = p.height * S; const c = document.createElement('canvas'); c.width = W * 2 + gap; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < p.cells.length; i++) { const cx = (i % p.width) * S, cy = Math.floor(i / p.width) * S; const k = p.cells[i];
      if (k < 0) { x.fillStyle = ((i % p.width + Math.floor(i / p.width)) % 2) ? '#ddd' : '#f4f4f4'; } else { const [r, gg, b] = p.colors[k].rgb; x.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')'; }
      x.fillRect(cx, cy, S, S); }
    if (img) x.drawImage(img, W + gap, 0, W, H);
    res(c.toDataURL('image/png')); }; }; })`;
const b = await launch();
try {
  await b.setWidth(1280);
  for (const f of ['R1.PNG','R2.PNG','R3.png','R4.png','R5.JPG','R6.png']) {
    await b.freshLoad();
    await b.upload(join(IMAGES, f));
    await b.evaluate(`(() => { const i = document.getElementById('targetWidth'); i.value = '${DESIGN_TARGET_IN}'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
    await b.generate(); await sleep(800);
    const url = await b.evaluate(RENDER);
    writeFileSync(`${OUT}/review-${f.split('.')[0]}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`Renders in ${OUT}/review-R1.png … review-R6.png`);
} finally { b.close(); }
