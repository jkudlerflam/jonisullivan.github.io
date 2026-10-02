// Gallery sections, worded and laid out like Squarespace 7.1:
//   GalleryImages  "Edit Gallery": the images (add with +, drag to reorder, trash on hover)
//   GalleryItem    one image: focal point, Description, alt text, Attach Link, hide
//   GalleryDesign  the Gallery tab of Edit Section: Gallery Type and its options
// The panels are mounted by section.js. Styles: admin/css/gallery.css (gl- classes).

import {
  html, useState, useRef, Icon, IconButton, Button, Field, TextInput, Toggle, Segmented, Select, Slider, LinkInput,
  useReorder, moveItem, mediaPreviewUrl, Spinner,
} from '../ui.js';
import { useStore, getState, setState, openModal, openMenu, toast, undo } from '../store.js';
import { setSectionProps, updateSection, importFiles, addGalleryItems } from '../actions.js';
import { ASPECTS } from '../../engine/schema.js';
import { GALLERY_LAYOUTS, STRIP_HEIGHT, REEL_HEIGHT } from '../../engine/gallery.js';
import { ArtworkCaption, RichLine, fullUrl } from './shared.js';

// ---------- gallery types ----------

const G = '#d6d6d6';
const box = (x, y, w, h) => html`<rect x=${x} y=${y} width=${w} height=${h} rx="1.5" fill=${G} />`;
const pic = kids => html`<svg viewBox="0 0 120 75" aria-hidden="true">${kids}</svg>`;
const arrows = (y, color) => html`<path d=${`M19 ${y - 4}l-5 4 5 4 M101 ${y - 4}l5 4-5 4`} fill="none" stroke=${color} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />`;

// Squarespace's names, in its order. `id` is the section's layout ('stack' is
// Grid: Simple with one image per row).
export const GALLERY_TYPES = [
  { id: 'grid', label: 'Grid: Simple', pic: pic([0, 1, 2].flatMap(c => [0, 1].map(r => box(17 + c * 30, 9 + r * 30, 26, 26)))) },
  { id: 'strips', label: 'Grid: Strips', pic: pic([box(14, 9, 30, 27), box(47, 9, 20, 27), box(70, 9, 36, 27), box(14, 39, 22, 27), box(39, 39, 40, 27), box(82, 39, 24, 27)]) },
  { id: 'masonry', label: 'Grid: Masonry', pic: pic([box(17, 6, 26, 36), box(17, 46, 26, 23), box(47, 6, 26, 21), box(47, 31, 26, 38), box(77, 6, 26, 29), box(77, 39, 26, 30)]) },
  {
    id: 'slideshow', label: 'Slideshow: Simple',
    pic: pic([box(30, 7, 60, 46), arrows(30, '#9a9a9a'),
      html`<circle cx="54" cy="63" r="2" fill="#9a9a9a" />`, html`<circle cx="60" cy="63" r="2" fill=${G} />`, html`<circle cx="66" cy="63" r="2" fill=${G} />`]),
  },
  { id: 'slideshow-full', label: 'Slideshow: Full', pic: pic([box(4, 8, 112, 59), arrows(37.5, '#ffffff')]) },
  { id: 'reel', label: 'Slideshow: Reel', pic: pic([box(4, 15, 30, 45), box(37, 15, 48, 45), box(88, 15, 32, 45), arrows(37.5, '#ffffff')]) },
];

// Older names, still imported elsewhere.
const LAYOUTS = GALLERY_TYPES;
const LAYOUT_IDS = GALLERY_LAYOUTS;

export function galleryType(sec) {
  const layout = GALLERY_LAYOUTS.includes(sec.layout) ? sec.layout : 'grid';
  return layout === 'stack' ? 'grid' : layout;
}

// Whether the gallery crops images, which is when an image's focal point matters.
function cropsImages(sec) {
  const type = galleryType(sec);
  return type === 'slideshow-full' || (type === 'grid' && !!sec.aspect && sec.aspect !== 'original');
}

const validFocal = f => Array.isArray(f) && f.length === 2 && f.every(Number.isFinite);
const clampPct = v => Math.round(Math.min(100, Math.max(0, v)));

// ---------- Edit Gallery: the images ----------

