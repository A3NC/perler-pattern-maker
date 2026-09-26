// The mechanical UI Checks, measured in every screen state at both widths:
//
//   UI-1  page never scrolls sideways; no box escapes its parent; selects not truncated
//   UI-4  every Tab stop shows the app's own focus ring (not the browser's `auto` one)
//   UI-5  WCAG contrast of every text/background pair, from computed colours
//   UI-6  every control at least 44 × 44
//
// States: U1 first load, U2 uploaded, U3 generated, E editor (brush + picker
// open), U4a over the size limit, U4b a text file named .png. UI-2's reflow and
// U1–U5 themselves are judged on the screenshots this writes to OUT.
//
//     node scripts/ui-check/audit.mjs        (with `npm run dev` running)
//
// Exits non-zero if any Check fails. Two things it cannot see, and which the
// screenshots are for: text hidden by `text-overflow`, and the select check's
// guess at the arrow's width, which over-reports on auto-width selects -- those
// are listed as "verify", not counted as failures.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep, WIDTHS, OUT, FIXTURES } from './cdp.mjs';

const PAGE_AUDIT = String.raw`(() => {
    const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('.sr-only'); };
    const name = (el) => { let n = el.tagName.toLowerCase(); if (el.id) n += '#' + el.id;
        else if (el.className && typeof el.className === 'string') n += '.' + el.className.trim().split(/\s+/).join('.');
        const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
        return t ? n + ' "' + t + '"' : n; };
    const de = document.documentElement;
    const res = { docScrollWidth: de.scrollWidth, clientWidth: de.clientWidth, escapes: [], selects: [], small: [], contrast: [] };

    // UI-1: boxes leaving the viewport, or content overflowing a non-scrolling box.
    // The crop overlay is excluded: its handles hang outside the image by design.
    for (const el of document.body.querySelectorAll('*')) {
        if (!vis(el) || el.closest('#outputContainer') || el.closest('.crop-clip, .crop-rect')) continue;
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 0.5 || r.left < -0.5) res.escapes.push(name(el) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
        const s = getComputedStyle(el);
        if (s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0
            && !['SELECT', 'INPUT', 'BUTTON'].includes(el.tagName) && !el.matches('#previewArea, #previewFrame'))
            res.escapes.push(name(el) + ' content ' + el.scrollWidth + ' > box ' + el.clientWidth);
    }

    // UI-1: the selected option's text against the select's content box, less a guessed ~20px arrow.
    const cv = document.createElement('canvas').getContext('2d');
    for (const sel of document.querySelectorAll('select')) {
        if (!vis(sel)) continue; const s = getComputedStyle(sel); cv.font = s.font;
        const text = sel.options[sel.selectedIndex].text; const need = cv.measureText(text).width;
        const box = sel.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 20;
        res.selects.push({ sel: name(sel), text, needPx: Math.round(need), availPx: Math.round(box), truncated: need > box });
    }

    // UI-6: every control. A checkbox counts its label row (the label carries for=), and the
    // hidden file input counts the visible label that stands in for it.
    for (const el of document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"]), label.file-button')) {
        if (!vis(el)) continue; let r = el.getBoundingClientRect(); let via = '';
        if (el.type === 'checkbox' && el.parentElement.classList.contains('view-toggle')) { r = el.parentElement.getBoundingClientRect(); via = ' (row)'; }
        if (r.width < 44 - 0.5 || r.height < 44 - 0.5) res.small.push(name(el) + via + ' ' + r.width.toFixed(1) + '×' + r.height.toFixed(1));
    }

    // UI-5: each element with its own visible text; background = the stack of ancestor backgrounds.
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
        let bg = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg); return bg; };
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const seen = new Set();
    const measure = (el, color, label) => {
        const s = getComputedStyle(el); const bg = bgOf(el); const fg = blend(parse(color), bg);
        const hi = Math.max(L(fg), L(bg)), lo = Math.min(L(fg), L(bg)); const ratio = (hi + 0.05) / (lo + 0.05);
        const px = parseFloat(s.fontSize), w = parseInt(s.fontWeight); const need = px >= 24 || (px >= 18.66 && w >= 700) ? 3 : 4.5;
        const key = label + hex(fg) + hex(bg); if (seen.has(key)) return; seen.add(key);
        res.contrast.push({ el: label, fg: hex(fg), bg: hex(bg), ratio: +ratio.toFixed(2), need, pass: ratio >= need });
    };
    for (const el of document.body.querySelectorAll('*')) {
        if (!vis(el)) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
            || ['INPUT', 'SELECT'].includes(el.tagName) && !['checkbox', 'color', 'file'].includes(el.type);
        if (own) measure(el, getComputedStyle(el).color, name(el) + (el.disabled ? ' [disabled]' : ''));
        // Placeholders are text too, and their colour is the browser's unless the app pins it.
        if (el.placeholder && !el.value) measure(el, getComputedStyle(el, '::placeholder').color, name(el) + ' ::placeholder');
    }
    return res;
})()`;

