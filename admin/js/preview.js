// The live preview: an iframe showing the real page, rendered by the same code
// that builds the public site. In edit mode its text is editable in place,
// files can be dropped onto it, and it reports hover, focus and layout changes
// to the overlay (section toolbars, "Add section" buttons, text toolbar).

import { renderPageHtml, renderHeader, renderFooter, renderSection, pageById, pageFile } from '../engine/render.js';
import { renderCss, fontLinks } from '../engine/css.js';
import { getState, setState, subscribe, updateSite, undo, redo, openModal, setBeforeHistory } from './store.js';
import { sanitizeRich, sanitizeInline, sanitizePlain, pasteToRich, pasteToInline } from './sanitize.js';
import {
  scopeTarget, setPath, getPath, goToPage, importFiles, addGalleryItems, addSection, findSection, setSectionProps, updateSection, save,
} from './actions.js';
import { newSection, newBlock, uid, GRID_COLS } from '../engine/schema.js';

// ---------- tiny event emitter for the overlay ----------

const handlers = {};
export const events = {
  on(name, fn) { (handlers[name] ||= new Set()).add(fn); return () => handlers[name].delete(fn); },
  emit(name, data) { handlers[name]?.forEach(fn => fn(data)); },
};

let iframe = null;
let doc = null;
let win = null;
let loaded = { pageId: null, mode: null, viewing: null, revision: -1 };
let cache = null;
let rafPending = false;

export const frameDoc = () => doc;
export const frameEl = () => iframe;

function siteRoot() {
  return getState().config.siteRoot;
}

function shownSite(s = getState()) {
  return s.viewing ? s.viewing.site : s.site;
}

function editing(s = getState()) {
  return s.mode === 'edit' && !s.viewing;
}

function mediaUrl(m, variant) {
  const path = variant === 'medium' && m.medium ? m.medium.src : m.src;
  return getState().objectUrls[path] || null;
}

function renderOpts() {
  return { edit: true, mediaUrl, _eagerUsed: true };
}

// ---------- loading and refreshing ----------

export function attachFrame(el) {
  if (iframe === el) return;
  iframe = el;
  loaded = { pageId: null, mode: null, viewing: null, revision: -1 };
  fullLoad();
}

subscribe(s => {
  if (!iframe || !s.site) return;
  const viewingKey = s.viewing ? s.viewing.sha : null;
  if (s.pageId !== loaded.pageId || s.mode !== loaded.mode || viewingKey !== loaded.viewing) {
    fullLoad();
    return;
  }
  if (s.revision !== loaded.revision) {
    loaded.revision = s.revision;
    // Typed text is already on the page; syncNow records it (rememberShown).
    if (s.changeSource !== 'inline') scheduleRefresh();
  }
  markSelection();
});

function fullLoad() {
  const s = getState();
  const site = shownSite(s);
  const page = pageById(site, s.pageId) || pageById(site, site.settings.homePage);
  if (!page) return;
  const samePage = win && loaded.pageId === s.pageId;
  const scrollY = samePage ? win.scrollY : 0;
  loaded = { pageId: s.pageId, mode: s.mode, viewing: s.viewing ? s.viewing.sha : null, revision: s.revision };
  const root = siteRoot();
  const html = renderPageHtml(site, page, {
    ...renderOpts(),
    baseHref: root,
    siteJsUrl: `${root}admin/engine/site.js`,
    editorHead: `\n<link rel="stylesheet" href="${root}admin/editor-frame.css">`,
  });
  cache = null;
  iframe.onload = () => {
    win = iframe.contentWindow;
    doc = iframe.contentDocument;
    if (!editing()) doc.documentElement.removeAttribute('data-editing');
    bindEvents();
    cache = computeParts(site, page);
    afterRender();
    if (scrollY) win.scrollTo(0, scrollY);
    events.emit('load');
  };
  iframe.srcdoc = html;
}

