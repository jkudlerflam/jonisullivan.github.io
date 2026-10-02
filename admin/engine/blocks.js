// Fluid Engine sections: blocks placed on a grid (24 columns on computers, 8 on
// phones), as in Squarespace 7.1. Every text, image and button on the site is a
// block in one of these sections. Rendering and the matching CSS live together.
//
// Fields every block may have:
//   d {x,y,w,h}       desktop place in grid cells; m: phone place, or null = automatic
//   alignV            'top' | 'middle' | 'bottom': where the content sits in the box
//   hideDesktop, hideMobile
//   style             { bg, radius, padding, stroke: 'solid'|'dotted'|'', strokeColor, strokeWidth }
// Block kinds are the entries of KINDS below; add a kind by adding an entry.

import { GRID_COLS, GRID_COLS_MOBILE } from './schema.js';
import { esc, editAttr, imgTag, takeEager, placeholder, sectionOpen, sizeAttrs, videoEmbedUrl } from './util.js';

// Phone layout: explicit `m` positions win; otherwise stack blocks in reading
// order, full width, keeping image proportions. Blocks hidden on phones take no room.
export function mobileLayout(blocks) {
  const out = new Map();
  if (blocks.length && blocks.every(b => b.m)) {
    for (const b of blocks) out.set(b.id, b.m);
    return out;
  }
  const ordered = [...blocks].filter(b => !b.hideMobile).sort((a, b) => a.d.y - b.d.y || a.d.x - b.d.x);
  let y = 0;
  for (const b of ordered) {
    const keepShape = b.kind === 'image' || b.kind === 'video' || b.kind === 'embed' || b.kind === 'map';
    const h = keepShape ? Math.max(2, Math.round(GRID_COLS_MOBILE * b.d.h / Math.max(1, b.d.w))) : (b.kind === 'line' ? 1 : Math.max(1, Math.min(b.d.h, 3)));
    out.set(b.id, { x: 0, y, w: GRID_COLS_MOBILE, h });
    y += h + 1;
  }
  for (const b of blocks) if (!out.has(b.id)) out.set(b.id, { x: 0, y, w: GRID_COLS_MOBILE, h: 1 });
  return out;
}

const area = p => `${p.y + 1} / ${p.x + 1} / span ${p.h} / span ${p.w}`;

// A section whose only block spans the full width of the first row sizes to its
// content, like a plain column of text: no fixed row heights, nothing cropped.
export function isFitSection(sec) {
  const b = sec.blocks || [];
  return b.length === 1 && b[0].d.x === 0 && b[0].d.y === 0 && b[0].d.w === GRID_COLS && b[0].d.h <= 1;
}

const COLOR = /^#[0-9a-f]{3,8}$/i;

// Squarespace's "Style background" for a block.
function styleVars(st) {
  if (!st) return '';
  const v = [];
  if (COLOR.test(st.bg || '')) v.push(`--b-bg:${st.bg}`);
  if (st.radius) v.push(`--b-rad:${Number(st.radius)}px`);
  if (st.padding) v.push(`--b-pad:${Number(st.padding)}px`);
  if (st.stroke === 'solid' || st.stroke === 'dotted') {
    v.push(`--b-stroke:${Number(st.strokeWidth) || 1}px ${st.stroke} ${COLOR.test(st.strokeColor || '') ? st.strokeColor : 'currentColor'}`);
  }
  return v.length ? `;${v.join(';')}` : '';
}

