// Shared plumbing for the end-to-end tests: a throwaway copy of the site in a
// bare git repository, tools/devserver.mjs serving the editor against it (a mock
// of the GitHub API), headless Chrome driven over the DevTools protocol, and a
// few helpers. Node built-ins only (Node 22+). Needs Google Chrome (set CHROME
// to use another binary).
//
// Options every test accepts: --port 8899  --keep (keep the temporary files)

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8899;
const TOKEN = 'test-token-123';
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- a throwaway copy of the site in a bare repository ----------

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'joni-e2e-'));
const WORK = path.join(TMP, 'work');
const BARE = path.join(TMP, 'site.git');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepo() {
  execFileSync('rsync', ['-a', '--exclude', '.git', '--exclude', '.claude', '--exclude', 'STATE.md', '--exclude', 'node_modules', `${ROOT}/`, `${WORK}/`]);
  // The repository as it is after a deploy: content in the editor's own format.
  execFileSync(process.execPath, [path.join(WORK, 'tools/build.mjs')], { stdio: 'ignore' });
  git(TMP, 'init', '-q', '-b', 'main', WORK);
  git(WORK, 'add', '-A');
  git(WORK, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Site as deployed');
  git(TMP, 'clone', '-q', '--bare', WORK, BARE);
}

// ---------- processes ----------

const children = [];
function start(cmd, argv, opts = {}) {
  const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let log = '';
  p.stdout.on('data', d => { log += d; });
  p.stderr.on('data', d => { log += d; });
  p.log = () => log;
  children.push(p);
  return p;
}

function cleanup() {
  for (const p of children) { try { p.kill('SIGKILL'); } catch {} }
  if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

async function waitForHttp(url, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    if (Date.now() - t0 > timeout) throw new Error(`nothing answered at ${url}`);
    await sleep(150);
  }
}

async function startChrome() {
  const profile = path.join(TMP, 'chrome');
  start(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--window-size=1440,900', 'about:blank',
  ]);
  const file = path.join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('\n')) {
    if (Date.now() - t0 > 20000) throw new Error('Chrome did not start');
    await sleep(100);
  }
  const [port, wsPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
  return `ws://127.0.0.1:${port}${wsPath}`;
}

