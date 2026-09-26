// Shared harness for the UI checks: a headless Chrome driven over the DevTools
// protocol, with no dependency beyond Node 22's built-in WebSocket and fetch.
// Built during M8 to measure UI-1 … UI-6 and the U1–U5 states; kept for M9,
// which walks those Checks again.
//
// It measures a *running* app. Start `npm run dev` first, or point APP at any
// server (e.g. `npm run preview`):
//
//     APP=http://localhost:5173/ node scripts/ui-check/audit.mjs
//
// Environment: APP (default http://localhost:5173/), OUT (default
// scripts/ui-check/out, git-ignored), CHROME (default: the macOS install path).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const APP = process.env.APP ?? 'http://localhost:5173/';
export const OUT = process.env.OUT ?? join(HERE, 'out');
export const FIXTURES = join(HERE, 'fixtures');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The two widths every UI Check names. 390 is emulated as a phone (dpr 2, mobile viewport). */
export const WIDTHS = [1280, 390];

export async function launch() {
    mkdirSync(OUT, { recursive: true });
    // Port 0 lets Chrome pick a free port and write it to DevToolsActivePort,
    // so two runs never collide on a fixed port.
    const profile = mkdtempSync(join(tmpdir(), 'ui-check-'));
    const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    let targets;
    for (let i = 0; i < 50; i++) {
        try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(100); }
    }
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        if (m.method) for (const fn of listeners.get(m.method) ?? []) fn(m.params);
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (m) => m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result));
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
    };

    const waitFor = async (expression, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (await evaluate(expression)) return; await sleep(100); }
        throw new Error(`timeout: ${expression}`);
    };

    await send('Page.enable'); await send('DOM.enable'); await send('Runtime.enable');

    const b = {
        send, evaluate, waitFor,
        on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),

        async setWidth(w) {
            await send('Emulation.setDeviceMetricsOverride', w === 390
                ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
                : { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
        },

        /** A first visit: storage cleared (so autosave restores nothing), palette loaded, web fonts in. */
        async freshLoad() {
            await send('Storage.clearDataForOrigin', { origin: new URL(APP).origin, storageTypes: 'all' });
            await send('Page.navigate', { url: APP });
            await sleep(300);
            await waitFor(`window.__perlerBooted && !document.getElementById('generateBtn').textContent.includes('Loading')`);
            // Measuring mid font-swap would measure the fallback face.
            await evaluate('document.fonts.ready.then(() => true)');
            await sleep(200);
        },

        async upload(path) {
            const { root } = await send('DOM.getDocument');
            const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#imageUpload' });
            await send('DOM.setFileInputFiles', { nodeId, files: [path] });
            await sleep(800);
        },

        async generate() {
            await evaluate(`document.getElementById('generateBtn').click()`);
            await waitFor(`document.getElementById('beadList').children.length > 0`);
        },

        async key(key, code, keyCode, text) {
            // `text` matters: without it Chrome dispatches the key but does not
            // activate the focused control, so Enter/Space appear to do nothing.
            await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
        },

        tab: () => b.key('Tab', 'Tab', 9),

        /**
         * Make the next Tab land on the page's first control. blur() is not
         * enough: Chrome resumes sequential navigation from the last focused
         * element, so a pass after an earlier one would start mid-page. A click
         * on empty page margin moves the starting point to the top.
         */
        async focusFromTop() {
            await evaluate('document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)');
            await sleep(50);
            for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 2, y: 2, button: 'left', clickCount: 1 });
            await sleep(50);
        },

        /**
         * The whole page. CAVEAT: this capture does not paint a nested scroll
         * container that lies outside the viewport, so .bead-list can come out
         * blank here while being fine on screen. Use captureElement for it.
         */
        async capturePage(file) {
            const m = await send('Page.getLayoutMetrics');
            const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
                clip: { x: 0, y: 0, width: m.cssLayoutViewport.clientWidth, height: Math.ceil(m.cssContentSize.height), scale: 1 } });
            writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
        },

        /** One element, scrolled into the viewport first. Clip coordinates are page coordinates, not viewport ones. */
        async captureElement(selector, file, { pad = 0, scale = 1, maxHeight = Infinity } = {}) {
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
            await sleep(250);
            const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
            const c = await send('Page.captureScreenshot', { format: 'png', clip: {
                x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
                width: r.w + 2 * pad, height: Math.min(r.h, maxHeight) + 2 * pad, scale } });
            writeFileSync(join(OUT, file), Buffer.from(c.data, 'base64'));
        },

        close() { ws.close(); chrome.kill(); },
    };
    return b;
}
