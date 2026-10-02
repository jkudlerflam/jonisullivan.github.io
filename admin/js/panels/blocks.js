// Blank sections, the editor's version of Squarespace's Fluid Engine.
//
// Blocks are handled right on the page. Listeners bound to the preview on every
// load turn a press on a block into a move once the mouse travels 4px (text
// blocks too); a plain click on words puts the text cursor where the click was,
// a click anywhere else on a block selects it, and a drag on the section
// background draws a box that selects several blocks. BlockOverlay draws over
// the preview for the selected section: outlines, the selection frame and
// handles, the block toolbar and its popovers (alignment, link, Layers), the
// grid and guides while dragging, and "+ ADD BLOCK". Keyboard shortcuts and the
// right-click menu follow Squarespace. BlockPanel edits one block's settings.

import {
  html, render, useState, useEffect, useRef, useLayoutEffect, Icon, IconButton, Button, Field, TextInput, Toggle,
  Segmented, Select, Slider, ColorInput, ImageField, LinkInput, FloatingPanel, useReorder, moveItem, mediaPreviewUrl,
} from '../ui.js';
import { useStore, getState, setState, openMenu, closeMenu, openModal, toast, undo } from '../store.js';
import { updateSection, findSection, saveSectionForReuse } from '../actions.js';
import { events, frameDoc, frameEl, rectInStage, sectionEl, activeField, flushSync } from '../preview.js';
import { BLOCK_TYPES, GRID_COLS, GRID_COLS_MOBILE, newBlock, uid, cloneWithNewIds } from '../../engine/schema.js';
import { mobileLayout, videoEmbedUrl } from '../../engine/render.js';
import { SOCIAL, socialHref } from '../../engine/blocks.js';
import { sanitizeInline, pasteToInline } from '../sanitize.js';
import { RichLine } from './shared.js';

// ---------- block kinds in the editor ----------

// The block menu, in Squarespace's order: [kind, icon, words the search box knows].
const MENU = [
  ['text', 'text', 'paragraph heading words writing title'],
  ['image', 'image', 'picture photo painting artwork'],
  ['button', 'button', 'link'],
  ['line', 'line', 'divider rule separator horizontal'],
  ['quote', 'quote', 'quotation testimonial'],
  ['video', 'video', 'youtube vimeo film movie'],
  ['embed', 'code', 'embed html script iframe widget'],
  ['form', 'bForm', 'contact email message'],
  ['social', 'bSocial', 'social instagram facebook twitter x tiktok youtube vimeo linkedin pinterest email icons'],
  ['map', 'bMap', 'location address google directions place'],
  ['accordion', 'bAccordion', 'faq questions dropdown collapse expand toggle'],
];
const ICON_OF = Object.fromEntries(MENU.map(([kind, icon]) => [kind, icon]));

// Blocks whose words are typed on the page (an image's caption too): a plain
// click there puts the text cursor where the click was.
const CARET_KINDS = new Set(['text', 'quote', 'image']);

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const SNAP = 0.75; // edges snap to other blocks' edges within this many cells

// Icons the shared set does not have: [outline path, filled path?].
const BP = {
  bForm: ['M4 3h16v18H4z M7.5 7h9 M7.5 11h9 M7.5 15h5'],
  bSocial: ['M17.5 8a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z M6.5 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z M17.5 21.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z M8.9 13.4l6.2 3.7 M15.1 6.9l-6.2 3.7'],
  bMap: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  bAccordion: ['M4 4h16v6H4z M4 14.5h16 M4 19.5h16 M14.5 6.2l1.5 1.5 1.5-1.5'],
  vTop: ['M4 4h16 M8 7.5h8v9H8z'],
  vMiddle: ['M3 12h4 M17 12h4 M7 6.5h10v11H7z'],
  vBottom: ['M4 20h16 M8 7.5h8v9H8z'],
  forward: ['M9 9H3v12h12v-6', 'M9 3h12v12H9z'],
  backward: ['M9 3h12v12H9z', 'M3 9h6v6h6v6H3z'],
  bucket: ['M5.2 11.3L11.5 5l7 7-6.3 6.3a1.6 1.6 0 0 1-2.2 0l-4.8-4.8a1.6 1.6 0 0 1 0-2.2z M5 12.5h13.5 M8.5 2.5l3 2.5', 'M20.2 14.5s1.6 1.9 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.2 1.6-3.1 1.6-3.1z'],
};