// ---------- a small Chrome DevTools Protocol client ----------

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      } else if (m.method) {
        for (const l of [...listeners]) if (l.method === m.method) l.fn(m.params, m.sessionId);
      }
    };
    ws.onerror = () => reject(new Error('could not connect to Chrome'));
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        const n = ++id;
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
        return new Promise((res, rej) => pending.set(n, { res, rej }));
      },
      on(method, fn) { listeners.push({ method, fn }); },
      close: () => ws.close(),
    });
  });
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  let chooseFiles = null;
  cdp.on('Page.fileChooserOpened', async (params, sid) => {
    if (sid !== sessionId || !chooseFiles) return;
    const files = chooseFiles;
    chooseFiles = null;
    await send('DOM.setFileInputFiles', { files, backendNodeId: params.backendNodeId });
  });

  const page = {
    send,
    // The next file dialog the page opens is answered with these files.
    willChoose(files) { chooseFiles = files; },
    async go(url) { await send('Page.navigate', { url }); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, what, timeout = 10000) {
      const t0 = Date.now();
      for (;;) {
        const v = await page.eval(expression).catch(() => null);
        if (v) return v;
        if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what || expression}`);
        await sleep(100);
      }
    },
    async mouse(type, x, y, extra = {}) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    },
    async click(x, y) {
      await page.mouse('mouseMoved', x, y, { button: 'none' });
      await page.mouse('mousePressed', x, y);
      await page.mouse('mouseReleased', x, y);
    },
    // Center of the element a JS expression returns, in page coordinates.
    // Elements inside the preview frame are offset by the frame's position.
    async center(expr) {
      const r = await page.eval(`(() => {
        const el = ${expr};
        if (!el) return null;
        const win = el.ownerDocument.defaultView;
        let b = el.getBoundingClientRect();
        // Scroll it into view first when it is off the screen, as a person would.
        if (b.top < 0 || b.bottom > win.innerHeight) { el.scrollIntoView({ block: 'center', inline: 'center' }); b = el.getBoundingClientRect(); }
        let x = b.left + b.width / 2, y = b.top + b.height / 2;
        if (win !== window && win.frameElement) { const f = win.frameElement.getBoundingClientRect(); x += f.left; y += f.top; }
        return { x, y };
      })()`);
      if (!r) throw new Error(`not on the page: ${expr}`);
      return r;
    },
    async clickOn(expr) { const { x, y } = await page.center(expr); await page.click(x, y); },
    async dblclick(x, y) {
      await page.mouse('mouseMoved', x, y, { button: 'none', buttons: 0 });
      for (const clickCount of [1, 2]) {
        await page.mouse('mousePressed', x, y, { buttons: 1, clickCount });
        await page.mouse('mouseReleased', x, y, { buttons: 0, clickCount });
      }
    },
    async rightClick(x, y) {
      await page.mouse('mouseMoved', x, y, { button: 'none', buttons: 0 });
      await page.mouse('mousePressed', x, y, { button: 'right', buttons: 2 });
      await page.mouse('mouseReleased', x, y, { button: 'right', buttons: 0 });
    },
    // Presses at (x1, y1), moves in small steps to (x2, y2) and lets go.
    async drag(x1, y1, x2, y2, { steps = 12 } = {}) {
      await page.mouse('mouseMoved', x1, y1, { button: 'none', buttons: 0 });
      await page.mouse('mousePressed', x1, y1, { buttons: 1 });
      for (let i = 1; i <= steps; i++) {
        await page.mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, { button: 'left', buttons: 1 });
        await sleep(16);
      }
      await page.mouse('mouseReleased', x2, y2, { buttons: 0 });
      await sleep(150);
    },
    // Replaces the text of an input the way pasting would (and tells the page).
    async fill(expr, text) {
      await page.eval(`(() => {
        const el = ${expr};
        el.focus();
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    },
    // Moves the mouse over an element in the preview once the preview has
    // finished loading (its hover tracking starts then), wiggling once.
    async hoverOn(expr) {
      await page.waitFor(`${FRAME}.readyState === 'complete'`, 'the preview to finish loading');
      await sleep(150);
      const { x, y } = await page.center(expr);
      await page.mouse('mouseMoved', x, y, { button: 'none' });
      await page.mouse('mouseMoved', x + 2, y + 1, { button: 'none' });
    },
    async key(key, { meta = false, shift = false, alt = false, ctrl = false, code } = {}) {
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
      const named = { End: 35, Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
      const vk = named[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      const base = { key, code: code || (key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : '') : key), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      const raw = ['Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key);
      await send('Input.dispatchKeyEvent', { type: raw ? 'rawKeyDown' : 'keyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async type(text) { await send('Input.insertText', { text }); },
  };
  return page;
}

// Expressions used by several steps.
const FRAME = `document.querySelector('.stage iframe, iframe').contentDocument`;
const STATE = `window.__ed.getState()`;
const byText = (scope, text) => `[...${scope}].find(e => e.textContent.trim() === ${JSON.stringify(text)})`;

// A small, real PNG file (an RGB picture with a lighter square in the middle).
function writePng(file, width, height) {
  const zlib = process.getBuiltinModule('node:zlib');
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const inner = x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4;
      row.set(inner ? [232, 211, 106] : [122, 154, 107], 1 + x * 3);
    }
    rows.push(row);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return file;
}

// ---------- running a scenario ----------

let failed = 0;
export async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`);
  }
}

// Prepares the repository, starts the mock GitHub server and Chrome, and opens
// one page. Returns { cdp, page }.
export async function launch() {
  makeRepo();
  start(process.execPath, [path.join(ROOT, 'tools/devserver.mjs'), '--port', String(PORT), '--site', ROOT,
    '--repo', BARE, '--token', TOKEN, '--pages-delay', '1'], { cwd: ROOT });
  await waitForHttp(`${BASE}/admin/`);
  const cdp = await connect(await startChrome());
  const page = await openPage(cdp);
  return { cdp, page };
}

// Runs a scenario and exits with 0 when every step passed.
export function run(scenario) {
  scenario()
    .catch(e => { failed++; console.error(`FAIL ${e.message}`); })
    .finally(() => {
      console.log(failed ? `\n${failed} step(s) failed.${KEEP ? ` Files kept in ${TMP}` : ''}` : '\nAll steps passed.');
      process.exit(failed ? 1 : 0);
    });
}

export { ROOT, TOKEN, BASE, TMP, WORK, BARE, git, sleep, FRAME, STATE, byText, writePng, openPage, connect, fs, path };
