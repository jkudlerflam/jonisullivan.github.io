// Gallery sections, with Squarespace 7.1's six gallery types:
//   Grid: Simple       layout 'grid' ('stack' is the same type with one image per row)
//   Grid: Strips       layout 'strips': justified rows, every image in a row equally tall
//   Grid: Masonry      layout 'masonry'
//   Slideshow: Simple  layout 'slideshow': one image at a time, arrows, counter, thumbnails
//   Slideshow: Full    layout 'slideshow-full': fixed height, the image fills the frame
//   Slideshow: Reel    layout 'reel': images side by side at a fixed height, moved with arrows
// Rendering and the matching CSS live together here. site.js adds the lightbox,
// the slideshow controls and the per-image animations.
//
// Section fields (SECTION_TYPES.gallery in schema.js): layout, items, columns, gap,
// mobileGap (null = automatic), aspect, captions, captionAlign, lightbox, bleedMobile,
// autoplay (seconds, 0 = off), slideHeight (% of the window height). Fields older files
// may lack, so each has a default here: rowHeight (px: the row height of Grid: Strips and
// the image height of Slideshow: Reel), thumbnails (Slideshow: Simple), animation
// ('site' | 'none' | 'fade' | 'scale') and bleed (Full Bleed).
// Items: { id, media, caption, alt, link, newTab, hidden, focal: [x%, y%] }.

import { esc, imgTag, takeEager, placeholder, sectionOpen, field, mediaUrls } from './util.js';

export const GALLERY_LAYOUTS = ['stack', 'grid', 'strips', 'masonry', 'slideshow', 'slideshow-full', 'reel'];
export const SLIDESHOW_LAYOUTS = ['slideshow', 'slideshow-full', 'reel'];
export const STRIP_HEIGHT = 260;   // default row height of Grid: Strips, in px
export const REEL_HEIGHT = 400;    // default image height of Slideshow: Reel, in px
const ANIMATIONS = ['none', 'fade', 'scale'];

// Width / height of an image, rounded, for layouts that size images by their shape.
function ratioOf(m) {
  return m.w > 0 && m.h > 0 ? Math.round((m.w / m.h) * 1000) / 1000 : 1.5;
}

const validFocal = f => Array.isArray(f) && f.length === 2 && f.every(Number.isFinite);

export function renderGallery(site, page, sec, opts) {
  const items = (sec.items || []).filter(it => site.media[it.media] && (opts.edit || !it.hidden));
  if (!items.length) {
    return opts.edit ? `${sectionOpen(sec, ['s-gallery'], opts)}${placeholder(opts, 'gallery', 'Drop images here, or click to add images')}</section>` : '';
  }
  const layout = GALLERY_LAYOUTS.includes(sec.layout) ? sec.layout : 'grid';
  const show = SLIDESHOW_LAYOUTS.includes(layout);
  const vars = { '--g-gap': `${sec.gap ?? 24}px` };
  if (layout === 'grid' || layout === 'masonry') {
    vars['--g-cols'] = sec.columns || 3;
    vars['--g-cols-m'] = Math.min(2, sec.columns || 3);
  }
  let cropped = '';
  if ((layout === 'grid' || layout === 'stack') && sec.aspect && sec.aspect !== 'original') {
    vars['--g-aspect'] = sec.aspect.replace(':', ' / ');
    cropped = ' cropped';
  }
  const rowHeight = sec.rowHeight || (layout === 'reel' ? REEL_HEIGHT : STRIP_HEIGHT);
  if (layout === 'strips') vars['--g-rh'] = `${rowHeight}px`;
  if (show) vars['--g-h'] = layout === 'reel' ? `${rowHeight}px` : `${sec.slideHeight || 75}vh`;
  if (layout === 'stack' || layout === 'slideshow') vars['--g-gap-m'] = `${sec.mobileGap ?? Math.min(16, sec.gap ?? 16)}px`;
  else if (typeof sec.mobileGap === 'number') vars['--g-gap-m'] = `${sec.mobileGap}px`;

  const width = sec.width || 1100;
  const cols = layout === 'grid' || layout === 'masonry' ? (sec.columns || 3) : 1;
  const sizes = cols > 1 ? `(max-width: 780px) 50vw, ${Math.round(width / cols)}px` : `(max-width: 780px) 100vw, ${width}px`;
  // Strips and reels show each image at a set height, so its width follows its shape.
  const sizesFor = r => {
    if (layout === 'strips') return `(max-width: 780px) 60vw, ${Math.round(rowHeight * r)}px`;
    if (layout === 'reel') return `(max-width: 780px) 86vw, ${Math.round(rowHeight * r)}px`;
    if (layout === 'slideshow-full' && !sec.width) return '100vw';
    return sizes;
  };
  const lightbox = sec.lightbox ? '1' : '0';
  const capAlign = sec.captionAlign === 'center' ? ' center' : sec.captionAlign === 'right' ? ' right' : '';
  const figs = items.map(it => {
    const m = site.media[it.media];
    const r = ratioOf(m);
    const focal = validFocal(it.focal) ? ` style="object-position:${it.focal[0]}% ${it.focal[1]}%"` : '';
    const img = imgTag(site, it.media, opts, { cls: 'g-img', sizes: sizesFor(r), alt: it.alt || m.alt, eager: takeEager(opts), full: true, extra: focal });
    const body = it.link ? `<a class="g-link" href="${esc(it.link)}"${it.newTab ? ' target="_blank" rel="noopener"' : ''}>${img}</a>` : img;
    const cap = sec.captions ? field(opts, 'figcaption', `g-cap${capAlign}`, `s:${sec.id}`, `items.${it.id}.caption`, 'inline', it.caption, 'Add a caption') : '';
    const shape = layout === 'strips' || layout === 'reel' ? ` style="--r:${r}"` : '';
    return `<figure class="g-item${it.hidden ? ' ed-hidden' : ''}"${shape}${opts.edit ? ` data-item="${esc(it.id)}"` : ''}>${body}${cap}</figure>`;
  }).join('');
  const nav = show
    ? '<div class="g-nav"><button class="g-prev" type="button" aria-label="Previous image">‹</button><span class="g-count"></span><button class="g-next" type="button" aria-label="Next image">›</button></div>'
    : '';
  const thumbs = layout === 'slideshow' && sec.thumbnails ? renderThumbs(site, items, opts) : '';
  const anim = ANIMATIONS.includes(sec.animation) ? ` data-g-anim="${sec.animation}"` : '';
  const attrs = ` data-lightbox="${lightbox}"${show && sec.autoplay ? ` data-autoplay="${sec.autoplay}"` : ''}${anim}`;
  const classes = ['s-gallery', `g-${layout}`, cropped.trim(), sec.bleedMobile ? 'bleed-mobile' : '', sec.bleed ? 'g-bleed' : ''];
  const open = sectionOpen(sec, classes, opts, vars, attrs);
  return `${open}<div class="g-items">${figs}</div>${nav}${thumbs}</section>`;
}