function BIcon({ name, size = 18 }) {
  const p = BP[name];
  if (!p) return html`<${Icon} name=${name} size=${size} />`;
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden="true"><path d=${p[0]} />${p[1] ? html`<path d=${p[1]} style="fill:currentColor;stroke:none" />` : null}</svg>`;
}

// A toolbar or popover button with one of the icons above.
function TB({ icon, label, active, onClick }) {
  return html`<button type="button" class=${`ibtn small${active ? ' on' : ''}`} title=${label} aria-label=${label} aria-pressed=${active ? 'true' : undefined} onClick=${onClick}><${BIcon} name=${icon} size=${16} /></button>`;
}

// ---------- blocks in the site data ----------

function liveSection(sectionId) {
  const hit = sectionId ? findSection(getState().site, sectionId) : null;
  return hit && Array.isArray(hit.section.blocks) ? hit.section : null;
}

function liveBlock(sectionId, blockId) {
  const sec = liveSection(sectionId);
  return sec ? sec.blocks.find(b => b.id === blockId) || null : null;
}

// True once the phone layout has been arranged by hand (every block has `m`).
const ownPhoneLayout = blocks => blocks.length > 0 && blocks.every(b => b.m);

// Block positions as they are shown: desktop (`d`), or phone (by hand or automatic).
function layoutOf(blocks, phone) {
  return phone ? mobileLayout(blocks) : new Map(blocks.map(b => [b.id, b.d]));
}

// The first row below every block.
function bottomOf(layout) {
  let y = 0;
  for (const p of layout.values()) if (p) y = Math.max(y, p.y + p.h);
  return y;
}

function clampPos(p, cols) {
  if (!p) return null;
  const w = Math.max(1, Math.min(cols, Math.round(p.w) || 1));
  const h = Math.max(1, Math.round(p.h) || 1);
  return { x: Math.max(0, Math.min(cols - w, Math.round(p.x) || 0)), y: Math.max(0, Math.round(p.y) || 0), w, h };
}

const samePos = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function editBlocks(sectionId, fn, opts) {
  flushSync();
  updateSection(sectionId, sec => { if (Array.isArray(sec.blocks)) fn(sec); }, opts);
}

function setBlockProps(sectionId, blockId, patch, label = 'edit block') {
  editBlocks(sectionId, sec => {
    const b = sec.blocks.find(x => x.id === blockId);
    if (b) Object.assign(b, patch);
  }, { label, coalesce: `block:${blockId}:${Object.keys(patch).join(',')}` });
}

function updateBlock(sectionId, blockId, fn, label = 'edit block', coalesce = null) {
  editBlocks(sectionId, sec => {
    const b = sec.blocks.find(x => x.id === blockId);
    if (b) fn(b);
  }, { label, coalesce });
}

// Saves new places for one or more blocks as one undo step. The first change
// made in phone view writes out the automatic phone layout for every block, so
// from then on the phone layout is Joni's own and no longer follows the desktop.
function placeBlocks(sectionId, phone, places, label, coalesce = null) {
  editBlocks(sectionId, sec => {
    if (phone && !ownPhoneLayout(sec.blocks)) {
      const auto = mobileLayout(sec.blocks);
      for (const x of sec.blocks) x.m = { ...auto.get(x.id) };
    }
    for (const [id, pos] of places) {
      const b = sec.blocks.find(x => x.id === id);
      if (!b || !pos) continue;
      if (phone) b.m = { ...pos };
      else b.d = { ...pos };
    }
  }, { label, coalesce });
}

// ---------- state of the overlay (shared by every BlockOverlay) ----------

const ui = {
  view: null,    // a drag on screen: { sectionId, mode, targets, free, guides, center, label }
  marquee: null, // the selection box: { sectionId, rect, ids }
  grid: false,   // G: grid always visible
  pop: null,     // { kind: 'align' | 'link' | 'layers', sectionId, blockId }
  hover: null,   // block highlighted from Layers
};
const uiFns = new Set();

function setUi(patch) {
  Object.assign(ui, patch);
  for (const fn of [...uiFns]) fn();
}

function useUi() {
  const [, set] = useState(0);
  useEffect(() => {
    const fn = () => set(n => n + 1);
    uiFns.add(fn);
    return () => uiFns.delete(fn);
  }, []);
  return ui;
}

// ---------- selection ----------

// Selected block ids in a section: blockIds when several are selected.
function idsIn(sel, sec) {
  if (!sel || !sec || sel.sectionId !== sec.id) return [];
  const has = id => sec.blocks.some(b => b.id === id);
  if (Array.isArray(sel.blockIds) && sel.blockIds.length > 1) {
    const ids = sel.blockIds.filter(has);
    if (ids.length) return ids;
  }
  return sel.blockId && has(sel.blockId) ? [sel.blockId] : [];
}

const selIds = sectionId => idsIn(getState().selection, liveSection(sectionId));

function select(sectionId, ids) {
  const list = [...new Set(ids)];
  const s = getState();
  const patch = {
    selection: list.length > 1
      ? { sectionId, blockId: list[list.length - 1], blockIds: list }
      : { sectionId, blockId: list[0] || null },
  };
  // The Edit Block panel follows one selected block, and closes for a group.
  if (s.editPanel?.kind === 'block') {
    if (list.length === 1) {
      if (s.editPanel.blockId !== list[0]) patch.editPanel = { kind: 'block', id: sectionId, blockId: list[0] };
    } else {
      patch.editPanel = null;
    }
  }
  setState(patch);
  if (ui.pop && (ui.pop.sectionId !== sectionId || (ui.pop.kind !== 'layers' && !(list.length === 1 && list[0] === ui.pop.blockId)))) setUi({ pop: null });
}

function toggleInSelection(sectionId, blockId) {
  const cur = selIds(sectionId);
  select(sectionId, cur.includes(blockId) ? cur.filter(id => id !== blockId) : [...cur, blockId]);
}

function openBlockPanel(sectionId, blockId, tab = null) {
  setState({ selection: { sectionId, blockId }, editPanel: { kind: 'block', id: sectionId, blockId, tab } });
  if (ui.pop && ui.pop.kind !== 'layers') setUi({ pop: null });
}

// The next block in reading order (top to bottom, left to right).
function selectNext(sectionId, dir) {
  const sec = liveSection(sectionId);
  if (!sec || !sec.blocks.length) return;
  const lay = layoutOf(sec.blocks, isPhone(sectionId));
  const order = sec.blocks.filter(b => lay.get(b.id))
    .sort((a, b) => lay.get(a.id).y - lay.get(b.id).y || lay.get(a.id).x - lay.get(b.id).x)
    .map(b => b.id);
  const primary = getState().selection?.blockId;
  const cur = order.indexOf(primary);
  const i = cur < 0 ? (dir > 0 ? 0 : order.length - 1) : (cur + dir + order.length) % order.length;
  select(sectionId, [order[i]]);
}

// ---------- block operations (each one undo step) ----------

let reveal = null; // a block just added; scrolled into view once it is on the page

function addBlockOfKind(sectionId, kind) {
  const sec = liveSection(sectionId);
  if (!sec) return;
  const block = newBlock(kind, { x: 0, y: bottomOf(layoutOf(sec.blocks, false)) });
  // With a phone layout arranged by hand, the new block gets a phone place too
  // (at the bottom); otherwise every block would fall back to the automatic one.
  if (ownPhoneLayout(sec.blocks)) block.m = { ...mobileLayout([block]).get(block.id), y: bottomOf(mobileLayout(sec.blocks)) };
  editBlocks(sectionId, s => { s.blocks.push(block); }, { label: `add ${(BLOCK_TYPES[kind]?.label || kind).toLowerCase()} block` });
  reveal = block.id;
  if (kind === 'text' || kind === 'quote') {
    // Like Squarespace: start typing right away.
    select(sectionId, [block.id]);
    whenOnPage(sectionId, block.id, el => {
      const field = el.querySelector('[data-edit]');
      if (!field) return;
      field.focus({ preventScroll: true });
      const r = field.ownerDocument.createRange();
      r.selectNodeContents(field);
      const s = field.ownerDocument.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
  } else {
    openBlockPanel(sectionId, block.id);
  }
}

// Runs fn(element) once the block is in the preview (after the next refresh).
function whenOnPage(sectionId, blockId, fn, tries = 30) {
  const el = blockEl(sectionId, blockId);
  if (el) { fn(el); return; }
  if (tries > 0) requestAnimationFrame(() => whenOnPage(sectionId, blockId, fn, tries - 1));
}

// Copies sit one row lower, on top of the originals.
function duplicateBlocks(sectionId, ids) {
  if (!ids.length) return;
  const made = [];
  editBlocks(sectionId, sec => {
    const own = ownPhoneLayout(sec.blocks);
    const chosen = sec.blocks.filter(b => ids.includes(b.id));
    if (!chosen.length) return;
    const after = Math.max(...chosen.map(b => sec.blocks.indexOf(b)));
    const copies = chosen.map(src => {
      const copy = cloneWithNewIds(src);
      copy.d = { ...src.d, y: src.d.y + 1 };
      copy.m = own && src.m ? { ...src.m, y: src.m.y + 1 } : null;
      return copy;
    });
    sec.blocks.splice(after + 1, 0, ...copies);
    made.push(...copies.map(c => c.id));
  }, { label: ids.length > 1 ? 'duplicate blocks' : 'duplicate block' });
  if (made.length) select(sectionId, made);
}

function deleteBlocks(sectionId, ids) {
  if (!ids.length) return;
  const field = activeField();
  if (field && ids.includes(field.closest('[data-bid]')?.dataset.bid)) stopTyping(field);
  editBlocks(sectionId, sec => { sec.blocks = sec.blocks.filter(b => !ids.includes(b.id)); }, { label: ids.length > 1 ? 'delete blocks' : 'delete block' });
  const s = getState();
  const patch = { selection: { sectionId } };
  if (s.editPanel?.kind === 'block' && ids.includes(s.editPanel.blockId)) patch.editPanel = null;
  setState(patch);
  if (ui.pop && ui.pop.kind !== 'layers') setUi({ pop: null });
  toast(ids.length > 1 ? `${ids.length} blocks deleted.` : 'Block deleted.', { action: { label: 'Undo', onClick: undo } });
}

// Stacking order is the order of the blocks: later ones lie on top.
// how: 'forward' | 'backward' (past the nearest block they overlap) | 'front' | 'back'.
function arrange(sectionId, ids, how) {
  const sec = liveSection(sectionId);
  if (!sec || !ids.length) return;
  const lay = layoutOf(sec.blocks, isPhone(sectionId));
  const mine = id => ids.includes(id);
  let order = sec.blocks.map(b => b.id);
  if (how === 'front' || how === 'back') {
    const rest = order.filter(id => !mine(id));
    const chosen = order.filter(mine);
    order = how === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  } else {
    const chosen = order.filter(mine);
    for (const id of how === 'forward' ? [...chosen].reverse() : chosen) {
      const i = order.indexOf(id);
      if (how === 'forward') {
        let j = order.findIndex((o, k) => k > i && !mine(o) && overlaps(lay.get(id), lay.get(o)));
        if (j < 0) j = order.findIndex((o, k) => k > i && !mine(o));
        if (j < 0) continue;
        order.splice(i, 1);
        order.splice(j, 0, id);
      } else {
        let j = -1;
        for (let k = i - 1; k >= 0; k--) if (!mine(order[k]) && overlaps(lay.get(id), lay.get(order[k]))) { j = k; break; }
        if (j < 0) for (let k = i - 1; k >= 0; k--) if (!mine(order[k])) { j = k; break; }
        if (j < 0) continue;
        order.splice(i, 1);
        order.splice(j, 0, id);
      }
    }
  }
  if (order.every((id, i) => sec.blocks[i].id === id)) return;
  const labels = { forward: 'bring forward', backward: 'send backward', front: 'bring to front', back: 'send to back' };
  editBlocks(sectionId, s => {
    const byId = new Map(s.blocks.map(b => [b.id, b]));
    s.blocks = order.map(id => byId.get(id)).filter(Boolean);
  }, { label: labels[how] });
}

function setHidden(sectionId, ids, which, hide) {
  const key = which === 'mobile' ? 'hideMobile' : 'hideDesktop';
  editBlocks(sectionId, sec => { for (const b of sec.blocks) if (ids.includes(b.id)) b[key] = hide; },
    { label: `${hide ? 'hide' : 'show'} on ${which === 'mobile' ? 'mobile' : 'desktop'}` });
}

// ⌘⇧H: hide (or show again) at the screen size being edited.
function toggleHideHere(sectionId, ids) {
  const sec = liveSection(sectionId);
  if (!sec || !ids.length) return;
  const which = isPhone(sectionId) ? 'mobile' : 'desktop';
  const key = which === 'mobile' ? 'hideMobile' : 'hideDesktop';
  const hide = !sec.blocks.filter(b => ids.includes(b.id)).every(b => b[key]);
  setHidden(sectionId, ids, which, hide);
  toast(hide ? `Hidden on ${which}. It stays faded here so you can show it again.` : `Shown on ${which} again.`, { action: { label: 'Undo', onClick: undo } });
}

// Option + up / down in phone view: swap places with the block above or below.
function moveInStack(sectionId, blockId, dir) {
  const sec = liveSection(sectionId);
  if (!sec) return;
  const lay = mobileLayout(sec.blocks);
  const order = sec.blocks.filter(b => lay.get(b.id) && !b.hideMobile)
    .map(b => ({ id: b.id, p: lay.get(b.id) }))
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
  const i = order.findIndex(o => o.id === blockId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  const [upper, lower] = dir < 0 ? [order[j], order[i]] : [order[i], order[j]];
  const gap = Math.max(0, lower.p.y - (upper.p.y + upper.p.h));
  placeBlocks(sectionId, true, [
    [lower.id, { ...lower.p, y: upper.p.y }],
    [upper.id, { ...upper.p, y: upper.p.y + lower.p.h + gap }],
  ], dir < 0 ? 'move block up' : 'move block down');
}

function nudge(sectionId, ids, dx, dy) {
  const sec = liveSection(sectionId);
  if (!sec) return;
  const phone = isPhone(sectionId);
  const cols = phone ? GRID_COLS_MOBILE : GRID_COLS;
  const lay = layoutOf(sec.blocks, phone);
  const items = ids.map(id => [id, clampPos(lay.get(id), cols)]).filter(([, p]) => p);
  if (!items.length) return;
  const minX = Math.min(...items.map(([, p]) => p.x));
  const maxX = Math.max(...items.map(([, p]) => p.x + p.w));
  const minY = Math.min(...items.map(([, p]) => p.y));
  const ddx = Math.max(-minX, Math.min(cols - maxX, dx));
  const ddy = Math.max(-minY, dy);
  if (!ddx && !ddy) return;
  placeBlocks(sectionId, phone, items.map(([id, p]) => [id, { ...p, x: p.x + ddx, y: p.y + ddy }]),
    ids.length > 1 ? 'move blocks' : 'move block', `nudge:${ids.join(',')}:${phone ? 'phone' : 'desktop'}`);
}

// ⌘ + arrows: wider, narrower, taller, shorter. ⌘⇧ + arrows: the same on both sides.
function resizeBy(sectionId, ids, key, both) {
  const sec = liveSection(sectionId);
  if (!sec) return;
  const phone = isPhone(sectionId);
  const cols = phone ? GRID_COLS_MOBILE : GRID_COLS;
  const lay = layoutOf(sec.blocks, phone);
  const places = [];
  for (const id of ids) {
    const p = clampPos(lay.get(id), cols);
    if (!p) continue;
    let { x, y, w, h } = p;
    if (!both) {
      if (key === 'ArrowRight') w = Math.min(cols - x, w + 1);
      if (key === 'ArrowLeft') w = Math.max(1, w - 1);
      if (key === 'ArrowDown') h += 1;
      if (key === 'ArrowUp') h = Math.max(1, h - 1);
    } else {
      if (key === 'ArrowRight') { const nx = Math.max(0, x - 1); w = Math.min(cols, x + w + 1) - nx; x = nx; }
      if (key === 'ArrowLeft' && w > 2) { x += 1; w -= 2; }
      if (key === 'ArrowDown') { const ny = Math.max(0, y - 1); h += y - ny + 1; y = ny; }
      if (key === 'ArrowUp' && h > 2) { y += 1; h -= 2; }
    }
    const next = { x, y, w, h };
    if (!samePos(p, next)) places.push([id, next]);
  }
  if (places.length) placeBlocks(sectionId, phone, places, 'resize block', `resize:${ids.join(',')}:${phone ? 'phone' : 'desktop'}`);
}

// ---------- copy and paste (kept for this browser tab) ----------

const CLIP_KEY = 'editor.blockClipboard';
let clip = null;
try { clip = JSON.parse(sessionStorage.getItem(CLIP_KEY) || 'null'); } catch { clip = null; }

const hasClip = () => !!(clip && Array.isArray(clip.blocks) && clip.blocks.length);

function copyBlocks(sectionId, ids) {
  const sec = liveSection(sectionId);
  if (!sec || !ids.length) return;
  flushSync();
  const blocks = liveSection(sectionId).blocks.filter(b => ids.includes(b.id));
  clip = { sectionId, blocks: JSON.parse(JSON.stringify(blocks)) };
  try { sessionStorage.setItem(CLIP_KEY, JSON.stringify(clip)); } catch { /* memory copy still works */ }
  toast(blocks.length > 1 ? `${blocks.length} blocks copied. Press ⌘V to paste them.` : 'Block copied. Press ⌘V to paste it.', { timeout: 2500 });
}

// Pasted blocks keep their arrangement; in the section they came from they sit
// one row lower, like a duplicate.
function pasteBlocks(sectionId) {
  const sec = liveSection(sectionId);
  if (!sec || !hasClip()) return false;
  const made = clip.blocks.map(b => cloneWithNewIds(b));
  const dy = clip.sectionId === sectionId ? 1 : 0;
  for (const b of made) {
    b.d = clampPos({ ...b.d, y: b.d.y + dy }, GRID_COLS);
    b.m = null;
  }
  if (ownPhoneLayout(sec.blocks)) {
    const y0 = bottomOf(mobileLayout(sec.blocks));
    const auto = mobileLayout(made);
    for (const b of made) { const p = auto.get(b.id); b.m = { ...p, y: y0 + p.y }; }
  }
  editBlocks(sectionId, s => { s.blocks.push(...made); }, { label: made.length > 1 ? 'paste blocks' : 'paste block' });
  reveal = made[0].id;
  select(sectionId, made.map(b => b.id));
  return true;
}

// ---------- the grid, measured in the preview ----------

const tracks = v => String(v || '').split(/\s+/).map(parseFloat).filter(n => Number.isFinite(n));

function blockEl(sectionId, blockId) {
  const sec = sectionEl(sectionId);
  return sec ? sec.querySelector(`[data-bid="${CSS.escape(blockId)}"]`) : null;
}

// The section's grid in stage coordinates: the column width and gap, and the
// real row heights (a row grows when its text does not fit).
function measure(sectionId) {
  const sec = sectionEl(sectionId);
  const grid = sec && sec.querySelector('.fe-grid');
  const r = grid && rectInStage(grid);
  if (!r) return null;
  const cs = grid.ownerDocument.defaultView.getComputedStyle(grid);
  const colTracks = tracks(cs.gridTemplateColumns);
  const gap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  const cols = colTracks.length === GRID_COLS || colTracks.length === GRID_COLS_MOBILE
    ? colTracks.length : (getState().device === 'mobile' ? GRID_COLS_MOBILE : GRID_COLS);
  const colW = colTracks.length === cols ? colTracks[0] : Math.max(1, (r.w - (cols - 1) * gap) / cols);
  const rows = tracks(cs.gridTemplateRows);
  const tops = [0];
  for (const h of rows) tops.push(tops[tops.length - 1] + h + rowGap);
  return {
    x: r.x, y: r.y, w: r.w, h: r.h, cols, gap, rowGap, colW, step: colW + gap, rows, tops,
    unit: rows.length ? Math.min(...rows) : colW, // an ordinary row; used below the last one
    phone: cols === GRID_COLS_MOBILE,
    frame: { x: r.frameLeft, y: r.frameTop, w: r.frameW, h: r.frameH },
  };
}

// Is the section shown on the phone grid (8 columns)?
function isPhone(sectionId) {
  const g = sectionId ? measure(sectionId) : null;
  return g ? g.phone : getState().device === 'mobile';
}

// Offset from the grid's top of the line above row i.
function rowTop(g, i) {
  const n = g.rows.length;
  if (i <= n) return g.tops[Math.max(0, i)];
  return g.tops[n] + (i - n) * (g.unit + g.rowGap);
}

// The row line nearest to an offset from the grid's top.
function nearestRow(g, py) {
  const n = g.rows.length;
  if (py >= g.tops[n]) return n + Math.round((py - g.tops[n]) / (g.unit + g.rowGap));
  let best = 0;
  for (let i = 1; i <= n; i++) if (Math.abs(g.tops[i] - py) < Math.abs(g.tops[best] - py)) best = i;
  return best;
}

const nearestCol = (g, px) => Math.round(px / g.step); // a left edge -> its column
const nearestColEnd = (g, px) => Math.round((px + g.gap) / g.step); // a right edge -> the column after it

// A rectangle of cells, relative to the grid.
function cellRect(g, p) {
  const y = rowTop(g, p.y);
  return { x: p.x * g.step, y, w: p.w * g.step - g.gap, h: rowTop(g, p.y + p.h) - y - g.rowGap };
}

// The candidate closest to value, if within limit (toPx turns a candidate into value's unit).
function nearestOf(value, candidates, limit, toPx = v => v) {
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.abs(value - toPx(c));
    if (dist <= limit && dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
}

// Thin guides where the block's edges line up with another block's.
function guidesFor(g, t, others) {
  const out = [];
  const L = t.x * g.step;
  const R = (t.x + t.w) * g.step - g.gap;
  const T = rowTop(g, t.y);
  const B = rowTop(g, t.y + t.h) - g.rowGap;
  for (const o of others) {
    const oL = o.x * g.step;
    const oR = (o.x + o.w) * g.step - g.gap;
    const oT = rowTop(g, o.y);
    const oB = rowTop(g, o.y + o.h) - g.rowGap;
    const y1 = Math.min(T, oT);
    const y2 = Math.max(B, oB);
    const x1 = Math.min(L, oL);
    const x2 = Math.max(R, oR);
    if (o.x === t.x) out.push({ v: true, at: L, from: y1, to: y2 });
    if (o.x + o.w === t.x + t.w) out.push({ v: true, at: R, from: y1, to: y2 });
    if (o.y === t.y) out.push({ v: false, at: T, from: x1, to: x2 });
    if (o.y + o.h === t.y + t.h) out.push({ v: false, at: B, from: x1, to: x2 });
  }
  return out;
}

// ---------- pointer: moving, resizing, selection box ----------

let ptr = null;            // the mouse button held on a block, a handle or the background
let swallowClick = false;  // the click that ends a press we handled is not the preview's

const isEditing = () => { const s = getState(); return s.mode === 'edit' && !s.viewing; };

// Leaves the text being typed, without a leftover highlighted selection.
function stopTyping(field = activeField()) {
  if (!field) return;
  field.blur();
  field.ownerDocument.getSelection()?.removeAllRanges();
}
const asEl = n => (!n ? null : n.nodeType === 1 ? n : n.parentElement || null);

function stageBox() {
  const st = frameEl()?.closest('.stage');
  return st ? st.getBoundingClientRect() : null;
}

// Pointer position in stage coordinates, from an event in this window or in the preview.
function stagePoint(e) {
  const st = stageBox();
  if (!st) return null;
  if (e.view && e.view !== window) {
    const fr = frameEl().getBoundingClientRect();
    return { x: fr.left - st.left + e.clientX, y: fr.top - st.top + e.clientY };
  }
  return { x: e.clientX - st.left, y: e.clientY - st.top };
}

// o: { kind: 'block' | 'resize' | 'marquee', sectionId, blockId?, handle?, field?, client?, add? }
function pointerStart(o, e) {
  if (ptr) pointerEnd();
  const p = stagePoint(e);
  if (!p) return;
  ptr = { ...o, start: p, point: p, moved: false, drag: null };
  window.addEventListener('pointermove', onPtrMove, true);
  window.addEventListener('pointerup', onPtrUp, true);
  window.addEventListener('pointercancel', cancelPointer, true);
  window.addEventListener('blur', cancelPointer);
}

function pointerEnd(dropped = false) {
  const o = ptr;
  ptr = null;
  // The blocks that followed the pointer go back, unless they were dropped
  // somewhere new (the page is redrawn with them there).
  if (o?.drag && !dropped) liftBlocks(o.drag, null);
  window.removeEventListener('pointermove', onPtrMove, true);
  window.removeEventListener('pointerup', onPtrUp, true);
  window.removeEventListener('pointercancel', cancelPointer, true);
  window.removeEventListener('blur', cancelPointer);
  if (o?.drag) clearInterval(o.drag.timer);
  frameDoc()?.documentElement.classList.remove('bk-dragging');
  if (ui.view || ui.marquee) setUi({ view: null, marquee: null });
  return o;
}

const cancelPointer = () => { pointerEnd(false); };

function onPtrMove(e) {
  const o = ptr;
  if (!o) return;
  const p = stagePoint(e);
  if (!p) return;
  o.point = p;
  if (!o.moved) {
    if (Math.hypot(p.x - o.start.x, p.y - o.start.y) < 4) return;
    o.moved = true;
    if (!beginDrag(o)) { pointerEnd(); return; }
  }
  if (o.kind === 'marquee') trackMarquee(o);
  else track(o);
}

function onPtrUp() {
  const d0 = ptr?.drag;
  const dropped = !!(d0 && d0.targets && d0.targets.some(([id, p]) => !samePos(p, d0.items.find(i => i.id === id).pos)));
  const o = pointerEnd(dropped);
  if (!o) return;
  if (!o.moved) {
    if (o.kind === 'block') clickedBlock(o);
    return;
  }
  if (o.kind === 'marquee') {
    if (o.hits) select(o.sectionId, o.hits);
    return;
  }
  const d = o.drag;
  if (!d || !d.targets) return;
  const changed = d.targets.some(([id, p]) => !samePos(p, d.items.find(i => i.id === id).pos));
  if (changed) placeBlocks(d.sectionId, d.phone, d.targets, d.mode === 'resize' ? 'resize block' : d.items.length > 1 ? 'move blocks' : 'move block');
}

// The press became a drag: work out what moves.
function beginDrag(o) {
  if (o.kind === 'marquee') {
    swallowClick = true;
    o.base = o.add ? selIds(o.sectionId) : [];
    if (getState().selection?.sectionId !== o.sectionId) setState({ selection: { sectionId: o.sectionId } });
    return true;
  }
  const sec = liveSection(o.sectionId);
  const g = measure(o.sectionId);
  if (!sec || !g || !sec.blocks.some(b => b.id === o.blockId)) return false;
  let ids = [o.blockId];
  if (o.kind === 'block') {
    const cur = selIds(o.sectionId);
    if (cur.length > 1 && cur.includes(o.blockId)) ids = cur;
    else if (!(cur.length === 1 && cur[0] === o.blockId)) select(o.sectionId, ids);
  }
  stopTyping();
  const lay = layoutOf(sec.blocks, g.phone);
  const items = ids.map(id => {
    const pos = clampPos(lay.get(id), g.cols);
    const el = blockEl(o.sectionId, id);
    const br = el && rectInStage(el);
    return { id, pos, box: br && br.w ? { x: br.x - g.x, y: br.y - g.y, w: br.w, h: br.h } : cellRect(g, pos) };
  }).filter(it => it.pos);
  if (!items.length) return false;
  const bx = Math.min(...items.map(i => i.pos.x));
  const by = Math.min(...items.map(i => i.pos.y));
  const pl = Math.min(...items.map(i => i.box.x));
  const pt = Math.min(...items.map(i => i.box.y));
  o.drag = {
    sectionId: o.sectionId,
    mode: o.kind === 'resize' ? 'resize' : 'move',
    handle: o.handle,
    phone: g.phone,
    items,
    bbox: {
      pos: { x: bx, y: by, w: Math.max(...items.map(i => i.pos.x + i.pos.w)) - bx, h: Math.max(...items.map(i => i.pos.y + i.pos.h)) - by },
      box: { x: pl, y: pt, w: Math.max(...items.map(i => i.box.x + i.box.w)) - pl, h: Math.max(...items.map(i => i.box.y + i.box.h)) - pt },
    },
    others: sec.blocks.filter(b => !ids.includes(b.id)).map(b => clampPos(lay.get(b.id), g.cols)).filter(Boolean),
    start: { x: o.start.x - g.x, y: o.start.y - g.y }, // pointer, relative to the grid
    targets: null,
    timer: setInterval(autoScroll, 40),
  };
  frameDoc()?.documentElement.classList.add('bk-dragging');
  return true;
}

// Works out the cells under the pointer, with snapping. Offsets are kept
// relative to the grid, so scrolling the page during a drag does not move the block.
function track(o) {
  const d = o.drag;
  if (!d) return;
  const g = measure(d.sectionId);
  if (!g) return;
  const dx = o.point.x - g.x - d.start.x;
  const dy = o.point.y - g.y - d.start.y;
  const thrY = SNAP * (g.unit + g.rowGap);
  const others = d.others;
  if (d.mode === 'move') {
    const bb = d.bbox;
    const w = bb.pos.w;
    const free = { x: bb.box.x + dx, y: bb.box.y + dy, w: bb.box.w, h: bb.box.h };
    const fx = free.x / g.step;
    let x = Math.max(0, Math.min(g.cols - w, Math.round(fx)));
    const cx = (g.cols - w) / 2;
    if (Number.isInteger(cx) && Math.abs(fx - cx) <= 0.5) {
      x = cx; // the section's center wins
    } else {
      const c = nearestOf(fx, others.flatMap(p => [p.x, p.x + p.w - w]).filter(v => v >= 0 && v <= g.cols - w), SNAP);
      if (c !== null) x = c;
    }
    let y = Math.max(0, nearestRow(g, free.y));
    const cy = nearestOf(free.y, others.flatMap(p => [p.y, p.y + p.h - bb.pos.h]).filter(v => v >= 0), thrY, v => rowTop(g, v));
    if (cy !== null) y = cy;
    const ddx = x - bb.pos.x;
    const ddy = y - bb.pos.y;
    d.targets = d.items.map(it => [it.id, { ...it.pos, x: it.pos.x + ddx, y: it.pos.y + ddy }]);
    liftBlocks(d, { x: dx, y: dy });
    const t = { ...bb.pos, x, y };
    setUi({ view: {
      sectionId: d.sectionId, mode: 'move', targets: d.targets, free, guides: guidesFor(g, t, others),
      center: 2 * x + w === g.cols, label: d.items.length === 1 ? `${t.w} × ${t.h}` : null,
    } });
    return;
  }
  const { id, pos, box } = d.items[0];
  const hd = d.handle;
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  let x = pos.x;
  let y = pos.y;
  let endX = pos.x + pos.w;
  let endY = pos.y + pos.h;
  if (hd.includes('w')) {
    left += dx;
    x = Math.max(0, Math.min(endX - 1, nearestCol(g, left)));
    const c = nearestOf(left / g.step, others.map(p => p.x).filter(v => v < endX), SNAP);
    if (c !== null) x = c;
  }
  if (hd.includes('e')) {
    right += dx;
    endX = Math.max(x + 1, Math.min(g.cols, nearestColEnd(g, right)));
    const c = nearestOf((right + g.gap) / g.step, others.map(p => p.x + p.w).filter(v => v > x && v <= g.cols), SNAP);
    if (c !== null) endX = c;
  }
  if (hd.includes('n')) {
    top += dy;
    y = Math.max(0, Math.min(endY - 1, nearestRow(g, top)));
    const c = nearestOf(top, others.map(p => p.y).filter(v => v < endY), thrY, v => rowTop(g, v));
    if (c !== null) y = c;
  }
  if (hd.includes('s')) {
    bottom += dy;
    endY = Math.max(y + 1, nearestRow(g, bottom + g.rowGap));
    const c = nearestOf(bottom + g.rowGap, others.map(p => p.y + p.h).filter(v => v > y), thrY, v => rowTop(g, v));
    if (c !== null) endY = c;
  }
  const t = { x, y, w: endX - x, h: endY - y };
  d.targets = [[id, t]];
  setUi({ view: {
    sectionId: d.sectionId, mode: 'resize', handle: hd, targets: d.targets,
    free: { x: Math.min(left, right), y: Math.min(top, bottom), w: Math.abs(right - left), h: Math.abs(bottom - top) },
    guides: guidesFor(g, t, others), center: 2 * t.x + t.w === g.cols, label: `${t.w} × ${t.h}`,
  } });
}

// While moving, the blocks themselves follow the pointer (offset null: back in place).
function liftBlocks(d, offset) {
  if (d.mode !== 'move') return;
  for (const it of d.items) {
    const el = blockEl(d.sectionId, it.id);
    if (!el) continue;
    if (offset) {
      el.style.transform = `translate(${Math.round(offset.x)}px, ${Math.round(offset.y)}px)`;
      el.style.zIndex = '50';
      el.style.opacity = '.85';
    } else {
      el.style.removeProperty('transform');
      el.style.removeProperty('z-index');
      el.style.removeProperty('opacity');
    }
  }
}

// Near the top or bottom of the preview, the page scrolls so blocks can go anywhere.
function autoScroll() {
  const o = ptr;
  const d = o && o.drag;
  const win = frameDoc()?.defaultView;
  if (!d || !win) return;
  const g = measure(d.sectionId);
  if (!g) return;
  const top = g.frame.y + 40;
  const bottom = g.frame.y + g.frame.h - 40;
  let by = 0;
  if (o.point.y < top) by = -Math.min(24, Math.ceil((top - o.point.y) / 3));
  else if (o.point.y > bottom) by = Math.min(24, Math.ceil((o.point.y - bottom) / 3));
  if (!by) return;
  win.scrollBy(0, by);
  track(o);
}

function trackMarquee(o) {
  const sec = liveSection(o.sectionId);
  if (!sec) return;
  const a = o.start;
  const b = o.point;
  const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  const hits = sec.blocks.filter(bk => {
    const el = blockEl(o.sectionId, bk.id);
    const r = el && rectInStage(el);
    return r && r.w && r.x < rect.x + rect.w && rect.x < r.x + r.w && r.y < rect.y + rect.h && rect.y < r.y + r.h;
  }).map(bk => bk.id);
  o.hits = [...new Set([...(o.base || []), ...hits])];
  setUi({ marquee: { sectionId: o.sectionId, rect, ids: o.hits } });
}

// A click (no drag) on a block. Words get the text cursor where the click was;
// an empty block asks for its content right away.
function clickedBlock(o) {
  const { sectionId, blockId } = o;
  const b = liveBlock(sectionId, blockId);
  if (!b) return;
  select(sectionId, [blockId]);
  if (o.field && o.field.isConnected) {
    placeCaret(o.field, o.client.x, o.client.y);
    return;
  }
  if (b.kind === 'image' && !getState().site.media[b.media]) { chooseImage(sectionId, blockId); return; }
  if (b.kind === 'form' && !String(b.endpoint || getState().site.settings.formEndpoint || '').trim()) { openBlockPanel(sectionId, blockId, 'storage'); return; }
  const empty = (b.kind === 'video' && !videoEmbedUrl(b.url)) || (b.kind === 'embed' && !b.html)
    || (b.kind === 'map' && !String(b.address || '').trim()) || (b.kind === 'social' && !(b.links || []).length)
    || (b.kind === 'accordion' && !(b.items || []).length);
  if (empty) openBlockPanel(sectionId, blockId);
}

function placeCaret(field, x, y) {
  const doc = field.ownerDocument;
  field.focus({ preventScroll: true });
  let range = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
  if (!range || !field.contains(range.startContainer)) {
    // Beside the words: the line at that height, else the start or the end.
    const r = field.getBoundingClientRect();
    const inside = { x: Math.min(Math.max(x, r.left + 1), r.right - 1), y: Math.min(Math.max(y, r.top + 1), r.bottom - 1) };
    range = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(inside.x, inside.y) : null;
    if (!range || !field.contains(range.startContainer)) {
      range = doc.createRange();
      range.selectNodeContents(field);
      range.collapse(y < r.top);
    }
  }
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------- listeners in the preview (bound again on every load) ----------

// Editor-only rules inside the preview: a hand over blocks, blocks hidden at
// this screen size stay visible (faded) so they can be selected and shown again.
const FRAME_CSS = `
html[data-editing] .s-blocks .fe-b{cursor:grab}
html[data-editing] .s-blocks .fe-b *:not(:focus){cursor:inherit}
html[data-editing] .s-blocks .fe-b [data-edit]:focus{cursor:text}
html[data-editing] .s-blocks .fe-b:hover{outline:1px solid rgba(29,107,243,.55)}
html.bk-dragging,html.bk-dragging *{cursor:grabbing!important;user-select:none!important}
@media (min-width:781px){
  html[data-editing] .fe-b.hide-d{display:block;opacity:.38}
  html[data-editing] .fe-b.hide-d.av-middle,html[data-editing] .fe-b.hide-d.av-bottom,html[data-editing] .fe-b.hide-d.k-line{display:flex}
}
@media (max-width:780px){
  html[data-editing] .fe-b.hide-m{display:block;opacity:.38}
  html[data-editing] .fe-b.hide-m.av-middle,html[data-editing] .fe-b.hide-m.av-bottom,html[data-editing] .fe-b.hide-m.k-line{display:flex}
}`;

const boundDocs = new WeakSet();

function bindFrame() {
  const doc = frameDoc();
  const win = doc?.defaultView;
  if (!doc || !win || boundDocs.has(doc)) return;
  boundDocs.add(doc);
  if (!doc.getElementById('bk-frame-css')) {
    const st = doc.createElement('style');
    st.id = 'bk-frame-css';
    st.textContent = FRAME_CSS;
    doc.head.appendChild(st);
  }
  win.addEventListener('mousedown', onFrameDown, true);
  win.addEventListener('click', onFrameClick, true);
  win.addEventListener('dblclick', onFrameDblClick, true);
  win.addEventListener('contextmenu', onFrameContext, true);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('pointermove', onPtrMove, true);
  win.addEventListener('pointerup', onPtrUp, true);
  win.addEventListener('pointercancel', cancelPointer, true);
}

events.on('load', () => {
  if (ptr) pointerEnd();
  bindFrame();
});
window.addEventListener('keydown', onKey, true);

// The blocks section an event in the preview happened in, if any.
function blocksSectionOf(t) {
  const sec = t && t.closest('[data-sid]');
  return sec && sec.dataset.type === 'blocks' ? sec : null;
}

function onFrameDown(e) {
  swallowClick = false;
  if (!isEditing()) return;
  if (e.button === 2) {
    // A right-click on a block opens the block menu; it must not start typing.
    const t = asEl(e.target);
    const field = activeField();
    if (blocksSectionOf(t) && t.closest('[data-bid]') && !(field && field.contains(t))) e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  closeAddMenu();
  if (getState().menu) closeMenu();
  if (ui.pop && ui.pop.kind !== 'layers') setUi({ pop: null });
  const t = asEl(e.target);
  const secEl = blocksSectionOf(t);
  if (!secEl) return;
  const field = activeField();
  if (field && field.contains(t)) return; // typing: the mouse selects text as usual
  const sectionId = secEl.dataset.sid;
  const bEl = t.closest('[data-bid]');
  e.preventDefault();
  stopTyping(field);
  // The press does not move the focus by itself (it was prevented): take it
  // from a text box in a panel, so the keys now act on the blocks.
  if (document.activeElement && document.activeElement !== document.body && document.activeElement !== frameEl()) document.activeElement.blur();
  try { e.view.focus(); } catch { /* the keys still reach this window */ }
  if (!bEl) {
    pointerStart({ kind: 'marquee', sectionId, add: e.shiftKey }, e);
    return;
  }
  swallowClick = true;
  const blockId = bEl.dataset.bid;
  if (e.shiftKey) { toggleInSelection(sectionId, blockId); return; }
  const b = liveBlock(sectionId, blockId);
  // Text and quotes type wherever they are clicked (the cursor goes to the
  // nearest spot); an image only in its caption.
  let words = b && CARET_KINDS.has(b.kind) ? t.closest('[data-edit]') : null;
  if (!words && b && (b.kind === 'text' || b.kind === 'quote')) words = bEl.querySelector('[data-edit]');
  pointerStart({ kind: 'block', sectionId, blockId, field: words && bEl.contains(words) ? words : null, client: { x: e.clientX, y: e.clientY } }, e);
}

function onFrameClick(e) {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}

// Double-click opens the block's settings; in text being typed it selects a word.
function onFrameDblClick(e) {
  if (!isEditing()) return;
  const t = asEl(e.target);
  const secEl = blocksSectionOf(t);
  const bEl = secEl && t.closest('[data-bid]');
  if (!bEl) return;
  const field = activeField();
  if (field && field.contains(t)) return;
  e.stopPropagation();
  e.preventDefault();
  openBlockPanel(secEl.dataset.sid, bEl.dataset.bid);
}

function onFrameContext(e) {
  if (!isEditing()) return;
  const t = asEl(e.target);
  const secEl = blocksSectionOf(t);
  if (!secEl) return;
  const field = activeField();
  if (field && field.contains(t)) return; // the browser's menu, with spelling suggestions
  e.preventDefault();
  const fr = frameEl().getBoundingClientRect();
  const at = { x: fr.left + e.clientX, y: fr.top + e.clientY };
  const bEl = t.closest('[data-bid]');
  if (bEl) openBlockMenu(at, secEl.dataset.sid, bEl.dataset.bid);
  else openSectionMenu(at, secEl.dataset.sid);
}

// ---------- keyboard (Squarespace's Fluid Engine shortcuts) ----------

function onKey(e) {
  if (!isEditing() || e.isComposing) return;
  if (ptr) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pointerEnd(); }
    return;
  }
  const t = asEl(e.target);
  const s = getState();
  // Typing in a block: Escape stops typing and keeps the block selected.
  const typed = t?.closest?.('[data-edit]');
  if (typed) {
    const bEl = typed.closest('[data-bid]');
    const secEl = bEl && blocksSectionOf(bEl);
    if (e.key === 'Escape' && secEl && !s.modal) {
      e.preventDefault();
      e.stopPropagation();
      stopTyping(typed);
      select(secEl.dataset.sid, [bEl.dataset.bid]);
    }
    return;
  }
  if (t?.closest?.('input, textarea, select, [contenteditable], .fpanel, .modal-back, .menu, .fmt, .bk-pop, .bk-addmenu')) return;
  if (s.modal || s.menu) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  const key = k.length === 1 ? k.toLowerCase() : k;
  if (key === 'Escape' && ui.pop) { e.preventDefault(); e.stopPropagation(); setUi({ pop: null, hover: null }); return; }
  const sid = s.selection?.sectionId;
  const sec = liveSection(sid);
  if (!sec || !sectionEl(sid)) return;
  const ids = selIds(sid);
  let handled = true;
  if (key === 'g' && !mod && !e.altKey && !e.shiftKey) setUi({ grid: !ui.grid });
  else if (mod && key === 'a' && !e.altKey && !e.shiftKey) { if (sec.blocks.length) select(sid, sec.blocks.map(b => b.id)); }
  else if (mod && key === 'v' && !e.altKey && !e.shiftKey) handled = pasteBlocks(sid);
  else if (k === 'Tab' && !mod && !e.altKey) selectNext(sid, e.shiftKey ? -1 : 1);
  else if (!ids.length) handled = false;
  else if (mod && key === 'c' && !e.altKey && !e.shiftKey) copyBlocks(sid, ids);
  else if (mod && key === 'd' && !e.altKey && !e.shiftKey) duplicateBlocks(sid, ids);
  else if (mod && e.shiftKey && key === 'h') toggleHideHere(sid, ids);
  else if ((k === 'Delete' || k === 'Backspace') && !mod && !e.altKey) deleteBlocks(sid, ids);
  else if (k === 'Escape') {
    setState({ selection: { sectionId: sid }, ...(s.editPanel?.kind === 'block' ? { editPanel: null } : {}) });
  } else if (ARROWS[k]) {
    const vertical = k === 'ArrowUp' || k === 'ArrowDown';
    if (mod) resizeBy(sid, ids, k, e.shiftKey);
    else if (e.altKey) {
      if (vertical && ids.length === 1 && isPhone(sid)) moveInStack(sid, ids[0], k === 'ArrowUp' ? -1 : 1);
    } else if (e.shiftKey && vertical) arrange(sid, ids, k === 'ArrowUp' ? 'forward' : 'backward');
    else {
      const n = e.shiftKey ? 4 : 1;
      nudge(sid, ids, ARROWS[k][0] * n, ARROWS[k][1] * n);
    }
  } else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

// ---------- right-click menus ----------

const withKeys = (label, keys) => html`<span class="bk-mi">${label}</span><span class="bk-kbd">${keys}</span>`;

function openBlockMenu(at, sectionId, blockId) {
  const cur = selIds(sectionId);
  const ids = cur.includes(blockId) ? cur : [blockId];
  if (!cur.includes(blockId)) select(sectionId, ids);
  const sec = liveSection(sectionId);
  if (!sec) return;
  const chosen = sec.blocks.filter(b => ids.includes(b.id));
  const hidD = chosen.every(b => b.hideDesktop);
  const hidM = chosen.every(b => b.hideMobile);
  openMenu(at, [
    { note: 'Arrange' },
    { label: withKeys('Bring forward', '⇧↑'), onClick: () => arrange(sectionId, ids, 'forward') },
    { label: withKeys('Send backward', '⇧↓'), onClick: () => arrange(sectionId, ids, 'backward') },
    { label: 'Bring to front', onClick: () => arrange(sectionId, ids, 'front') },
    { label: 'Send to back', onClick: () => arrange(sectionId, ids, 'back') },
    'sep',
    { label: withKeys('Copy', '⌘C'), onClick: () => copyBlocks(sectionId, ids) },
    { label: withKeys('Duplicate', '⌘D'), onClick: () => duplicateBlocks(sectionId, ids) },
    ...(hasClip() ? [{ label: withKeys('Paste', '⌘V'), onClick: () => pasteBlocks(sectionId) }] : []),
    'sep',
    { label: hidD ? 'Show on desktop' : 'Hide on desktop', onClick: () => setHidden(sectionId, ids, 'desktop', !hidD) },
    { label: hidM ? 'Show on mobile' : 'Hide on mobile', onClick: () => setHidden(sectionId, ids, 'mobile', !hidM) },
    'sep',
    { label: withKeys('Delete', '⌫'), danger: true, onClick: () => deleteBlocks(sectionId, ids) },
  ]);
}

function openSectionMenu(at, sectionId) {
  if (getState().selection?.sectionId !== sectionId || getState().selection?.blockId) setState({ selection: { sectionId } });
  openMenu(at, [
    ...(hasClip() ? [{ label: withKeys('Paste', '⌘V'), onClick: () => pasteBlocks(sectionId) }] : []),
    { label: 'Save section', onClick: () => saveSectionForReuse(sectionId) },
  ]);
}

// ---------- the block menu ("+ ADD BLOCK") ----------

let addHost = null;
let addClosed = { at: 0, sectionId: null };

export function openAddMenu(anchor, sectionId) {
  // A second click on the same button closes the menu instead of opening it again.
  if (addClosed.sectionId === sectionId && Date.now() - addClosed.at < 300) return;
  closeMenu();
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const pos = r ? { x: r.left, y: r.bottom + 6, above: r.top - 6 } : { x: anchor?.x || 80, y: anchor?.y || 80, above: anchor?.y || 80 };
  if (!addHost) {
    addHost = document.createElement('div');
    addHost.className = 'bk-addmenu-host';
    document.body.appendChild(addHost);
  }
  render(html`<${AddBlockMenu} key=${Date.now()} pos=${pos} sectionId=${sectionId} />`, addHost);
}

function closeAddMenu(bySection = null) {
  if (!addHost || !addHost.firstChild) return;
  addClosed = { at: Date.now(), sectionId: bySection };
  render(null, addHost);
}

function AddBlockMenu({ pos, sectionId }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    const down = e => {
      if (ref.current && ref.current.contains(e.target)) return;
      closeAddMenu(e.target.closest?.('.bk-add, .ov-addblock') ? sectionId : null);
    };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAddMenu(); } };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    const offs = [events.on('load', () => closeAddMenu())];
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      offs.forEach(off => off());
    };
  }, []);
  const words = q.trim().toLowerCase();
  const list = MENU.filter(([kind, , extra]) => !words || `${BLOCK_TYPES[kind]?.label || kind} ${extra}`.toLowerCase().includes(words));
  const pick = kind => { closeAddMenu(); addBlockOfKind(sectionId, kind); };
  const W = 324;
  const H = 400;
  const left = Math.max(8, Math.min(pos.x, window.innerWidth - W - 8));
  const top = pos.y + H > window.innerHeight - 8 && pos.above - H > 8 ? pos.above - H : Math.max(8, Math.min(pos.y, window.innerHeight - H - 8));
  return html`<div class="bk-addmenu" ref=${ref} style=${`left:${left}px;top:${top}px;width:${W}px`} role="dialog" aria-label="Add a block">
    <label class="bk-am-search">
      <${Icon} name="search" size=${16} />
      <input ref=${input} type="text" placeholder="Search blocks" value=${q} aria-label="Search blocks"
        onInput=${e => setQ(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); pick(list[0][0]); } }} />
    </label>
    <div class="bk-am-grid">
      ${list.map(([kind, icon]) => html`<button type="button" class="bk-am-tile" onClick=${() => pick(kind)}>
        <${BIcon} name=${icon} size=${24} /><span>${BLOCK_TYPES[kind]?.label || kind}</span>
      </button>`)}
    </div>
    ${!list.length ? html`<p class="bk-am-none">No blocks match "${q.trim()}".</p>` : null}
    <p class="bk-am-hint">New blocks go below the others. Drag them anywhere.</p>
  </div>`;
}

// ---------- the overlay ----------

const px = n => `${Math.round(n * 10) / 10}px`;

// Buttons the main overlay draws (ADD SECTION, the section toolbar), so ours can stay clear of them.
function busyZones(layerEl) {
  const ov = layerEl && layerEl.parentElement;
  if (!ov) return [];
  const base = ov.getBoundingClientRect();
  return [...ov.children].filter(el => el.matches('.ov-add, .ov-tools')).map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  });
}

function union(rects) {
  const x = Math.min(...rects.map(r => r.x));
  const y = Math.min(...rects.map(r => r.y));
  return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
}

// Short text that tells blocks apart in Layers.
function snippet(b, site) {
  const text = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  switch (b.kind) {
    case 'text': case 'quote': return text(b.html);
    case 'image': { const m = site.media[b.media]; return m ? text(m.title || m.alt || '') : 'No image yet'; }
    case 'button': return b.label || '';
    case 'video': return String(b.url || '').replace(/^https?:\/\/(www\.)?/, '');
    case 'map': return b.address || '';
    case 'accordion': return (b.items || []).map(i => i.title).filter(Boolean).join(', ');
    case 'social': return (b.links || []).map(l => SOCIAL[l.platform]?.label).filter(Boolean).join(', ');
    default: return '';
  }
}

export function BlockOverlay({ section, revision }) { // eslint-disable-line no-unused-vars
  const selection = useStore(s => s.selection);
  useStore(s => s.device);
  const site = useStore(s => s.site);
  const u = useUi();
  const [, setTick] = useState(0);
  const layer = useRef(null);
  const sid = section.id;
  const sidRef = useRef(sid);
  sidRef.current = sid;
  const blocks = section.blocks || [];
  const ids = idsIn(selection, section);
  const single = ids.length === 1 ? ids[0] : null;

  // Measure again whenever the preview scrolls, reflows, reloads or starts typing.
  useEffect(() => {
    const tick = () => setTick(n => n + 1);
    const offs = ['layout', 'scroll', 'load', 'focus'].map(name => events.on(name, tick));
    return () => {
      offs.forEach(off => off());
      if (ui.pop?.sectionId === sidRef.current || ui.hover) setUi({ pop: null, hover: null });
      const s = getState();
      if (s.editPanel?.kind === 'block' && s.editPanel.id === sidRef.current && s.selection?.sectionId !== sidRef.current) setState({ editPanel: null });
    };
  }, []);

  // The Edit Block panel follows the selected block, and closes when none is selected.
  useEffect(() => {
    const ep = getState().editPanel;
    if (!ep || ep.kind !== 'block' || ep.id !== sid || ep.blockId === single) return;
    setState({ editPanel: single ? { kind: 'block', id: sid, blockId: single } : null });
  }, [single, sid]);

  // A block that was just added or pasted is scrolled into view.
  useEffect(() => {
    if (!reveal) return;
    const el = blockEl(sid, reveal);
    if (!el) return;
    reveal = null;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > el.ownerDocument.defaultView.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // Popovers close on a click elsewhere in the editor.
  useEffect(() => {
    if (!u.pop) return undefined;
    const down = e => { if (!e.target.closest?.('.bk-pop, .bk-tools')) setUi({ pop: null, hover: null }); };
    window.addEventListener('mousedown', down, true);
    return () => window.removeEventListener('mousedown', down, true);
  }, [!!u.pop]);

  const g = frameDoc() ? measure(sid) : null;
  if (!g) return html`<div class="bk-layer" ref=${layer}></div>`;
  const f = g.frame;
  const rel = r => `left:${px(r.x - f.x)};top:${px(r.y - f.y)};width:${px(r.w)};height:${px(r.h)}`;
  const shown = layoutOf(blocks, g.phone);
  const field = activeField();
  const typing = !!field && field.closest('[data-sid]')?.dataset.sid === sid;
  const view = u.view && u.view.sectionId === sid ? u.view : null;
  const marquee = u.marquee && u.marquee.sectionId === sid ? u.marquee : null;
  const busy = !!(view || marquee);
  const zones = busy ? [] : busyZones(layer.current);

  const rects = new Map();
  for (const b of blocks) {
    const el = blockEl(sid, b.id);
    const r = el && rectInStage(el);
    if (r && (r.w || r.h)) rects.set(b.id, r);
  }

  // Outlines for every block, and a tag on blocks hidden at this screen size.
  const outlines = blocks.map(b => (rects.get(b.id) ? html`<div key=${b.id} class="bk-outline" style=${rel(rects.get(b.id))}></div>` : null));
  const hiddenHere = b => (g.phone ? b.hideMobile : b.hideDesktop);
  const tags = blocks.filter(b => hiddenHere(b) && rects.get(b.id)).map(b => {
    const r = rects.get(b.id);
    return html`<div key=${`t-${b.id}`} class="bk-tag" style=${`left:${px(r.x - f.x + 6)};top:${px(r.y - f.y + 6)}`}><${Icon} name="eyeOff" size=${12} /> Hidden on ${g.phone ? 'mobile' : 'desktop'}</div>`;
  });

  // The selection: one block has a frame and eight handles; a group has frames and a box.
  let selUi = null;
  const selRects = (marquee ? marquee.ids : ids).map(id => rects.get(id)).filter(Boolean);
  if (selRects.length && !view) {
    if (single && !marquee) {
      const r = rects.get(single);
      selUi = html`<div class="bk-sel" style=${rel(r)}></div>
        ${HANDLES.map(hd => {
          const x = hd.includes('w') ? r.x : hd.includes('e') ? r.x + r.w : r.x + r.w / 2;
          const y = hd.includes('n') ? r.y : hd.includes('s') ? r.y + r.h : r.y + r.h / 2;
          return html`<div key=${hd} class=${`bk-h bk-h-${hd}`} style=${`left:${px(x - f.x)};top:${px(y - f.y)};cursor:${CURSORS[hd]}`}
            onPointerDown=${e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* window listeners still work */ }
              pointerStart({ kind: 'resize', sectionId: sid, blockId: single, handle: hd }, e);
            }}
            onContextMenu=${e => { e.preventDefault(); openBlockMenu({ x: e.clientX, y: e.clientY }, sid, single); }}></div>`;
        })}`;
    } else {
      selUi = html`${selRects.map((r, i) => html`<div key=${i} class="bk-sel multi" style=${rel(r)}></div>`)}
        ${selRects.length > 1 && !marquee ? html`<div class="bk-group" style=${rel(union(selRects))}></div>` : null}`;
    }
  }

  // Layers: the row under the pointer lights up its block.
  const hv = u.hover && rects.get(u.hover);
  const hoverUi = hv ? html`<div class="bk-hover" style=${rel(hv)}></div>` : null;

  // The grid (while dragging, or kept on with G), guides, and where blocks will land.
  let gridUi = null;
  if (view || u.grid) {
    const lowest = view ? Math.max(...view.targets.map(([, p]) => p.y + p.h)) + 2 : 0;
    const rowsShown = Math.max(g.rows.length, lowest);
    const lines = [];
    for (let i = 0; i <= rowsShown; i++) lines.push(rowTop(g, i));
    const gh = lines[lines.length - 1];
    const cols = `repeating-linear-gradient(90deg, rgba(29,107,243,.09) 0 ${g.colW}px, transparent ${g.colW}px ${g.step}px)`;
    gridUi = html`<div class=${`bk-grid${view ? '' : ' kept'}`} style=${`${rel({ x: g.x, y: g.y, w: g.w, h: gh })};background-image:${cols}`}>
        ${lines.map((y, i) => html`<div key=${i} class="bk-row" style=${`top:${px(y)}`}></div>`)}
      </div>
      ${view ? html`
        ${view.targets.map(([id, p]) => {
          const c = cellRect(g, p);
          return html`<div key=${`g-${id}`} class="bk-ghost" style=${rel({ x: g.x + c.x, y: g.y + c.y, w: c.w, h: c.h })}>${view.label ? html`<span class="bk-size">${view.label}</span>` : null}</div>`;
        })}
        ${view.guides.map((gd, i) => (gd.v
          ? html`<div key=${`gd-${i}`} class="bk-guide v" style=${`left:${px(g.x + gd.at - f.x)};top:${px(g.y + gd.from - f.y)};height:${px(gd.to - gd.from)}`}></div>`
          : html`<div key=${`gd-${i}`} class="bk-guide h" style=${`left:${px(g.x + gd.from - f.x)};top:${px(g.y + gd.at - f.y)};width:${px(gd.to - gd.from)}`}></div>`))}
        ${view.center ? html`<div class="bk-center" style=${`left:${px(g.x + g.w / 2 - f.x)};top:${px(g.y - f.y)};height:${px(gh)}`}></div>` : null}` : null}`;
  }
  const marqueeUi = marquee ? html`<div class="bk-marquee" style=${rel(marquee.rect)}></div>` : null;

  // "+ ADD BLOCK" at the section's top left, on its edge so it hides as little
  // of the blocks there as possible. Not in phone view, which (as in
  // Squarespace) is for arranging the blocks, not adding them.
  let add = null;
  const sr = !busy && !typing && !g.phone && rectInStage(sectionEl(sid));
  if (sr && sr.y + sr.h > f.y + 40 && sr.y < f.y + f.h - 40) {
    const pill = { x: Math.max(sr.x + 8, f.x + 8), y: Math.max(sr.y - 14, f.y + 8), w: 124, h: 28 };
    for (const z of zones) if (overlaps(pill, z)) pill.y = z.y + z.h + 6;
    zones.push(pill);
    add = html`<button type="button" class="bk-add" style=${`left:${px(pill.x)};top:${px(pill.y)}`}
      onClick=${e => openAddMenu(e.currentTarget, sid)}><${Icon} name="plus" size=${13} /> ADD BLOCK</button>`;
  }

  // The block toolbar (hidden while typing, so the text toolbar can sit above the block).
  let tools = null;
  let pop = null;
  if (!busy && !typing && selRects.length) {
    const box = single ? rects.get(single) : union(selRects);
    const b = single ? blocks.find(x => x.id === single) : null;
    const rest = blocks.filter(o => !ids.includes(o.id));
    const overlapping = ids.some(id => rest.some(o => overlaps(shown.get(id), shown.get(o.id))));
    const isPop = kind => !!(u.pop && u.pop.kind === kind && u.pop.sectionId === sid && (kind === 'layers' || u.pop.blockId === single));
    const togglePop = kind => setUi({ pop: isPop(kind) ? null : { kind, sectionId: sid, blockId: single } });
    const btns = [];
    if (b) {
      btns.push(html`<${IconButton} small icon="pencil" label="Edit" onClick=${() => openBlockPanel(sid, b.id)} />`);
      btns.push('sep');
      const av = b.alignV === 'middle' ? 'vMiddle' : b.alignV === 'bottom' ? 'vBottom' : 'vTop';
      btns.push(html`<${TB} icon=${av} label="Content alignment" active=${isPop('align')} onClick=${() => togglePop('align')} />`);
      if (b.kind === 'image' || b.kind === 'button') {
        btns.push(html`<${TB} icon="link" label=${(b.kind === 'button' ? b.url : b.link) ? 'Edit link' : 'Add link'} active=${isPop('link')} onClick=${() => togglePop('link')} />`);
      }
    } else {
      btns.push(html`<span class="bk-count">${ids.length} blocks</span>`);
      btns.push('sep');
    }
    if (overlapping) {
      btns.push(html`<${TB} icon="forward" label="Move forward (⇧↑)" onClick=${() => arrange(sid, ids, 'forward')} />`);
      btns.push(html`<${TB} icon="backward" label="Move backward (⇧↓)" onClick=${() => arrange(sid, ids, 'backward')} />`);
    }
    if (b && b.kind === 'text') btns.push(html`<${TB} icon="bucket" label="Style background" onClick=${() => openBlockPanel(sid, b.id, 'background')} />`);
    if (btns[btns.length - 1] !== 'sep') btns.push('sep');
    btns.push(html`<${TB} icon="layers" label="Layers" active=${isPop('layers')} onClick=${() => togglePop('layers')} />`);
    btns.push(html`<${IconButton} small icon="copy" label="Duplicate (⌘D)" onClick=${() => duplicateBlocks(sid, ids)} />`);
    btns.push(html`<${IconButton} small icon="trash" label="Delete" onClick=${() => deleteBlocks(sid, ids)} />`);
    const nBtns = btns.filter(x => x !== 'sep').length;
    const TW = 10 + nBtns * 30 + btns.filter(x => x === 'sep').length * 7 + (b ? 0 : 50);
    const TH = 38;
    // Above the block if there is room, else below it; slid right of anything in the way.
    const clampX = x => Math.max(f.x + 6, Math.min(x, f.x + f.w - TW - 6));
    const fits = (x, y) => y >= f.y + 6 && y + TH <= f.y + f.h - 6 && !zones.some(z => overlaps({ x, y, w: TW, h: TH }, z));
    const place = y => {
      let x = clampX(box.x);
      for (let i = 0; i < 4 && !fits(x, y); i++) {
        const z = zones.find(zz => overlaps({ x, y, w: TW, h: TH }, zz));
        if (!z || clampX(z.x + z.w + 8) === x) break;
        x = clampX(z.x + z.w + 8);
      }
      return fits(x, y) ? { x, y } : null;
    };
    const spot = place(box.y - TH - 8) || place(box.y + box.h + 8) || { x: clampX(box.x), y: Math.max(f.y + 6, Math.min(box.y + 6, f.y + f.h - TH - 6)) };
    const left = spot.x;
    const top = spot.y;
    tools = html`<div class="bk-tools" style=${`left:${px(left)};top:${px(top)}`} onMouseDown=${e => e.stopPropagation()}>
      ${btns.map(x => (x === 'sep' ? html`<span class="bk-sep"></span>` : x))}
    </div>`;
    if (u.pop && u.pop.sectionId === sid) {
      const PW = u.pop.kind === 'layers' ? 300 : u.pop.kind === 'link' ? 300 : 200;
      const PH = u.pop.kind === 'layers' ? Math.min(380, 58 + blocks.length * 38) : u.pop.kind === 'link' ? 200 : (b && b.kind === 'text' ? 132 : 76);
      const pl = Math.max(f.x + 6, Math.min(left, f.x + f.w - PW - 6));
      const pt = top + TH + 6 + PH <= f.y + f.h - 6 ? top + TH + 6 : Math.max(f.y + 6, top - PH - 6);
      const style = `left:${px(pl)};top:${px(pt)};width:${PW}px`;
      if (u.pop.kind === 'layers') pop = html`<${LayersPop} section=${section} ids=${ids} site=${site} phone=${g.phone} style=${style} />`;
      else if (b && u.pop.kind === 'align' && u.pop.blockId === b.id) pop = html`<${AlignPop} sectionId=${sid} block=${b} style=${style} />`;
      else if (b && u.pop.kind === 'link' && u.pop.blockId === b.id) pop = html`<${LinkPop} sectionId=${sid} block=${b} style=${style} />`;
    }
  }

  return html`<div class="bk-layer" ref=${layer}>
    <div class="bk-clip" style=${`left:${px(f.x)};top:${px(f.y)};width:${px(f.w)};height:${px(f.h)}`}>
      ${outlines}${gridUi}${hoverUi}${selUi}${tags}${marqueeUi}
    </div>
    ${add}${tools}${pop}
    ${view ? html`<div class="bk-shield" style=${`cursor:${view.mode === 'move' ? 'grabbing' : CURSORS[view.handle]}`}></div>` : null}
  </div>`;
}

// ---------- toolbar popovers ----------

const VALIGN = [['top', 'vTop', 'Top'], ['middle', 'vMiddle', 'Middle'], ['bottom', 'vBottom', 'Bottom']];
const HALIGN = [['left', 'alignLeft', 'Left'], ['center', 'alignCenter', 'Center'], ['right', 'alignRight', 'Right'], ['justify', 'justify', 'Justified']];

function AlignPop({ sectionId, block, style }) {
  const set = (patch, label) => setBlockProps(sectionId, block.id, patch, label);
  const v = block.alignV || 'top';
  const h = block.textAlign || 'left';
  return html`<div class="bk-pop bk-alignpop" style=${style}>
    <div class="bk-pop-lbl">Vertical alignment</div>
    <div class="bk-pop-btns">${VALIGN.map(([val, icon, label]) => html`<${TB} icon=${icon} label=${label} active=${v === val} onClick=${() => set({ alignV: val }, 'content alignment')} />`)}</div>
    ${block.kind === 'text' ? html`
      <div class="bk-pop-lbl">Text alignment</div>
      <div class="bk-pop-btns">${HALIGN.map(([val, icon, label]) => html`<${TB} icon=${icon} label=${label} active=${h === val} onClick=${() => set({ textAlign: val }, 'text alignment')} />`)}</div>` : null}
  </div>`;
}

// Bare web addresses get https://, email addresses mailto:. Page files stay as they are.
function tidyLink(v) {
  const s = String(v || '').trim();
  if (!s || /^(https?:|mailto:|tel:|#|\/|\.)/i.test(s) || /^[\w-]+\.html?([#?].*)?$/i.test(s)) return s;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return `mailto:${s}`;
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(s)) return `https://${s}`;
  return s;
}

