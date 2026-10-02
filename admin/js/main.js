// Starts the editor: reads the config, signs in, loads the site from GitHub,
// offers to restore an unsaved draft, then shows the editor.

import { html, render, Spinner, Button, timeAgo } from './ui.js';
import { getState, setState, subscribe, toast, confirmDialog } from './store.js';
import { kv, blobs } from './db.js';
import { GitHub } from './github.js';
import { storedToken, storeToken, forgetToken, tokenRemembered } from './auth.js';
import { normalizeSite } from '../engine/schema.js';
import { App } from './app.js';
import { Login, Setup } from './login.js';
import { scheduleAutoSave } from './actions.js';

const root = document.getElementById('root');

function screen(content) {
  render(html`<div class="login"><div class="login-card">${content}</div></div>`, root);
}

function fail(title, message, retry = true) {
  screen(html`<h1>${title}</h1><p class="sub">${message}</p>${retry ? html`<${Button} block onClick=${() => location.reload()}>Try again<//>` : null}`);
}

async function boot() {
  screen(html`<p class="sub" style="margin:0;display:flex;gap:10px;align-items:center"><${Spinner} /> Opening the editor…</p>`);
  let config;
  try {
    config = await (await fetch('config.json', { cache: 'no-store' })).json();
    const siteJs = await (await fetch('engine/site.js', { cache: 'no-store' })).text();
    config.siteRoot = config.siteRoot || new URL('../', location.href).href;
    setState({ config, siteJs });
  } catch {
    fail("The editor didn't load", 'Check your internet connection and try again.');
    return;
  }
  const params = new URLSearchParams(location.search);
  // Local testing against the mock GitHub only.
  if (config.mock) {
    if (params.get('token')) storeToken(params.get('token'), false);
    window.__ed = { getState, setState };
  }
  if (params.has('setup')) { showSetup(config); return; }
  // A key kept for this tab only (Remember me turned off) stays that way.
  const token = storedToken();
  if (token && (await useToken(token, tokenRemembered()))) return;
  forgetToken();
  showLogin(config);
}

async function showLogin(config) {
  let keyFile = null;
  // The site copy first; right after setup GitHub Pages may not have published
  // it yet, so fall back to the repository itself.
  const sources = ['key.json'];
  if (!config.mock) sources.push(`https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/admin/key.json`);
  for (const url of sources) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) { keyFile = await r.json(); break; }
    } catch {}
  }
  if (!keyFile) { showSetup(config); return; }
  render(html`<${Login} config=${config} keyFile=${keyFile} onSetup=${() => showSetup(config)}
    onToken=${async (token, remember) => {
      if (!(await useToken(token, remember))) throw new Error("The password worked, but the editing key it unlocks was refused by GitHub. Ask Jonah to set up a new key.");
    }} />`, root);
}

function showSetup(config, existingToken = null) {
  render(html`<${Setup} config=${config} existingToken=${existingToken} onDone=${async token => {
    history.replaceState(null, '', location.pathname);
    await useToken(token, true);
  }} />`, root);
}

// Checks a token with GitHub, then loads the site. False if GitHub refuses it.
async function useToken(token, remember) {
  const { config } = getState();
  const gh = new GitHub({ ...config, token });
  try {
    const info = await gh.repoInfo();
    if (!info.permissions || !info.permissions.push) return false;
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) return false;
    fail("Can't reach GitHub", e.message);
    return true;
  }
  storeToken(token, remember);
  setState({ token, gh });
  try {
    await loadSite(gh);
  } catch (e) {
    fail("The site didn't load", e.message);
    return true;
  }
  render(html`<${App} />`, root);
  await offerDraft(gh);
  watchForAutoSave();
  return true;
}

async function loadSite(gh) {
  const head = await gh.headSha();
  const text = await gh.fileText('content/site.json', head);
  if (!text) throw new Error('This website has not been set up for the editor yet (content/site.json is missing).');
  const site = normalizeSite(JSON.parse(text));
  setState({
    baseSite: site,
    baseSha: head,
    site: structuredClone(site),
    pageId: site.settings.homePage,
    revision: 1,
    save: { status: 'idle', message: '' },
  });
}

// A draft is the working copy kept in this browser when changes were not saved.
async function offerDraft(gh) {
  let draft = null;
  try { draft = await kv.get('draft'); } catch {}
  if (!draft || !draft.site) return;
  const s = getState();
  let current = draft.baseSha === s.baseSha;
  if (!current) {
    try {
      const old = await gh.fileText('content/site.json', draft.baseSha);
      current = !!old && JSON.stringify(normalizeSite(JSON.parse(old))) === JSON.stringify(s.baseSite);
    } catch {}
  }
  let keep = current;
  if (!current) {
    keep = await confirmDialog({
      title: 'You have unsaved changes',
      message: `You made changes ${timeAgo(draft.savedAt)} that were never saved, and the website has been changed since then (maybe from another computer). If you keep your changes, saving them will replace the newer version.`,
      confirmLabel: 'Keep my changes',
      cancelLabel: 'Discard them',
    });
  }
  const paths = Object.keys(draft.pending || {});
  if (!keep) {
    await kv.del('draft').catch(() => {});
    for (const p of paths) blobs.del(p).catch(() => {});
    return;
  }
  const objectUrls = {};
  const pending = {};
  for (const p of paths) {
    const b = await blobs.get(p).catch(() => null);
    if (b) { objectUrls[p] = URL.createObjectURL(b); pending[p] = true; }
  }
  const site = normalizeSite(draft.site);
  const pageId = site.pages.some(p => p.id === draft.pageId) ? draft.pageId : site.settings.homePage;
  setState({ site, pending, objectUrls, pageId, mode: 'edit', revision: getState().revision + 1 });
  toast("We brought back changes you hadn't saved. Click Save to publish them, or Exit to throw them away.", { timeout: 10000 });
}

// Outside edit mode (Pages panel, Settings), changes save on their own.
function watchForAutoSave() {
  let rev = getState().revision;
  subscribe(s => {
    if (s.revision === rev) return;
    rev = s.revision;
    if (s.mode === 'website' && !s.viewing) scheduleAutoSave();
  });
}

export function logout() {
  forgetToken();
  location.href = location.pathname;
}

export function changePassword() {
  showSetup(getState().config, getState().token);
}

// Dropping a file anywhere else must never navigate away from the editor.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

boot();
