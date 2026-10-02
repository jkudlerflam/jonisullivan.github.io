// Edit Section: the floating panel for one section, like Squarespace's.
//   Fluid Engine sections   Design, Background, Colors
//   galleries               Images, Gallery, Background, Colors
//   CV, article list, form and spacer
//                           Content, Design, Background, Colors
// The panel reads the section from the store on every render, so changes made
// on the page show up here at once, and the other way around.

import {
  html, useState, useEffect, useRef, useLayoutEffect, Icon, IconButton, Button, Field, TextInput, Toggle, Segmented,
  Select, Slider, ColorInput, FloatingPanel, useReorder, moveItem, mediaPreviewUrl,
} from '../ui.js';
import { useStore, getState, setState, openModal, confirmDialog, toast, undo } from '../store.js';
import { findSection, setSectionProps, updateSection } from '../actions.js';
import { SECTION_TYPES, uid } from '../../engine/schema.js';
import { ALIGN3, SpaceField, RichLine } from './shared.js';
import { GalleryImages, GalleryItem, GalleryDesign } from './gallery.js';

// ---------- panel and tabs ----------

// What Squarespace calls each kind of section at the top of the panel.
const TITLES = { blocks: 'Section', gallery: 'Gallery', cv: 'CV', posts: 'Articles', form: 'Form', spacer: 'Spacer' };

// Tabs before Background and Colors. Ids match what the rest of the editor asks
// for ('images' when a gallery image is clicked).
const FIRST_TABS = {
  blocks: [['design', 'Design']],
  gallery: [['images', 'Images'], ['gallery', 'Gallery']],
  cv: [['content', 'Content'], ['design', 'Design']],
  posts: [['content', 'Content'], ['design', 'Design']],
  form: [['content', 'Content'], ['design', 'Design']],
  spacer: [['content', 'Content'], ['design', 'Design']],
};

function tabsFor(type) {
  return [...(FIRST_TABS[type] || [['design', 'Design']]), ['background', 'Background'], ['colors', 'Colors']]
    .map(([id, label]) => ({ id, label }));
}

// Older tab names ('format', a gallery's 'design') still lead somewhere sensible.
function pickTab(type, tabs, wanted) {
  if (tabs.some(t => t.id === wanted)) return wanted;
  if (type === 'gallery' && (wanted === 'design' || wanted === 'format')) return 'gallery';
  if (wanted === 'format') return 'design';
  return tabs[0].id;
}

const lastWidth = new Map();    // section id -> inset width before switching to Full
const lastBg = new Map();       // section id -> color before the background was switched off
const lastImage = new Map();    // section id -> image before switching to another background
const customHeight = new Set(); // sections where Custom height was picked
const gridScroll = new Map();   // section id -> scroll position of the image grid
let focusEntry = null;          // CV entry whose text box takes the focus when it appears
let focusHeading = null;        // CV list whose heading takes the focus when it appears

export function SectionPanel({ sectionId, tab, itemId, onClose }) {
  const site = useStore(s => s.site);
  const bodyRef = useRef(null);
  const prevView = useRef(null);
  const hit = findSection(site, sectionId);
  const sec = hit ? hit.section : null;
  const tabs = tabsFor(sec?.type);
  const cur = pickTab(sec?.type, tabs, tab);
  const item = sec && sec.type === 'gallery' && itemId ? (sec.items || []).find(i => i.id === itemId) || null : null;
  const viewKey = item ? `item:${item.id}` : cur;

  // The section disappeared (deleted, or undone): close the panel.
  useEffect(() => { if (!hit) onClose(); }, [!hit]);

  // A new tab or image starts at the top; going back to the image grid
  // returns to where it was.
  useLayoutEffect(() => {
    const body = bodyRef.current?.closest('.fpanel-body');
    if (body) {
      const back = viewKey === 'images' && String(prevView.current).startsWith('item:');
      body.scrollTop = back ? (gridScroll.get(sectionId) || 0) : 0;
    }
    prevView.current = viewKey;
  }, [viewKey]);

  if (!hit) return null;
  const title = TITLES[sec.type] || 'Section';
  const view = patch => setState({ editPanel: { ...getState().editPanel, ...patch } });
  const openItem = id => {
    const body = bodyRef.current?.closest('.fpanel-body');
    if (!item && body) gridScroll.set(sectionId, body.scrollTop);
    view({ tab: 'images', itemId: id });
  };

  if (item) {
    return html`<${FloatingPanel} title=${title} onClose=${onClose} onBack=${() => view({ tab: 'images', itemId: null })}>
      <div class="se-panel" ref=${bodyRef}>
        <${GalleryItem} sec=${sec} item=${item} site=${site} openItem=${openItem} back=${() => view({ tab: 'images', itemId: null })} />
      </div>
    <//>`;
  }
  return html`<${FloatingPanel} title=${title} onClose=${onClose} tabs=${tabs} tab=${cur} onTab=${id => view({ tab: id, itemId: null })}>
    <div class="se-panel" ref=${bodyRef} data-tab=${cur}>
      <${TabBody} sec=${sec} page=${hit.page} site=${site} tab=${cur} openItem=${openItem} />
    </div>
  <//>`;
}