function LinkPop({ sectionId, block, style }) {
  const key = block.kind === 'button' ? 'url' : 'link';
  const value = block[key] || '';
  const set = (patch, label) => setBlockProps(sectionId, block.id, patch, label);
  return html`<div class="bk-pop bk-linkpop" style=${style}>
    <div class="bk-pop-lbl">Link</div>
    <${LinkInput} value=${value} onChange=${v => set({ [key]: tidyLink(v) }, block.kind === 'button' ? 'button link' : 'image link')} />
    <${Toggle} label="Open in new tab" checked=${!!block.newTab} onChange=${v => set({ newTab: v }, 'open in new tab')} />
    <div class="bk-pop-foot">
      ${value ? html`<button type="button" class="linkbtn" onClick=${() => set({ [key]: '', newTab: false }, 'remove link')}>Remove link</button>` : html`<span></span>`}
      <${Button} small onClick=${() => setUi({ pop: null })}>Done<//>
    </div>
  </div>`;
}

// Layers: the section's blocks, top layer first. Drag to restack; the eyes hide a
// block on desktop or on phones.
function LayersPop({ section, ids, site, phone, style }) {
  const blocks = section.blocks || [];
  const n = blocks.length;
  const list = [...blocks].reverse();
  const item = useReorder((from, to) => {
    editBlocks(section.id, sec => { moveItem(sec.blocks, n - 1 - from, n - 1 - to); }, { label: 'reorder layers' });
  });
  return html`<div class="bk-pop bk-layers" style=${style} onMouseLeave=${() => setUi({ hover: null })}>
    <div class="bk-pop-head"><b>Layers</b><span class="bk-pop-sub">Top layer first. Drag to reorder.</span>
      <${IconButton} small icon="x" label="Close" onClick=${() => setUi({ pop: null, hover: null })} /></div>
    <ul class="bk-lyr">
      ${list.map((b, i) => {
        const p = item(i);
        const off = phone ? b.hideMobile : b.hideDesktop;
        return html`<li key=${b.id} class=${`bk-lyr-row${ids.includes(b.id) ? ' sel' : ''}${off ? ' off' : ''} ${p.class}`}
          draggable=${p.draggable} onDragStart=${p.onDragStart} onDragEnd=${p.onDragEnd} onDragOver=${p.onDragOver} onDrop=${p.onDrop}
          onMouseEnter=${() => setUi({ hover: b.id })}
          onClick=${e => { if (!e.target.closest('button')) select(section.id, [b.id]); }}>
          <span class="bk-lyr-grip"><${Icon} name="grip" size=${14} /></span>
          <span class="bk-lyr-ic"><${BIcon} name=${ICON_OF[b.kind] || 'plus'} size=${16} /></span>
          <span class="bk-lyr-nm"><b>${BLOCK_TYPES[b.kind]?.label || 'Block'}</b><span>${snippet(b, site)}</span></span>
          <button type="button" class=${`bk-eye${b.hideDesktop ? ' off' : ''}`} title=${b.hideDesktop ? 'Show on desktop' : 'Hide on desktop'}
            aria-label=${b.hideDesktop ? 'Show on desktop' : 'Hide on desktop'} onClick=${() => setHidden(section.id, [b.id], 'desktop', !b.hideDesktop)}><${Icon} name="desktop" size=${15} /></button>
          <button type="button" class=${`bk-eye${b.hideMobile ? ' off' : ''}`} title=${b.hideMobile ? 'Show on mobile' : 'Hide on mobile'}
            aria-label=${b.hideMobile ? 'Show on mobile' : 'Hide on mobile'} onClick=${() => setHidden(section.id, [b.id], 'mobile', !b.hideMobile)}><${Icon} name="mobile" size=${15} /></button>
        </li>`;
      })}
    </ul>
  </div>`;
}

