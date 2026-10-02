// Drawn over the preview in edit mode: section outlines and toolbars,
// "+ ADD SECTION" pills, "EDIT SITE HEADER", drop indicators, and dragging
// sections to a new position.

import { html, useState, useEffect, useRef, Icon, IconButton } from './ui.js';
import { useStore, getState, setState, openModal } from './store.js';
import { moveSection, duplicateSection, deleteSection, moveSectionTo, currentPage, saveSectionForReuse } from './actions.js';
import { events, rectInStage, sectionEl, sectionEls, frameDoc, activeField } from './preview.js';
import { SECTION_TYPES } from '../engine/schema.js';
import { BlockOverlay, openAddMenu } from './panels/blocks.js';

function useTick() {
  const [, setN] = useState(0);
  return () => setN(n => n + 1);
}

export function Overlay() {
  const selection = useStore(s => s.selection);
  const editPanel = useStore(s => s.editPanel);
  const pageId = useStore(s => s.pageId);
  const revision = useStore(s => s.revision);
  const [hover, setHover] = useState({ sectionId: null, zone: null });
  const [drop, setDrop] = useState(null);
  const [dragging, setDragging] = useState(null); // { sectionId, index }
  const [typing, setTyping] = useState(false);
  const tick = useTick();

  useEffect(() => {
    const offs = [
      events.on('hover', h => { if (h) setHover(h); }),
      events.on('layout', tick),
      events.on('scroll', tick),
      // A reloaded page has nothing focused, and no focusout fires for the old one.
      events.on('load', () => { setHover({ sectionId: null, zone: null }); setTyping(false); tick(); }),
      events.on('drop-target', setDrop),
      events.on('focus', () => setTyping(!!activeField())),
    ];
    return () => offs.forEach(f => f());
  }, []);

  if (!frameDoc()) return null;
  const page = currentPage();
  if (!page) return null;

  const shownId = dragging ? dragging.sectionId : (hover.sectionId || selection?.sectionId);
  const els = sectionEls();
  const boxes = [];
  const pills = [];
  let tools = null;

  const selEl = selection?.sectionId ? sectionEl(selection.sectionId) : null;
  if (selEl) {
    const r = rectInStage(selEl);
    if (r) boxes.push(html`<div class="ov-box selected" style=${`left:${r.x - 1}px;top:${r.y - 1}px;width:${r.w + 2}px;height:${r.h + 2}px`}></div>`);
  }
  const el = shownId ? sectionEl(shownId) : null;
  if (el && !dragging) {
    const r = rectInStage(el);
    if (r) {
      if (shownId !== selection?.sectionId) boxes.push(html`<div class="ov-box" style=${`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`}></div>`);
      const index = page.sections.findIndex(s => s.id === shownId);
      const sec = page.sections[index];
      // Short sections: put the toolbar above the section so it doesn't cover the text.
      const top = r.h < 140 && r.y - r.frameTop > 52 ? r.y - 46 : Math.max(r.y + 8, r.frameTop + 8);
      const right = Math.max(8, (r.frameLeft + r.frameW) - (r.x + r.w) + 8);
      // Squarespace's section toolbar, in its order: Edit Section, Duplicate, Save, ↑, ↓, Delete.
      const isGallery = sec?.type === 'gallery';
      tools = html`<div class="ov-tools" style=${`top:${top}px;right:${right}px`} onMouseDown=${e => e.stopPropagation()}>
        ${isGallery ? html`<button type="button" class="label-btn" onClick=${() => setState({ selection: { sectionId: shownId }, editPanel: { kind: 'section', id: shownId, tab: 'images' } })}>
          <${Icon} name="image" size=${14} /> EDIT GALLERY
        </button>` : null}
        <button type="button" class="label-btn" onClick=${() => setState({ selection: { sectionId: shownId }, editPanel: { kind: 'section', id: shownId, tab: isGallery ? 'design' : null } })}>
          <${Icon} name="pencil" size=${14} /> EDIT SECTION
        </button>
        <span class="sep"></span>
        <${IconButton} small icon="copy" label="Duplicate section" onClick=${() => duplicateSection(shownId)} />
        <${IconButton} small icon="heart" label="Save section" onClick=${() => saveSectionForReuse(shownId)} />
        <${IconButton} small icon="up" label="Move section up" disabled=${index <= 0} onClick=${() => moveSection(shownId, -1)} />
        <${IconButton} small icon="down" label="Move section down" disabled=${index >= page.sections.length - 1} onClick=${() => moveSection(shownId, 1)} />
        <${IconButton} small icon="trash" label="Delete section" onClick=${() => deleteSection(shownId)} />
      </div>`;
      const cx = r.x + r.w / 2;
      pills.push(html`<button type="button" class="ov-add" style=${`left:${cx}px;top:${Math.max(r.y, r.frameTop + 16)}px`} onClick=${() => openModal('addSection', { pageId: page.id, index })}><${Icon} name="plus" size=${13} /> ADD SECTION</button>`);
      pills.push(html`<button type="button" class="ov-add" style=${`left:${cx}px;top:${Math.min(r.y + r.h, r.frameTop + r.frameH - 16)}px`} onClick=${() => openModal('addSection', { pageId: page.id, index: index + 1 })}><${Icon} name="plus" size=${13} /> ADD SECTION</button>`);
    }
  }

  // Empty page: one big button.
  if (!page.sections.length) {
    const pageEl = frameDoc().querySelector('.page');
    const r = pageEl && rectInStage(pageEl);
    if (r) pills.push(html`<button type="button" class="ov-add" style=${`left:${r.x + r.w / 2}px;top:${r.y + 80}px;height:40px;padding:0 22px;font-size:12px`} onClick=${() => openModal('addSection', { pageId: page.id, index: 0 })}><${Icon} name="plus" size=${14} /> ADD SECTION</button>`);
  }

  // Header and footer buttons.
  let zoneBtn = null;
  if (hover.zone === 'header' && !hover.sectionId) {
    const h = frameDoc().querySelector('.site-header');
    const r = h && rectInStage(h);
    if (r) zoneBtn = html`<button type="button" class="ov-zone" style=${`left:${r.x + 12}px;top:${Math.max(r.y, r.frameTop) + r.h / 2 > r.frameTop + 40 ? Math.max(r.y, r.frameTop) + 10 : r.frameTop + 10}px`} onClick=${() => setState({ editPanel: { kind: 'header' } })}><${Icon} name="pencil" size=${13} /> EDIT SITE HEADER</button>`;
  }
  if (hover.zone === 'footer' && !hover.sectionId) {
    const f = frameDoc().querySelector('.site-footer');
    const r = f && rectInStage(f);
    if (r) zoneBtn = html`<button type="button" class="ov-zone" style=${`left:${r.x + 12}px;top:${r.y + 6}px`} onClick=${() => setState({ editPanel: { kind: 'footer' } })}><${Icon} name="pencil" size=${13} /> EDIT FOOTER</button>`;
  }

  // Files dragged over the page.
  let dropEl = null;
  if (drop) {
    if (drop.kind === 'new') {
      const r = drop.el ? rectInStage(drop.el) : null;
      if (r) {
        const y = drop.after ? r.y + r.h + 12 : r.y - 12;
        dropEl = html`<div class="ov-line" style=${`left:${r.x}px;top:${y}px;width:${r.w}px`}></div>
          <div class="ov-zone" style=${`left:${r.x + r.w / 2 - 110}px;top:${y + 8}px;pointer-events:none`}>${drop.label}</div>`;
      }
    } else if (drop.kind === 'grid' && drop.ghost) {
      // The box the new image block will fill, on the section's grid.
      const r = rectInStage(drop.el);
      const g = drop.ghost;
      if (r) dropEl = html`<div class="ov-drop ov-ghost" style=${`left:${r.frameLeft + g.left}px;top:${r.frameTop + g.top}px;width:${g.width}px;height:${g.height}px`}>${drop.label}</div>`;
    } else {
      const r = rectInStage(drop.el);
      if (r) dropEl = html`<div class="ov-drop" style=${`left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`}>${drop.label}</div>`;
    }
  }

  // Line where a dragged section will land.
  let dragLine = null;
  if (dragging && dragging.index !== null) {
    const ref = els[dragging.index] || els[els.length - 1];
    const r = ref && rectInStage(ref);
    if (r) {
      const y = dragging.index >= els.length ? r.y + r.h + 6 : r.y - 6;
      dragLine = html`<div class="ov-line" style=${`left:${r.x}px;top:${y}px;width:${r.w}px`}></div>`;
    }
  }

  const blocksSel = selection && page.sections.find(s => s.id === selection.sectionId && s.type === 'blocks');

  // Every Fluid Engine section shows "+ ADD BLOCK" in its top-left corner on hover.
  let addBlock = null;
  const hoverSec = hover.sectionId && page.sections.find(s => s.id === hover.sectionId);
  if (hoverSec && hoverSec.type === 'blocks' && hoverSec.id !== blocksSel?.id && !dragging && !typing && getState().device !== 'mobile') {
    const r = rectInStage(sectionEl(hoverSec.id));
    if (r) {
      addBlock = html`<button type="button" class="ov-add ov-addblock" style=${`left:${r.x + 10}px;top:${Math.max(r.y, r.frameTop) + 10}px;transform:none`}
        onClick=${e => { setState({ selection: { sectionId: hoverSec.id } }); openAddMenu(e.currentTarget, hoverSec.id); }}><${Icon} name="plus" size=${13} /> ADD BLOCK</button>`;
    }
  }

  return html`<div class="overlay" key=${pageId}>
    ${dragging ? html`<div class="ov-shield" style="position:absolute;inset:0;pointer-events:auto;cursor:grabbing"></div>` : null}
    ${boxes}${dragLine}${dropEl}
    ${blocksSel ? html`<${BlockOverlay} section=${blocksSel} revision=${revision} />` : null}
    ${addBlock}
    ${!dragging && !typing ? pills : null}
    ${!dragging && !typing ? tools : null}
    ${zoneBtn}
  </div>`;
}

// Drag a section by its move handle; the line shows where it will land.
function startDrag(e, sectionId, page, setDragging) {
  e.preventDefault();
  const from = page.sections.findIndex(s => s.id === sectionId);
  let index = null;
  setDragging({ sectionId, index });
  const doc = frameDoc();
  const iframe = doc.defaultView.frameElement;
  // While dragging, a transparent shield covers the preview so the pointer
  // events reach this window instead of disappearing into the iframe.
  const move = ev => {
    const f = iframe.getBoundingClientRect();
    const y = ev.clientY - f.top;
    const els = sectionEls();
    let i = els.length;
    for (let k = 0; k < els.length; k++) {
      const r = els[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) { i = k; break; }
    }
    // Auto-scroll near the edges of the preview.
    if (y < 60) doc.defaultView.scrollBy(0, -18);
    else if (y > f.height - 60) doc.defaultView.scrollBy(0, 18);
    index = i;
    setDragging({ sectionId, index });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    setDragging(null);
    if (index === null) return;
    let to = index;
    if (from < to) to -= 1;
    if (to !== from) moveSectionTo(sectionId, to);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
