// Site Styles, modeled on Squarespace 7.1: a list of style categories, each
// opening its own view inside the same floating panel. Every control writes to
// site.design through updateSite(), so each change can be undone and the
// preview restyles itself as you go.

import {
  html, useState, useEffect, useRef, Icon, IconButton, Field, Toggle, Segmented, Slider, ColorInput, FontPicker, FloatingPanel,
  loadAllFonts,
} from '../ui.js';
import { useStore, getState, setState, updateSite, confirmDialog, undo, redo, canUndo, canRedo } from '../store.js';
import { DEFAULT_DESIGN, fontById } from '../../engine/schema.js';

// ---------- reading and writing design values ----------

const clone = v => JSON.parse(JSON.stringify(v));

export function getIn(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setIn(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = obj;
  for (const k of keys) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[last] = value;
}

// Sets one value in site.design ("text.h1"). `drag` is for sliders, color
// pickers and other continuous controls: one drag becomes one undo step.
export function setDesign(path, value, label, drag = false) {
  if (getIn(getState().site.design, path) === value) return;
  updateSite(site => setIn(site.design, path, value), { label, coalesce: drag ? `design:${path}` : null });
}

const decimals = step => (String(step).split('.')[1] || '').length;

// A labeled slider bound to one design value.
export function SliderField({ label, path, min, max, step = 1, unit = 'px', undo, help }) {
  const value = useStore(s => getIn(s.site.design, path));
  const dec = decimals(step);
  const change = v => setDesign(path, Number(Number(v).toFixed(dec)), undo || label.toLowerCase(), true);
  return html`<${Field} label=${label} help=${help}>
    <${Slider} value=${value} min=${min} max=${max} step=${step} unit=${unit} onChange=${change} />
  <//>`;
}

// ---------- color helpers ----------

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

export function luminance(hex) {
  const c = rgbOf(hex);
  if (!c) return null;
  const [r, g, b] = c.map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio, 1 to 21. Unknown colors count as readable.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return 21;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// ---------- choices offered ----------

export const LAYOUTS = [
  { id: 'sidebar', label: 'Sidebar on the left', desc: 'Title and menu in a column beside your pages' },
  { id: 'topbar', label: 'Top bar', desc: 'Title on the left, menu across the top' },
  { id: 'centered', label: 'Centered', desc: 'Title in the middle, menu below it' },
];

const WEIGHTS = [
  { value: 400, label: 'Normal' },
  { value: 600, label: 'Semi-bold' },
  { value: 700, label: 'Bold' },
];

const ACTIVE_STYLES = [
  { value: 'italic', label: 'Italic' },
  { value: 'underline', label: 'Underline' },
  { value: 'bold', label: 'Bold' },
  { value: 'none', label: 'None' },
];

const BUTTON_STYLES = [
  { value: 'outline', label: 'Outline' },
  { value: 'solid', label: 'Solid' },
  { value: 'link', label: 'Text link' },
];

const ANIMATIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade in' },
  { value: 'rise', label: 'Slide up' },
];

const FONT_PACKS = [
  { id: 'original', name: 'Original', fonts: { title: 'system', nav: 'system', heading: 'system', body: 'system' } },
  { id: 'garamond', name: 'Garamond', fonts: { title: 'eb-garamond', nav: 'system', heading: 'eb-garamond', body: 'system' } },
  { id: 'modern', name: 'Modern', fonts: { title: 'inter', nav: 'inter', heading: 'inter', body: 'inter' } },
  { id: 'editorial', name: 'Editorial', fonts: { title: 'playfair-display', nav: 'work-sans', heading: 'playfair-display', body: 'work-sans' } },
  { id: 'classic', name: 'Classic', fonts: { title: 'libre-baskerville', nav: 'lora', heading: 'libre-baskerville', body: 'lora' } },
  { id: 'typewriter', name: 'Typewriter', fonts: { title: 'courier-prime', nav: 'courier-prime', heading: 'courier-prime', body: 'courier-prime' } },
  { id: 'elegant', name: 'Elegant', fonts: { title: 'cormorant-garamond', nav: 'jost', heading: 'cormorant-garamond', body: 'jost' } },
  { id: 'contemporary', name: 'Contemporary', fonts: { title: 'dm-serif-display', nav: 'dm-sans', heading: 'dm-serif-display', body: 'dm-sans' } },
];

const FONT_ROLES = [
  { role: 'title', label: 'Site title' },
  { role: 'nav', label: 'Navigation' },
  { role: 'heading', label: 'Headings' },
  { role: 'body', label: 'Paragraphs' },
];

// Every palette keeps titles, paragraphs, captions and links at a contrast of
// 7:1 or more with the background, and sets the image viewer to match.
const PALETTES = [
  { id: 'white', name: 'Original white', colors: { ...DEFAULT_DESIGN.colors }, lightbox: DEFAULT_DESIGN.lightbox.background },
  {
    id: 'paper', name: 'Warm paper', lightbox: '#f6f1e7',
    colors: { background: '#f6f1e7', text: '#2a2420', paragraph: '#3b332c', muted: '#7d7265', caption: '#4a4038', link: '#2a2420', accent: '#2a2420', accentText: '#f6f1e7', line: '#e2d9c8' },
  },
  {
    id: 'gray', name: 'Gallery gray', lightbox: '#ebebe8',
    colors: { background: '#ebebe8', text: '#161616', paragraph: '#262626', muted: '#6b6b67', caption: '#333331', link: '#161616', accent: '#161616', accentText: '#ffffff', line: '#d3d3cf' },
  },
  {
    id: 'sage', name: 'Soft sage', lightbox: '#eef0e9',
    colors: { background: '#eef0e9', text: '#1e2a22', paragraph: '#2c3830', muted: '#68766b', caption: '#3a463d', link: '#2d5639', accent: '#2d4535', accentText: '#ffffff', line: '#d6dccf' },
  },
  {
    id: 'ink', name: 'Ink blue', lightbox: '#ffffff',
    colors: { background: '#ffffff', text: '#1b2a4e', paragraph: '#27365a', muted: '#76809a', caption: '#33405f', link: '#2549a6', accent: '#1b2a4e', accentText: '#ffffff', line: '#e1e5ee' },
  },
  {
    id: 'night', name: 'Night (dark)', lightbox: '#0b0b0b',
    colors: { background: '#111111', text: '#f2f2f2', paragraph: '#d4d4d4', muted: '#8c8c8c', caption: '#bdbdbd', link: '#f2f2f2', accent: '#f2f2f2', accentText: '#111111', line: '#2e2e2e' },
  },
];

const COLOR_FIELDS = [
  { key: 'background', label: 'Background', hint: 'Behind everything' },
  { key: 'text', label: 'Titles & menu', hint: 'Site title, headings, menu' },
  { key: 'paragraph', label: 'Paragraphs', hint: 'Body text' },
  { key: 'muted', label: 'Small gray text', hint: 'Dates and notes' },
  { key: 'caption', label: 'Captions', hint: 'Text under images' },
  { key: 'link', label: 'Links', hint: 'Links inside text' },
  { key: 'accent', label: 'Buttons', hint: 'Button color' },
  { key: 'accentText', label: 'Button text', hint: 'Text on solid buttons' },
  { key: 'line', label: 'Lines', hint: 'Dividers and quote lines' },
];

const samePack = (a, b) => FONT_ROLES.every(({ role }) => a[role] === b[role]);
const packOf = fonts => FONT_PACKS.find(p => samePack(p.fonts, fonts)) || null;
const paletteOf = colors => PALETTES.find(p => COLOR_FIELDS.every(({ key }) => sameColor(p.colors[key], colors[key]))) || null;
const shortFont = id => (id === 'system' ? 'System' : fontById(id).label);
const oneLine = s => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
const weightName = w => (WEIGHTS.find(o => o.value === Number(w))?.label || `Weight ${w}`).toLowerCase();
const layoutName = id => (LAYOUTS.find(l => l.id === id) || LAYOUTS[0]).label;

// ---------- actions ----------

function applyPack(pack) {
  if (samePack(pack.fonts, getState().site.design.fonts)) return;
  updateSite(site => { site.design.fonts = clone(pack.fonts); }, { label: 'font pack' });
}

function applyPalette(pal) {
  const d = getState().site.design;
  if (paletteOf(d.colors) === pal && sameColor(d.lightbox.background, pal.lightbox)) return;
  updateSite(site => {
    site.design.colors = clone(pal.colors);
    site.design.lightbox = { ...site.design.lightbox, background: pal.lightbox };
  }, { label: 'color palette' });
}

// The style of every button on the site (button sections and button blocks).
function buttonStyles(site) {
  const out = [];
  for (const p of site.pages) {
    for (const s of p.sections) {
      if (s.type === 'button') out.push(s.style);
      if (s.type === 'blocks') for (const b of s.blocks || []) if (b.kind === 'button') out.push(b.style);
    }
  }
  return out;
}

const countButtons = site => buttonStyles(site).length;

// The site-wide button style also restyles every button already on the site,
// the way Squarespace's button styles apply everywhere at once.
function setButtonStyle(style) {
  const site0 = getState().site;
  if (site0.design.buttons.style === style && buttonStyles(site0).every(s => s === style)) return;
  updateSite(site => {
    site.design.buttons.style = style;
    for (const p of site.pages) {
      for (const s of p.sections) {
        if (s.type === 'button') s.style = style;
        if (s.type === 'blocks') for (const b of s.blocks || []) if (b.kind === 'button') b.style = style;
      }
    }
  }, { label: 'button style' });
}

async function resetStyles() {
  const ok = await confirmDialog({
    title: 'Reset all styles?',
    message: 'Fonts, colors, text sizes, the header layout, navigation and buttons go back to the original design. Your pages, images and logo stay as they are. You can undo this with the Undo button.',
    confirmLabel: 'Reset styles',
    danger: true,
  });
  if (!ok) return;
  updateSite(site => {
    const logo = site.design.logo;
    site.design = clone(DEFAULT_DESIGN);
    if (logo) site.design.logo = logo;
  }, { label: 'reset styles' });
}

// ---------- hints shown in the category list ----------

function fontsHint(d) {
  const head = fontById(d.fonts.heading).label;
  const body = fontById(d.fonts.body).label;
  const names = head === body ? head : `${head} and ${body}`;
  const pack = packOf(d.fonts);
  return pack ? `${pack.name}: ${names}` : names;
}

function Dots({ colors }) {
  return html`<span class="st-dots" aria-hidden="true">${colors.map(c => html`<i style=${`background:${c}`}></i>`)}</span>`;
}

function colorsHint(d) {
  const c = d.colors;
  const pal = paletteOf(c);
  return html`<${Dots} colors=${[c.background, c.text, c.paragraph, c.accent, c.line]} />${pal ? pal.name : 'Custom colors'}`;
}

function textHint(d) {
  return `Paragraphs ${d.text.p}px, headings ${d.text.h1}px, line spacing ${d.text.lineHeight}`;
}

function titleHint(d) {
  const t = d.title;
  const parts = [`${t.size}px`, weightName(t.weight)];
  if (t.italic) parts.push('italic');
  if (t.uppercase) parts.push('uppercase');
  if (d.logo?.media) parts.push('logo shown instead');
  return parts.join(', ');
}

function navHint(d) {
  const n = d.nav;
  const active = {
    italic: 'current page in italic', underline: 'current page underlined', bold: 'current page in bold', none: 'current page not marked',
  }[n.active];
  return [`${n.size}px`, n.uppercase ? 'uppercase' : null, active].filter(Boolean).join(', ');
}

function buttonsHint(d) {
  const b = d.buttons;
  const style = (BUTTON_STYLES.find(o => o.value === b.style) || BUTTON_STYLES[0]).label;
  return [style, Number(b.radius) > 0 ? `rounded corners (${b.radius}px)` : 'square corners', b.uppercase ? 'uppercase' : null]
    .filter(Boolean).join(', ');
}

function imagesHint(d) {
  return html`<${Dots} colors=${[d.lightbox.background]} />Lightbox background ${String(d.lightbox.background).toUpperCase()}`;
}

// Squarespace's order (Themes, Fonts, Colors, Buttons, Animations, Spacing),
// then the lightbox, the site title and the menu. Views with a `parent` open
// from inside another view (Fonts > Headings) and are not listed on the first page.
const VIEWS = [
  { id: 'themes', title: 'Themes', View: ThemesView, hint: themesHint },
  { id: 'fonts', title: 'Fonts', View: FontsView, hint: fontsHint },
  { id: 'colors', title: 'Colors', View: ColorsView, hint: colorsHint },
  { id: 'buttons', title: 'Buttons', View: ButtonsView, hint: buttonsHint },
  { id: 'animations', title: 'Animations', View: AnimationsView, hint: d => (ANIMATIONS.find(a => a.value === d.animation) || ANIMATIONS[0]).label },
  { id: 'layout', title: 'Spacing', View: LayoutView, hint: d => `${layoutName(d.layout)}, margins ${d.spacing.padX}px` },
  { id: 'images', title: 'Lightbox', View: ImagesView, hint: imagesHint },
  { id: 'title', title: 'Site title', View: TitleView, hint: titleHint },
  { id: 'nav', title: 'Navigation', View: NavView, hint: navHint },
  { id: 'headings', parent: 'fonts', title: 'Headings', View: HeadingsView, hint: d => `${shortFont(d.fonts.heading)}, ${d.text.h1}px` },
  { id: 'paragraphs', parent: 'fonts', title: 'Paragraphs', View: ParagraphsView, hint: d => `${shortFont(d.fonts.body)}, ${d.text.p}px` },
  { id: 'buttonfont', parent: 'fonts', title: 'Buttons', View: ButtonFontView, hint: d => `${shortFont(d.fonts.nav)}${d.buttons.uppercase ? ', uppercase' : ''}` },
  { id: 'misc', parent: 'fonts', title: 'Miscellaneous', View: MiscView, hint: d => `Site title, captions, small text` },
  { id: 'text', parent: 'fonts', title: 'Text sizes', View: TextView, hint: textHint },
];
const FONT_PARTS = ['headings', 'paragraphs', 'buttonfont', 'misc'];

// ---------- Themes: fonts, colors and buttons together ----------

const THEMES = [
  { id: 'original', name: 'Original', pack: 'original', palette: 'white', buttons: 'outline' },
  { id: 'gallery', name: 'Gallery', pack: 'garamond', palette: 'gray', buttons: 'outline' },
  { id: 'modern', name: 'Modern', pack: 'modern', palette: 'white', buttons: 'solid' },
  { id: 'editorial', name: 'Editorial', pack: 'editorial', palette: 'paper', buttons: 'link' },
  { id: 'classic', name: 'Classic', pack: 'classic', palette: 'paper', buttons: 'outline' },
  { id: 'botanical', name: 'Botanical', pack: 'elegant', palette: 'sage', buttons: 'outline' },
  { id: 'studio', name: 'Studio', pack: 'typewriter', palette: 'white', buttons: 'outline' },
  { id: 'night', name: 'Night', pack: 'contemporary', palette: 'night', buttons: 'solid' },
];

function themeOf(d) {
  return THEMES.find(t => {
    const pack = FONT_PACKS.find(p => p.id === t.pack);
    const pal = PALETTES.find(p => p.id === t.palette);
    return pack && pal && JSON.stringify(pack.fonts) === JSON.stringify(d.fonts)
      && Object.entries(pal.colors).every(([k, v]) => String(d.colors[k]).toLowerCase() === String(v).toLowerCase())
      && d.buttons.style === t.buttons;
  }) || null;
}

function themesHint(d) {
  const t = themeOf(d);
  return t ? t.name : 'Custom';
}

function applyTheme(t) {
  const pack = FONT_PACKS.find(p => p.id === t.pack);
  const pal = PALETTES.find(p => p.id === t.palette);
  updateSite(site => {
    site.design.fonts = clone(pack.fonts);
    site.design.colors = { ...site.design.colors, ...clone(pal.colors) };
    if (pal.lightbox) site.design.lightbox.background = pal.lightbox;
    site.design.buttons.style = t.buttons;
  }, { label: `${t.name} theme` });
}

function ThemesView({ design }) {
  useEffect(() => { loadAllFonts(); }, []);
  const current = themeOf(design);
  return html`
    <p class="help st-intro">A theme changes your fonts, colors and buttons together. You can still adjust each one afterwards.</p>
    <div class="st-themes">
      ${THEMES.map(t => {
        const pack = FONT_PACKS.find(p => p.id === t.pack);
        const pal = PALETTES.find(p => p.id === t.palette);
        const title = fontById(pack.fonts.title);
        const body = fontById(pack.fonts.body);
        const c = pal.colors;
        return html`<button type="button" class=${`st-theme${current?.id === t.id ? ' on' : ''}`} onClick=${() => applyTheme(t)}>
          <span class="st-theme-pic" style=${`background:${c.background};color:${c.text}`}>
            <span class="st-theme-title" style=${`font-family:${title.stack}`}>${(getState().site.settings.siteName || 'Your Name').toUpperCase()}</span>
            <span class="st-theme-body" style=${`font-family:${body.stack};color:${c.paragraph}`}>Paintings and drawings from the studio.</span>
            <span class=${`st-theme-btn ${t.buttons}`} style=${`--acc:${c.accent};--acc-t:${c.accentText}`}>View work</span>
          </span>
          <span class="st-theme-name">${t.name}</span>
        </button>`;
      })}
    </div>`;
}

// ---------- the panel ----------

// Opens on the category list, or on a category when editPanel.view names one
// (the Site Header panel's "More styles" opens "Site title").
export function DesignPanel({ onClose }) {
  const design = useStore(s => s.site.design);
  const requested = useStore(s => s.stylesView || s.editPanel?.view || null);
  const known = id => VIEWS.some(v => v.id === id);
  const [view, setView] = useState(known(requested) ? requested : 'home');
  useEffect(() => { if (known(requested)) setView(requested); }, [requested]);
  const ref = useRef(null);
  useEffect(() => {
    const body = ref.current && ref.current.closest('.fpanel-body');
    if (body) body.scrollTop = 0;
  }, [view]);
  const current = VIEWS.find(v => v.id === view);
  useStore(s => s.revision);
  // Undo and redo at the top of the panel, as in Squarespace.
  const actions = html`
    <${IconButton} small icon="undo" label="Undo" disabled=${!canUndo()} onClick=${undo} />
    <${IconButton} small icon="redo" label="Redo" disabled=${!canRedo()} onClick=${redo} />`;
  return html`<${FloatingPanel} title=${current ? current.title : 'Site Styles'} onClose=${onClose} onBack=${current ? () => setView(current.parent || 'home') : null} actions=${actions}>
    <div class=${`st-panel st-view-${view}`} ref=${ref}>
      ${current ? html`<${current.View} design=${design} onOpen=${setView} />` : html`<${HomeView} design=${design} onOpen=${setView} />`}
    </div>
  <//>`;
}

// A list of rows that each open a view.
function ViewList({ ids, design, onOpen }) {
  return html`<ul class="style-list st-list">
    ${ids.map(id => VIEWS.find(v => v.id === id)).map(v => html`<li key=${v.id}>
      <button type="button" onClick=${() => onOpen(v.id)}>
        <span class="st-row"><span class="st-row-name">${v.title}</span><span class="hint">${v.hint(design)}</span></span>
        <span class="chev"><${Icon} name="chevR" size=${16} /></span>
      </button>
    </li>`)}
  </ul>`;
}

function HomeView({ design, onOpen }) {
  return html`
    <${ViewList} ids=${VIEWS.filter(v => !v.parent).map(v => v.id)} design=${design} onOpen=${onOpen} />
    <div class="st-reset">
      <button type="button" class="linkbtn st-danger" onClick=${resetStyles}>Reset all styles to the original design</button>
      <p class="help">Your pages, images and logo are not changed.</p>
    </div>`;
}

// ---------- Fonts ----------

// A collapsed font choice: the font's name shown in that font. Clicking opens the full list.
function FontRow({ role, label, open, onToggle }) {
  useEffect(() => { loadAllFonts(); }, []);
  const id = useStore(s => s.site.design.fonts[role]);
  const f = fontById(id);
  const ref = useRef(null);
  // Bring the whole opened list into view inside the panel.
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(raf);
  }, [open]);
  return html`<div class=${`st-font${open ? ' open' : ''}`} ref=${ref}>
    <div class="st-font-lbl">${label}</div>
    <button type="button" class="st-font-btn" aria-expanded=${open ? 'true' : 'false'} title=${open ? 'Close the font list' : 'Choose a font'} onClick=${onToggle}>
      <span class="st-font-name" style=${`font-family:${f.stack}`}>${f.label}</span>
      <${Icon} name="chevD" size=${16} />
    </button>
    ${open ? html`<div class="st-font-list">
      <${FontPicker} value=${f.id} onChange=${v => setDesign(`fonts.${role}`, v, `${label.toLowerCase()} font`)} />
    </div>` : null}
  </div>`;
}