// ---------- Edit Block panel ----------

const plainOptions = list => list.map(([value, label]) => ({ value, label }));
const ALIGN3 = [
  { value: 'left', label: 'Left', icon: 'alignLeft', iconOnly: true },
  { value: 'center', label: 'Center', icon: 'alignCenter', iconOnly: true },
  { value: 'right', label: 'Right', icon: 'alignRight', iconOnly: true },
];
const ALIGN4 = [...ALIGN3, { value: 'justify', label: 'Justified', icon: 'justify', iconOnly: true }];

// Tabs like Squarespace's block editors; the first one opens unless asked otherwise.
const TABS = {
  text: [['design', 'Design'], ['background', 'Background']],
  image: [['content', 'Content'], ['design', 'Design']],
  button: [['content', 'Content'], ['design', 'Design']],
  video: [['content', 'Content']],
  quote: [['content', 'Content']],
  embed: [['content', 'Content']],
  form: [['content', 'Content'], ['storage', 'Storage'], ['advanced', 'Advanced']],
  social: [['content', 'Content'], ['design', 'Design']],
  map: [['location', 'Location'], ['design', 'Design']],
  accordion: [['content', 'Content'], ['design', 'Design']],
};

export function BlockPanel({ sectionId, blockId, onClose }) {
  const site = useStore(s => s.site);
  const ep = useStore(s => s.editPanel);
  const body = useRef(null);
  const hit = findSection(site, sectionId);
  const sec = hit ? hit.section : null;
  const block = sec && Array.isArray(sec.blocks) ? sec.blocks.find(b => b.id === blockId) : null;
  const tabs = block && TABS[block.kind] ? TABS[block.kind].map(([id, label]) => ({ id, label })) : null;
  const tab = tabs ? (tabs.some(t => t.id === ep?.tab) ? ep.tab : tabs[0].id) : null;
  useEffect(() => { if (!block) onClose(); }, [!block]);
  useLayoutEffect(() => { const sc = body.current?.closest('.fpanel-body'); if (sc) sc.scrollTop = 0; }, [tab]);
  if (!block) return null;
  const set = (patch, label) => setBlockProps(sectionId, blockId, patch, label);
  const upd = (fn, label, coalesce = null) => updateBlock(sectionId, blockId, fn, label, coalesce);
  const Body = BODIES[block.kind];
  return html`<${FloatingPanel} title=${BLOCK_TYPES[block.kind]?.label || 'Block'} onClose=${onClose}
    tabs=${tabs} tab=${tab} onTab=${id => setState({ editPanel: { ...getState().editPanel, tab: id } })}>
    <div class="bk-panel" ref=${body}>
      ${Body ? html`<${Body} block=${block} site=${site} set=${set} upd=${upd} tab=${tab} sectionId=${sectionId} />` : null}
      <div class="subhead">Visibility</div>
      <${Toggle} label="Hide on desktop" checked=${!!block.hideDesktop} onChange=${v => set({ hideDesktop: v }, v ? 'hide on desktop' : 'show on desktop')} />
      <${Toggle} label="Hide on phones" checked=${!!block.hideMobile} onChange=${v => set({ hideMobile: v }, v ? 'hide on mobile' : 'show on mobile')} />
      <div class="bk-foot">
        <${Button} kind="secondary" small icon="trash" class="btn secondary small bk-del" onClick=${() => deleteBlocks(sectionId, [blockId])}>Delete block<//>
      </div>
    </div>
  <//>`;
}