function TabBody({ sec, page, site, tab, openItem }) {
  // Sliders and typing merge into one undo step; a click is a step of its own.
  const set = (props, label) => setSectionProps(sec.id, props, label);
  const pick = (props, label) => updateSection(sec.id, s => Object.assign(s, props), { label });
  const p = { sec, page, site, set, pick };
  switch (tab) {
    case 'background': return html`<${BackgroundTab} ...${p} />`;
    case 'colors': return html`<${ColorsTab} ...${p} />`;
    case 'design': return sec.type === 'blocks' ? html`<${BlocksDesign} ...${p} />` : html`<${SectionDesign} ...${p} />`;
    case 'images': return html`<${GalleryImages} ...${p} openItem=${openItem} />`;
    case 'gallery': return html`<${GalleryDesign} ...${p} />
      <div class="subhead">Section spacing</div>
      <${SpacingFields} sec=${sec} set=${set} />`;
    default:
      switch (sec.type) {
        case 'cv': return html`<${CvTab} ...${p} />`;
        case 'posts': return html`<${PostsTab} ...${p} />`;
        case 'form': return html`<${FormTab} ...${p} />`;
        case 'spacer': return html`<${SpacerTab} ...${p} />`;
        default: return html`<${SectionDesign} ...${p} />`;
      }
  }
}

// ---------- Design ----------

// Section heights in grid rows. A row is a twenty-fourth of the section's width,
// so Small is about a third of a laptop screen and Large about a whole one.
const HEIGHTS = [
  { value: 'small', label: 'Small', rows: 8 },
  { value: 'medium', label: 'Medium', rows: 12 },
  { value: 'large', label: 'Large', rows: 18 },
];
const HEIGHT_OPTIONS = [...HEIGHTS, { value: 'custom', label: 'Custom' }];
const VALIGN = [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }];