function FontsView({ design, onOpen }) {
  useEffect(() => { loadAllFonts(); }, []);
  const title = useStore(s => oneLine(s.site.settings.headerTitle || s.site.settings.siteName) || 'Site title');
  const current = packOf(design.fonts);
  const c = design.colors;
  const t = design.title;
  const titleLook = `letter-spacing:${Math.min(0.3, Math.max(0, Number(t.letterSpacing) || 0))}em;text-transform:${t.uppercase ? 'uppercase' : 'none'};font-style:${t.italic ? 'italic' : 'normal'};font-weight:${t.weight}`;
  return html`
    <div class="subhead">Font packs</div>
    <div class="cards st-cards">
      ${FONT_PACKS.map(p => {
        const fam = role => fontById(p.fonts[role]).stack;
        const on = current === p;
        const head = shortFont(p.fonts.heading);
        const body = shortFont(p.fonts.body);
        return html`<button type="button" key=${p.id} class=${`card-opt st-pack${on ? ' on' : ''}`} aria-pressed=${on ? 'true' : 'false'} onClick=${() => applyPack(p)}>
          <span class="st-pack-prev" style=${`background:${c.background};color:${c.text}`}>
            <span class="t" style=${`font-family:${fam('title')};${titleLook}`}>${title}</span>
            <span class="h" style=${`font-family:${fam('heading')};font-weight:${design.text.headingWeight}`}>Recent work</span>
            <span class="p" style=${`font-family:${fam('body')};color:${c.paragraph}`}>Paintings, drawings and notes from the studio.</span>
          </span>
          <span class="st-card-name">${p.name}</span>
          <span class="st-card-sub">${head === body ? head : `${head} + ${body}`}</span>
        </button>`;
      })}
    </div>
    <div class="subhead">Fonts and sizes for each part</div>
    <${ViewList} ids=${FONT_PARTS} design=${design} onOpen=${onOpen} />`;
}