function computeParts(site, page) {
  const opts = renderOpts();
  return {
    css: renderCss(site),
    fonts: fontLinks(site.design),
    bodyClass: `layout-${site.design.layout} page-${page.slug}`,
    header: renderHeader(site, page, opts),
    footer: renderFooter(site, opts),
    pageCls: `page${page.align === 'center' ? ' center' : ''}`,
    pageStyle: page.width ? `--page-w:${page.width}px` : '',
    sections: page.sections.map(sec => [sec.id, renderSection(site, page, sec, opts)]),
  };
}

// After typing, the page already shows the new text, so only the record of
// what it shows (the cache) is brought up to date for the part that was typed
// in. Without this, undoing the typing would look like no change at all. While
// a redraw is pending or running, the record is left alone so that the redraw
// draws the part again.
let holdRecord = false;

function rememberShown(scope) {
  if (!doc || !cache || rafPending || holdRecord) return;
  const s = getState();
  const site = shownSite(s);
  const page = pageById(site, s.pageId);
  if (!page) return;
  const [kind, id] = scope.split(':');
  const sec = kind === 's' && page.sections.find(x => x.id === id);
  const entry = sec && cache.sections.find(([sid]) => sid === id);
  // Text that belongs to the site or to another page (the footer, an article
  // title in a list) can show anywhere, so the whole record is renewed.
  if (entry) entry[1] = renderSection(site, page, sec, renderOpts());
  else cache = computeParts(site, page);
}

// Where the cursor is in a text, counted in characters, so it can be put back
// after the text is redrawn (Undo or Redo while typing).
function caretOffset(el) {
  const sel = win.getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = doc.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}