function BlocksDesign({ sec, set, pick }) {
  const rows = Math.max(1, Math.round(sec.rows || 1));
  const preset = HEIGHTS.find(h => h.rows === rows);
  const custom = !preset || customHeight.has(sec.id);
  const [, redraw] = useState(0);
  // Height and vertical alignment work together: a section with vAlign uses them.
  const setRows = (n, click = false) => (click ? pick : set)({ rows: n, vAlign: sec.vAlign || 'top' }, 'section height');
  const pickHeight = v => {
    if (v === 'custom') { customHeight.add(sec.id); redraw(n => n + 1); return; }
    customHeight.delete(sec.id);
    setRows(HEIGHTS.find(h => h.value === v).rows, true);
  };
  const blocks = sec.blocks || [];
  const phoneLayout = blocks.some(b => b.m);
  const resetPhone = () => updateSection(sec.id, s => { for (const b of s.blocks || []) b.m = null; }, { label: 'reset phone layout' });
  return html`
    <${Field} label="Section height" value=${custom ? (rows <= 1 ? 'Fits the content' : `${rows} rows`) : preset.label}>
      <${Segmented} value=${custom ? 'custom' : preset.value} options=${HEIGHT_OPTIONS} onChange=${pickHeight} />
    <//>
    ${custom ? html`<${Field}><${Slider} value=${rows} min=${1} max=${40} onChange=${setRows} /><//>` : null}
    <p class="help se-under">The section grows by itself when its blocks need more room.</p>
    <${WidthFields} sec=${sec} set=${set} pick=${pick} />
    <${Field} label="Vertical alignment" help="Where the content sits when the section is taller than it.">
      <${Segmented} value=${['middle', 'bottom'].includes(sec.vAlign) ? sec.vAlign : 'top'} options=${VALIGN}
        onChange=${v => pick({ vAlign: v }, 'vertical alignment')} />
    <//>
    <div class="subhead">Spacing</div>
    <${SpacingFields} sec=${sec} set=${set} />
    <${Field} label="Space between blocks" value=${`${sec.gap ?? 16}px`}>
      <${Slider} value=${sec.gap ?? 16} min=${0} max=${60} unit="px" onChange=${n => set({ gap: n }, 'space between blocks')} />
    <//>
    <div class="subhead">Phones</div>
    <p class="help se-under">${phoneLayout ? 'This section has its own phone layout.' : 'On phones the blocks stack in reading order.'}</p>
    <${Button} small kind="secondary" icon="refresh" disabled=${!phoneLayout} onClick=${resetPhone}>Reset phone layout<//>
    <p class="note se-hint se-addhint"><${Icon} name="plus" size=${14} /> To add text, images or buttons, click Add Block at the top left of the section.</p>`;
}

// Design tab of lists, article lists, forms and spacers.
function SectionDesign({ sec, set, pick }) {
  return html`
    <${WidthFields} sec=${sec} set=${set} pick=${pick} />
    <div class="subhead">Spacing</div>
    <${SpacingFields} sec=${sec} set=${set} />`;
}

function defaultWidth(type) {
  try { return SECTION_TYPES[type].make().width || 900; } catch { return 900; }
}

function WidthFields({ sec, set, pick }) {
  const inset = typeof sec.width === 'number' && sec.width > 0;
  const toFull = () => { if (inset) lastWidth.set(sec.id, sec.width); pick({ width: null }, 'content width'); };
  const toInset = () => pick({ width: sec.width || lastWidth.get(sec.id) || defaultWidth(sec.type) }, 'content width');
  return html`
    <${Field} label="Content width" value=${inset ? `${sec.width}px` : 'Full'}>
      <${Segmented} value=${inset ? 'inset' : 'full'} options=${[{ value: 'full', label: 'Full' }, { value: 'inset', label: 'Inset' }]}
        onChange=${v => (v === 'full' ? toFull() : toInset())} />
    <//>
    ${inset ? html`
      <${Field} label="Inset width" value=${`${sec.width}px`}>
        <${Slider} value=${sec.width} min=${300} max=${1600} step=${10} unit="px" onChange=${w => set({ width: w }, 'content width')} />
      <//>
      <${Field} label="Position">
        <${Segmented} value=${sec.align === 'center' || sec.align === 'right' ? sec.align : 'left'} options=${ALIGN3}
          onChange=${a => pick({ align: a }, 'content position')} />
      <//>` : null}`;
}

function SpacingFields({ sec, set }) {
  return html`
    <${SpaceField} label="Space above" value=${sec.spaceAbove || 0} onChange=${v => set({ spaceAbove: v }, 'space above')} />
    <${SpaceField} label="Space below" value=${typeof sec.space === 'number' ? sec.space : 48} onChange=${v => set({ space: v }, 'space below')} />`;
}

// ---------- colors shared by Background and Colors ----------

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const DEFAULT_BG = '#f2f2f0';

function normHex(c) {
  const v = String(c || '').toLowerCase();
  return /^#[0-9a-f]{3}$/.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

function rgbOf(c) {
  const v = normHex(c);
  return /^#[0-9a-f]{6}/.test(v) ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) : [0, 0, 0];
}

function luminance(c) {
  const [r, g, b] = rgbOf(c).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// a, moved toward b by t (0 to 1).
function mix(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// Quick picks: a soft gray plus the colors already used in Site Styles.
function designSwatches(design) {
  const seen = new Set();
  const out = [];
  for (const c of [DEFAULT_BG, ...Object.values(design.colors || {}), design.lightbox?.background]) {
    if (typeof c !== 'string' || !HEX_COLOR.test(c)) continue;
    const k = normHex(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function Swatches({ colors, value, onPick, label }) {
  const v = normHex(value);
  return html`<div class="se-swatches" role="group" aria-label=${label}>
    ${colors.map(c => html`<button type="button" class=${`se-sw${c === v ? ' on' : ''}`} style=${`background:${c}`} title=${c} aria-label=${`${label}: ${c}`} onClick=${() => onPick(c)}></button>`)}
  </div>`;
}

// ---------- Background ----------

const BG_MODES = [{ value: 'none', label: 'None' }, { value: 'color', label: 'Color' }, { value: 'image', label: 'Image' }];

function BackgroundTab({ sec, site, set, pick }) {
  const actual = sec.bgImage ? 'image' : HEX_COLOR.test(sec.bg || '') ? 'color' : 'none';
  const [choosing, setChoosing] = useState(false); // Image picked, no image chosen yet
  const mode = choosing && actual !== 'image' ? 'image' : actual;
  const choose = m => {
    if (m === mode) return;
    if (m === 'image') {
      const prev = lastImage.get(sec.id);
      if (prev && site.media[prev]) pick({ bgImage: prev }, 'background image');
      else setChoosing(true);
      return;
    }
    setChoosing(false);
    if (sec.bgImage) lastImage.set(sec.id, sec.bgImage);
    if (m === 'none') {
      if (HEX_COLOR.test(sec.bg || '')) lastBg.set(sec.id, sec.bg);
      pick({ bg: '', bgImage: null }, 'background');
    } else {
      pick({ bg: HEX_COLOR.test(sec.bg || '') ? sec.bg : (lastBg.get(sec.id) || DEFAULT_BG), bgImage: null }, 'background color');
    }
  };
  return html`
    <${Field} label="Background">
      <${Segmented} value=${mode} options=${BG_MODES} onChange=${choose} />
    <//>
    ${mode === 'none' ? html`<p class="help se-under">The section uses the page's background. Pick Color or Image to give it its own.</p>` : null}
    ${mode === 'color' ? html`<${ColorBackground} sec=${sec} site=${site} set=${set} pick=${pick} />` : null}
    ${mode === 'image' ? html`<${ImageBackground} sec=${sec} site=${site} set=${set} pick=${pick} setChoosing=${setChoosing} />` : null}
    ${mode !== 'none' ? html`
      <div class="subhead">Size</div>
      <${Toggle} label="Extend to the edges of the screen" help=${sec.bgFull === false ? 'The background stays behind the section itself.' : 'The background reaches both sides of the window.'}
        checked=${sec.bgFull !== false} onChange=${v => pick({ bgFull: v }, 'background width')} />
      <${Field} label="Inner spacing" value=${`${sec.pad ?? 48}px`} help="Space between the edge of the background and the content, above and below.">
        <${Slider} value=${sec.pad ?? 48} min=${0} max=${200} unit="px" onChange=${n => set({ pad: n }, 'inner spacing')} />
      <//>` : null}`;
}

function ColorBackground({ sec, site, set, pick }) {
  return html`<${Field} label="Color">
    <${ColorInput} value=${sec.bg} onChange=${c => set({ bg: c }, 'background color')} />
    <${Swatches} colors=${designSwatches(site.design)} value=${sec.bg} label="Background color" onPick=${c => pick({ bg: c }, 'background color')} />
  <//>
  <p class="help se-under">Themes in the Colors tab set the background and the text color together.</p>`;
}

function ImageBackground({ sec, site, set, pick, setChoosing }) {
  const m = sec.bgImage ? site.media[sec.bgImage] : null;
  const chooseImage = () => openModal('mediaPicker', {
    multiple: false,
    onPick: picked => {
      const id = [].concat(picked)[0];
      if (!id) return;
      pick({ bgImage: id }, 'background image');
      setChoosing(false);
    },
  });
  // Image stays picked, with an empty box for another picture.
  const remove = () => {
    lastImage.delete(sec.id);
    setChoosing(true);
    pick({ bgImage: null }, 'remove background image');
  };
  if (!sec.bgImage) {
    return html`<button type="button" class="dropzone se-bgadd" onClick=${chooseImage}>
      <${Icon} name="image" size=${24} />
      <b>Add an image</b>
      <span class="muted">It fills the whole section, behind the content.</span>
    </button>`;
  }
  if (!m) {
    return html`<p class="note warn">This image is no longer in your Asset Library.</p>
      <${Button} small kind="secondary" onClick=${chooseImage}>Choose another image<//>`;
  }
  const focal = Array.isArray(sec.bgFocal) && sec.bgFocal.length === 2 ? sec.bgFocal : [50, 50];
  const ov = sec.bgOverlay && HEX_COLOR.test(sec.bgOverlay.color || '') ? sec.bgOverlay : null;
  const setOverlay = (patch, click = false) => (click ? pick : set)({ bgOverlay: { color: ov?.color || '#000000', opacity: ov?.opacity ?? 30, ...patch } }, 'image overlay');
  return html`
    <${FocalPicker} media=${m} value=${focal} onChange=${f => set({ bgFocal: f }, 'focal point')} />
    <p class="help se-under">Click or drag on the image to choose the part that always stays in view.</p>
    <div class="se-bgacts">
      <${Button} small kind="secondary" onClick=${chooseImage}>Replace image<//>
      <button type="button" class="linkbtn" onClick=${remove}>Remove</button>
    </div>
    <div class="subhead">Overlay</div>
    <${Toggle} label="Color overlay" help=${ov ? null : 'A see-through color over the image makes text easier to read.'} checked=${!!ov}
      onChange=${on => pick({ bgOverlay: on ? { color: '#000000', opacity: 30 } : null }, on ? 'add overlay' : 'remove overlay')} />
    ${ov ? html`
      <${Field} label="Overlay color">
        <${ColorInput} value=${ov.color} onChange=${c => setOverlay({ color: c })} />
        <${Swatches} colors=${designSwatches(site.design)} value=${ov.color} label="Overlay color" onPick=${c => setOverlay({ color: c }, true)} />
      <//>
      <${Field} label="Opacity" value=${`${ov.opacity ?? 30}%`}>
        <${Slider} value=${ov.opacity ?? 30} min=${0} max=${100} unit="%" onChange=${n => setOverlay({ opacity: n })} />
      <//>` : null}`;
}