function readAddAtTop() {
  try { return localStorage.getItem('se.addAtTop') === '1'; } catch { return false; }
}

function GalleryImages({ sec, site, openItem }) {
  const busy = useStore(s => s.busy);
  const [over, setOver] = useState(false);
  const [atTop, setAtTop] = useState(readAddAtTop);
  const fileRef = useRef(null);
  const plusRef = useRef(null);
  const items = sec.items || [];
  const hiddenCount = items.filter(i => i.hidden).length;
  const reorder = useReorder((from, to) => {
    updateSection(sec.id, s => { moveItem(s.items, from, to); }, { label: 'reorder images' });
  }, { axis: 'x' });
  const where = () => (atTop ? 0 : null);

  const upload = async (files, index = where()) => {
    const list = [...files];
    if (!list.length || getState().busy) return;
    setState({ busy: `Preparing ${list.length} image${list.length > 1 ? 's' : ''}…` });
    try {
      const ids = await importFiles(list, { onProgress: (i, n) => setState({ busy: `Preparing image ${i + 1} of ${n}…` }) });
      if (ids.length) addGalleryItems(sec.id, ids, index);
    } finally {
      setState({ busy: null });
    }
  };
  const search = () => openModal('mediaPicker', {
    multiple: true,
    onPick: ids => {
      const list = [].concat(ids || []).filter(Boolean);
      if (list.length) addGalleryItems(sec.id, list, where());
    },
  });
  const addMenu = () => openMenu(plusRef.current, [
    { label: 'Upload Images', icon: 'upload', onClick: () => fileRef.current?.click() },
    { label: 'Search Images', icon: 'search', onClick: search },
  ]);
  const remove = id => {
    updateSection(sec.id, s => { s.items = (s.items || []).filter(x => x.id !== id); }, { label: 'remove image from gallery' });
    toast('Image removed from the gallery.', { action: { label: 'Undo', onClick: undo }, timeout: 6000 });
  };
  const setTop = v => {
    setAtTop(v);
    try { localStorage.setItem('se.addAtTop', v ? '1' : '0'); } catch {}
  };

  // Files dragged in from the computer. Dropped on an image, they go next to it.
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragOver = e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const onDragLeave = e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); };
  const onDrop = e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setOver(false);
    const tile = e.target.closest?.('[data-idx]');
    let index = where();
    if (tile) {
      const r = tile.getBoundingClientRect();
      index = Number(tile.dataset.idx) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
    }
    upload(e.dataTransfer.files, index);
  };

  return html`<div class="gl-images" onDragOver=${onDragOver} onDragLeave=${onDragLeave} onDrop=${onDrop}>
    <div class="gl-head">
      <span>${items.length ? `${items.length} image${items.length === 1 ? '' : 's'}` : 'No images yet'}${hiddenCount ? html` <span class="muted">· ${hiddenCount} hidden</span>` : null}</span>
      ${busy ? html`<span class="gl-busy"><${Spinner} /> ${busy}</span>` : null}
    </div>
    <div class=${`gl-grid${over ? ' over' : ''}`}>
      <button type="button" class="gl-tile gl-add" ref=${plusRef} disabled=${!!busy} title="Add images" aria-label="Add images" onClick=${addMenu}>
        ${busy ? html`<${Spinner} />` : html`<${Icon} name="plus" size=${24} />`}
      </button>
      ${items.map((it, i) => {
        const p = reorder(i);
        const m = site.media[it.media];
        const name = m ? m.title || m.alt || '' : '';
        const open = () => openItem(it.id);
        return html`<div key=${it.id} class=${`gl-tile${it.hidden ? ' off' : ''}${p.class ? ` ${p.class}` : ''}`} data-idx=${i} data-item=${it.id}
          draggable="true" onDragStart=${p.onDragStart} onDragEnd=${p.onDragEnd} onDragOver=${p.onDragOver} onDrop=${p.onDrop}>
          <div class="gl-pick" role="button" tabindex="0" title=${name} aria-label=${`Edit image ${i + 1}${name ? `: ${name}` : ''}`}
            onClick=${open} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
            ${m ? html`<img src=${mediaPreviewUrl(m, 'medium')} alt="" loading="lazy" draggable="false" />`
              : html`<span class="gl-missing"><${Icon} name="warning" size=${18} />Missing</span>`}
          </div>
          ${it.hidden ? html`<span class="gl-badge"><${Icon} name="eyeOff" size=${12} />Hidden</span>` : null}
          <button type="button" class="gl-trash" title="Remove from gallery" aria-label=${`Remove image ${i + 1} from the gallery`}
            onClick=${() => remove(it.id)}><${Icon} name="trash" size=${15} /></button>
        </div>`;
      })}
    </div>
    <p class="gl-help">${over ? 'Drop to add these images.'
      : items.length ? 'Drag images to reorder them. Click an image to edit it. You can also drop images here from your computer.'
        : 'Click + to upload images or choose them from your library. You can also drop images here from your computer.'}</p>
    <label class="gl-addpos">New images go
      <select class="select" value=${atTop ? 'top' : 'end'} onChange=${e => setTop(e.target.value === 'top')}>
        <option value="end" selected=${!atTop}>at the end</option>
        <option value="top" selected=${atTop}>at the top</option>
      </select>
    </label>
    <input type="file" ref=${fileRef} multiple accept="image/*,.heic,.heif" hidden
      onChange=${e => { const files = [...e.target.files]; e.target.value = ''; upload(files); }} />
  </div>`;
}