// One font choice that opens in place.
function OneFont({ role, label }) {
  const [open, setOpen] = useState(false);
  return html`<${FontRow} role=${role} label=${label} open=${open} onToggle=${() => setOpen(!open)} />`;
}

function HeadingsView({ design }) {
  return html`
    <${OneFont} role="heading" label="Heading font" />
    <${Field} label="Weight">
      <${Segmented} value=${Number(design.text.headingWeight)} options=${WEIGHTS} onChange=${v => setDesign('text.headingWeight', v, 'heading weight')} />
    <//>
    <${SliderField} label="Letter spacing" path="text.headingLetterSpacing" min=${-0.05} max=${0.3} step=${0.01} unit="em" undo="heading letter spacing" />
    <div class="subhead">Sizes</div>
    <${SliderField} label="Heading 1" path="text.h1" min=${16} max=${96} undo="heading 1 size" />
    <${SliderField} label="Heading 2" path="text.h2" min=${14} max=${72} undo="heading 2 size" />
    <${SliderField} label="Heading 3" path="text.h3" min=${12} max=${48} undo="heading 3 size" />
    <p class="help">Heading 4 is a little larger than the paragraph around it.</p>`;
}

function ParagraphsView() {
  return html`
    <${OneFont} role="body" label="Paragraph font" />
    <div class="subhead">Sizes</div>
    <${SliderField} label="Paragraph 1" path="text.large" min=${12} max=${36} undo="paragraph 1 size" help="Large text." />
    <${SliderField} label="Paragraph 2" path="text.p" min=${11} max=${28} undo="paragraph 2 size" help="The normal size for text on your pages." />
    <${SliderField} label="Paragraph 3" path="text.small" min=${10} max=${24} undo="paragraph 3 size" help="Small text." />
    <${SliderField} label="Line height" path="text.lineHeight" min=${1.2} max=${2} step=${0.05} unit=" " undo="line height" help="Space between the lines of a paragraph." />`;
}