// The image, whole; clicking or dragging on it moves the focal point.
function FocalPicker({ media, value, onChange }) {
  const ref = useRef(null);
  const [x, y] = value;
  const at = e => {
    const r = ref.current.getBoundingClientRect();
    const px = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
    const py = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100);
    if (px !== x || py !== y) onChange([px, py]);
  };
  const down = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    at(e);
    const move = ev => at(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const key = e => {
    const step = e.shiftKey ? 10 : 2;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onChange([Math.max(0, Math.min(100, x + d[0])), Math.max(0, Math.min(100, y + d[1]))]);
  };
  return html`<div class="se-focal">
    <div class="se-focal-img" ref=${ref} onPointerDown=${down} onKeyDown=${key} tabindex="0" role="slider"
      aria-label="Focal point" aria-valuetext=${`${x}% from the left, ${y}% from the top`}>
      <img src=${mediaPreviewUrl(media, 'medium')} alt="" draggable="false" />
      <span class="se-focal-dot" style=${`left:${x}%;top:${y}%`}></span>
    </div>
  </div>`;
}

// ---------- Colors ----------

// Section themes made from the colors in Site Styles, like Squarespace's.
function sectionThemes(design) {
  const c = design.colors || {};
  const ok = (v, fallback) => (HEX_COLOR.test(v || '') ? normHex(v) : fallback);
  const page = ok(c.background, '#ffffff');
  const text = ok(c.text, '#111111');
  const [light, dark] = luminance(page) >= luminance(text) ? [page, text] : [text, page];
  return [
    { id: 'default', label: 'Site default', bg: '', fg: '', show: [page, text] },
    { id: 'light', label: 'Light', bg: mix(light, dark, 0.06), fg: dark },
    { id: 'dark', label: 'Dark', bg: mix(dark, light, 0.2), fg: light },
    { id: 'darkest', label: 'Darkest', bg: dark, fg: light },
    { id: 'accent', label: 'Accent', bg: ok(c.accent, dark), fg: ok(c.accentText, light) },
  ].map(t => ({ ...t, show: t.show || [t.bg, t.fg] }));
}