// ---------- one image ----------

// Click or drag on the image to choose the point that stays in view when the
// gallery crops it. Arrow keys move it too (Shift: faster).
function FocalPicker({ media, focal, dim, onChange }) {
  const imgRef = useRef(null);
  const dragging = useRef(false);
  const f = validFocal(focal) ? focal : [50, 50];
  const put = next => { if (!validFocal(focal) || next[0] !== f[0] || next[1] !== f[1]) onChange(next); };
  const at = e => {
    const r = imgRef.current.getBoundingClientRect();
    return [clampPct(((e.clientX - r.left) / r.width) * 100), clampPct(((e.clientY - r.top) / r.height) * 100)];
  };
  const down = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    put(at(e));
  };
  const move = e => { if (dragging.current) put(at(e)); };
  const up = () => { dragging.current = false; };
  const key = e => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 2;
    put([clampPct(f[0] + d[0] * step), clampPct(f[1] + d[1] * step)]);
  };
  return html`<div class=${`gl-focal${dim ? ' off' : ''}`} tabindex="0" role="group"
    aria-label=${`Focal point ${f[0]}% from the left, ${f[1]}% from the top. Click the image or use the arrow keys to move it.`}
    onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onKeyDown=${key}>
    <img ref=${imgRef} src=${mediaPreviewUrl(media, 'medium')} alt="" draggable="false" />
    <span class="gl-dot" style=${`left:${f[0]}%;top:${f[1]}%`} aria-hidden="true"></span>
  </div>`;
}