// Slideshow: Simple's strip of small images under the slides; site.js moves the
// slideshow to the one clicked and marks the current one.
function renderThumbs(site, items, opts) {
  const buttons = items.map((it, i) => {
    const u = mediaUrls(site, it.media, opts);
    const m = u.m;
    const src = u.medium || u.main;
    const dim = u.medium ? m.medium : m;
    const size = dim.w ? ` width="${dim.w}" height="${dim.h}"` : '';
    return `<button class="g-thumb${i === 0 ? ' on' : ''}${it.hidden ? ' ed-hidden' : ''}" type="button" aria-label="Show image ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}><img src="${esc(src)}"${size} alt="" loading="lazy" decoding="async"></button>`;
  }).join('');
  return `<div class="g-thumbs">${buttons}</div>`;
}

export const GALLERY_CSS = `/* galleries */
.g-items{display:flex;flex-direction:column;gap:var(--g-gap,34px)}
.g-item{margin:0;min-width:0}
.g-img{display:block;width:100%;height:auto}
.g-item a.g-link{display:block}
[data-lightbox="1"] .g-img{cursor:zoom-in}
.g-cap.center{text-align:center}
.g-cap.right{text-align:right}
.g-grid .g-items{display:grid;grid-template-columns:repeat(var(--g-cols,3),minmax(0,1fr));gap:var(--g-gap,24px)}
.g-grid.cropped .g-img,.g-stack.cropped .g-img{aspect-ratio:var(--g-aspect);object-fit:cover}
.g-masonry .g-items{display:block;columns:var(--g-cols,3);column-gap:var(--g-gap,24px)}
.g-masonry .g-item{break-inside:avoid;margin:0 0 var(--g-gap,24px)}
.g-slideshow .g-items{flex-direction:row;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;outline:none}
.g-slideshow .g-items::-webkit-scrollbar{display:none}
.g-slideshow .g-item{flex:0 0 100%;scroll-snap-align:center;display:flex;flex-direction:column;align-items:center}
.g-slideshow .g-img{width:auto;max-width:100%;max-height:var(--g-h,75vh);object-fit:contain}
.g-nav{display:flex;justify-content:center;align-items:center;gap:18px;margin-top:14px;font-size:var(--p-s);color:var(--muted)}
.g-nav button{background:none;border:0;padding:4px 10px;font-size:22px;line-height:1;color:var(--text);cursor:pointer}
/* Grid: Strips. Images are placed at 85% of the row height, then each grows in proportion
   to its width until the row is full, so every image in a row has the same height (close
   to the chosen one). The last row keeps its images at their placed size. */
.g-strips .g-items{flex-direction:row;flex-wrap:wrap}
.g-strips .g-items::after{content:"";flex:10000 1 0px}
.g-strips .g-item{flex:var(--r,1.5) 1 calc(var(--r,1.5) * var(--g-rh,260px) * .85)}
.g-strips .g-img{aspect-ratio:var(--r,1.5);object-fit:cover}
/* Slideshow: Full and Slideshow: Reel. --g-eh is the height the images are shown at. */
.g-slideshow-full,.g-reel{position:relative;--g-eh:var(--g-h,75vh)}
.g-slideshow .g-items,.g-slideshow-full .g-items,.g-reel .g-items{position:relative}
.g-slideshow-full .g-items,.g-reel .g-items{flex-direction:row;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;outline:none}
.g-slideshow-full .g-items::-webkit-scrollbar,.g-reel .g-items::-webkit-scrollbar{display:none}
.g-slideshow-full .g-item{flex:0 0 100%;scroll-snap-align:start}
.g-slideshow-full .g-img{height:var(--g-eh);object-fit:cover}
.g-reel .g-items{gap:var(--g-gap,24px)}
.g-reel .g-item{flex:0 0 auto;width:calc(var(--g-eh) * var(--r,1.5));scroll-snap-align:start}
.g-reel .g-img{height:var(--g-eh);object-fit:cover}
.g-slideshow-full .g-nav,.g-reel .g-nav{position:absolute;left:0;right:0;top:0;height:var(--g-eh);margin:0;padding:0 14px;justify-content:space-between;pointer-events:none}
.g-slideshow-full.has-bg .g-nav,.g-reel.has-bg .g-nav{top:var(--s-pad,48px)}
.g-slideshow-full .g-nav button,.g-reel .g-nav button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0 0 3px;border-radius:50%;background:rgba(255,255,255,.88);color:#111;font-size:28px;box-shadow:0 1px 6px rgba(0,0,0,.2);pointer-events:auto}
.g-slideshow-full .g-count,.g-reel .g-count{display:none}
/* Slideshow: Simple thumbnails */
.g-thumbs{position:relative;display:flex;gap:8px;margin-top:12px;padding:2px 0;overflow-x:auto;scrollbar-width:none}
.g-thumbs::-webkit-scrollbar{display:none}
.g-thumb{flex:0 0 auto;margin:0;padding:0;border:0;background:none;cursor:pointer;opacity:.45;transition:opacity .2s}
.g-thumb:first-child{margin-left:auto}
.g-thumb:last-child{margin-right:auto}
.g-thumb:hover,.g-thumb.on{opacity:1}
.g-thumb img{display:block;width:auto;max-width:none;height:64px}
/* Full Bleed: the gallery reaches the edges of the content area */
.s.g-bleed{max-width:none;margin-left:calc(-1 * var(--pad-x));margin-right:calc(-1 * var(--pad-x))}
/* per-gallery animations (site.js adds g-anim-ready, g-anim-t and g-in) */
.g-anim-ready .g-anim-t{transition:opacity .8s ease,transform .8s ease}
.g-anim-ready .g-anim-t:not(.g-in){opacity:0}
.g-anim-ready [data-g-anim="scale"] .g-anim-t:not(.g-in){transform:scale(.9)}

`;