function ColorsTab({ sec, site, set, pick }) {
  const themes = sectionThemes(site.design);
  const bg = HEX_COLOR.test(sec.bg || '') ? normHex(sec.bg) : '';
  const fg = HEX_COLOR.test(sec.fg || '') ? normHex(sec.fg) : '';
  const current = themes.find(t => t.bg === bg && t.fg === fg)?.id || null;
  const swatches = designSwatches(site.design);
  return html`
    <div class="subhead">Section theme</div>
    <div class="se-themes" role="radiogroup" aria-label="Section theme">
      ${themes.map(t => html`<button type="button" role="radio" aria-checked=${current === t.id ? 'true' : 'false'} data-theme=${t.id}
        class=${`se-theme${current === t.id ? ' on' : ''}`} onClick=${() => pick({ bg: t.bg, fg: t.fg }, 'section colors')}>
        <span class="se-theme-pic" style=${`background:${t.show[0]};color:${t.show[1]}`}>
          <b>Aa</b><i style=${`background:${t.show[1]}`}></i><i class="short" style=${`background:${t.show[1]}`}></i>
        </span>
        <span class="se-theme-nm">${t.label}</span>
      </button>`)}
    </div>
    <p class="help se-under">${sec.bgImage ? 'A theme sets the text color, and the color that shows while the background image loads.' : 'A theme sets the background and the text color together, from your site colors.'}</p>
    <div class="subhead">Text</div>
    <${Field} label="Text color" value=${fg || 'From the theme'}>
      <div class="se-fg">
        <${ColorInput} value=${fg} onChange=${col => set({ fg: col }, 'text color')} />
        ${fg ? html`<button type="button" class="linkbtn" onClick=${() => pick({ fg: '' }, 'text color')}>Default</button>` : null}
      </div>
      <${Swatches} colors=${swatches} value=${fg} label="Text color" onPick=${col => pick({ fg: col }, 'text color')} />
    <//>`;
}