function ButtonFontView({ design }) {
  return html`
    <${OneFont} role="nav" label="Button font" />
    <p class="help st-gap">Buttons share this font with the navigation menu.</p>
    <${Toggle} label="Uppercase" help="Show button text in capital letters." checked=${!!design.buttons.uppercase} onChange=${v => setDesign('buttons.uppercase', v, 'button uppercase')} />`;
}

function MiscView({ onOpen }) {
  return html`
    <${OneFont} role="title" label="Site title font" />
    <button type="button" class="linkbtn st-more" onClick=${() => onOpen('title')}>More site title options <${Icon} name="chevR" size=${14} /></button>
    <div class="subhead">Small text</div>
    <${SliderField} label="Small gray text" path="text.meta" min=${9} max=${24} undo="small gray text size" help="Dates and short notes." />
    <${SliderField} label="Image captions" path="captions.size" min=${9} max=${24} undo="caption size" help="Text under images." />`;
}

// ---------- Colors ----------

function readability(d) {
  const c = d.colors;
  const low = (fg, bg) => contrast(fg, bg) < 3;
  const parts = [];
  if (low(c.text, c.background)) parts.push('titles and the menu');
  if (low(c.paragraph, c.background)) parts.push('paragraphs');
  if (low(c.caption, c.background)) parts.push('captions');
  if (low(c.link, c.background)) parts.push('links');
  if (low(c.accent, c.background)) parts.push('buttons');
  const out = [];
  if (parts.length) out.push(`Hard to read on this background: ${parts.join(', ')}.`);
  if (low(c.accentText, c.accent)) out.push('Button text is hard to read on the button color.');
  return out;
}

