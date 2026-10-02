// Shared interface pieces: icons, buttons, form controls, panels, modals.
// Everything is written with htm tagged templates (no build step).

import { h, html, render, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from '../vendor/htm-preact.js';
import { FONTS, fontById } from '../engine/schema.js';
import { getState, useStore, openModal } from './store.js';

export { h, html, render, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect };

// ---------- icons (24px, stroke) ----------

const P = {
  pages: 'M7 3h7l5 5v13H7z M14 3v5h5',
  design: 'M14.5 4.5l5 5L11 18H6v-5z M12.5 6.5l5 5 M6 18c-1 1.5-2.5 2.3-3.5 2.5.3-1.2 1-2.6 2-3.5',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 8.5h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4 M12 17.5h.01',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M19 12l-7 7-7-7',
  chevR: 'M9 6l6 6-6 6',
  chevL: 'M15 6l-6 6 6 6',
  chevD: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12 M18 6L6 18',
  home: 'M4 11l8-7 8 7 M6 9.5V20h12V9.5',
  folder: 'M3 6h6l2 2h10v11H3z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  minus: 'M5 12h14',
  desktop: 'M3 5h18v12H3z M9 21h6 M12 17v4',
  mobile: 'M8 3h8v18H8z M11 18h2',
  undo: 'M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9 M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  check: 'M5 12l5 5 9-10',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  text: 'M5 6V4h14v2 M12 4v16 M9 20h6',
  gallery: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  video: 'M4 5h16v14H4z M10 9l5 3-5 3z',
  button: 'M3 8h18v8H3z M8 12h8',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  code: 'M8 8l-5 4 5 4 M16 8l5 4-5 4',
  layout: 'M3 4h18v16H3z M3 9h18 M9 9v11',
  columns: 'M3 5h8v14H3z M14 7h7 M14 11h7 M14 15h5',
  logout: 'M15 4h4v16h-4 M10 16l-4-4 4-4 M6 12h10',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  warning: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  alignLeft: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
  alignCenter: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
  alignRight: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
  justify: 'M4 6h16 M4 10h16 M4 14h16 M4 18h16',
  ul: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  ol: 'M10 6h10 M10 12h10 M10 18h10 M4 5l1.5-1v4.5 M3.8 14.2a1.2 1.2 0 0 1 2.2.6c0 .9-2.2 2.2-2.2 2.2H6.2',
  quote: 'M7 7h4v4c0 3-2 5-4 6 M15 7h4v4c0 3-2 5-4 6',
  clear: 'M4 7V5h12v2 M10 5l-3 14 M14 15l6 6 M20 15l-6 6',
  spacer: 'M4 7h16 M4 17h16 M12 9.5v5',
  cv: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
  posts: 'M4 5h16 M4 9h10 M4 14h16 M4 18h10',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9s1-6.3 3.5-9z',
  focal: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  line: 'M4 12h16',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  strike: 'M5 12h14 M16 7.5C15.3 6 13.8 5 12 5c-2.5 0-4 1.3-4 3 0 1.2.8 2 2 2.6 M8 16.5C8.7 18 10.2 19 12 19c2.5 0 4-1.3 4-3 0-.6-.2-1.1-.5-1.5',
  indent: 'M4 6h16 M10 10h10 M10 14h10 M4 18h16 M4 9l3 3-3 3',
  outdent: 'M4 6h16 M10 10h10 M10 14h10 M4 18h16 M7 9l-3 3 3 3',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z M7.5 11.5h.01 M9.5 7.5h.01 M14.5 7.5h.01 M17 11h.01',
  paste: 'M9 4h6v3H9z M7 5H5v16h14V5h-2 M9 12h6 M9 16h4',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  pin: 'M12 17v4 M8 3h8l-1 6 3 3H6l3-3z',
};

export function Icon({ name, size = 18, title }) {
  const d = P[name] || P.info;
  // Dot-only icons need a heavier stroke to be visible.
  const style = name === 'grip' || name === 'dots' ? 'stroke-width:3' : undefined;
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" aria-hidden=${title ? undefined : 'true'} style=${style}>${title ? html`<title>${title}</title>` : null}<path d=${d} /></svg>`;
}

// ---------- buttons ----------

export function Button({ kind = '', small, block, icon, children, ...rest }) {
  const cls = ['btn', kind, small ? 'small' : '', block ? 'block' : ''].filter(Boolean).join(' ');
  return html`<button type="button" class=${cls} ...${rest}>${icon ? html`<${Icon} name=${icon} size=${16} />` : null}${children}</button>`;
}

export function IconButton({ icon, label, active, small, size, ...rest }) {
  return html`<button type="button" class=${`ibtn${active ? ' active' : ''}${small ? ' small' : ''}`} title=${label} aria-label=${label} ...${rest}><${Icon} name=${icon} size=${size || (small ? 16 : 18)} /></button>`;
}

// ---------- form controls ----------

export function Field({ label, value, help, children }) {
  return html`<div class="field">
    ${label ? html`<div class="lbl"><span>${label}</span>${value !== undefined ? html`<span class="val">${value}</span>` : null}</div>` : null}
    ${children}
    ${help ? html`<p class="help">${help}</p>` : null}
  </div>`;
}

// A text box that keeps its own text while focused, so typing is never
// interrupted by the store re-rendering. onChange fires as you type.
export function TextInput({ value, onChange, multiline, rows = 3, placeholder, mono, type = 'text', onEnter, autoFocus, ...rest }) {
  const [local, setLocal] = useState(value ?? '');
  const focused = useRef(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused.current) setLocal(value ?? ''); }, [value]);
  useEffect(() => { if (autoFocus && ref.current) { ref.current.focus(); ref.current.select?.(); } }, []);
  const props = {
    ref,
    class: `${multiline ? 'textarea' : 'input'}${mono ? ' mono' : ''}`,
    value: local,
    placeholder,
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; setLocal(value ?? ''); },
    onInput: e => { setLocal(e.target.value); onChange && onChange(e.target.value); },
    onKeyDown: e => { if (e.key === 'Enter' && !multiline && onEnter) onEnter(e.target.value); },
    ...rest,
  };
  return multiline ? html`<textarea rows=${rows} ...${props}></textarea>` : html`<input type=${type} ...${props} />`;
}