// ---------- article list ----------

function PostsTab({ sec, page, site, set }) {
  const blogs = site.pages.filter(p => p.kind === 'blog');
  const value = sec.blog || (page.kind === 'blog' ? page.id : '');
  const options = [...(blogs.some(b => b.id === value) ? [] : [{ value: '', label: 'Choose a collection…' }]), ...blogs.map(b => ({ value: b.id, label: b.title }))];
  return html`
    ${blogs.length ? html`<${Field} label="Collection" help="Its published articles are listed here by themselves, newest first.">
      <${Select} value=${value} options=${options} onChange=${v => v && set({ blog: v }, 'article collection')} />
    <//>` : html`<p class="note warn">There is no article collection yet. Add one in the Pages panel (Exit, then Pages, then +).</p>`}
    <div class="subhead">Show</div>
    <${Toggle} label="Thumbnail image" checked=${!!sec.showImage} onChange=${v => set({ showImage: v }, 'article list')} />
    <${Toggle} label="Date" checked=${!!sec.showDate} onChange=${v => set({ showDate: v }, 'article list')} />
    <${Toggle} label="Subtitle" checked=${!!sec.showSubtitle} onChange=${v => set({ showSubtitle: v }, 'article list')} />
    <${Toggle} label="Excerpt" checked=${!!sec.showExcerpt} onChange=${v => set({ showExcerpt: v }, 'article list')} />
    <${Field} label="“Read more” link" help="Leave empty to hide the link.">
      <${TextInput} value=${sec.readMore} placeholder="Read More →" onChange=${v => set({ readMore: v }, 'read more text')} />
    <//>
    <p class="help se-under">Article titles, subtitles and excerpts can be edited right on the page, or in each article's settings.</p>`;
}

// ---------- CV ----------

function CvTab({ sec }) {
  const groups = sec.groups || [];
  const edit = (mutate, label, coalesce = null) => updateSection(sec.id, s => { s.groups = s.groups || []; mutate(s); }, { label, coalesce });
  const addList = () => {
    const g = { id: uid('g'), heading: 'NEW LIST:', items: [{ id: uid('i'), year: String(new Date().getFullYear()), html: '' }] };
    focusHeading = g.id;
    edit(s => { s.groups.push(g); }, 'add list');
  };
  return html`
    <p class="note">Each list has a heading and entries. You can also click any entry on the page and type there.</p>
    <div class="se-cv">
      ${groups.map((g, gi) => html`<${CvGroup} key=${g.id} g=${g} gi=${gi} count=${groups.length} edit=${edit} />`)}
    </div>
    <${Button} small kind="secondary" icon="plus" onClick=${addList}>Add a list<//>`;
}

