// Editor state: the working copy of the site, what is selected, which panel is
// open, undo/redo, and the draft kept in this browser. Components read it with
// useStore(selector) and change the site only through updateSite().

import { useState, useEffect, useRef } from '../vendor/htm-preact.js';
import { kv } from './db.js';

let state = {
  config: null,          // admin/config.json
  token: null,           // GitHub token (in memory)
  site: null,            // working copy, always normalized
  baseSite: null,        // the version last saved to GitHub
  baseSha: null,         // commit the working copy is based on
  revision: 0,           // bumps on every site change
  changeSource: null,    // 'inline' when text was typed into the preview itself
  pageId: null,          // page shown in the preview
  mode: 'website',       // 'website' (browse, Pages panel) | 'edit' (editing the page)
  sidePanel: 'pages',    // website-mode left panel: root | pages | blog:<id> | media | settings | history | help
  stylesOpen: false,     // Site Styles panel on the left (either mode)
  editPanel: null,       // floating panel in edit mode: { kind: 'section'|'styles'|'header'|'footer'|'block', id, tab }
  selection: null,       // { sectionId, itemId?, blockId? }
  device: 'desktop',     // 'desktop' | 'mobile'
  pending: {},           // repo paths of images waiting to be uploaded -> true
  save: { status: 'idle', message: '' }, // idle | saving | deploying | live | error
  modal: null,           // { kind, ...props }
  menu: null,            // { x, y, items }
  toasts: [],
  viewing: null,         // { sha, site, date } while previewing an old version
  siteJs: '',            // text of engine/site.js, published as assets/site.js
  gh: null,              // GitHub client
  objectUrls: {},        // repo path -> blob: URL for images not uploaded yet
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Re-renders the component when the selected value changes (by identity, or
// shallowly for plain objects and arrays).
export function useStore(selector = s => s) {
  const sel = useRef(selector);
  sel.current = selector;
  const [value, setValue] = useState(() => selector(state));
  const last = useRef(value);
  useEffect(() => subscribe(s => {
    const v = sel.current(s);
    if (!shallowEqual(v, last.current)) {
      last.current = v;
      setValue(() => v);
    }
  }), []);
  return value;
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.is(a[k], b[k]));
}

// ---------- site changes, undo and redo ----------

const undoStack = [];
const redoStack = [];
let lastCoalesce = null;

// mutator(site) edits a fresh copy in place. Options:
//   label     shown in "Undo ..." messages
//   coalesce  edits with the same key within 1.5 s share one undo step (typing)
//   source    'inline' when the preview already shows the change (no re-render)
export function updateSite(mutator, { label = 'change', coalesce = null, source = null } = {}) {
  const prev = state.site;
  const next = structuredClone(prev);
  mutator(next);
  const now = Date.now();
  const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.t < 1500;
  if (!merge) {
    undoStack.push({ site: prev, label, pageId: state.pageId });
    if (undoStack.length > 200) undoStack.shift();
  }
  lastCoalesce = coalesce ? { key: coalesce, t: now } : null;
  redoStack.length = 0;
  setState({ site: next, revision: state.revision + 1, changeSource: source });
  scheduleDraftSave();
  return next;
}

// Replace the whole working copy (restore a version, discard, load latest).
export function replaceSite(site, { label = 'change', resetHistory = false } = {}) {
  if (resetHistory) {
    undoStack.length = 0;
    redoStack.length = 0;
  } else {
    undoStack.push({ site: state.site, label, pageId: state.pageId });
  }
  lastCoalesce = null;
  const pageId = site.pages.some(p => p.id === state.pageId) ? state.pageId : site.settings.homePage;
  setState({ site, pageId, revision: state.revision + 1, changeSource: null, selection: null });
  scheduleDraftSave();
}

// Called before Undo or Redo (the preview saves typing that is still pending).
let beforeHistory = null;
export function setBeforeHistory(fn) { beforeHistory = fn; }

function restore(from, to, verb) {
  beforeHistory?.();
  const entry = from.pop();
  if (!entry) return;
  to.push({ site: state.site, label: entry.label, pageId: state.pageId });
  lastCoalesce = null;
  const site = entry.site;
  const pageId = site.pages.some(p => p.id === state.pageId) ? state.pageId : (entry.pageId || site.settings.homePage);
  setState({ site, pageId, revision: state.revision + 1, changeSource: null });
  scheduleDraftSave();
  toast(`${verb}: ${entry.label}`);
}

export const undo = () => restore(undoStack, redoStack, 'Undid');
export const redo = () => restore(redoStack, undoStack, 'Redid');
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

// ---------- unsaved changes ----------

let dirtyCache = { rev: -1, base: null, value: false };
export function isDirty(s = state) {
  if (!s.site || !s.baseSite) return false;
  if (dirtyCache.rev === s.revision && dirtyCache.base === s.baseSite) return dirtyCache.value;
  const value = Object.keys(s.pending).length > 0 || JSON.stringify(s.site) !== JSON.stringify(s.baseSite);
  dirtyCache = { rev: s.revision, base: s.baseSite, value };
  return value;
}

// ---------- draft in this browser ----------

let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 600);
}

export async function saveDraftNow() {
  clearTimeout(draftTimer);
  if (!state.site || state.viewing) return;
  try {
    if (isDirty()) {
      await kv.set('draft', { site: state.site, baseSha: state.baseSha, pending: state.pending, pageId: state.pageId, savedAt: Date.now() });
    } else {
      await kv.del('draft');
    }
  } catch {
    // No storage available: the editor keeps working without a draft.
  }
}

// ---------- toasts, menus, dialogs ----------

let toastId = 0;
export function toast(message, { kind = 'info', timeout = 3500, action = null } = {}) {
  const id = ++toastId;
  setState(s => ({ toasts: [...s.toasts, { id, message, kind, action }] }));
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}

export function dismissToast(id) {
  setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
}

export function openModal(kind, props = {}) {
  setState({ modal: { kind, ...props } });
}

export function closeModal() {
  setState({ modal: null });
}

// Resolves true/false. kind 'danger' paints the confirm button red.
export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, third = null }) {
  return new Promise(resolve => {
    openModal('confirm', { title, message, confirmLabel, cancelLabel, danger, third, resolve });
  });
}

// items: [{ label, icon, onClick, danger }] or 'sep'. anchor: a DOM element or {x, y}.
export function openMenu(anchor, items) {
  let x;
  let y;
  if (anchor && anchor.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 6;
  } else {
    ({ x, y } = anchor);
  }
  setState({ menu: { x, y, items } });
}

export function closeMenu() {
  if (state.menu) setState({ menu: null });
}