function ColorsView({ design }) {
  const c = design.colors;
  const current = paletteOf(c);
  const warn = readability(design);
  return html`
    <div class="subhead">Palettes</div>
    <div class="cards st-cards">
      ${PALETTES.map(p => {
        const on = current === p;
        return html`<button type="button" key=${p.id} class=${`card-opt st-pal${on ? ' on' : ''}`} aria-pressed=${on ? 'true' : 'false'} onClick=${() => applyPalette(p)}>
          <span class="st-pal-strip" aria-hidden="true">
            <span class="bg" style=${`background:${p.colors.background};color:${p.colors.text}`}><b>Aa</b><i style=${`background:${p.colors.muted}`}></i></span>
            ${['paragraph', 'muted', 'accent', 'line'].map(k => html`<span style=${`background:${p.colors[k]}`}></span>`)}
          </span>
          <span class="st-card-name">${p.name}</span>
        </button>`;
      })}
    </div>
    <p class="help st-gap">A palette changes all the colors at once, including the background of the image viewer. You can fine-tune any color below.</p>
    <div class="subhead">Colors</div>
    ${warn.length ? html`<div class="note warn">${warn.map(w => html`<div>${w}</div>`)}</div>` : null}
    <div class="st-colors">
      ${COLOR_FIELDS.map(f => html`<div class="st-color-row" key=${f.key}>
        <span class="st-color-lbl"><span>${f.label}</span><small>${f.hint}</small></span>
        <${ColorInput} value=${c[f.key]} onChange=${v => setDesign(`colors.${f.key}`, v, `${f.label.toLowerCase()} color`, true)} />
      </div>`)}
    </div>`;
}