// Each kind returns { inner, cls?, attrs? }.
const KINDS = {
  text(site, sec, b, ctx) {
    const sz = sizeAttrs(b.size, b.lineHeight);
    const ta = b.textAlign && b.textAlign !== 'left' ? ` ta-${b.textAlign}` : '';
    return { inner: `<div class="rt${sz.cls}"${sz.style}${editAttr(ctx.opts, ctx.scope, `${ctx.path}.html`, 'rich')}>${b.html || ''}</div>`, cls: ta };
  },

  image(site, sec, b, ctx) {
    const { opts, scope, path } = ctx;
    if (!site.media[b.media]) return { inner: placeholder(opts, 'image', 'Click to add an image') };
    // fit: 'original' keeps the image's own shape; 'fill' crops it to the box; 'fit' shows it whole inside the box.
    const mode = b.fit === 'original' ? 'original' : b.fit === 'fit' || b.fit === 'contain' ? 'fit' : 'fill';
    const focal = b.focal ? `${b.focal[0]}% ${b.focal[1]}%` : '50% 50%';
    const lightbox = b.lightbox && !b.link;
    const sizes = `(max-width: 780px) 100vw, ${Math.round((sec.width || 1100) * b.d.w / GRID_COLS)}px`;
    const img = imgTag(site, b.media, opts, {
      cls: lightbox ? 'g-img' : '', sizes, alt: b.alt || undefined, eager: takeEager(opts), full: lightbox,
      extra: mode === 'original' ? '' : ` style="--fit:${mode === 'fit' ? 'contain' : 'cover'};--focal:${focal}"`,
    });
    const linked = b.link ? `<a href="${esc(b.link)}"${b.newTab ? ' target="_blank" rel="noopener"' : ''}>${img}</a>` : img;
    const cap = b.caption ? `<figcaption${lightbox ? ' class="g-cap"' : ''}${editAttr(opts, scope, `${path}.caption`, 'inline')}>${b.caption}</figcaption>` : '';
    const cls = [b.caption ? 'has-cap' : '', mode === 'original' ? 'fit-original' : '', b.captionStyle === 'small' ? 'cap-small' : ''].filter(Boolean).join(' ');
    return { inner: `<figure class="fig">${linked}${cap}</figure>`, cls: cls ? ` ${cls}` : '', attrs: lightbox ? ' data-lightbox="1"' : '' };
  },

  button(site, sec, b, ctx) {
    const style = b.style === 'solid' ? ' solid' : b.style === 'link' ? ' link' : '';
    const align = b.buttonAlign === 'center' ? ' center' : b.buttonAlign === 'right' ? ' right' : '';
    return { inner: `<div class="btn-row${align}"><a class="btn${style}" href="${esc(b.url || '#')}"${b.newTab ? ' target="_blank" rel="noopener"' : ''}${editAttr(ctx.opts, ctx.scope, `${ctx.path}.label`, 'plain')}>${esc(b.label || 'Button')}</a></div>` };
  },

  video(site, sec, b, ctx) {
    const src = videoEmbedUrl(b.url);
    return { inner: src ? `<div class="video-frame"><iframe src="${esc(src)}" title="Video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>` : placeholder(ctx.opts, 'video', 'Add a YouTube or Vimeo link') };
  },

  line() {
    return { inner: '<hr>' };
  },

  quote(site, sec, b, ctx) {
    const { opts, scope, path } = ctx;
    return { inner: `<figure class="fig"><blockquote${editAttr(opts, scope, `${path}.html`, 'rich')}>${b.html || ''}</blockquote>${b.attribution || opts.edit ? `<figcaption${editAttr(opts, scope, `${path}.attribution`, 'plain')}>${esc(b.attribution || '')}</figcaption>` : ''}</figure>` };
  },

  embed(site, sec, b, ctx) {
    return { inner: b.html ? `<div class="embed">${b.html}</div>` : placeholder(ctx.opts, 'embed', 'Paste embed code in the block settings') };
  },

  // A contact form. Same markup as the form section, so assets/site.js sends it.
  // Without an address (its own, or the one in Settings) it is not published.
  form(site, sec, b, ctx) {
    const endpoint = String(b.endpoint || site.settings.formEndpoint || '').trim();
    if (!endpoint) return { inner: placeholder(ctx.opts, 'form', 'Form: add your form address in Settings → Contact form to switch it on') };
    const f = b.fields || {};
    const input = (on, name, label, type = 'text', req = true) => (on ? `<label>${label}<input type="${type}" name="${name}"${req ? ' required' : ''}></label>` : '');
    const body = [
      input(f.name, 'name', 'Name'),
      input(f.email, 'email', 'Email', 'email'),
      input(f.subject, 'subject', 'Subject', 'text', false),
      f.message ? '<label>Message<textarea name="message" required></textarea></label>' : '',
      '<input class="hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">',
      `<div><button class="btn solid" type="submit">${esc(b.buttonLabel || 'Send')}</button></div>`,
      '<p class="form-status" role="status" aria-live="polite"></p>',
    ].join('');
    return { inner: `<form class="contact-form" method="post" action="${esc(endpoint)}" data-endpoint="${esc(endpoint)}" data-success="${esc(b.successMessage || 'Thank you!')}">${body}</form>` };
  },

  // Icons linking to social profiles. Links without an address are left out of
  // the published page (the editor shows them faded).
  social(site, sec, b, ctx) {
    const links = (b.links || []).filter(l => l && SOCIAL[l.platform]);
    const shown = ctx.opts.edit ? links : links.filter(l => socialHref(l));
    if (!shown.length) return { inner: placeholder(ctx.opts, 'social', 'Add links to your profiles in the block settings') };
    const size = b.size === 'small' || b.size === 'large' ? ` sl-${b.size}` : '';
    const align = b.socialAlign === 'center' || b.socialAlign === 'right' ? ` sl-${b.socialAlign}` : '';
    const items = shown.map(l => {
      const p = SOCIAL[l.platform];
      const href = socialHref(l);
      const away = href && l.platform !== 'email' ? ' target="_blank" rel="noopener"' : '';
      return `<a class="sl-a${href ? '' : ' sl-off'}" href="${esc(href || '#')}"${away} aria-label="${p.label}" title="${p.label}"><svg viewBox="0 0 24 24" aria-hidden="true"${p.evenodd ? ' fill-rule="evenodd"' : ''}><path d="${p.d}"/></svg></a>`;
    }).join('');
    return { inner: `<div class="sl${size}${align}">${items}</div>` };
  },

  // A Google map of an address (no key needed for this embed).
  map(site, sec, b, ctx) {
    const address = String(b.address || '').trim();
    if (!address) return { inner: placeholder(ctx.opts, 'map', 'Type an address in the block settings') };
    const zoom = Math.max(1, Math.min(20, Math.round(Number(b.zoom) || 14)));
    const src = `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&output=embed`;
    return { inner: `<div class="map-frame"><iframe src="${esc(src)}" title="${esc(`Map: ${address}`)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>` };
  },

  // Questions and answers that open and close (<details>, no script needed).
  accordion(site, sec, b, ctx) {
    const items = (b.items || []).filter(it => it && (ctx.opts.edit || it.title || it.html));
    if (!items.length) return { inner: placeholder(ctx.opts, 'accordion', 'Add items in the block settings') };
    const cls = ['acc', b.dividers === false ? '' : 'acc-lines', b.icon === 'arrow' ? 'acc-arrow' : ''].filter(Boolean).join(' ');
    const rows = items.map((it, i) => `<details class="acc-item"${b.openFirst && i === 0 ? ' open' : ''}><summary class="acc-title"><span>${esc(it.title || '')}</span><i class="acc-ic" aria-hidden="true"></i></summary><div class="acc-body rt">${it.html || ''}</div></details>`).join('');
    return { inner: `<div class="${cls}">${rows}</div>` };
  },
};