function GalleryItem({ sec, item, site, openItem, back }) {
  const items = sec.items || [];
  const i = items.findIndex(x => x.id === item.id);
  const m = site.media[item.media];
  const editItem = (mutate, label, key = null) => updateSection(sec.id, s => {
    const it = (s.items || []).find(x => x.id === item.id);
    if (it) mutate(it);
  }, { label, coalesce: key ? `gi:${item.id}:${key}` : null });
  const setItem = (patch, label, key) => editItem(it => Object.assign(it, patch), label, key);
  const replace = () => openModal('mediaPicker', {
    multiple: false,
    onPick: picked => {
      const id = [].concat(picked)[0];
      if (!id) return;
      updateSection(sec.id, (s, st) => {
        const it = (s.items || []).find(x => x.id === item.id);
        if (!it) return;
        // A description that was the old artwork's caption becomes the new one's.
        const old = st.media[it.media];
        if (old && old.caption && it.caption === old.caption) it.caption = st.media[id]?.caption || '';
        it.media = id;
        delete it.focal;
      }, { label: 'replace image' });
    },
  });
  const remove = () => {
    updateSection(sec.id, s => { s.items = (s.items || []).filter(x => x.id !== item.id); }, { label: 'remove image from gallery' });
    back();
    toast('Image removed from the gallery.', { action: { label: 'Undo', onClick: undo }, timeout: 6000 });
  };
  const crops = cropsImages(sec);

  return html`<div class="gl-item">
    <div class="gl-nav">
      <${IconButton} small icon="chevL" label="Previous image" disabled=${i <= 0} onClick=${() => openItem(items[i - 1].id)} />
      <span>Image ${i + 1} of ${items.length}</span>
      <${IconButton} small icon="chevR" label="Next image" disabled=${i >= items.length - 1} onClick=${() => openItem(items[i + 1].id)} />
    </div>
    <div class="gl-stage">
      ${m ? html`<${FocalPicker} key=${item.id} media=${m} focal=${item.focal} dim=${item.hidden}
          onChange=${f => setItem({ focal: f }, 'focal point', 'focal')} />`
        : html`<${Icon} name="image" size=${30} />`}
      ${item.hidden ? html`<span class="gl-flag"><${Icon} name="eyeOff" size=${13} /> Hidden</span>` : null}
    </div>
    ${m ? html`<p class="gl-fnote">
        <span>Click the image to set its focal point.${crops ? '' : html` <span class="muted">It is used when the gallery crops images, as in Slideshow: Full or Grid: Simple with an aspect ratio.</span>`}</span>
        ${validFocal(item.focal) ? html`<button type="button" class="linkbtn" onClick=${() => editItem(it => { delete it.focal; }, 'focal point')}>Reset</button>` : null}
      </p>`
      : html`<p class="note warn">This image is missing from the Asset Library. Replace it or remove it from the gallery.</p>`}
    ${m?.title ? html`<p class="gl-title">${m.title}</p>` : null}
    <${Field} label="Description">
      <${RichLine} key=${item.id} value=${item.caption} placeholder="Shown as the caption under the image" label="Description"
        onChange=${v => setItem({ caption: v }, 'edit description', 'caption')} />
      <${ArtworkCaption} media=${m} current=${item.caption} onUse=${c => setItem({ caption: c }, 'use artwork caption')} />
    <//>
    ${!sec.captions ? html`<p class="note gl-capnote">Captions are turned off for this gallery, so the description is not shown.
      <button type="button" class="linkbtn" onClick=${() => setSectionProps(sec.id, { captions: true }, 'show captions')}>Turn them on</button></p>` : null}
    <${Field} label="Alt text" help="Describes the image for people who use screen readers. If empty, the alt text from the Asset Library is used.">
      <${TextInput} value=${item.alt} placeholder=${m?.alt || 'Describe the image'} onChange=${v => setItem({ alt: v }, 'alt text', 'alt')} />
    <//>
    <${Field} label="Attach Link" help=${sec.lightbox ? 'Clicking the image opens this link instead of the lightbox.' : 'Clicking the image opens this link.'}>
      <${LinkInput} value=${item.link} onChange=${v => { const url = v.trim(); setItem({ link: url ? fullUrl(url) : '' }, 'image link', 'link'); }} />
    <//>
    ${item.link ? html`<${Toggle} label="Open in new tab" checked=${!!item.newTab} onChange=${v => setItem({ newTab: v }, 'link setting')} />` : null}
    <${Toggle} label="Hide this image" help="Hidden images stay in the gallery but are not shown on the site."
      checked=${!!item.hidden} onChange=${v => setItem({ hidden: v }, v ? 'hide image' : 'show image')} />
    <div class="gl-acts">
      <${Button} small kind="secondary" icon="refresh" onClick=${replace}>Replace image<//>
      <${Button} small kind="secondary" icon="trash" class="btn secondary small gl-danger" onClick=${remove}>Remove from gallery<//>
    </div>
  </div>`;
}

// ---------- Gallery tab: type and options ----------

const ANIMATIONS = [
  { value: 'site', label: 'Site Default' },
  { value: 'none', label: 'No Animation' },
  { value: 'fade', label: 'Fading' },
  { value: 'scale', label: 'Scaling' },
];
const WIDTHS = [{ value: 'bleed', label: 'Full Bleed' }, { value: 'full', label: 'Full' }, { value: 'inset', label: 'Inset' }];
const CAPTION_ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

const lastWidth = new Map();     // section id -> Inset width, while Full or Full Bleed is chosen
const lastDuration = new Map();  // section id -> slide duration, while autoplay is off
const beforeFull = new Map();    // section id -> Inset width before switching to Slideshow: Full