const FOCUS_PROBE = String.raw`(() => { const el = document.activeElement; if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    // The hidden file input draws its ring on the label after it.
    const shown = el.classList.contains('file-input') ? getComputedStyle(el.nextElementSibling) : s;
    return { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        label: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 24),
        outline: shown.outlineStyle + ' ' + shown.outlineWidth + ' ' + shown.outlineColor,
        focusVisible: el.matches(':focus-visible') }; })()`;

async function tabThrough(b, max = 60) {
    await b.focusFromTop();
    const stops = []; const seen = new Set();
    for (let i = 0; i < max; i++) {
        await b.tab(); await sleep(40);
        const p = await b.evaluate(FOCUS_PROBE); if (!p) break;
        const k = p.el + p.label; if (seen.has(k)) break; seen.add(k); stops.push(p);
    }
    // Focusing a late row scrolls the bead list; put it back so later states start at rest.
    await b.evaluate(`document.activeElement && document.activeElement.blur(); document.getElementById('beadList').scrollTop = 0`);
    return stops;
}

const b = await launch();
const results = {};

async function state(key, act, { focus = false } = {}) {
    await act();
    await sleep(300);
    const a = await b.evaluate(PAGE_AUDIT);
    await b.capturePage(`${key}.png`); // at rest: before the Tab pass scrolls lists
    if (await b.evaluate(`document.getElementById('beadList').children.length > 0`))
        await b.captureElement('#beadCountsContainer', `${key}-inventory.png`); // see capturePage's caveat
    if (focus) a.focus = await tabThrough(b);
    results[key] = a;
}

for (const w of WIDTHS) {
    await b.setWidth(w);
    await b.freshLoad();
    await state(`${w}-U1-first-load`, async () => {}, { focus: true });
    await state(`${w}-U2-uploaded`, () => b.upload(join(FIXTURES, 'art.png')));
    await state(`${w}-U3-generated`, () => b.generate(), { focus: true });
    await state(`${w}-E-editor-picker`, () => b.evaluate(
        `document.getElementById('toolBrushBtn').click(); document.getElementById('activeColorBtn').click()`), { focus: true });
    await state(`${w}-U4a-over-limit`, () => b.evaluate(`(() => { const t = document.getElementById('targetWidth');
        t.value = '9999'; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`));
    await b.freshLoad();
    await state(`${w}-U4b-bad-file`, () => b.upload(join(FIXTURES, 'not-an-image.png')));
}
b.close();

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
for (const [key, r] of Object.entries(results)) {
    console.log(key);
    if (r.docScrollWidth > r.clientWidth) fail(`UI-1 page scrolls sideways: ${r.docScrollWidth} > ${r.clientWidth}`);
    for (const e of r.escapes) fail(`UI-1 ${e}`);
    for (const s of r.selects) if (s.truncated) console.log(`  verify UI-1 select ${s.sel}: needs ~${s.needPx}px of ~${s.availPx}px (check the screenshot)`);
    for (const s of r.small) fail(`UI-6 ${s}`);
    for (const c of r.contrast) if (!c.pass) fail(`UI-5 ${c.ratio}:1 < ${c.need} ${c.fg} on ${c.bg} ${c.el}`);
    for (const f of r.focus ?? []) if (!f.focusVisible || /^(none|auto)/.test(f.outline)) fail(`UI-4 ${f.el} "${f.label}": ${f.outline}`);
}
const pairs = new Map();
for (const r of Object.values(results)) for (const c of r.contrast) pairs.set(`${c.fg} on ${c.bg}`, Math.min(c.ratio, pairs.get(`${c.fg} on ${c.bg}`) ?? 99));
const lowest = [...pairs].sort((x, y) => x[1] - y[1]).slice(0, 3).map(([p, v]) => `${v} ${p}`).join(', ');
const stops = Object.values(results).reduce((n, r) => n + (r.focus?.length ?? 0), 0);
console.log(`\n${failures ? failures + ' failure(s)' : 'All mechanical Checks pass'}. Tab stops checked: ${stops}. Lowest contrast: ${lowest}.`);
console.log(`Screenshots and results.json in ${OUT}`);
process.exit(failures ? 1 : 0);