function CvGroup({ g, gi, count, edit }) {
  const items = g.items || [];
  const reorder = useReorder((from, to) => {
    edit(s => { const grp = s.groups.find(x => x.id === g.id); if (grp) moveItem(grp.items, from, to); }, 'reorder entries');
  });
  const inGroup = (s, fn) => { const grp = s.groups.find(x => x.id === g.id); if (grp) fn(grp); };
  const addEntry = () => {
    const it = { id: uid('i'), year: String(new Date().getFullYear()), html: '' };
    focusEntry = it.id;
    edit(s => inGroup(s, grp => { grp.items = grp.items || []; grp.items.unshift(it); }), 'add entry');
  };
  const move = d => edit(s => {
    const k = s.groups.findIndex(x => x.id === g.id);
    if (k < 0 || k + d < 0 || k + d >= s.groups.length) return;
    moveItem(s.groups, k, k + d);
  }, 'move list');
  const removeGroup = async () => {
    if (items.length) {
      const ok = await confirmDialog({
        title: `Delete the list "${(g.heading || 'Untitled').replace(/:$/, '')}"?`,
        message: `Its ${items.length} entr${items.length === 1 ? 'y is' : 'ies are'} deleted too. You can undo this right away with the Undo button.`,
        confirmLabel: 'Delete list',
        danger: true,
      });
      if (!ok) return;
    }
    edit(s => { s.groups = s.groups.filter(x => x.id !== g.id); }, 'delete list');
  };
  const takeFocus = focusHeading === g.id;
  if (takeFocus) focusHeading = null;
  return html`<div class="cvg se-cvg">
    <div class="cvg-head">
      <${TextInput} value=${g.heading} placeholder="LIST HEADING:" autoFocus=${takeFocus} aria-label="List heading"
        onChange=${v => edit(s => inGroup(s, grp => { grp.heading = v; }), 'list heading', `cvh:${g.id}`)} />
      <${IconButton} small icon="up" label="Move list up" disabled=${gi === 0} onClick=${() => move(-1)} />
      <${IconButton} small icon="down" label="Move list down" disabled=${gi === count - 1} onClick=${() => move(1)} />
      <${IconButton} small icon="trash" label="Delete list" onClick=${removeGroup} />
    </div>
    <div class="se-cv-add">
      <button type="button" class="linkbtn" onClick=${addEntry}><${Icon} name="plus" size=${14} /> Add entry</button>
      <span class="muted">${items.length} entr${items.length === 1 ? 'y' : 'ies'}</span>
    </div>
    ${items.map((it, i) => html`<${CvRow} key=${it.id} it=${it} gid=${g.id} props=${reorder(i)} edit=${edit} inGroup=${inGroup} />`)}
  </div>`;
}

function CvRow({ it, gid, props: p, edit, inGroup }) {
  const rowRef = useRef(null);
  const setEntry = (patch, label, key) => edit(s => inGroup(s, grp => {
    const e = (grp.items || []).find(x => x.id === it.id);
    if (e) Object.assign(e, patch);
  }), label, key);
  const remove = () => {
    edit(s => inGroup(s, grp => { grp.items = grp.items.filter(x => x.id !== it.id); }), 'delete entry');
    toast('Entry deleted.', { action: { label: 'Undo', onClick: undo } });
  };
  const takeFocus = focusEntry === it.id;
  if (takeFocus) focusEntry = null;
  return html`<div ref=${rowRef} class=${`cvi${p.class ? ` ${p.class}` : ''}`} data-entry=${it.id} data-group=${gid} onDragOver=${p.onDragOver} onDrop=${p.onDrop}>
    <span class="grip" draggable="true" title="Drag to reorder"
      onDragStart=${e => { p.onDragStart(e); rowRef.current.classList.add('dragging'); try { e.dataTransfer.setDragImage(rowRef.current, 12, 14); } catch {} }}
      onDragEnd=${e => { p.onDragEnd(e); rowRef.current?.classList.remove('dragging'); }}><${Icon} name="grip" size=${16} /></span>
    <${TextInput} value=${it.year} placeholder="Year" aria-label="Year" onChange=${v => setEntry({ year: v }, 'edit year', `cvy:${it.id}`)} />
    <${RichLine} compact link value=${it.html} placeholder="Title, venue, city" label="Entry" autoFocus=${takeFocus}
      onChange=${v => setEntry({ html: v }, 'edit entry', `cvt:${it.id}`)} />
    <${IconButton} small icon="trash" label="Delete entry" onClick=${remove} />
  </div>`;
}