export function Toggle({ label, help, checked, onChange }) {
  return html`<label class=${`toggle${checked ? ' on' : ''}`} onClick=${e => { e.preventDefault(); onChange(!checked); }}>
    <span><span class="t-lbl">${label}</span>${help ? html`<span class="t-help">${help}</span>` : null}</span>
    <span class="switch" role="switch" aria-checked=${checked ? 'true' : 'false'} tabindex="0"
      onKeyDown=${e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked); } }}></span>
  </label>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="seg" role="radiogroup">
    ${options.map(o => html`<button type="button" class=${o.value === value ? 'on' : ''} role="radio" aria-checked=${o.value === value ? 'true' : 'false'} title=${o.title || o.label}
      onClick=${() => onChange(o.value)}>${o.icon ? html`<${Icon} name=${o.icon} size=${16} />` : null}${o.label && !o.iconOnly ? o.label : null}</button>`)}
  </div>`;
}

export function Select({ value, options, onChange }) {
  return html`<select class="select" value=${value ?? ''} onChange=${e => onChange(e.target.value)}>
    ${options.map(o => html`<option value=${o.value} selected=${o.value === value}>${o.label}</option>`)}
  </select>`;
}

export function Slider({ value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  const v = Number(value ?? min);
  return html`<div class="slider">
    <input type="range" min=${min} max=${max} step=${step} value=${v} onInput=${e => onChange(Number(e.target.value))} />
    <input class="num" type="number" min=${min} max=${max} step=${step} value=${v}
      onChange=${e => { const n = Number(e.target.value); if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n))); }} />
    ${unit ? html`<span class="muted" style="font-size:12px;width:18px">${unit}</span>` : null}
  </div>`;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function ColorInput({ value, onChange }) {
  const [text, setText] = useState(value || '');
  useEffect(() => setText(value || ''), [value]);
  const full = HEX.test(value || '') && value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value;
  return html`<div class="color">
    <span class="sw" style=${`background:${value}`}><input type="color" value=${HEX.test(full || '') ? full : '#000000'} onInput=${e => onChange(e.target.value)} aria-label="Pick a color" /></span>
    <input class="input" value=${text} onInput=${e => { setText(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} />
  </div>`;
}

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">
    ${tabs.map(t => html`<button type="button" role="tab" class=${t.id === value ? 'on' : ''} aria-selected=${t.id === value ? 'true' : 'false'} onClick=${() => onChange(t.id)}>${t.label}</button>`)}
  </div>`;
}

// ---------- fonts ----------

let fontsLoaded = false;
// Loads every font in the list into the editor itself so the picker can show them.
export function loadAllFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  for (const f of FONTS) {
    if (!f.google) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }
}

export function FontPicker({ value, onChange }) {
  useEffect(loadAllFonts, []);
  const kinds = [['sans', 'Sans serif'], ['serif', 'Serif'], ['mono', 'Typewriter']];
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, []);
  return html`<div class="fontlist" ref=${ref} role="listbox">
    ${kinds.map(([k, label]) => FONTS.filter(f => f.kind === k).map((f, i) => html`
      <button type="button" class=${f.id === value ? 'on' : ''} role="option" aria-selected=${f.id === value ? 'true' : 'false'}
        style=${`font-family:${f.stack}`} onClick=${() => onChange(f.id)}>
        <span>${f.label}</span>${i === 0 ? html`<small>${label}</small>` : null}
      </button>`))}
  </div>`;
}

export function fontLabel(id) {
  return fontById(id).label;
}

// ---------- media ----------

// URL the editor can show for a media item: a local copy for images that are
// not uploaded yet, otherwise the file on the site.
export function mediaPreviewUrl(m, variant = 'main') {
  if (!m) return '';
  const path = variant === 'medium' && m.medium ? m.medium.src : m.src;
  return getState().objectUrls?.[path] || `${getState().config?.siteRoot || '../'}${path}`;
}

export function Thumb({ media, selected, hidden, badge, onClick, ...rest }) {
  const m = media;
  return html`<button type="button" class=${`thumb${selected ? ' selected' : ''}${hidden ? ' hidden-item' : ''}`} onClick=${onClick} title=${m?.alt || m?.title || ''} ...${rest}>
    ${m ? html`<img src=${mediaPreviewUrl(m, 'medium')} alt="" loading="lazy" draggable="false" />` : null}
    ${badge ? html`<span class="badge">${badge}</span>` : null}
  </button>`;
}

// Shows the chosen image with Replace / Remove. Picking opens the asset library.
export function ImageField({ value, onChange, allowRemove = true }) {
  const site = useStore(s => s.site);
  const m = value ? site.media[value] : null;
  const pick = () => openModal('mediaPicker', { onPick: id => onChange(id) });
  return html`<div class="img-field">
    <div class="prev">${m ? html`<img src=${mediaPreviewUrl(m, 'medium')} alt="" />` : html`<${Icon} name="image" size=${26} />`}</div>
    <div class="acts">
      <${Button} small kind="secondary" onClick=${pick}>${m ? 'Replace image' : 'Choose image'}<//>
      ${m && allowRemove ? html`<button type="button" class="linkbtn" onClick=${() => onChange(null)}>Remove</button>` : null}
    </div>
  </div>`;
}

// URL box plus a list of the site's pages, so Joni can link to a page without typing.
export function LinkInput({ value, onChange, placeholder = 'https:// or choose a page' }) {
  const site = useStore(s => s.site);
  const pages = site.pages.filter(p => !p.disabled);
  const isPage = pages.find(p => pageFileName(site, p) === value);
  return html`<div style="display:grid;gap:6px">
    <${TextInput} value=${value} onChange=${onChange} placeholder=${placeholder} />
    <select class="select" value=${isPage ? value : ''} onChange=${e => e.target.value && onChange(e.target.value)}>
      <option value="">Link to a page on this site…</option>
      ${pages.map(p => html`<option value=${pageFileName(site, p)} selected=${isPage && isPage.id === p.id}>${p.title}</option>`)}
    </select>
  </div>`;
}

export function pageFileName(site, page) {
  return page.id === site.settings.homePage ? 'index.html' : `${page.slug}.html`;
}

// ---------- panels and modals ----------

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="modal-back" onMouseDown=${e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class=${`modal ${size}`} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head"><h3>${title}</h3>${onClose ? html`<${IconButton} icon="x" label="Close" onClick=${onClose} />` : null}</div>
      <div class="modal-body">${children}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : null}
    </div>
  </div>`;
}

// Floating, draggable panel used in edit mode (Edit Section, Site Styles...).
export function FloatingPanel({ title, onClose, tabs, tab, onTab, children, wide, onBack, actions }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const startDrag = e => {
    if (e.target.closest('button')) return;
    const panel = ref.current;
    const rect = panel.getBoundingClientRect();
    const parent = panel.offsetParent.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = ev => {
      const x = Math.min(Math.max(0, ev.clientX - parent.left - dx), parent.width - rect.width);
      const y = Math.min(Math.max(0, ev.clientY - parent.top - dy), parent.height - 60);
      setPos({ x, y });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const style = pos ? `left:${pos.x}px;top:${pos.y}px;right:auto` : '';
  return html`<section class=${`fpanel${wide ? ' wide' : ''}`} ref=${ref} style=${style} aria-label=${title}>
    <div class="fpanel-head" onPointerDown=${startDrag}>
      ${onBack ? html`<${IconButton} icon="chevL" label="Back" small onClick=${onBack} />` : null}
      <h3>${title}</h3>
      ${actions || null}
      <${IconButton} icon="x" label="Close" small onClick=${onClose} />
    </div>
    ${tabs ? html`<${Tabs} tabs=${tabs} value=${tab} onChange=${onTab} />` : null}
    <div class="fpanel-body">${children}</div>
  </section>`;
}

// ---------- drag to reorder ----------

// Native drag and drop for a list. Returns props to spread on each item.
// onMove(fromIndex, toIndex) receives the final position in the list.
export function useReorder(onMove, { axis = 'y' } = {}) {
  const drag = useRef(null);
  const [over, setOver] = useState(null); // { index, after }
  const itemProps = index => ({
    draggable: true,
    onDragStart: e => {
      drag.current = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      e.currentTarget.classList.add('dragging');
    },
    onDragEnd: e => { e.currentTarget.classList.remove('dragging'); drag.current = null; setOver(null); },
    onDragOver: e => {
      if (drag.current === null) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      if (!over || over.index !== index || over.after !== after) setOver({ index, after });
    },
    onDrop: e => {
      e.preventDefault();
      const from = drag.current;
      if (from === null || !over) return;
      let to = over.index + (over.after ? 1 : 0);
      if (from < to) to -= 1;
      drag.current = null;
      setOver(null);
      if (to !== from) onMove(from, to);
    },
    class: over && over.index === index ? (over.after ? 'drop-after' : 'drop-before') : '',
  });
  return itemProps;
}

export function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}

// ---------- misc ----------

export function Spinner() {
  return html`<span class="spin" aria-hidden="true"></span>`;
}

export function timeAgo(date) {
  const d = typeof date === 'number' ? date : Date.parse(date);
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatWhen(date) {
  const d = new Date(date);
  return d.toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