// ---------- text ----------

function TextBody({ block, site, set, upd, tab }) {
  if (tab === 'background') return html`<${StyleBackground} block=${block} site=${site} upd=${upd} />`;
  const size = block.size ?? 'normal';
  const custom = typeof size === 'number';
  const t = site.design.text;
  const pxFor = { small: t.small, normal: t.p, large: t.large };
  return html`
    <p class="note">Type right on the page. Select words to make them bold, italic, a heading or a link.</p>
    <${Field} label="Text size" value=${custom ? `${size}px` : undefined}>
      <${Segmented} value=${custom ? 'custom' : size}
        options=${plainOptions([['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['custom', 'Custom']])}
        onChange=${v => set({ size: v === 'custom' ? (custom ? size : (pxFor[size] || t.p || 16)) : v }, 'text size')} />
    <//>
    ${custom ? html`<${Field}><${Slider} value=${size} min=${10} max=${72} unit="px" onChange=${v => set({ size: v }, 'text size')} /><//>` : null}
    <${Field} label="Line spacing">
      <${Segmented} value=${block.lineHeight || 'normal'} options=${plainOptions([['tight', 'Tight'], ['normal', 'Normal'], ['loose', 'Loose']])}
        onChange=${v => set({ lineHeight: v }, 'line spacing')} />
    <//>
    <${Field} label="Text alignment">
      <${Segmented} value=${block.textAlign || 'left'} options=${ALIGN4} onChange=${v => set({ textAlign: v }, 'text alignment')} />
    <//>
    <${Field} label="Vertical alignment" help="Where the text sits when the block is taller than its words.">
      <${Segmented} value=${block.alignV || 'top'} options=${plainOptions([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']])}
        onChange=${v => set({ alignV: v }, 'content alignment')} />
    <//>`;
}

const DEFAULT_STYLE = { bg: '#f2f2f0', radius: 0, padding: 24, stroke: '', strokeColor: '#111111', strokeWidth: 1 };
const lastStyle = new Map(); // block id -> its style before the background was switched off

// Squarespace's "Style background" for text blocks.
function StyleBackground({ block, site, upd }) {
  const st = block.style || null;
  const on = !!st;
  const change = (patch, label = 'style background') => upd(b => { b.style = { ...DEFAULT_STYLE, ...(b.style || {}), ...patch }; }, label, `style:${block.id}:${Object.keys(patch).join(',')}`);
  const toggle = v => {
    if (v) upd(b => { b.style = { ...(lastStyle.get(block.id) || DEFAULT_STYLE) }; }, 'style background');
    else { lastStyle.set(block.id, st); upd(b => { b.style = null; }, 'remove background'); }
  };
  const c = site.design.colors;
  const swatches = [...new Set(['#f2f2f0', '#ffffff', c.background, c.line, c.muted, c.text, c.accent].filter(Boolean).map(x => x.toLowerCase()))];
  return html`
    <${Toggle} label="Background" help="A colored box behind the text." checked=${on} onChange=${toggle} />
    ${on ? html`
      <${Field} label="Color">
        <${ColorInput} value=${st.bg || '#f2f2f0'} onChange=${v => change({ bg: v }, 'background color')} />
        <div class="bk-swatches">${swatches.map(col => html`<button type="button" class=${`bk-sw${(st.bg || '').toLowerCase() === col ? ' on' : ''}`} style=${`background:${col}`}
          title=${col} aria-label=${`Color ${col}`} onClick=${() => change({ bg: col }, 'background color')}></button>`)}</div>
      <//>
      <${Field} label="Corner radius" value=${`${st.radius || 0}px`}>
        <${Slider} value=${st.radius || 0} min=${0} max=${60} unit="px" onChange=${v => change({ radius: v }, 'corner radius')} />
      <//>
      <${Field} label="Padding" value=${`${st.padding || 0}px`}>
        <${Slider} value=${st.padding || 0} min=${0} max=${80} unit="px" onChange=${v => change({ padding: v }, 'padding')} />
      <//>
      <${Field} label="Stroke">
        <${Segmented} value=${st.stroke || ''} options=${plainOptions([['', 'None'], ['solid', 'Solid'], ['dotted', 'Dotted']])} onChange=${v => change({ stroke: v }, 'stroke')} />
      <//>
      ${st.stroke ? html`
        <${Field} label="Stroke color"><${ColorInput} value=${st.strokeColor || '#111111'} onChange=${v => change({ strokeColor: v }, 'stroke color')} /><//>
        <${Field} label="Thickness" value=${`${st.strokeWidth || 1}px`}>
          <${Slider} value=${st.strokeWidth || 1} min=${1} max=${10} unit="px" onChange=${v => change({ strokeWidth: v }, 'stroke thickness')} />
        <//>` : null}` : null}`;
}

// ---------- image ----------

function ImageBody({ block, site, set, upd, tab, sectionId }) {
  const m = site.media[block.media];
  const fit = block.fit === 'original' ? 'original' : block.fit === 'fit' || block.fit === 'contain' ? 'fit' : 'fill';
  if (tab === 'design') {
    const radius = Number(block.style?.radius) || 0;
    return html`
      <${Field} label="Image fit" help=${fit === 'original' ? 'The image keeps its own shape; the block follows its height. Best for artwork.'
        : fit === 'fill' ? 'The image fills the block and is cropped to fit. Set the focal point in Content.' : 'The whole image shows inside the block.'}>
        <${Segmented} value=${fit} options=${plainOptions([['original', 'Original'], ['fill', 'Fill'], ['fit', 'Fit']])} onChange=${v => set({ fit: v }, 'image fit')} />
      <//>
      <${Field} label="Corner radius" value=${`${radius}px`}>
        <${Slider} value=${radius} min=${0} max=${100} unit="px" onChange=${v => upd(b => {
          const st = { ...(b.style || {}), radius: v };
          b.style = Object.values(st).some(x => x) ? st : null;
        }, 'corner radius', `radius:${block.id}`)} />
      <//>`;
  }
  const focal = Array.isArray(block.focal) ? block.focal : [50, 50];
  return html`
    <${Field} label="Image"><${ImageField} value=${block.media} onChange=${id => set({ media: id }, id ? 'replace image' : 'remove image')} /><//>
    ${m ? html`
      ${fit !== 'original' ? html`<${Field} label="Focal point" value=${`${focal[0]}%, ${focal[1]}%`}
        help=${fit === 'fill' ? 'Click the part of the image that should always stay in view when the block crops it.' : 'Where the image sits inside the block.'}>
        <${FocalPicker} media=${m} focal=${focal} onChange=${v => set({ focal: v }, 'focal point')} />
      <//>` : null}
      <${Field} label="Alt text" help="Describes the image for people who use screen readers. Leave it empty to use the alt text from the Asset Library.">
        <${TextInput} value=${block.alt || ''} placeholder=${m.alt || 'Describe the image'} onChange=${v => set({ alt: v }, 'alt text')} />
      <//>
      <${Field} label="Caption" help="Shown under the image. Select words and click I for italics.">
        <${CaptionInput} value=${block.caption || ''} onChange=${v => set({ caption: v }, 'caption')} />
        ${!block.caption && m.caption ? html`<button type="button" class="linkbtn bk-usecap" onClick=${() => set({ caption: m.caption }, 'caption')}>Use the caption from the Asset Library</button>` : null}
      <//>
      ${block.caption ? html`<${Field} label="Caption size">
        <${Segmented} value=${block.captionStyle === 'small' ? 'small' : 'normal'} options=${plainOptions([['normal', 'Normal'], ['small', 'Small']])}
          onChange=${v => set({ captionStyle: v }, 'caption size')} />
      <//>` : null}
      <div class="subhead">Clicking the image</div>
      <${Field} label="Link" help="Optional. Clicking the image opens this page or website.">
        <${LinkInput} value=${block.link || ''} onChange=${v => set({ link: tidyLink(v) }, 'image link')} />
      <//>
      ${block.link ? html`<${Toggle} label="Open in new tab" checked=${!!block.newTab} onChange=${v => set({ newTab: v }, 'open in new tab')} />`
        : html`<${Toggle} label="Lightbox" help="Clicking the image opens it larger, on its own." checked=${!!block.lightbox} onChange=${v => set({ lightbox: v }, 'lightbox')} />`}`
    : html`<p class="help bk-under">You can also drop an image file from your computer onto the block.</p>
      <${Button} small kind="secondary" icon="image" onClick=${() => chooseImage(sectionId, block.id)}>Choose an image<//>`}`;
}

function chooseImage(sectionId, blockId) {
  openModal('mediaPicker', {
    onPick: id => {
      const media = Array.isArray(id) ? id[0] : id;
      if (media) setBlockProps(sectionId, blockId, { media }, 'choose image');
    },
  });
}

// ---------- button, video, quote, code, line ----------

function ButtonBody({ block, set, tab }) {
  if (tab === 'design') {
    return html`
      <${Field} label="Style">
        <${Segmented} value=${block.style || 'outline'} options=${plainOptions([['outline', 'Outline'], ['solid', 'Solid'], ['link', 'Text link']])}
          onChange=${v => set({ style: v }, 'button style')} />
      <//>
      <${Field} label="Alignment">
        <${Segmented} value=${block.buttonAlign || 'left'} options=${ALIGN3} onChange=${v => set({ buttonAlign: v }, 'button alignment')} />
      <//>
      <p class="help">Colors, corners and capitals for every button are in Site Styles, under Buttons.</p>`;
  }
  return html`
    <${Field} label="Button text"><${TextInput} value=${block.label || ''} placeholder="Learn more" onChange=${v => set({ label: v }, 'button text')} /><//>
    <${Field} label="Link"><${LinkInput} value=${block.url || ''} onChange=${v => set({ url: tidyLink(v) }, 'button link')} /><//>
    <${Toggle} label="Open in new tab" checked=${!!block.newTab} onChange=${v => set({ newTab: v }, 'open in new tab')} />`;
}

function VideoBody({ block, set }) {
  const bad = block.url && !videoEmbedUrl(block.url);
  return html`
    <${Field} label="YouTube or Vimeo link"
      help=${bad ? 'This does not look like a YouTube or Vimeo video link yet.' : 'Open the video on YouTube or Vimeo, copy the address from the address bar, and paste it here.'}>
      <${TextInput} value=${block.url || ''} placeholder="https://www.youtube.com/watch?v=…" onChange=${v => set({ url: v.trim() }, 'video link')} />
    <//>`;
}

function QuoteBody({ block, set }) {
  return html`
    <p class="note">Type the quotation right on the page.</p>
    <${Field} label="Attribution" help="Who said or wrote it. Shown under the quotation.">
      <${TextInput} value=${block.attribution || ''} placeholder="Name" onChange=${v => set({ attribution: v }, 'attribution')} />
    <//>`;
}

function EmbedBody({ block, set }) {
  return html`
    <${Field} label="Code" help="Paste the code another website gives you, for example a sign-up form. It works on the live site; in the editor it is shown but can't be clicked.">
      <${TextInput} multiline rows=${8} mono value=${block.html || ''} placeholder="<iframe …></iframe>" onChange=${v => set({ html: v }, 'code')} />
    <//>`;
}

function LineBody() {
  return html`<p class="note">A thin horizontal line in the color of your site's lines. Drag its handles on the page to make it longer or shorter.</p>`;
}

// ---------- form ----------

function FormBody({ block, site, set, upd, tab }) {
  if (tab === 'storage') {
    const own = String(block.endpoint || '').trim();
    const fallback = String(site.settings.formEndpoint || '').trim();
    let status;
    if (own && !/^https:\/\/\S+$/.test(own)) status = html`<p class="note warn">The address should start with https://</p>`;
    else if (own) status = html`<p class="note ok"><${Icon} name="check" size=${14} /> The form is on. Messages go to the address below.</p>`;
    else if (fallback) status = html`<p class="note ok"><${Icon} name="check" size=${14} /> The form is on. It uses the form address from Settings.</p>`;
    else status = html`<p class="note warn">The form is off until it has an address. Add your form address in Settings → Contact form (every form on the site uses it), or paste one below for this form only.</p>`;
    return html`${status}
      <p class="help bk-under">Messages are sent to your email through Formspree, a free service.</p>
      <${Field} label="Form address for this form" help="Optional. Leave it empty to use the address from Settings.">
        <${TextInput} value=${block.endpoint || ''} placeholder=${fallback || 'https://formspree.io/f/…'} onChange=${v => set({ endpoint: v.trim() }, 'form address')} />
      <//>`;
  }
  if (tab === 'advanced') {
    return html`<${Field} label="Post-submit message" help="Shown in place of the form once a message is sent.">
      <${TextInput} multiline rows=${3} value=${block.successMessage || ''} placeholder="Thank you! Your message has been sent." onChange=${v => set({ successMessage: v }, 'post-submit message')} />
    <//>`;
  }
  const f = block.fields || {};
  const setField = (k, v) => upd(b => { b.fields = { ...(b.fields || {}), [k]: v }; }, 'form fields');
  return html`
    <div class="subhead">Fields</div>
    <${Toggle} label="Name" checked=${!!f.name} onChange=${v => setField('name', v)} />
    <${Toggle} label="Email" help=${f.email ? null : 'Without it you cannot reply to messages.'} checked=${!!f.email} onChange=${v => setField('email', v)} />
    <${Toggle} label="Subject" checked=${!!f.subject} onChange=${v => setField('subject', v)} />
    <${Toggle} label="Message" checked=${!!f.message} onChange=${v => setField('message', v)} />
    <div class="subhead">Button</div>
    <${Field} label="Button label"><${TextInput} value=${block.buttonLabel || ''} placeholder="Send" onChange=${v => set({ buttonLabel: v }, 'button label')} /><//>`;
}

// ---------- social links ----------

const PLATFORMS = Object.entries(SOCIAL).map(([value, p]) => ({ value, label: p.label }));
const PLACEHOLDERS = {
  instagram: 'instagram.com/yourname', facebook: 'facebook.com/yourpage', x: 'x.com/yourname', tiktok: 'tiktok.com/@yourname',
  youtube: 'youtube.com/@yourchannel', vimeo: 'vimeo.com/yourname', linkedin: 'linkedin.com/in/yourname', pinterest: 'pinterest.com/yourname',
  email: 'you@example.com',
};

// A row of a list that can be dragged by its grip (only the grip, so the text
// boxes in it still work with the mouse).
function useGripReorder(onMove) {
  const item = useReorder(onMove);
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    const up = () => setArmed(null);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  return (index, id) => {
    const p = item(index);
    return {
      row: {
        class: p.class, draggable: armed === id, onDragStart: p.onDragStart, onDragOver: p.onDragOver, onDrop: p.onDrop,
        onDragEnd: e => { p.onDragEnd(e); setArmed(null); },
      },
      grip: { onMouseDown: () => setArmed(id) },
    };
  };
}

function SocialBody({ block, set, upd, tab }) {
  if (tab === 'design') {
    return html`
      <${Field} label="Icon size">
        <${Segmented} value=${block.size || 'medium'} options=${plainOptions([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])} onChange=${v => set({ size: v }, 'icon size')} />
      <//>
      <${Field} label="Alignment">
        <${Segmented} value=${block.socialAlign || 'left'} options=${ALIGN3} onChange=${v => set({ socialAlign: v }, 'alignment')} />
      <//>
      <p class="help">The icons use your site's title color, from Site Styles.</p>`;
  }
  return html`<${SocialLinks} block=${block} upd=${upd} />`;
}

function SocialLinks({ block, upd }) {
  const links = block.links || [];
  const drag = useGripReorder((from, to) => upd(b => { moveItem(b.links, from, to); }, 'reorder links'));
  const setLink = (id, patch, label) => upd(b => { const l = (b.links || []).find(x => x.id === id); if (l) Object.assign(l, patch); }, label, `social:${id}:${Object.keys(patch).join(',')}`);
  const add = () => upd(b => {
    b.links = b.links || [];
    const used = new Set(b.links.map(l => l.platform));
    b.links.push({ id: uid('sl'), platform: Object.keys(SOCIAL).find(p => !used.has(p)) || 'instagram', url: '' });
  }, 'add link');
  return html`
    <p class="help bk-under">Paste the address of each profile. Links without an address do not show on your site.</p>
    <ul class="bk-items">
      ${links.map((l, i) => {
        const d = drag(i, l.id);
        const bad = l.url && !socialHref(l);
        return html`<li key=${l.id} class=${`bk-item ${d.row.class}`} draggable=${d.row.draggable} onDragStart=${d.row.onDragStart}
          onDragEnd=${d.row.onDragEnd} onDragOver=${d.row.onDragOver} onDrop=${d.row.onDrop}>
          <div class="bk-item-head">
            <span class="bk-grip" title="Drag to reorder" ...${d.grip}><${Icon} name="grip" size=${14} /></span>
            <${Select} value=${l.platform} options=${PLATFORMS} onChange=${v => setLink(l.id, { platform: v }, 'social platform')} />
            <${IconButton} small icon="trash" label="Remove link" onClick=${() => upd(b => { b.links = (b.links || []).filter(x => x.id !== l.id); }, 'remove link')} />
          </div>
          <${TextInput} value=${l.url || ''} placeholder=${PLACEHOLDERS[l.platform] || 'https://'} onChange=${v => setLink(l.id, { url: v.trim() }, 'social link')} />
          ${bad ? html`<p class="help bk-bad">${l.platform === 'email' ? 'This does not look like an email address yet.' : 'This does not look like a web address.'}</p>` : null}
        </li>`;
      })}
    </ul>
    <${Button} small kind="secondary" icon="plus" onClick=${add}>Add link<//>`;
}

// ---------- map ----------

function MapBody({ block, set, tab }) {
  if (tab === 'design') {
    const zoom = Math.max(1, Math.min(20, Math.round(Number(block.zoom) || 14)));
    return html`<${Field} label="Zoom" value=${zoom} help="Low numbers show a whole region, high numbers a few streets.">
      <${Slider} value=${zoom} min=${1} max=${20} onChange=${v => set({ zoom: v }, 'map zoom')} />
    <//>`;
  }
  return html`<${Field} label="Address" help="A street address or the name of a place, as you would type it into Google Maps.">
    <${TextInput} value=${block.address || ''} placeholder="Street, city" onChange=${v => set({ address: v }, 'map address')} />
  <//>`;
}

// ---------- accordion ----------

function AccordionBody({ block, set, upd, tab }) {
  if (tab === 'design') {
    return html`
      <${Toggle} label="Dividers" help="Thin lines between the items." checked=${block.dividers !== false} onChange=${v => set({ dividers: v }, 'dividers')} />
      <${Field} label="Icon">
        <${Segmented} value=${block.icon === 'arrow' ? 'arrow' : 'plus'} options=${plainOptions([['plus', 'Plus'], ['arrow', 'Arrow']])} onChange=${v => set({ icon: v }, 'accordion icon')} />
      <//>
      <${Toggle} label="Open the first item" help="The first item starts open when the page loads." checked=${!!block.openFirst} onChange=${v => set({ openFirst: v }, 'open first item')} />`;
  }
  return html`<${AccordionItems} block=${block} upd=${upd} />`;
}

function AccordionItems({ block, upd }) {
  const items = block.items || [];
  const drag = useGripReorder((from, to) => upd(b => { moveItem(b.items, from, to); }, 'reorder items'));
  const setItem = (id, patch, label) => upd(b => { const it = (b.items || []).find(x => x.id === id); if (it) Object.assign(it, patch); }, label, `acc:${id}:${Object.keys(patch).join(',')}`);
  const add = () => upd(b => { b.items = b.items || []; b.items.push({ id: uid('ai'), title: `Item ${b.items.length + 1}`, html: '' }); }, 'add item');
  return html`
    <ul class="bk-items">
      ${items.map((it, i) => {
        const d = drag(i, it.id);
        return html`<li key=${it.id} class=${`bk-item ${d.row.class}`} draggable=${d.row.draggable} onDragStart=${d.row.onDragStart}
          onDragEnd=${d.row.onDragEnd} onDragOver=${d.row.onDragOver} onDrop=${d.row.onDrop}>
          <div class="bk-item-head">
            <span class="bk-grip" title="Drag to reorder" ...${d.grip}><${Icon} name="grip" size=${14} /></span>
            <${TextInput} value=${it.title || ''} placeholder="Title" aria-label="Item title" onChange=${v => setItem(it.id, { title: v }, 'item title')} />
            <${IconButton} small icon="trash" label="Remove item" onClick=${() => upd(b => { b.items = (b.items || []).filter(x => x.id !== it.id); }, 'remove item')} />
          </div>
          <${RichLine} value=${it.html || ''} link label="Description" placeholder="Description" onChange=${v => setItem(it.id, { html: v }, 'item description')} />
        </li>`;
      })}
    </ul>
    <${Button} small kind="secondary" icon="plus" onClick=${add}>Add item<//>`;
}

const BODIES = {
  text: TextBody, image: ImageBody, button: ButtonBody, video: VideoBody, quote: QuoteBody, embed: EmbedBody, line: LineBody,
  form: FormBody, social: SocialBody, map: MapBody, accordion: AccordionBody,
};

// ---------- small inputs ----------

// A one-line caption box that keeps italics (captions are inline HTML).
function CaptionInput({ value, onChange }) {
  const ref = useRef(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !focused.current && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);
  const read = () => onChange(sanitizeInline(ref.current.innerHTML));
  return html`<div class="bk-cap">
    <div class="input bk-cap-text" ref=${ref} contenteditable="true" role="textbox" aria-label="Caption" data-placeholder="Add a caption"
      onFocus=${() => { focused.current = true; }}
      onBlur=${() => {
        focused.current = false;
        const clean = sanitizeInline(ref.current.innerHTML);
        if (ref.current.innerHTML !== clean) ref.current.innerHTML = clean;
      }}
      onInput=${read}
      onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); read(); } }}
      onPaste=${e => {
        e.preventDefault();
        document.execCommand('insertHTML', false, pasteToInline(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain')));
        read();
      }}></div>
    <button type="button" class="bk-ital" title="Italic (⌘I)" aria-label="Italic"
      onMouseDown=${e => { e.preventDefault(); ref.current.focus(); document.execCommand('italic'); read(); }}><i>I</i></button>
  </div>`;
}

// Click (or drag) on the image to choose the point that stays in view when it is cropped.
function FocalPicker({ media, focal, onChange }) {
  const ref = useRef(null);
  const last = useRef(focal);
  last.current = focal;
  const ratio = media.w && media.h ? media.w / media.h : 4 / 3;
  let w = 308;
  let h = w / ratio;
  if (h > 210) { h = 210; w = h * ratio; }
  const put = v => {
    const next = [Math.round(Math.min(100, Math.max(0, v[0]))), Math.round(Math.min(100, Math.max(0, v[1])))];
    if (next[0] !== last.current[0] || next[1] !== last.current[1]) { last.current = next; onChange(next); }
  };
  const at = e => {
    const r = ref.current.getBoundingClientRect();
    put([((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100]);
  };
  const down = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    ref.current.focus();
    at(e);
    const move = ev => at(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const key = e => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    put([focal[0] + d[0], focal[1] + d[1]]);
  };
  return html`<div class="bk-focal" ref=${ref} tabindex="0" role="slider" aria-label="Focal point" aria-valuetext=${`${focal[0]}% across, ${focal[1]}% down`}
    style=${`width:${Math.round(w)}px;height:${Math.round(h)}px`} onPointerDown=${down} onKeyDown=${key}>
    <img src=${mediaPreviewUrl(media, 'medium')} alt="" draggable="false" />
    <span class="bk-dot" style=${`left:${focal[0]}%;top:${focal[1]}%`}></span>
  </div>`;
}