// Social Links: platforms Joni can pick, with small icons (24 x 24, filled).
export const SOCIAL = {
  instagram: { label: 'Instagram', evenodd: true, d: 'M7.5 2.5h9a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5zm0 1.9a3.1 3.1 0 0 0-3.1 3.1v9a3.1 3.1 0 0 0 3.1 3.1h9a3.1 3.1 0 0 0 3.1-3.1v-9a3.1 3.1 0 0 0-3.1-3.1zM12 7.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zm0 1.9a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8zm5.2-3.4a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3z' },
  facebook: { label: 'Facebook', d: 'M13.6 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9a23 23 0 0 0-2.5-.1c-2.5 0-4.2 1.5-4.2 4.3v2.4H7.4v3.3h2.8V22z' },
  x: { label: 'X', d: 'M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.2L5.6 21h-3l7-8.1L2 3h6.2l4.3 5.7zm-1 16.2h1.7L7.3 4.7H5.5z' },
  tiktok: { label: 'TikTok', d: 'M13.4 3h3.2c.3 2.2 1.8 3.7 4.1 3.9v3.2a7 7 0 0 1-4.1-1.3v6.4a5.6 5.6 0 1 1-5.6-5.6h.4v3.3H11a2.3 2.3 0 1 0 2.4 2.3z' },
  youtube: { label: 'YouTube', evenodd: true, d: 'M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8A27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15.1V8.9l5.3 3.1z' },
  vimeo: { label: 'Vimeo', d: 'M22 7.4c-.1 2-1.5 4.6-4.1 8-2.7 3.5-5 5.2-6.9 5.2-1.2 0-2.2-1.1-3-3.3L6.4 11.3c-.6-2.2-1.2-3.3-1.9-3.3-.1 0-.7.3-1.6 1L2 7.8l3-2.6c1.3-1.2 2.3-1.8 3-1.8 1.6-.2 2.6.9 2.9 3.3.4 2.6.7 4.2.8 4.8.4 2 .9 2.9 1.4 2.9.4 0 1.1-.7 2-2 .9-1.4 1.4-2.5 1.4-3.2.1-1.2-.4-1.8-1.4-1.8-.5 0-1 .1-1.5.3 1-3.2 2.9-4.8 5.7-4.7 2.1.1 3.1 1.4 3 4z' },
  linkedin: { label: 'LinkedIn', evenodd: true, d: 'M4.6 3h14.8A1.6 1.6 0 0 1 21 4.6v14.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 19.4V4.6A1.6 1.6 0 0 1 4.6 3zm1.8 6.8V18h2.6V9.8zm1.3-4.1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm3 4.1V18h2.6v-4.3c0-1.2.4-2.1 1.6-2.1 1.1 0 1.3.9 1.3 2V18h2.6v-4.9c0-2.4-.7-3.5-2.9-3.5-1.3 0-2.2.7-2.6 1.4V9.8z' },
  pinterest: { label: 'Pinterest', d: 'M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.8-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.9 0-2.5-1.8-4.3-4.4-4.3-3 0-4.8 2.3-4.8 4.6 0 .9.4 1.9.8 2.4.1.1.1.2.1.3l-.3 1.2c0 .2-.2.3-.4.2-1.4-.6-2.2-2.6-2.2-4.2 0-3.4 2.5-6.6 7.2-6.6 3.8 0 6.7 2.7 6.7 6.3 0 3.8-2.4 6.8-5.7 6.8-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.2 1-.9 2.2-1.4 2.9A10 10 0 1 0 12 2z' },
  email: { label: 'Email', evenodd: true, d: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.3V17h16V7.3l-8 5.3zM5.4 7l6.6 4.4L18.6 7z' },
};

// Where a social link goes: email addresses become mailto: links, bare
// addresses get https://, anything else (javascript: and the like) is dropped.
export function socialHref(link) {
  const url = String(link?.url || '').trim();
  if (!url) return '';
  if (link.platform === 'email' || /^mailto:/i.test(url)) {
    const addr = url.replace(/^mailto:/i, '');
    return /^[^\s@]+@[^\s@]+$/.test(addr) ? `mailto:${addr}` : '';
  }
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return '';
  return `https://${url.replace(/^\/+/, '')}`;
}

export const BLOCK_KINDS = KINDS;

export function renderBlock(site, sec, b, m, opts) {
  const render = KINDS[b.kind];
  if (!render) return '';
  const ctx = { opts, scope: `s:${sec.id}`, path: `blocks.${b.id}` };
  const { inner, cls = '', attrs = '' } = render(site, sec, b, ctx);
  const classes = [
    `fe-b k-${b.kind}${cls}`,
    b.alignV === 'middle' || b.alignV === 'bottom' ? `av-${b.alignV}` : '',
    b.hideDesktop ? 'hide-d' : '',
    b.hideMobile ? 'hide-m' : '',
    b.style && styleVars(b.style) ? 'has-style' : '',
  ].filter(Boolean).join(' ');
  return `<div class="${classes}" style="--d:${area(b.d)};--m:${area(m || b.d)}${styleVars(b.style)}"${attrs}${opts.edit ? ` data-bid="${esc(b.id)}"` : ''}>${inner}</div>`;
}

export function renderBlocksSection(site, page, sec, opts) {
  const blocks = sec.blocks || [];
  const mobile = mobileLayout(blocks);
  const rows = Math.max(sec.rows || 1, ...blocks.map(b => b.d.y + b.d.h));
  const inner = blocks.map(b => renderBlock(site, sec, b, mobile.get(b.id), opts)).join('');
  const empty = !blocks.length ? placeholder(opts, 'blocks', 'Blank section: click "Add Block" to place text, images or buttons') : '';
  const fit = isFitSection(sec) ? ' fe-fit' : '';
  return `${sectionOpen(sec, ['s-blocks'], opts, { '--fe-gap': `${sec.gap ?? 16}px`, '--fe-rows': rows })}<div class="fe"><div class="fe-grid${fit}">${inner}</div>${empty}</div></section>`;
}

export const BLOCKS_CSS = `/* blank sections (free grid) */
.fe{container-type:inline-size}
.fe-grid{display:grid;grid-template-columns:repeat(${GRID_COLS},minmax(0,1fr));grid-auto-rows:minmax(calc((100cqw - ${GRID_COLS - 1} * var(--fe-gap,16px)) / ${GRID_COLS}),auto);column-gap:var(--fe-gap,16px);min-height:calc(var(--fe-rows,8) * 100cqw / ${GRID_COLS})}
.fe-grid.fe-fit{grid-auto-rows:auto!important;min-height:0!important}
.fe-b{grid-area:var(--d);min-width:0;min-height:0;position:relative}
.fe-b.av-middle,.fe-b.av-bottom{display:flex;flex-direction:column}
.fe-b.av-middle{justify-content:center}.fe-b.av-bottom{justify-content:flex-end}
.fe-b.has-style{background:var(--b-bg,transparent);border-radius:var(--b-rad,0);padding:var(--b-pad,0);border:var(--b-stroke,none);overflow:hidden}
.fe-b.k-image .fig,.fe-b.k-image .fig a{height:100%}
.fe-b.k-image img{width:100%;height:100%;object-fit:var(--fit,cover);object-position:var(--focal,50% 50%)}
.fe-b.k-image.has-cap .fig{display:flex;flex-direction:column}
.fe-b.k-image.has-cap img{flex:1;min-height:0}
.fe-b.k-image.fit-original .fig,.fe-b.k-image.fit-original .fig a{height:auto}
.fe-b.k-image.fit-original img{height:auto;flex:none}
.fe-b.k-line{display:flex;align-items:center}
.fe-b.k-line hr{width:100%;border:0;border-top:1px solid var(--line);margin:0}
.fe-b.k-video .video-frame{height:100%;aspect-ratio:auto}
.fe-b.k-quote blockquote{margin:0;font-family:var(--font-heading);font-size:var(--h3);line-height:1.4;color:var(--text)}
.fe-b.k-quote figcaption{margin-top:.6em;font-size:var(--p-s);color:var(--muted)}
@media (min-width:781px){.fe-b.hide-d{display:none}}
.fe-b.k-image.has-style img{border-radius:var(--b-rad,0)}
.sl{--sl:28px;display:flex;flex-wrap:wrap;align-items:center;gap:calc(var(--sl) * .6)}
.sl.sl-small{--sl:20px}.sl.sl-large{--sl:38px}
.sl.sl-center{justify-content:center}.sl.sl-right{justify-content:flex-end}
.sl-a{display:inline-flex;color:var(--text);line-height:0;text-decoration:none}
.sl-a svg{width:var(--sl);height:var(--sl);fill:currentColor}
.sl-a:hover{opacity:.7}
.sl-a.sl-off{opacity:.3}
.fe-b.k-map .map-frame{position:relative;height:100%;min-height:120px;background:#e8e8e8}
.fe-b.k-map .map-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.fe-grid.fe-fit .fe-b.k-map .map-frame{height:auto;aspect-ratio:16/9}
.acc-item>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;cursor:pointer;font-family:var(--font-heading);font-size:var(--p-l);line-height:1.35;color:var(--text)}
.acc-item>summary::-webkit-details-marker{display:none}
.acc-lines .acc-item{border-bottom:1px solid var(--line)}
.acc-lines .acc-item:first-child{border-top:1px solid var(--line)}
.acc-ic{position:relative;flex:none;width:12px;height:12px}
.acc-ic::before,.acc-ic::after{content:"";position:absolute;left:0;top:50%;width:100%;height:1.5px;margin-top:-.75px;background:currentColor;transition:transform .2s ease}
.acc-ic::after{transform:rotate(90deg)}
.acc-item[open]>summary .acc-ic::after{transform:rotate(0deg)}
.acc-arrow .acc-ic{width:9px;height:9px;margin-right:3px;border-right:1.5px solid;border-bottom:1.5px solid;transform:translateY(-2px) rotate(45deg);transition:transform .2s ease}
.acc-arrow .acc-ic::before,.acc-arrow .acc-ic::after{display:none}
.acc-arrow .acc-item[open]>summary .acc-ic{transform:translateY(2px) rotate(-135deg)}
.acc-body{padding:0 0 18px}

`;

export const BLOCKS_CSS_MOBILE = `  .fe-grid{grid-template-columns:repeat(${GRID_COLS_MOBILE},minmax(0,1fr));grid-auto-rows:minmax(calc((100cqw - ${GRID_COLS_MOBILE - 1} * var(--fe-gap,16px)) / ${GRID_COLS_MOBILE}),auto);min-height:0}
  .fe-b{grid-area:var(--m)}
  .fe-b.hide-m{display:none}
`;
