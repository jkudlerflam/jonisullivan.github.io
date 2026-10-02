// Helpers shared by the renderers (pages, sections, blocks, galleries).

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export const lines = s => esc(s).replace(/\r?\n/g, '<br>');
export const attr = (name, value) => (value === undefined || value === null || value === false ? '' : ` ${name}="${esc(value)}"`);

// FNV-1a, used for cache-busting query strings. Same result in Node and browsers.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function pageById(site, id) {
  return site.pages.find(p => p.id === id) || null;
}

// Pages that exist on the public site. Disabled pages and draft articles do not.
export function isLive(page) {
  if (!page || page.disabled) return false;
  if (page.kind === 'post' && page.post?.draft) return false;
  return true;
}

export function pageFile(site, page) {
  return page.id === site.settings.homePage ? 'index.html' : `${page.slug}.html`;
}

export function pageHref(site, id) {
  const p = pageById(site, id);
  return p ? pageFile(site, p) : '#';
}

export function postsOf(site, blogId) {
  return site.pages
    .map((p, i) => [p, i])
    .filter(([p]) => p.kind === 'post' && p.parent === blogId && isLive(p))
    .sort((a, b) => (b[0].post?.date || '').localeCompare(a[0].post?.date || '') || a[1] - b[1])
    .map(([p]) => p);
}

export function editAttr(opts, scope, path, kind) {
  return opts.edit ? ` data-edit="${esc(`${scope}|${path}`)}" data-kind="${kind}"` : '';
}

// ---------- images ----------

export function mediaUrls(site, id, opts) {
  const m = site.media[id];
  if (!m) return null;
  const main = (opts.mediaUrl && opts.mediaUrl(m, 'main')) || m.src;
  const medium = m.medium ? ((opts.mediaUrl && opts.mediaUrl(m, 'medium')) || m.medium.src) : null;
  return { m, main, medium };
}

export function imgTag(site, id, opts, { cls = '', sizes = '', alt, eager = false, full = false, extra = '' } = {}) {
  const u = mediaUrls(site, id, opts);
  if (!u) return '';
  const { m } = u;
  const srcset = u.medium ? ` srcset="${esc(u.medium)} ${m.medium.w}w, ${esc(u.main)} ${m.w}w"${sizes ? ` sizes="${esc(sizes)}"` : ''}` : '';
  const altText = alt ?? m.alt ?? '';
  const loading = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(u.main)}"${srcset}${m.w ? ` width="${m.w}" height="${m.h}"` : ''} alt="${esc(altText)}"${loading} decoding="async"${full ? ` data-full="${esc(u.main)}"` : ''}${opts.edit ? ` data-media="${esc(id)}"` : ''}${extra}>`;
}

// The first image on a page loads eagerly; later ones lazily.
export function takeEager(opts) {
  if (opts._eagerUsed) return false;
  opts._eagerUsed = true;
  return true;
}

export function placeholder(opts, kind, text) {
  return opts.edit ? `<div class="ed-empty" data-empty="${kind}">${esc(text)}</div>` : '';
}

// ---------- sections ----------