// ---------- spacer ----------

function SpacerTab({ sec, set }) {
  return html`
    <${Field} label="Height" value=${`${sec.height ?? 48}px`}>
      <${Slider} value=${sec.height ?? 48} min=${0} max=${400} unit="px" onChange=${n => set({ height: n }, 'spacer height')} />
    <//>
    <${Toggle} label="Show a line" help="A thin line across the middle of the space." checked=${!!sec.line} onChange=${v => set({ line: v }, v ? 'show line' : 'hide line')} />
    ${sec.line ? html`<p class="help se-under">The line color is the "Lines" color in Site Styles.</p>` : null}`;
}

// ---------- contact form ----------

function FormTab({ sec, site, set }) {
  const endpoint = (sec.endpoint || '').trim();
  const fallback = (site.settings.formEndpoint || '').trim();
  const f = sec.fields || {};
  const setField = (k, v) => set({ fields: { ...f, [k]: v } }, 'form fields');
  let status;
  if (endpoint && !/^https:\/\/\S+$/.test(endpoint)) status = html`<p class="note warn se-hint">The address should start with https://</p>`;
  else if (/formspree\.io/i.test(endpoint) && !/formspree\.io\/f\/\w+/i.test(endpoint)) status = html`<p class="note warn se-hint">This looks like a Formspree page, not a form address. The address you need looks like https://formspree.io/f/abcdwxyz.</p>`;
  else if (endpoint) status = html`<p class="note ok se-hint"><${Icon} name="check" size=${14} /> The form is on. Messages go to this address.</p>`;
  else if (fallback) status = html`<p class="note ok se-hint"><${Icon} name="check" size=${14} /> The form is on. It uses the address from Settings.</p>`;
  else status = html`<p class="note warn se-hint">The form is off until it has an address, here or in Settings. It does not show on the live site until then.</p>`;
  return html`
    <div class="note se-steps">
      <b>How to switch the form on</b>
      <ol>
        <li>Make a free account at <a href="https://formspree.io" target="_blank" rel="noopener">formspree.io</a>.</li>
        <li>Create a new form there and copy its address. It looks like https://formspree.io/f/abcdwxyz</li>
        <li>Paste it below. Messages then arrive in your email.</li>
      </ol>
      Leave the box empty to use the address from Settings.
    </div>
    <${Field} label="Form address">
      <${TextInput} value=${sec.endpoint} placeholder=${fallback || 'https://formspree.io/f/…'} onChange=${v => set({ endpoint: v.trim() }, 'form address')} />
    <//>
    ${status}
    <div class="subhead">Fields</div>
    <${Toggle} label="Name" checked=${!!f.name} onChange=${v => setField('name', v)} />
    <${Toggle} label="Email" help=${f.email ? null : 'Without it you cannot reply to messages.'} checked=${!!f.email} onChange=${v => setField('email', v)} />
    <${Toggle} label="Subject" checked=${!!f.subject} onChange=${v => setField('subject', v)} />
    <${Toggle} label="Message" checked=${!!f.message} onChange=${v => setField('message', v)} />
    <div class="subhead">Text</div>
    <${Field} label="Button label"><${TextInput} value=${sec.buttonLabel} placeholder="Send" onChange=${v => set({ buttonLabel: v }, 'button label')} /><//>
    <${Field} label="Message after sending">
      <${TextInput} multiline rows=${2} value=${sec.successMessage} placeholder="Thank you! Your message has been sent." onChange=${v => set({ successMessage: v }, 'success message')} />
    <//>`;
}