// ---------- Text ----------

function TextView({ design }) {
  return html`
    <div class="subhead">Headings</div>
    <${SliderField} label="Heading 1" path="text.h1" min=${16} max=${96} undo="heading 1 size" />
    <${SliderField} label="Heading 2" path="text.h2" min=${14} max=${72} undo="heading 2 size" />
    <${SliderField} label="Heading 3" path="text.h3" min=${12} max=${48} undo="heading 3 size" />
    <${Field} label="Heading weight">
      <${Segmented} value=${Number(design.text.headingWeight)} options=${WEIGHTS} onChange=${v => setDesign('text.headingWeight', v, 'heading weight')} />
    <//>
    <${SliderField} label="Heading letter spacing" path="text.headingLetterSpacing" min=${-0.05} max=${0.3} step=${0.01} unit="em" undo="heading letter spacing" />
    <div class="subhead">Paragraphs</div>
    <${SliderField} label="Paragraph 1 (large)" path="text.large" min=${12} max=${36} undo="large paragraph size" />
    <${SliderField} label="Paragraph 2" path="text.p" min=${11} max=${28} undo="paragraph size" help="The normal size for text on your pages." />
    <${SliderField} label="Paragraph 3 (small)" path="text.small" min=${10} max=${24} undo="small paragraph size" />
    <${SliderField} label="Line spacing" path="text.lineHeight" min=${1.2} max=${2} step=${0.05} unit=" " undo="line spacing" help="Space between the lines of a paragraph." />
    <div class="subhead">Small text</div>
    <${SliderField} label="Small gray text" path="text.meta" min=${9} max=${24} undo="small gray text size" help="Dates and short notes." />
    <${SliderField} label="Captions" path="captions.size" min=${9} max=${24} undo="caption size" help="Text under images." />`;
}

// ---------- Site title ----------

function TitleView({ design }) {
  const t = design.title;
  const hasLogo = useStore(s => !!(s.site.design.logo?.media && s.site.media[s.site.design.logo.media]));
  const device = useStore(s => s.device);
  const [fontOpen, setFontOpen] = useState(false);
  return html`
    ${hasLogo ? html`<p class="note">Your logo is shown in place of the site title. These settings apply when there is no logo.</p>` : null}
    <${FontRow} role="title" label="Font" open=${fontOpen} onToggle=${() => setFontOpen(!fontOpen)} />
    <${SliderField} label="Size" path="title.size" min=${10} max=${80} undo="site title size" />
    <${SliderField} label="Letter spacing" path="title.letterSpacing" min=${-0.05} max=${0.6} step=${0.01} unit="em" undo="site title letter spacing" />
    <${Field} label="Weight">
      <${Segmented} value=${Number(t.weight)} options=${WEIGHTS} onChange=${v => setDesign('title.weight', v, 'site title weight')} />
    <//>
    <${Toggle} label="Italic" checked=${!!t.italic} onChange=${v => setDesign('title.italic', v, 'site title italic')} />
    <${Toggle} label="Uppercase" help="Show the title in capital letters." checked=${!!t.uppercase} onChange=${v => setDesign('title.uppercase', v, 'site title uppercase')} />
    <div class="subhead st-subhead-row">
      <span>On phones</span>
      <button type="button" class="linkbtn" onClick=${() => setState({ device: device === 'mobile' ? 'desktop' : 'mobile' })}>${device === 'mobile' ? 'Back to desktop view' : 'Preview on a phone'}</button>
    </div>
    <${SliderField} label="Size on phones" path="title.mobileSize" min=${10} max=${48} undo="site title size on phones" />
    <${SliderField} label="Letter spacing on phones" path="title.mobileLetterSpacing" min=${-0.05} max=${0.6} step=${0.01} unit="em" undo="site title letter spacing on phones" />
    <div class="st-foot">
      <button type="button" class="linkbtn st-more" onClick=${() => setState({ editPanel: { kind: 'header' } })}>Change the title text or add a logo <${Icon} name="chevR" size=${14} /></button>
    </div>`;
}