// classes: extra class names after "s"; attrs: extra attribute string.
// Edit Section > Background and Colors: sec.bg is a background color, sec.fg a
// text color. sec.bgImage (a media id) is shown as a cover image behind the
// content, at the focal point sec.bgFocal ([x, y] in %), under an optional
// sec.bgOverlay ({ color, opacity 0-100 }); finding the image needs opts.site.
// sec.vAlign ('top' | 'middle' | 'bottom') places the content of a Fluid Engine
// section that is taller than its blocks. Sections without these fields come
// out exactly as before.
export function sectionOpen(sec, classes, opts, styleVars = {}, attrs = '') {
  const vars = { ...styleVars };
  if (sec.width) vars['--s-w'] = `${sec.width}px`;
  const below = typeof sec.space === 'number' ? sec.space : 48;
  if (below !== 48) vars['--sp'] = `${below}px`;
  if (sec.spaceAbove) vars['--sa'] = `${sec.spaceAbove}px`;
  const color = /^#[0-9a-f]{3,8}$/i;
  const hasBg = color.test(sec.bg || '');
  if (hasBg) {
    vars['--s-bg'] = sec.bg;
    vars['--s-pad'] = `${sec.pad ?? 48}px`;
  }
  const hasFg = color.test(sec.fg || '');
  if (hasFg) {
    vars['--s-fg'] = sec.fg;
    // Text on solid buttons in a colored section: the section's own color.
    vars['--s-on'] = hasBg ? sec.bg : readableOn(sec.fg);
  }
  const more = [];
  let layer = '';
  const site = opts.site;
  if (sec.bgImage && site && site.media && site.media[sec.bgImage]) {
    if (!hasBg) vars['--s-pad'] = `${sec.pad ?? 48}px`;
    const [fx, fy] = Array.isArray(sec.bgFocal) && sec.bgFocal.length === 2
      ? sec.bgFocal.map(n => Math.max(0, Math.min(100, Math.round(Number(n) || 0))))
      : [50, 50];
    const ov = overlayRgba(sec.bgOverlay);
    const img = imgTag(site, sec.bgImage, opts, { sizes: '100vw', alt: '', eager: takeEager(opts), extra: ` style="object-position:${fx}% ${fy}%"` });
    layer = `<div class="s-bgimg${ov ? ' has-ov' : ''}"${ov ? ` style="--s-ov:${ov}"` : ''} aria-hidden="true">${img}</div>`;
    more.push('has-bgimg');
    if (!hasBg && sec.bgFull !== false) more.push('bg-full');
  }
  if (sec.vAlign === 'top' || sec.vAlign === 'middle' || sec.vAlign === 'bottom') more.push(`va-${sec.vAlign}`);
  const style = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  const align = sec.align === 'center' ? 'center' : sec.align === 'right' ? 'right' : '';
  const bgCls = hasBg ? (sec.bgFull === false ? 'has-bg' : 'has-bg bg-full') : '';
  const cls = ['s', ...classes, align, bgCls, hasFg ? 'has-fg' : '', ...more].filter(Boolean).join(' ');
  return `<section class="${cls}"${style ? ` style="${style}"` : ''}${attrs}${opts.edit ? ` data-sid="${esc(sec.id)}" data-type="${esc(sec.type)}"` : ''}>${layer}`;
}

// Black or white, whichever reads better on the given color.
function readableOn(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

function hexRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

// The tint laid over a background image, or '' for none.
function overlayRgba(o) {
  if (!o || typeof o !== 'object') return '';
  const rgb = hexRgb(o.color);
  const a = Math.max(0, Math.min(100, Number(o.opacity) || 0)) / 100;
  if (!rgb || !a) return '';
  return `rgba(${rgb.join(',')},${Math.round(a * 100) / 100})`;
}

// An empty, editable caption-like field: rendered only in the editor, and shown
// there only while its section is selected (see admin/editor-frame.css).
export function field(opts, tag, cls, scope, path, kind, value, ph) {
  if (value) return `<${tag}${cls ? ` class="${cls}"` : ''}${editAttr(opts, scope, path, kind)}>${value}</${tag}>`;
  if (!opts.edit) return '';
  return `<${tag} class="${cls ? `${cls} ` : ''}ed-ph" data-placeholder="${esc(ph)}"${editAttr(opts, scope, path, kind)}></${tag}>`;
}

// Text size (small | normal | large | a pixel number) and line spacing (tight | normal | loose).
export function sizeAttrs(size, lineHeight) {
  const lh = lineHeight === 'tight' || lineHeight === 'loose' ? ` lh-${lineHeight}` : '';
  if (typeof size === 'number') return { cls: lh, style: ` style="--fs:${size}px"` };
  if (size === 'small' || size === 'large') return { cls: ` size-${size}${lh}`, style: '' };
  return { cls: lh, style: '' };
}

export function videoEmbedUrl(url) {
  if (!url) return '';
  let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return '';
}