function refocus(key, offset) {
  const el = doc.querySelector(`[data-edit="${CSS.escape(key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  if (offset != null) {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = offset;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (left <= n.length) { range.setStart(n, left); range.collapse(true); break; }
      left -= n.length;
    }
  }
  const sel = win.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function scheduleRefresh() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; refresh(); });
}

// Patch only what changed, so typing, images and scroll position are not disturbed.
function refresh() {
  if (!doc || !cache) return;
  const s = getState();
  const site = shownSite(s);
  const page = pageById(site, s.pageId);
  if (!page) return;
  // Typing not yet saved goes into the site first, so the redraw keeps it.
  holdRecord = true;
  try { flushSync(); } finally { holdRecord = false; }
  const next = computeParts(shownSite(), pageById(shownSite(), s.pageId) || page);
  const active = editing() ? activeField() : null;
  const offset = active ? caretOffset(active) : null;
  redrawing = true;
  try { patch(next); } finally { redrawing = false; }
  cache = next;
  afterRender();
  if (active && !active.isConnected) refocus(active.dataset.edit, offset);
}

// Replacing a text that has the cursor makes the browser report it as left;
// that must not save the old text over the new (see the focusout handler).
let redrawing = false;

function patch(next) {
  if (next.css !== cache.css) doc.getElementById('site-css').textContent = next.css;
  if (next.fonts !== cache.fonts) {
    doc.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').forEach(l => l.remove());
    doc.head.insertAdjacentHTML('beforeend', next.fonts);
  }
  if (next.bodyClass !== cache.bodyClass) doc.body.className = next.bodyClass;
  const header = doc.querySelector('.site-header');
  if (next.header !== cache.header && header) header.outerHTML = next.header;
  if (next.footer !== cache.footer) {
    const footer = doc.querySelector('.site-footer');
    if (footer) footer.outerHTML = next.footer || '';
    else if (next.footer) doc.querySelector('main').insertAdjacentHTML('afterend', next.footer);
  }
  const pageEl = doc.querySelector('.page');
  if (pageEl) {
    if (next.pageCls !== cache.pageCls) pageEl.className = next.pageCls;
    if (next.pageStyle !== cache.pageStyle) pageEl.setAttribute('style', next.pageStyle);
    const sameOrder = next.sections.length === cache.sections.length && next.sections.every(([id], i) => cache.sections[i][0] === id);
    if (!sameOrder) {
      pageEl.innerHTML = next.sections.map(([, h]) => h).join('\n');
    } else {
      next.sections.forEach(([id, h], i) => {
        if (h === cache.sections[i][1]) return;
        const el = doc.querySelector(`[data-sid="${CSS.escape(id)}"]`);
        if (el) el.outerHTML = h;
      });
    }
  }
}

function afterRender() {
  const on = editing();
  for (const el of doc.querySelectorAll('[data-edit]')) {
    if (on) {
      el.setAttribute('contenteditable', el.dataset.kind === 'plain' ? 'plaintext-only' : 'true');
      el.setAttribute('spellcheck', 'true');
    } else {
      el.removeAttribute('contenteditable');
    }
  }
  try { win.SiteJS && win.SiteJS.init(doc); } catch {}
  markSelection();
  events.emit('layout');
}

function markSelection() {
  if (!doc) return;
  const sel = getState().selection;
  for (const el of doc.querySelectorAll('.ed-selected')) {
    if (!sel || el.dataset.sid !== sel.sectionId) el.classList.remove('ed-selected');
  }
  if (sel && editing()) doc.querySelector(`[data-sid="${CSS.escape(sel.sectionId)}"]`)?.classList.add('ed-selected');
  events.emit('layout');
}

// ---------- geometry for the overlay ----------

// Rectangle of an element inside the frame, in the coordinates of the stage
// (the element that holds both the iframe and the overlay).
export function rectInStage(el) {
  if (!el || !iframe) return null;
  const f = iframe.getBoundingClientRect();
  const stage = iframe.closest('.stage').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: f.left - stage.left + r.left, y: f.top - stage.top + r.top, w: r.width, h: r.height, frameTop: f.top - stage.top, frameLeft: f.left - stage.left, frameW: f.width, frameH: f.height };
}

export function sectionEl(id) {
  return doc ? doc.querySelector(`[data-sid="${CSS.escape(id)}"]`) : null;
}

export function sectionEls() {
  return doc ? [...doc.querySelectorAll('[data-sid]')] : [];
}

// ---------- inline text editing ----------

const syncTimers = new Map();

function readValue(el) {
  const kind = el.dataset.kind;
  if (kind === 'rich') return sanitizeRich(el.innerHTML);
  if (kind === 'inline') return sanitizeInline(el.innerHTML);
  return sanitizePlain(el.innerHTML);
}

export function syncNow(el) {
  clearTimeout(syncTimers.get(el));
  syncTimers.delete(el);
  if (!el.isConnected) return;
  const [scope, path] = el.dataset.edit.split('|');
  const value = readValue(el);
  const target = scopeTarget(getState().site, scope);
  if (!target || getPath(target, path) === value) return;
  updateSite(site => {
    const t = scopeTarget(site, scope);
    if (t) setPath(t, path, value);
  }, { label: 'text edit', coalesce: `text:${el.dataset.edit}`, source: 'inline' });
  rememberShown(scope);
}

export function flushSync() {
  for (const el of [...syncTimers.keys()]) syncNow(el);
}

// Undo and Redo from any button first save typing that is still pending, so
// they undo it as one step, the same as ⌘Z inside the text.
setBeforeHistory(flushSync);

function scheduleSync(el) {
  clearTimeout(syncTimers.get(el));
  syncTimers.set(el, setTimeout(() => syncNow(el), 300));
}

export function activeField() {
  const a = doc?.activeElement;
  return a && a.matches?.('[data-edit]') ? a : null;
}

// ---------- formatting commands (used by the text toolbar) ----------

export function exec(cmd, value = null) {
  const el = activeField();
  if (!el) return;
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand(cmd, false, value);
  scheduleSync(el);
  events.emit('format');
}

function blockOfSelection() {
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const field = activeField();
  while (n && n !== field && !/^(P|H[1-4]|LI|BLOCKQUOTE)$/.test(n.nodeName)) n = n.parentNode;
  return n && n !== field ? n : null;
}

const STYLE_CLASSES = ['large', 'small', 'muted', 'mono'];

// Squarespace's text styles: h1 h2 h3 h4 p1 p2 p3 mono, plus meta (small gray) and quote.
export function setBlockStyle(style) {
  const el = activeField();
  if (!el) return;
  const tag = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', quote: 'blockquote' }[style] || 'p';
  doc.execCommand('formatBlock', false, `<${tag}>`);
  const block = blockOfSelection();
  if (block && block.nodeName === 'P') {
    block.classList.remove(...STYLE_CLASSES);
    const cls = { p1: 'large', p3: 'small', meta: 'muted', mono: 'mono' }[style];
    if (cls) block.classList.add(cls);
    if (!block.className) block.removeAttribute('class');
  }
  scheduleSync(el);
  events.emit('format');
}

// Every paragraph-level element the selection touches.
function blocksInSelection() {
  const field = activeField();
  const sel = doc.getSelection();
  if (!field || !sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const all = [...field.querySelectorAll('p, h1, h2, h3, h4, li, blockquote')].filter(b => !b.querySelector('p, li'));
  const hit = all.filter(b => range.intersectsNode(b));
  return hit.length ? hit : [blockOfSelection()].filter(Boolean);
}

// Indent (+1) or outdent (-1) paragraphs, up to three steps.
export function indent(delta) {
  const el = activeField();
  if (!el) return;
  for (const b of blocksInSelection()) {
    const cur = [1, 2, 3].find(n => b.classList.contains(`indent-${n}`)) || 0;
    const next = Math.max(0, Math.min(3, cur + delta));
    b.classList.remove('indent-1', 'indent-2', 'indent-3');
    if (next) b.classList.add(`indent-${next}`);
    if (!b.className) b.removeAttribute('class');
  }
  scheduleSync(el);
  events.emit('format');
}

// Text color: a site color name (follows Site Styles) or a custom #rrggbb, or
// null to remove it. Marked with a placeholder color, then turned into spans.
export function setTextColor(value) {
  if (!restoreSelection()) return;
  const el = activeField();
  if (!el) return;
  const MARK = '#010203';
  doc.execCommand('styleWithCSS', false, false);
  doc.execCommand('foreColor', false, MARK);
  for (const f of [...el.querySelectorAll('font[color]')]) {
    if (f.getAttribute('color').toLowerCase() !== MARK) continue;
    const span = doc.createElement('span');
    if (value) {
      span.setAttribute('data-tc', value);
      span.style.color = value[0] === '#' ? value : `var(--${value})`;
    } else {
      span.setAttribute('data-tc', 'none');
    }
    span.append(...f.childNodes);
    f.replaceWith(span);
  }
  syncNow(el);
  events.emit('format');
}

// Squarespace's clipboard button: paste what is on the clipboard as plain text.
export async function pastePlain() {
  const el = activeField();
  if (!el) return;
  rememberSelection();
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { return; }
  restoreSelection();
  doc.execCommand('insertText', false, text);
  scheduleSync(el);
}

export function formatState() {
  if (!activeField()) return null;
  const block = blockOfSelection();
  let style = 'p2';
  if (block) {
    const tag = block.nodeName;
    if (tag === 'H1') style = 'h1';
    else if (tag === 'H2') style = 'h2';
    else if (tag === 'H3') style = 'h3';
    else if (tag === 'H4') style = 'h4';
    else if (block.classList.contains('mono')) style = 'mono';
    else if (tag === 'BLOCKQUOTE' || block.closest('blockquote')) style = 'quote';
    else if (block.classList.contains('large')) style = 'p1';
    else if (block.classList.contains('small')) style = 'p3';
    else if (block.classList.contains('muted')) style = 'meta';
  }
  const q = c => { try { return doc.queryCommandState(c); } catch { return false; } };
  return {
    style,
    bold: q('bold'),
    italic: q('italic'),
    underline: q('underline'),
    strike: q('strikeThrough'),
    color: colorAtSelection(),
    ul: q('insertUnorderedList'),
    ol: q('insertOrderedList'),
    link: !!linkAtSelection(),
    kind: activeField().dataset.kind,
  };
}

function colorAtSelection() {
  const sel = doc?.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  return n.closest ? (n.closest('[data-tc]')?.getAttribute('data-tc') || null) : null;
}

export function linkAtSelection() {
  const sel = doc?.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  return n.closest ? n.closest('a') : null;
}

let savedRange = null;
export function rememberSelection() {
  const sel = doc?.getSelection();
  savedRange = sel && sel.rangeCount ? { range: sel.getRangeAt(0).cloneRange(), field: activeField() } : null;
  return savedRange;
}

export function restoreSelection() {
  if (!savedRange) return false;
  savedRange.field?.focus();
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange.range);
  return true;
}

export function applyLink(url, newTab) {
  if (!restoreSelection()) return;
  const field = activeField();
  let a = linkAtSelection();
  if (!a) {
    if (doc.getSelection().isCollapsed) {
      doc.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
    } else {
      doc.execCommand('createLink', false, url);
    }
    a = linkAtSelection();
  } else {
    a.setAttribute('href', url);
  }
  if (a) {
    if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }
  if (field) syncNow(field);
}

export function removeLink() {
  restoreSelection();
  const a = linkAtSelection();
  const field = activeField();
  if (a) {
    const r = doc.createRange();
    r.selectNodeContents(a);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    doc.execCommand('unlink');
  }
  if (field) syncNow(field);
}

// ---------- events inside the frame ----------

let hoverSid = null;
let hoverZone = null;
let dropInfo = null;

function bindEvents() {
  doc.addEventListener('mousemove', onMove, { passive: true });
  doc.addEventListener('mouseleave', () => { hoverSid = null; hoverZone = null; events.emit('hover', null); });
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('dblclick', onDblClick);
  doc.addEventListener('input', e => { const el = e.target.closest?.('[data-edit]'); if (el) scheduleSync(el); });
  doc.addEventListener('paste', onPaste);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', e => { if (e.target.matches?.('[data-edit]')) events.emit('focus', e.target); });
  doc.addEventListener('focusout', e => {
    if (redrawing) return;
    if (e.target.matches?.('[data-edit]')) {
      syncNow(e.target);
      setTimeout(() => events.emit('focus', activeField()), 0);
    }
  });
  doc.addEventListener('selectionchange', () => events.emit('format'));
  doc.addEventListener('dragover', onDragOver);
  doc.addEventListener('dragleave', e => { if (!e.relatedTarget) setDrop(null); });
  doc.addEventListener('drop', onDrop);
  win.addEventListener('scroll', () => events.emit('scroll'), { passive: true });
  win.addEventListener('resize', () => events.emit('layout'));
  // Images that load late change the layout.
  doc.addEventListener('load', e => { if (e.target.tagName === 'IMG') events.emit('layout'); }, true);
}

function onMove(e) {
  if (!editing()) return;
  const sec = e.target.closest?.('[data-sid]');
  const zone = e.target.closest?.('[data-zone]');
  const sid = sec ? sec.dataset.sid : null;
  const z = zone ? zone.dataset.zone : null;
  if (sid !== hoverSid || z !== hoverZone) {
    hoverSid = sid;
    hoverZone = z;
    events.emit('hover', { sectionId: sid, zone: z });
  }
}

export function currentHover() {
  return { sectionId: hoverSid, zone: hoverZone };
}

function pageForHref(href) {
  const site = shownSite();
  const file = href.split('#')[0].split('?')[0].split('/').pop() || 'index.html';
  return site.pages.find(p => pageFile(site, p) === file) || site.pages.find(p => `${p.slug}.html` === file) || null;
}

function onClick(e) {
  const a = e.target.closest('a');
  const inEditable = e.target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
  if (!editing()) {
    // Browsing: internal links switch pages inside the editor.
    if (a && a.getAttribute('href')) {
      const page = pageForHref(a.getAttribute('href'));
      e.preventDefault();
      if (page) goToPage(page.id);
      else if (/^https?:|^mailto:/.test(a.getAttribute('href'))) window.open(a.href, '_blank', 'noopener');
    }
    return;
  }
  if (a && !inEditable) {
    e.preventDefault();
    const navPage = a.closest('.nav') ? pageForHref(a.getAttribute('href') || '') : null;
    if (navPage) { goToPage(navPage.id); return; }
    if (a.classList.contains('site-title')) { goToPage(shownSite().settings.homePage); return; }
  }
  if (e.target.closest('summary')) return; // let menu folders open
  const sec = e.target.closest('[data-sid]');
  if (!sec) {
    if (!e.target.closest('[data-zone]')) setState({ selection: null });
    return;
  }
  const sectionId = sec.dataset.sid;
  const item = e.target.closest('[data-item]');
  const block = e.target.closest('[data-bid]');
  const empty = e.target.closest('.ed-empty');
  setState({ selection: { sectionId, itemId: item?.dataset.item || null, blockId: block?.dataset.bid || null } });
  if (empty) { onEmptyClick(sectionId, empty.dataset.empty, block?.dataset.bid); return; }
  const img = e.target.closest('img');
  if (img && !inEditable) {
    const type = sec.dataset.type;
    if (type === 'gallery') setState({ editPanel: { kind: 'section', id: sectionId, tab: 'images', itemId: item?.dataset.item || null } });
    else if (type === 'image' || type === 'imageText') setState({ editPanel: { kind: 'section', id: sectionId, tab: 'content' } });
    else if (block) setState({ editPanel: { kind: 'block', id: sectionId, blockId: block.dataset.bid } });
  } else if (block && !inEditable) {
    setState({ editPanel: { kind: 'block', id: sectionId, blockId: block.dataset.bid } });
  }
}

function onDblClick(e) {
  if (!editing()) return;
  const sec = e.target.closest('[data-sid]');
  if (sec && !e.target.closest('[data-edit]')) setState({ editPanel: { kind: 'section', id: sec.dataset.sid, tab: null } });
}

function onEmptyClick(sectionId, kind, blockId) {
  if (kind === 'gallery') {
    openModal('mediaPicker', { multiple: true, onPick: ids => addGalleryItems(sectionId, [].concat(ids)) });
  } else if (kind === 'image') {
    openModal('mediaPicker', {
      onPick: id => {
        if (blockId) {
          updateSection(sectionId, sec => {
            const b = sec.blocks.find(x => x.id === blockId);
            if (b) b.media = id;
          }, { label: 'choose image' });
        } else {
          setSectionProps(sectionId, { media: id }, 'choose image');
        }
      },
    });
  } else {
    setState({ editPanel: { kind: 'section', id: sectionId, tab: null } });
  }
}

function onPaste(e) {
  const el = e.target.closest?.('[data-edit]');
  if (!el || !editing()) return;
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  const kind = el.dataset.kind;
  if (kind === 'plain') doc.execCommand('insertText', false, text.replace(/\s+/g, ' ').trim());
  else if (kind === 'inline') doc.execCommand('insertHTML', false, pasteToInline(html, text));
  else doc.execCommand('insertHTML', false, pasteToRich(html, text));
  scheduleSync(el);
}

function onKey(e) {
  if (!editing()) return;
  const mod = e.metaKey || e.ctrlKey;
  const el = e.target.closest?.('[data-edit]');
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    flushSync();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); flushSync(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushSync(); save(); return; }
  if (mod && e.key.toLowerCase() === 'k' && el && el.dataset.kind !== 'plain') { e.preventDefault(); events.emit('link-request'); return; }
  if (el && el.dataset.kind === 'rich' && mod) {
    // ⌘⌥0..6: Paragraph 3, 2, 1, Heading 4, 3, 2, 1 (Squarespace's shortcuts).
    const styleKeys = { Digit0: 'p3', Digit1: 'p2', Digit2: 'p1', Digit3: 'h4', Digit4: 'h3', Digit5: 'h2', Digit6: 'h1' };
    if (e.altKey && styleKeys[e.code]) { e.preventDefault(); setBlockStyle(styleKeys[e.code]); return; }
    if (e.shiftKey && ['l', 'e', 'r'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      exec({ l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight' }[e.key.toLowerCase()]);
      return;
    }
    if (e.key === ']' || e.key === '[') { e.preventDefault(); indent(e.key === ']' ? 1 : -1); return; }
  }
  if (el && mod && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pastePlain(); return; }
  if (e.key === 'Escape') {
    if (el) { syncNow(el); el.blur(); }
    setState({ selection: null });
    return;
  }
  if (el && e.key === 'Enter') {
    if (el.dataset.kind === 'plain') { e.preventDefault(); el.blur(); }
    else if (el.dataset.kind === 'inline') { e.preventDefault(); doc.execCommand('insertLineBreak'); scheduleSync(el); }
  }
}

// ---------- dropping image files onto the page ----------

function hasFiles(e) {
  return [...(e.dataTransfer?.types || [])].includes('Files');
}

function dropTargetAt(e) {
  const site = shownSite();
  const page = pageById(site, getState().pageId);
  const sec = e.target.closest?.('[data-sid]');
  if (sec) {
    const type = sec.dataset.type;
    const block = e.target.closest('[data-bid]');
    if (type === 'gallery') return { kind: 'gallery', sectionId: sec.dataset.sid, el: sec, label: 'Drop to add to this gallery' };
    if (type === 'image' || type === 'imageText') return { kind: 'image', sectionId: sec.dataset.sid, el: sec, label: 'Drop to replace this image' };
    if (block && block.classList.contains('k-image')) return { kind: 'block', sectionId: sec.dataset.sid, blockId: block.dataset.bid, el: block, label: 'Drop to replace this image' };
    // Anywhere else in a Fluid Engine section: a new image block where it is dropped.
    const grid = type === 'blocks' && sec.querySelector('.fe-grid');
    if (grid) {
      const cell = gridCell(grid, e);
      return { kind: 'grid', sectionId: sec.dataset.sid, el: sec, cell, ghost: cell.ghost, label: 'Drop to add an image here' };
    }
  }
  // Between sections: insert a new gallery or image section there.
  const els = sectionEls();
  let index = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { index = i; break; }
  }
  const ref = els[index] || els[els.length - 1] || doc.querySelector('.page');
  return { kind: 'new', index, el: ref, after: index >= els.length, pageId: page.id, label: 'Drop to add a new section here' };
}

// The grid cell under the pointer, and the box an 8-column image block would
// fill there. On the phone preview new blocks go below the others instead.
const DROP_W = 8;

function gridCell(grid, e) {
  const r = grid.getBoundingClientRect();
  const cs = win.getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap) || 0;
  const cols = cs.gridTemplateColumns.split(' ').length;
  const colW = (r.width - (cols - 1) * gap) / cols;
  // A row is about a 24th of the grid's width (the grid's minimum height).
  const rowH = r.width / cols;
  if (cols !== GRID_COLS) return { x: 0, y: null, colW: null, rowH: null, gap };
  const rows = cs.gridTemplateRows.split(' ').map(parseFloat).filter(n => n > 0);
  let y = 0;
  let top = r.top;
  while (y < rows.length && e.clientY >= top + rows[y]) top += rows[y++];
  if (y === rows.length && e.clientY > top) {
    const extra = Math.floor((e.clientY - top) / rowH);
    y += extra;
    top += extra * rowH;
  }
  const x = Math.max(0, Math.min(GRID_COLS - DROP_W, Math.floor((e.clientX - r.left) / (colW + gap))));
  const width = DROP_W * colW + (DROP_W - 1) * gap;
  return { x, y, colW, rowH, gap, ghost: { left: r.left + x * (colW + gap), top, width, height: width } };
}

function addImageBlocks(sectionId, ids, cell) {
  const site = getState().site;
  const sec = findSection(site, sectionId)?.section;
  if (!sec) return;
  const gap = cell.gap || sec.gap || 16;
  const colW = cell.colW || ((sec.width || 1100) - (GRID_COLS - 1) * gap) / GRID_COLS;
  const rowH = cell.rowH || (sec.width || 1100) / GRID_COLS;
  const bottom = Math.max(0, ...(sec.blocks || []).map(b => b.d.y + b.d.h));
  let x = cell.x;
  let y = cell.y == null ? bottom + (bottom ? 1 : 0) : cell.y;
  let band = 0;
  const made = [];
  for (const id of ids) {
    const m = site.media[id];
    if (x + DROP_W > GRID_COLS) { x = 0; y += band + 1; band = 0; }
    const px = DROP_W * colW + (DROP_W - 1) * gap;
    const h = m && m.w && m.h ? Math.max(2, Math.round(px * m.h / m.w / rowH)) : DROP_W;
    const b = newBlock('image', { x, y });
    Object.assign(b, { media: id, fit: 'original', caption: m?.caption || '', alt: m?.alt || '' });
    b.d = { x, y, w: DROP_W, h };
    made.push(b);
    band = Math.max(band, h);
    x += DROP_W;
  }
  updateSection(sectionId, s => { s.blocks.push(...made); }, { label: made.length > 1 ? 'add images' : 'add image' });
  setState({ selection: { sectionId, blockId: made[0].id } });
}

function setDrop(info) {
  dropInfo = info;
  events.emit('drop-target', info);
}

function onDragOver(e) {
  if (!editing() || !hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const t = dropTargetAt(e);
  if (!dropInfo || t.kind !== dropInfo.kind || t.sectionId !== dropInfo.sectionId || t.index !== dropInfo.index || t.blockId !== dropInfo.blockId
    || t.cell?.x !== dropInfo.cell?.x || t.cell?.y !== dropInfo.cell?.y) setDrop(t);
}

async function onDrop(e) {
  if (!editing() || !hasFiles(e)) return;
  e.preventDefault();
  const target = dropTargetAt(e);
  setDrop(null);
  const files = [...e.dataTransfer.files];
  setState({ busy: `Preparing ${files.length} image${files.length > 1 ? 's' : ''}…` });
  try {
    const ids = await importFiles(files, { onProgress: (i, n) => setState({ busy: `Preparing image ${i + 1} of ${n}…` }) });
    if (!ids.length) return;
    if (target.kind === 'gallery') addGalleryItems(target.sectionId, ids);
    else if (target.kind === 'image') setSectionProps(target.sectionId, { media: ids[0] }, 'replace image');
    else if (target.kind === 'block') {
      updateSection(target.sectionId, sec => { const b = sec.blocks.find(x => x.id === target.blockId); if (b) b.media = ids[0]; }, { label: 'replace image' });
    } else if (target.kind === 'grid') {
      addImageBlocks(target.sectionId, ids, target.cell);
    } else if (ids.length === 1) {
      addSection(target.pageId, target.index, newSection('image', { media: ids[0], caption: getState().site.media[ids[0]]?.caption || '' }));
    } else {
      const sec = newSection('gallery', { layout: 'grid', columns: 3 });
      sec.items = ids.map(id => ({ id: uid('gi'), media: id, caption: getState().site.media[id]?.caption || '', alt: '', link: '', hidden: false }));
      addSection(target.pageId, target.index, sec);
    }
  } finally {
    setState({ busy: null });
  }
}

export function scrollToSection(id) {
  sectionEl(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export { findSection };