// ---------- Navigation ----------

function NavView({ design }) {
  const n = design.nav;
  const [fontOpen, setFontOpen] = useState(false);
  return html`
    <${FontRow} role="nav" label="Font" open=${fontOpen} onToggle=${() => setFontOpen(!fontOpen)} />
    <${SliderField} label="Size" path="nav.size" min=${9} max=${28} undo="menu size" />
    <${SliderField} label="Folder item size" path="nav.subSize" min=${9} max=${24} undo="folder item size" help="Pages listed inside a folder." />
    <${SliderField} label="Letter spacing" path="nav.letterSpacing" min=${-0.05} max=${0.4} step=${0.01} unit="em" undo="menu letter spacing" />
    <${Toggle} label="Uppercase" help="Show menu items in capital letters." checked=${!!n.uppercase} onChange=${v => setDesign('nav.uppercase', v, 'menu uppercase')} />
    <${SliderField} label="Space between items" path="nav.gap" min=${0} max=${60} undo="menu spacing" />
    <${Field} label="Current page style" help="How the menu marks the page you are on.">
      <${Segmented} value=${n.active} options=${ACTIVE_STYLES} onChange=${v => setDesign('nav.active', v, 'current page style')} />
    <//>`;
}

// ---------- Layout ----------

function LayoutPic({ id }) {
  const ink = '#2b2b2b';
  const menu = '#a9a9a9';
  const img = '#dcdcdc';
  const txt = '#cfcfcf';
  if (id === 'topbar') {
    return html`<svg viewBox="0 0 96 60" aria-hidden="true">
      <rect width="96" height="60" fill="#fff" />
      <rect x="7" y="8" width="22" height="3.2" rx="1" fill=${ink} />
      <rect x="50" y="8.6" width="9" height="2" rx="1" fill=${menu} /><rect x="63" y="8.6" width="9" height="2" rx="1" fill=${menu} /><rect x="76" y="8.6" width="13" height="2" rx="1" fill=${menu} />
      <rect x="7" y="19" width="82" height="25" fill=${img} />
      <rect x="7" y="49" width="56" height="2" rx="1" fill=${txt} /><rect x="7" y="53.5" width="44" height="2" rx="1" fill=${txt} />
    </svg>`;
  }
  if (id === 'centered') {
    return html`<svg viewBox="0 0 96 60" aria-hidden="true">
      <rect width="96" height="60" fill="#fff" />
      <rect x="35" y="6" width="26" height="3.2" rx="1" fill=${ink} />
      <rect x="23" y="13.5" width="10" height="2" rx="1" fill=${menu} /><rect x="37" y="13.5" width="10" height="2" rx="1" fill=${menu} /><rect x="51" y="13.5" width="10" height="2" rx="1" fill=${menu} /><rect x="65" y="13.5" width="8" height="2" rx="1" fill=${menu} />
      <rect x="14" y="21" width="68" height="24" fill=${img} />
      <rect x="22" y="50" width="52" height="2" rx="1" fill=${txt} /><rect x="28" y="54.5" width="40" height="2" rx="1" fill=${txt} />
    </svg>`;
  }
  return html`<svg viewBox="0 0 96 60" aria-hidden="true">
    <rect width="96" height="60" fill="#fff" />
    <rect width="27" height="60" fill="#f3f3f3" />
    <rect x="5" y="7" width="16" height="3.2" rx="1" fill=${ink} />
    <rect x="5" y="16" width="11" height="2" rx="1" fill=${menu} /><rect x="5" y="21" width="14" height="2" rx="1" fill=${menu} /><rect x="5" y="26" width="9" height="2" rx="1" fill=${menu} /><rect x="5" y="31" width="12" height="2" rx="1" fill=${menu} />
    <rect x="34" y="7" width="55" height="32" fill=${img} />
    <rect x="34" y="45" width="44" height="2" rx="1" fill=${txt} /><rect x="34" y="49.5" width="36" height="2" rx="1" fill=${txt} />
  </svg>`;
}

// The three header layouts as picture cards (also used by the Site Header panel).
export function LayoutCards() {
  const layout = useStore(s => s.site.design.layout);
  return html`<div class="st-layouts" role="radiogroup" aria-label="Header layout">
    ${LAYOUTS.map(l => {
      const on = l.id === layout;
      return html`<button type="button" key=${l.id} role="radio" aria-checked=${on ? 'true' : 'false'} class=${`card-opt st-lay${on ? ' on' : ''}`}
        onClick=${() => setDesign('layout', l.id, 'header layout')}>
        <span class="st-lay-pic"><${LayoutPic} id=${l.id} /></span>
        <span class="st-lay-txt"><b>${l.label}</b><span class="muted">${l.desc}</span></span>
      </button>`;
    })}
  </div>`;
}