export const GALLERY_CSS_MOBILE = `  .g-grid .g-items{grid-template-columns:repeat(var(--g-cols-m,2),minmax(0,1fr));gap:var(--g-gap-m,calc(var(--g-gap,24px) * .6))}
  .g-masonry .g-items{columns:var(--g-cols-m,2);column-gap:var(--g-gap-m,var(--g-gap,24px))}
  .g-masonry .g-item{margin-bottom:var(--g-gap-m,var(--g-gap,24px))}
  .g-stack .g-items,.g-slideshow .g-items{gap:var(--g-gap-m,16px)}
  .s.bleed-mobile{margin-left:-16px;margin-right:-16px;max-width:none}
  .s.g-bleed{margin-left:-16px;margin-right:-16px}
  .g-strips .g-items{gap:var(--g-gap-m,calc(var(--g-gap,24px) * .6))}
  .g-strips .g-item{flex-basis:calc(var(--r,1.5) * var(--g-rh,260px) * .5)}
  .g-slideshow-full{--g-eh:min(var(--g-h,75vh),75vw)}
  .g-reel{--g-eh:min(var(--g-h,400px),45vh,56vw)}
  .g-reel .g-items{gap:var(--g-gap-m,calc(var(--g-gap,24px) * .6))}
  .g-reel .g-item{width:min(calc(var(--g-eh) * var(--r,1.5)),86vw)}
  .g-reel .g-img{height:auto;aspect-ratio:var(--r,1.5)}
  .g-slideshow-full .g-nav button,.g-reel .g-nav button{width:36px;height:36px;font-size:24px}
  .g-thumb img{height:48px}
`;
