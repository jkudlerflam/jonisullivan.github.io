// The site's data model: defaults, section types, page templates, fonts, and
// helpers that keep a content/site.json file well formed. Shared by the
// in-browser editor and the Node build script, so it must not touch the DOM.

export const SCHEMA_VERSION = 2;

// ---------- ids and slugs ----------

export function uid(prefix = 'x') {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return `${prefix}-${s}`;
}

const RESERVED_SLUGS = new Set(['index', 'admin', 'assets', 'content', 'images', 'tools', 'tests', '404']);

export function slugify(text) {
  const s = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'page';
}

// A slug that no other page uses and that does not collide with site folders.
export function uniqueSlug(site, wanted, exceptPageId = null) {
  const base = slugify(wanted);
  const taken = new Set(site.pages.filter(p => p.id !== exceptPageId).map(p => p.slug));
  for (const r of site.redirects || []) taken.add(r.from.replace(/\.html$/, ''));
  let slug = RESERVED_SLUGS.has(base) ? `${base}-page` : base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

// ---------- fonts ----------
// `google` is the css2 family spec; only axes each family really has, because one
// bad axis makes Google return an error for the whole request.

export const FONTS = [
  { id: 'system', label: 'System sans-serif', kind: 'sans', stack: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia', kind: 'serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times', kind: 'serif', stack: '"Times New Roman", Times, serif' },
  { id: 'inter', label: 'Inter', kind: 'sans', google: 'Inter:ital,wght@0,400;0,600;1,400;1,600', stack: '"Inter", sans-serif' },
  { id: 'work-sans', label: 'Work Sans', kind: 'sans', google: 'Work+Sans:ital,wght@0,400;0,600;1,400;1,600', stack: '"Work Sans", sans-serif' },
  { id: 'dm-sans', label: 'DM Sans', kind: 'sans', google: 'DM+Sans:ital,wght@0,400;0,600;1,400;1,600', stack: '"DM Sans", sans-serif' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', kind: 'sans', google: 'IBM+Plex+Sans:ital,wght@0,400;0,600;1,400;1,600', stack: '"IBM Plex Sans", sans-serif' },
  { id: 'karla', label: 'Karla', kind: 'sans', google: 'Karla:ital,wght@0,400;0,600;1,400;1,600', stack: '"Karla", sans-serif' },
  { id: 'libre-franklin', label: 'Libre Franklin', kind: 'sans', google: 'Libre+Franklin:ital,wght@0,400;0,600;1,400;1,600', stack: '"Libre Franklin", sans-serif' },
  { id: 'jost', label: 'Jost', kind: 'sans', google: 'Jost:ital,wght@0,400;0,600;1,400;1,600', stack: '"Jost", sans-serif' },
  { id: 'montserrat', label: 'Montserrat', kind: 'sans', google: 'Montserrat:ital,wght@0,400;0,600;1,400;1,600', stack: '"Montserrat", sans-serif' },
  { id: 'raleway', label: 'Raleway', kind: 'sans', google: 'Raleway:ital,wght@0,400;0,600;1,400;1,600', stack: '"Raleway", sans-serif' },
  { id: 'josefin-sans', label: 'Josefin Sans', kind: 'sans', google: 'Josefin+Sans:ital,wght@0,400;0,600;1,400;1,600', stack: '"Josefin Sans", sans-serif' },
  { id: 'archivo', label: 'Archivo', kind: 'sans', google: 'Archivo:ital,wght@0,400;0,600;1,400;1,600', stack: '"Archivo", sans-serif' },
  { id: 'figtree', label: 'Figtree', kind: 'sans', google: 'Figtree:ital,wght@0,400;0,600;1,400;1,600', stack: '"Figtree", sans-serif' },
  { id: 'manrope', label: 'Manrope', kind: 'sans', google: 'Manrope:wght@400;600', stack: '"Manrope", sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', kind: 'sans', google: 'Space+Grotesk:wght@400;600', stack: '"Space Grotesk", sans-serif' },
  { id: 'syne', label: 'Syne', kind: 'sans', google: 'Syne:wght@400;600', stack: '"Syne", sans-serif' },
  { id: 'outfit', label: 'Outfit', kind: 'sans', google: 'Outfit:wght@400;600', stack: '"Outfit", sans-serif' },
  { id: 'eb-garamond', label: 'EB Garamond', kind: 'serif', google: 'EB+Garamond:ital,wght@0,400;0,600;1,400;1,600', stack: '"EB Garamond", serif' },
  { id: 'cormorant-garamond', label: 'Cormorant Garamond', kind: 'serif', google: 'Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600', stack: '"Cormorant Garamond", serif' },
  { id: 'playfair-display', label: 'Playfair Display', kind: 'serif', google: 'Playfair+Display:ital,wght@0,400;0,600;1,400;1,600', stack: '"Playfair Display", serif' },
  { id: 'lora', label: 'Lora', kind: 'serif', google: 'Lora:ital,wght@0,400;0,600;1,400;1,600', stack: '"Lora", serif' },
  { id: 'crimson-pro', label: 'Crimson Pro', kind: 'serif', google: 'Crimson+Pro:ital,wght@0,400;0,600;1,400;1,600', stack: '"Crimson Pro", serif' },
  { id: 'spectral', label: 'Spectral', kind: 'serif', google: 'Spectral:ital,wght@0,400;0,600;1,400;1,600', stack: '"Spectral", serif' },
  { id: 'newsreader', label: 'Newsreader', kind: 'serif', google: 'Newsreader:ital,wght@0,400;0,600;1,400;1,600', stack: '"Newsreader", serif' },
  { id: 'fraunces', label: 'Fraunces', kind: 'serif', google: 'Fraunces:ital,wght@0,400;0,600;1,400;1,600', stack: '"Fraunces", serif' },
  { id: 'libre-baskerville', label: 'Libre Baskerville', kind: 'serif', google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400', stack: '"Libre Baskerville", serif' },
  { id: 'dm-serif-display', label: 'DM Serif Display', kind: 'serif', google: 'DM+Serif+Display:ital@0;1', stack: '"DM Serif Display", serif' },
  { id: 'instrument-serif', label: 'Instrument Serif', kind: 'serif', google: 'Instrument+Serif:ital@0;1', stack: '"Instrument Serif", serif' },
  { id: 'courier-prime', label: 'Courier Prime', kind: 'mono', google: 'Courier+Prime:ital,wght@0,400;0,700;1,400;1,700', stack: '"Courier Prime", monospace' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', kind: 'mono', google: 'IBM+Plex+Mono:ital,wght@0,400;0,600;1,400;1,600', stack: '"IBM Plex Mono", monospace' },
  { id: 'space-mono', label: 'Space Mono', kind: 'mono', google: 'Space+Mono:ital,wght@0,400;0,700;1,400;1,700', stack: '"Space Mono", monospace' },
];

export function fontById(id) {
  return FONTS.find(f => f.id === id) || FONTS[0];
}

// ---------- design (site styles) ----------
// Defaults reproduce the hand-built site this editor replaced.

export const DEFAULT_DESIGN = {
  layout: 'sidebar',             // sidebar | topbar | centered
  colors: {
    background: '#ffffff',
    text: '#111111',             // titles, headings, navigation
    paragraph: '#222222',
    muted: '#999999',            // dates and small gray text
    caption: '#333333',
    link: '#111111',
    accent: '#111111',           // buttons
    accentText: '#ffffff',
    line: '#eeeeee',
  },
  fonts: { title: 'system', nav: 'system', heading: 'system', body: 'system' },
  title: { size: 22, mobileSize: 18, letterSpacing: 0.28, mobileLetterSpacing: 0.3, weight: 400, italic: false, uppercase: false },
  logo: { media: null, height: 48 },
  nav: { size: 13, subSize: 12, letterSpacing: 0.06, uppercase: true, gap: 14, active: 'italic' },
  text: {
    p: 16, small: 13, large: 18, meta: 14, lineHeight: 1.5,
    h1: 32, h2: 26, h3: 18, headingWeight: 600, headingLetterSpacing: 0.01,
  },
  captions: { size: 12 },
  spacing: { sidebarWidth: 220, padX: 26, padTop: 24 },
  buttons: { style: 'outline', radius: 0, uppercase: true },
  lightbox: { background: '#ffffff' },
  animation: 'none',             // none | fade | rise (sections appear as they scroll into view)
};

// Spacing presets offered next to the pixel sliders.
export const SPACE_OPTIONS = [
  { label: 'None', px: 0 },
  { label: 'S', px: 24 },
  { label: 'M', px: 48 },
  { label: 'L', px: 96 },
];
const LEGACY_SPACE = { none: 0, xs: 12, s: 24, m: 48, l: 72, xl: 96 };

export const ASPECTS = [
  { id: 'original', label: 'Original' },
  { id: '1:1', label: 'Square' },
  { id: '4:3', label: 'Landscape 4:3' },
  { id: '3:2', label: 'Landscape 3:2' },
  { id: '16:9', label: 'Wide 16:9' },
  { id: '3:4', label: 'Portrait 3:4' },
  { id: '2:3', label: 'Portrait 2:3' },
];

// ---------- sections ----------

// bg: background color ('' = none); bgFull: color reaches the screen edges; pad: inner
// spacing above and below when there is a background; fg: text color override ('' = default).
const common = () => ({ width: null, align: 'left', space: 48, spaceAbove: 0, bg: '', bgFull: true, pad: 48, fg: '' });

export const SECTION_TYPES = {
  gallery: {
    label: 'Gallery',
    description: 'Several images, stacked, in a grid, masonry, or as a slideshow',
    make: () => ({
      ...common(), align: 'center', layout: 'grid', items: [], columns: 3, gap: 24, mobileGap: null, aspect: 'original',
      captions: true, captionAlign: 'left', lightbox: true, bleedMobile: false, autoplay: 0, slideHeight: 75,
      rowHeight: null, thumbnails: false, animation: 'site', bleed: false,
    }),
  },
  image: {
    label: 'Image',
    description: 'One image with an optional caption and link',
    make: () => ({ ...common(), media: null, caption: '', captionStyle: 'normal', link: '', newTab: false, lightbox: false }),
  },
  text: {
    label: 'Text',
    description: 'Headings and paragraphs',
    make: () => ({ ...common(), html: '<p>Click here to start writing.</p>', size: 'normal', lineHeight: 'normal', textAlign: 'left' }),
  },
  imageText: {
    label: 'Image and text',
    description: 'An image beside a block of text',
    make: () => ({
      ...common(), media: null, caption: '', html: '<h2>Heading</h2><p>Write something about this image.</p>',
      imageSide: 'left', imageWidth: 50, verticalAlign: 'center', size: 'normal', lineHeight: 'normal',
    }),
  },
  posts: {
    label: 'Article list',
    description: 'An automatic list of the articles in a collection',
    make: () => ({
      ...common(), width: 780, blog: null, showImage: true, showDate: true, showSubtitle: true, showExcerpt: true,
      readMore: 'Read More →',
    }),
  },
  cv: {
    label: 'CV list',
    description: 'Headed lists of years and entries',
    make: () => ({
      ...common(), width: 800,
      groups: [{ id: uid('g'), heading: 'EXHIBITIONS:', items: [{ id: uid('i'), year: '2026', html: 'Title, Venue, City' }] }],
    }),
  },
  button: {
    label: 'Button',
    description: 'A link styled as a button',
    make: () => ({ ...common(), label: 'Learn more', url: '', newTab: false, style: 'outline', buttonAlign: 'left' }),
  },
  video: {
    label: 'Video',
    description: 'A YouTube or Vimeo video',
    make: () => ({ ...common(), url: '', caption: '' }),
  },
  spacer: {
    label: 'Spacer or line',
    description: 'Empty space, optionally with a thin line',
    make: () => ({ ...common(), height: 48, line: false, space: 0 }),
  },
  form: {
    label: 'Contact form',
    description: 'Name, email and message, sent to your inbox',
    make: () => ({
      ...common(), width: 600, endpoint: '', fields: { name: true, email: true, subject: false, message: true },
      buttonLabel: 'Send', successMessage: 'Thank you! Your message has been sent.',
    }),
  },
  embed: {
    label: 'Embed code',
    description: 'Advanced: paste HTML from another website',
    make: () => ({ ...common(), html: '' }),
  },
  // A free-form grid of blocks, like Squarespace's Fluid Engine. Positions are in grid
  // cells: 24 columns on desktop, 8 on phones. `m` is an optional phone layout; without
  // it the blocks stack in reading order.
  blocks: {
    label: 'Blank section',
    description: 'Place text, images and buttons anywhere on a grid',
    make: () => ({ ...common(), rows: 8, gap: 16, blocks: [] }),
  },
};

export const GRID_COLS = 24;
export const GRID_COLS_MOBILE = 8;

export const BLOCK_TYPES = {
  text: { label: 'Text', make: () => ({ html: '<p>Write here.</p>', size: 'normal', lineHeight: 'normal', textAlign: 'left' }), w: 10, h: 4 },
  image: { label: 'Image', make: () => ({ media: null, caption: '', captionStyle: 'normal', alt: '', link: '', newTab: false, lightbox: false, fit: 'fill', focal: [50, 50] }), w: 8, h: 8 },
  button: { label: 'Button', make: () => ({ label: 'Learn more', url: '', newTab: false, style: 'outline', buttonAlign: 'left' }), w: 6, h: 2 },
  video: { label: 'Video', make: () => ({ url: '' }), w: 12, h: 7 },
  line: { label: 'Line', make: () => ({}), w: 12, h: 1 },
  quote: { label: 'Quote', make: () => ({ html: '<p>A quotation.</p>', attribution: '' }), w: 12, h: 3 },
  embed: { label: 'Code', make: () => ({ html: '' }), w: 12, h: 6 },
  form: {
    label: 'Form',
    make: () => ({
      fields: { name: true, email: true, subject: false, message: true }, buttonLabel: 'Send',
      successMessage: 'Thank you! Your message has been sent.', endpoint: '',
    }),
    w: 12, h: 16,
  },
  social: {
    label: 'Social Links',
    make: () => ({ links: [{ id: uid('sl'), platform: 'instagram', url: '' }, { id: uid('sl'), platform: 'email', url: '' }], size: 'medium', socialAlign: 'left' }),
    w: 6, h: 2,
  },
  map: { label: 'Map', make: () => ({ address: '', zoom: 14 }), w: 12, h: 12 },
  accordion: {
    label: 'Accordion',
    make: () => ({
      items: [1, 2, 3].map(n => ({ id: uid('ai'), title: `Item ${n}`, html: 'Add a description.' })),
      dividers: true, icon: 'plus', openFirst: false,
    }),
    w: 12, h: 8,
  },
};

export function newBlock(kind, at = { x: 0, y: 0 }) {
  const def = BLOCK_TYPES[kind];
  if (!def) throw new Error(`Unknown block type: ${kind}`);
  return {
    id: uid('b'), kind, ...def.make(), d: { x: at.x, y: at.y, w: def.w, h: def.h }, m: null,
    alignV: 'top', hideDesktop: false, hideMobile: false, style: null,
  };
}

// Text, images, buttons, video and embeds are blocks in a Fluid Engine section,
// as in Squarespace. Asking for one of those section types returns the
// equivalent Fluid Engine section.
export function newSection(type, overrides = {}) {
  const def = SECTION_TYPES[type];
  if (!def) throw new Error(`Unknown section type: ${type}`);
  const sec = { id: uid('s'), type, ...def.make(), ...overrides };
  return BLOCK_SECTION_TYPES.has(sec.type) ? toBlocksSection(sec) : sec;
}

const BLOCK_SECTION_TYPES = new Set(['text', 'image', 'imageText', 'button', 'video', 'embed']);

// Converts a text / image / image-and-text / button / video / embed section into
// a Fluid Engine section that looks the same: its content becomes blocks.
export function toBlocksSection(s) {
  if (!BLOCK_SECTION_TYPES.has(s.type)) return s;
  const base = {
    id: s.id, type: 'blocks', width: s.width ?? null, align: s.align || 'left', space: typeof s.space === 'number' ? s.space : 48,
    spaceAbove: s.spaceAbove || 0, bg: s.bg || '', bgFull: s.bgFull ?? true, pad: s.pad ?? 48, fg: s.fg || '', rows: 1, gap: 16,
  };
  let n = 0;
  const blk = (kind, props, d = { x: 0, y: 0, w: GRID_COLS, h: 1 }) => ({
    ...BLOCK_TYPES[kind].make(), ...props, id: `b-${s.id.replace(/^s-/, '')}${n++ ? `-${n}` : ''}`, kind, d, m: null,
    alignV: props.alignV || 'top', hideDesktop: false, hideMobile: false, style: null,
  });
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  switch (s.type) {
    case 'text':
      return { ...base, blocks: [blk('text', pick(s, ['html', 'size', 'lineHeight', 'textAlign']))] };
    case 'image':
      return { ...base, blocks: [blk('image', { ...pick(s, ['media', 'caption', 'captionStyle', 'link', 'newTab', 'lightbox']), fit: 'original' })] };
    case 'imageText': {
      const iw = Math.round(GRID_COLS * Math.max(20, Math.min(80, s.imageWidth || 50)) / 100);
      const tw = GRID_COLS - iw - 1;
      const right = s.imageSide === 'right';
      const alignV = { top: 'top', center: 'middle', bottom: 'bottom' }[s.verticalAlign] || 'middle';
      return {
        ...base,
        blocks: [
          blk('image', { ...pick(s, ['media', 'caption']), fit: 'original' }, { x: right ? tw + 1 : 0, y: 0, w: iw, h: 1 }),
          blk('text', { ...pick(s, ['html', 'size', 'lineHeight']), alignV }, { x: right ? 0 : iw + 1, y: 0, w: tw, h: 1 }),
        ],
      };
    }
    case 'button':
      return { ...base, blocks: [blk('button', pick(s, ['label', 'url', 'newTab', 'style', 'buttonAlign']))] };
    case 'video':
      return { ...base, blocks: [blk('video', pick(s, ['url']), { x: 0, y: 0, w: GRID_COLS, h: 14 })] };
    case 'embed':
      return { ...base, blocks: [blk('embed', pick(s, ['html']), { x: 0, y: 0, w: GRID_COLS, h: 6 })] };
    default:
      return s;
  }
}

// Deep copy with fresh ids, used by "Duplicate".
export function cloneWithNewIds(obj) {
  const copy = JSON.parse(JSON.stringify(obj));
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      if (typeof o.id === 'string') o.id = uid(o.id.split('-')[0] || 'x');
      Object.values(o).forEach(walk);
    }
  })(copy);
  return copy;
}

// ---------- pages ----------

export const PAGE_TEMPLATES = [
  { id: 'blank', label: 'Blank page', description: 'Start from an empty page', sections: () => [] },
  {
    id: 'gallery', label: 'Gallery', description: 'Large images, one after another',
    sections: () => [newSection('gallery', { layout: 'stack', width: 900, gap: 34, lightbox: false, bleedMobile: true })],
  },
  {
    id: 'grid', label: 'Grid gallery', description: 'A grid of images that open in a viewer',
    sections: () => [newSection('gallery', { layout: 'grid', columns: 3, aspect: '1:1', width: null })],
  },
  {
    id: 'exhibition', label: 'Exhibition', description: 'Installation views with captions and a statement',
    page: { width: 900, align: 'center' },
    sections: () => [
      newSection('image', { caption: 'Installation view, <em>Exhibition Title</em>, Gallery, City' }),
      newSection('text', { html: '<p>Write about the exhibition here.</p>', width: 620, textAlign: 'justify' }),
      newSection('gallery', { layout: 'stack', gap: 48, lightbox: false }),
    ],
  },
  {
    id: 'text', label: 'Text page', description: 'A heading and paragraphs',
    page: { width: 780 },
    sections: () => [newSection('text', { html: '<h1>Page title</h1><p>Write here.</p>' })],
  },
  {
    id: 'contact', label: 'Contact', description: 'Contact details and a message form',
    sections: () => [
      newSection('text', { width: 600, size: 14, html: '<p>City, State.</p><p><strong>EMAIL:</strong> <a href="mailto:you@example.com">you@example.com</a></p>' }),
      newSection('form'),
    ],
  },
  {
    id: 'cv', label: 'CV', description: 'Headed lists of years and entries',
    sections: () => [newSection('cv')],
  },
  {
    id: 'blog', label: 'Article collection', description: 'A list of articles, like Art Writing',
    kind: 'blog',
    sections: () => [newSection('posts')],
  },
];

export const POST_TEMPLATE = (title = 'New article') => [
  newSection('text', { width: 980, space: 12, html: `<h1>${escapeText(title)}</h1><p class="muted">${formatDate(todayIso())}</p>` }),
  newSection('text', { width: 760, size: 14, space: 24, html: '<p>A short summary of the article.</p>' }),
  newSection('image', { width: 980, space: 24, caption: 'Installation view. Image courtesy of the gallery.' }),
  newSection('text', { width: 900, size: 'small', html: '<p>Write the article here.</p>' }),
];

export function newPage(site, { title = 'New page', template = 'blank', parent = null } = {}) {
  const t = PAGE_TEMPLATES.find(x => x.id === template) || PAGE_TEMPLATES[0];
  const page = {
    id: uid('p'),
    kind: parent ? 'post' : (t.kind || 'page'),
    title,
    navTitle: '',
    slug: uniqueSlug(site, title),
    seoTitle: '',
    description: '',
    socialImage: null,
    width: null,
    align: 'left',
    disabled: false,
    ...(t.page || {}),
    sections: parent ? POST_TEMPLATE(title) : t.sections(),
  };
  if (page.kind === 'blog') {
    for (const s of page.sections) if (s.type === 'posts') s.blog = page.id;
  }
  if (parent) {
    page.parent = parent;
    page.post = { title, subtitle: '', date: todayIso(), image: null, excerpt: '', draft: true };
  }
  return page;
}

// ---------- dates ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- whole-site helpers ----------

export function emptySite() {
  return normalizeSite({
    version: SCHEMA_VERSION,
    settings: { siteName: 'My Site', headerTitle: 'MY SITE', homePage: null },
    design: {},
    nav: [],
    pages: [],
    media: {},
    redirects: [],
  });
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Fill missing keys from defaults without overwriting anything present.
function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (target[k] === undefined) target[k] = JSON.parse(JSON.stringify(v));
    else if (isPlainObject(v) && isPlainObject(target[k])) fillDefaults(target[k], v);
  }
  return target;
}

const DEFAULT_SETTINGS = {
  siteName: 'My Site',
  headerTitle: 'MY SITE',
  titleFormat: '{site} — {page}',
  description: '',
  language: 'en',
  homePage: null,
  url: '',
  socialImage: null,
  favicon: null,
  footer: '',
  goatcounter: '',
  formEndpoint: '',
};

// Upgrades older files and fills defaults. Safe to call on every load.
export function normalizeSite(input) {
  const site = JSON.parse(JSON.stringify(input || {}));
  site.version = SCHEMA_VERSION;
  site.settings = fillDefaults(isPlainObject(site.settings) ? site.settings : {}, DEFAULT_SETTINGS);
  site.design = fillDefaults(isPlainObject(site.design) ? site.design : {}, DEFAULT_DESIGN);
  site.nav = Array.isArray(site.nav) ? site.nav : [];
  site.pages = Array.isArray(site.pages) ? site.pages : [];
  site.media = isPlainObject(site.media) ? site.media : {};
  site.redirects = Array.isArray(site.redirects) ? site.redirects : [];
  site.savedSections = Array.isArray(site.savedSections) ? site.savedSections : [];
  site.trash = Array.isArray(site.trash) ? site.trash : [];
  // Version 1 kept text and images as their own section types; version 2 makes
  // them Fluid Engine blocks (same look, Squarespace editing).
  if ((input?.version || 1) < 2) {
    for (const page of site.pages) page.sections = (page.sections || []).map(s => toBlocksSection(s));
  }
  for (const page of site.pages) {
    fillDefaults(page, { kind: 'page', navTitle: '', seoTitle: '', description: '', socialImage: null, width: null, align: 'left', disabled: false, sections: [] });
    if (page.kind === 'post') fillDefaults(page, { post: { title: page.title, subtitle: '', date: '', image: null, excerpt: '', draft: false } });
    for (const s of page.sections) {
      if (typeof s.space === 'string') s.space = LEGACY_SPACE[s.space] ?? 48;
      const def = SECTION_TYPES[s.type];
      if (def) fillDefaults(s, def.make());
    }
  }
  if (!site.settings.homePage || !site.pages.some(p => p.id === site.settings.homePage)) {
    site.settings.homePage = site.pages.find(p => p.kind !== 'post')?.id || null;
  }
  return site;
}

// Every nav entry that points at a page, in menu order (folders flattened).
export function navPageIds(site) {
  const ids = [];
  (function walk(items) {
    for (const it of items) {
      if (it.type === 'page') ids.push(it.page);
      if (it.type === 'folder') walk(it.children || []);
    }
  })(site.nav);
  return ids;
}

// Problems that would break the published site. The editor refuses to publish
// while this returns anything.
export function validateSite(site) {
  const problems = [];
  const slugs = new Map();
  for (const p of site.pages) {
    if (!isValidSlug(p.slug)) problems.push(`The page "${p.title}" has an invalid web address ("${p.slug}").`);
    if (slugs.has(p.slug)) problems.push(`Two pages use the web address "${p.slug}".`);
    slugs.set(p.slug, p.id);
    if (p.kind === 'post' && !site.pages.some(b => b.id === p.parent)) problems.push(`The article "${p.title}" belongs to a collection that no longer exists.`);
  }
  if (!site.pages.some(p => p.id === site.settings.homePage)) problems.push('No homepage is set.');
  const pageIds = new Set(site.pages.map(p => p.id));
  for (const id of navPageIds(site)) if (!pageIds.has(id)) problems.push('The menu links to a page that no longer exists.');
  return problems;
}