function LayoutView({ design }) {
  return html`
    <div class="subhead">Header layout</div>
    <${LayoutCards} />
    <div class="subhead">Spacing</div>
    ${design.layout === 'sidebar' ? html`<${SliderField} label="Sidebar width" path="spacing.sidebarWidth" min=${140} max=${420} undo="sidebar width" />` : null}
    <${SliderField} label="Page side margins" path="spacing.padX" min=${0} max=${160} undo="page side margins" help="Space between your content and the sides of the window." />
    <${SliderField} label="Space above content" path="spacing.padTop" min=${0} max=${200} undo="space above content" />
    <p class="note">On phones, the title stays at the top and the menu folds into a button with three lines. The spacing above is for larger screens.</p>`;
}

// ---------- Animations ----------

// The preview never animates, so each option card shows its motion on hover.
function AnimationsView({ design }) {
  const value = design.animation || 'none';
  return html`
    <div class="cards st-cards st-anims" role="radiogroup" aria-label="Animations">
      ${ANIMATIONS.map(a => {
        const on = a.value === value;
        return html`<button type="button" key=${a.value} role="radio" aria-checked=${on ? 'true' : 'false'} class=${`card-opt st-anim${on ? ' on' : ''}`}
          onClick=${() => setDesign('animation', a.value, 'animations')}>
          <span class=${`st-anim-pic k-${a.value}`} aria-hidden="true"><i class="t"></i><i class="b"></i><i class="b two"></i></span>
          <span class="st-card-name">${a.label}</span>
        </button>`;
      })}
    </div>
    <p class="help">Sections appear gently as visitors scroll. Turned off automatically for visitors who prefer reduced motion, and never shown inside the editor.</p>
    <p class="help">Move your mouse over an option to preview it.</p>`;
}

// ---------- Buttons ----------

function ButtonsView({ design }) {
  const b = design.buttons;
  const c = design.colors;
  const count = useStore(s => countButtons(s.site));
  let look = `background:transparent;color:${c.accent};border-color:${c.accent}`;
  if (b.style === 'solid') look = `background:${c.accent};color:${c.accentText};border-color:${c.accent}`;
  if (b.style === 'link') look = `background:transparent;color:${c.accent};border-color:transparent;text-decoration:underline;padding-left:0;padding-right:0`;
  const help = count
    ? `Applies to ${count === 1 ? 'the button' : `all ${count} buttons`} on your site. You can still change one button in its own settings.`
    : 'Applies to the buttons on your site.';
  return html`
    <div class="st-demo" style=${`background:${c.background}`} aria-hidden="true">
      <span class="st-demo-btn" style=${`${look};border-radius:${b.radius}px;text-transform:${b.uppercase ? 'uppercase' : 'none'};font-family:${fontById(design.fonts.nav).stack}`}>Learn more</span>
    </div>
    <${Field} label="Style" help=${help}>
      <${Segmented} value=${b.style} options=${BUTTON_STYLES} onChange=${setButtonStyle} />
    <//>
    <${SliderField} label="Corner rounding" path="buttons.radius" min=${0} max=${30} undo="button corners" />
    <${Toggle} label="Uppercase" help="Show button text in capital letters." checked=${!!b.uppercase} onChange=${v => setDesign('buttons.uppercase', v, 'button uppercase')} />
    <p class="help">Button colors are under Colors.</p>`;
}

// ---------- Images ----------

function lightboxPresets(d) {
  const page = { label: 'Same as page', value: d.colors.background };
  const darkText = (luminance(d.colors.text) ?? 0) < 0.4;
  const more = darkText
    ? [{ label: 'White', value: '#ffffff' }, { label: 'Light gray', value: '#f2f2f2' }, { label: 'Warm white', value: '#f8f5ef' }]
    : [{ label: 'Black', value: '#000000' }, { label: 'Charcoal', value: '#1c1c1c' }, { label: 'Dark gray', value: '#2b2b2b' }];
  return [page, ...more.filter(p => !sameColor(p.value, page.value))];
}

function ImagesView({ design }) {
  const bg = design.lightbox.background;
  const fg = design.colors.text;
  return html`
    <p class="note">The lightbox is the full-screen viewer that opens when someone clicks an image in a gallery that has the lightbox turned on.</p>
    <div class="st-lb" style=${`background:${bg};color:${fg}`} aria-hidden="true">
      <span class="st-lb-count">1 / 12</span><span class="st-lb-x">×</span>
      <span class="st-lb-arrow l">‹</span><span class="st-lb-arrow r">›</span>
      <span class="st-lb-fig"><span class="st-lb-img"></span><span class="st-lb-cap">Title, oil on canvas</span></span>
    </div>
    <${Field} label="Lightbox background">
      <${ColorInput} value=${bg} onChange=${v => setDesign('lightbox.background', v, 'lightbox background', true)} />
    <//>
    <div class="st-chips">
      ${lightboxPresets(design).map(p => html`<button type="button" key=${p.label} class=${`st-chip${sameColor(p.value, bg) ? ' on' : ''}`}
        onClick=${() => setDesign('lightbox.background', p.value, 'lightbox background')}><i style=${`background:${p.value}`}></i>${p.label}</button>`)}
    </div>
    ${contrast(bg, fg) < 3 ? html`<p class="note warn">The arrows, close button and captions in the viewer use your "Titles & menu" color, so they are hard to see on this background.</p>` : null}`;
}