function GalleryDesign({ sec, set }) {
  const type = galleryType(sec);
  const layout = sec.layout === 'stack' ? 'stack' : type;
  const isGrid = type === 'grid' || type === 'strips' || type === 'masonry';
  const columns = Math.max(1, sec.columns || 3);
  const perRow = layout === 'stack' ? 1 : columns;
  const gap = sec.gap ?? 24;
  const autoMobile = sec.mobileGap === null || sec.mobileGap === undefined;
  const autoGap = layout === 'stack' || layout === 'slideshow' ? Math.min(16, gap) : layout === 'masonry' ? gap : Math.round(gap * 0.6);
  const seconds = Number(sec.autoplay) > 0 ? Number(sec.autoplay) : 0;
  const height = sec.slideHeight || 75;
  const rowHeight = sec.rowHeight || (type === 'reel' ? REEL_HEIGHT : STRIP_HEIGHT);
  const width = sec.bleed ? 'bleed' : typeof sec.width === 'number' && sec.width > 0 ? 'inset' : 'full';
  const animation = ANIMATIONS.some(a => a.value === sec.animation) ? sec.animation : 'site';

  const chooseType = id => {
    if (id === type) return;
    // Grid: Simple with one image per row is stored as 'stack'.
    const patch = { layout: id === 'grid' ? (columns >= 2 ? 'grid' : 'stack') : id };
    if (id === 'masonry' && columns < 2) patch.columns = 3;
    // Slideshow: Full fills the width of the page; switching away gives back the width it had.
    if (id === 'slideshow-full' && width === 'inset') {
      beforeFull.set(sec.id, sec.width);
      patch.width = null;
    } else if (type === 'slideshow-full' && beforeFull.has(sec.id)) {
      if (width === 'full') patch.width = beforeFull.get(sec.id);
      beforeFull.delete(sec.id);
    }
    set(patch, 'gallery type');
  };
  const setPerRow = n => (type === 'grid'
    ? set({ columns: n, layout: n >= 2 ? 'grid' : 'stack' }, 'images per row')
    : set({ columns: n }, 'images per row'));
  const setAutoplay = on => {
    if (on) set({ autoplay: lastDuration.get(sec.id) || 4 }, 'autoplay');
    else { lastDuration.set(sec.id, seconds); set({ autoplay: 0 }, 'autoplay'); }
  };
  const setWidth = v => {
    if (v === width) return;
    if (width === 'inset') lastWidth.set(sec.id, sec.width);
    if (v === 'inset') set({ bleed: false, width: lastWidth.get(sec.id) || 900 }, 'gallery width');
    else set({ bleed: v === 'bleed', width: null }, 'gallery width');
  };

  return html`<div class="gl-design">
    <${Field} label="Gallery Type">
      <${Select} value=${type} options=${GALLERY_TYPES.map(t => ({ value: t.id, label: t.label }))} onChange=${chooseType} />
    <//>

    ${type === 'grid' || type === 'masonry' ? html`<${Field} label="Images per row" value=${perRow}>
      <${Slider} value=${perRow} min=${1} max=${6} onChange=${setPerRow} />
    <//>` : null}
    ${type === 'grid' ? html`<${Field} label="Aspect Ratio" help=${sec.aspect && sec.aspect !== 'original' ? 'Every image is cropped to this shape. Set the part to keep with each image\'s focal point.' : 'Original shows each image whole.'}>
      <${Select} value=${sec.aspect || 'original'} options=${ASPECTS.map(a => ({ value: a.id, label: a.label }))} onChange=${v => set({ aspect: v }, 'aspect ratio')} />
    <//>` : null}
    ${type === 'strips' ? html`<${Field} label="Row height" value=${`${rowHeight}px`}>
      <${Slider} value=${rowHeight} min=${100} max=${600} step=${10} unit="px" onChange=${n => set({ rowHeight: n }, 'row height')} />
    <//>` : null}
    ${type === 'slideshow' || type === 'slideshow-full' ? html`<${Field} label="Image height" value=${`${height}% of the window`}>
      <${Slider} value=${height} min=${20} max=${100} unit="%" onChange=${n => set({ slideHeight: n }, 'image height')} />
    <//>` : null}
    ${type === 'reel' ? html`<${Field} label="Image height" value=${`${rowHeight}px`}>
      <${Slider} value=${rowHeight} min=${150} max=${800} step=${10} unit="px" onChange=${n => set({ rowHeight: n }, 'image height')} />
    <//>` : null}
    ${type === 'slideshow' ? html`<${Toggle} label="Show thumbnails" help="Small images under the slideshow. Click one to show it."
      checked=${!!sec.thumbnails} onChange=${v => set({ thumbnails: v }, v ? 'show thumbnails' : 'hide thumbnails')} />` : null}
    ${!isGrid ? html`
      <${Toggle} label="Autoplay" help="Moves to the next image by itself. It pauses while a visitor points at the slideshow."
        checked=${seconds > 0} onChange=${setAutoplay} />
      ${seconds > 0 ? html`<${Field} label="Slide Duration" value=${`${seconds} seconds`}>
        <${Slider} value=${seconds} min=${1} max=${15} unit="s" onChange=${n => set({ autoplay: n }, 'slide duration')} />
      <//>` : null}` : null}

    ${isGrid || type === 'reel' ? html`
      <div class="subhead">Spacing</div>
      <${Field} label="Image spacing" value=${`${gap}px`}>
        <${Slider} value=${gap} min=${0} max=${120} unit="px" onChange=${n => set({ gap: n }, 'image spacing')} />
      <//>
      <${Field} label="Spacing on phones" value=${autoMobile ? `Automatic (${autoGap}px)` : `${sec.mobileGap}px`}>
        <${Segmented} value=${autoMobile ? 'auto' : 'custom'} options=${[{ value: 'auto', label: 'Automatic' }, { value: 'custom', label: 'Custom' }]}
          onChange=${v => set({ mobileGap: v === 'auto' ? null : autoGap }, 'spacing on phones')} />
      <//>
      ${!autoMobile ? html`<${Field}><${Slider} value=${sec.mobileGap} min=${0} max=${80} unit="px" onChange=${n => set({ mobileGap: n }, 'spacing on phones')} /><//>` : null}` : null}

    <div class="subhead">Captions</div>
    <${Toggle} label="Show captions" help="Each image's Description, shown under it."
      checked=${!!sec.captions} onChange=${v => set({ captions: v }, v ? 'show captions' : 'hide captions')} />
    ${sec.captions ? html`<${Field} label="Caption alignment">
      <${Segmented} value=${CAPTION_ALIGN.some(a => a.value === sec.captionAlign) ? sec.captionAlign : 'left'} options=${CAPTION_ALIGN}
        onChange=${v => set({ captionAlign: v }, 'caption alignment')} />
    <//>` : null}

    <div class="subhead">Behavior</div>
    <${Toggle} label="Click to enlarge (lightbox)" help="Clicking an image opens it large, with arrows to the next one."
      checked=${!!sec.lightbox} onChange=${v => set({ lightbox: v }, 'lightbox')} />
    <${Field} label="Animation" help=${animation === 'site' ? 'Follows Site Styles > Animations.' : animation === 'none' ? 'The gallery never animates.' : isGrid ? 'Each image animates as it scrolls into view.' : 'The slideshow animates as it scrolls into view.'}>
      <${Select} value=${animation} options=${ANIMATIONS} onChange=${v => set({ animation: v }, 'gallery animation')} />
    <//>

    <div class="subhead">Width</div>
    <${Field}>
      <${Segmented} value=${width} options=${WIDTHS} onChange=${setWidth} />
    <//>
    ${width === 'inset' ? html`<${Field} label="Inset width" value=${`${sec.width}px`}>
      <${Slider} value=${sec.width} min=${300} max=${1600} step=${10} unit="px" onChange=${w => set({ width: w }, 'gallery width')} />
    <//>` : html`<p class="gl-help gl-under">${width === 'bleed' ? 'The gallery reaches the edges of the page area.' : 'The gallery fills the width of the page.'}</p>`}
    ${width !== 'bleed' ? html`<${Toggle} label="Edge to edge on phones" help="Images reach the edges of the phone screen."
      checked=${!!sec.bleedMobile} onChange=${v => set({ bleedMobile: v }, 'edge to edge on phones')} />` : null}
  </div>`;
}

export { readAddAtTop, GalleryImages, GalleryItem, G, box, pic, LAYOUTS, LAYOUT_IDS, GalleryDesign };
