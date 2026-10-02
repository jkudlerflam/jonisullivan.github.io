// Builds the public stylesheet (assets/site.css) from the design settings.
// Everything a person can change in Site Styles becomes a CSS variable on :root;
// the rest of the sheet is fixed and only reads those variables.

import { fontById } from './schema.js';
import { GALLERY_CSS, GALLERY_CSS_MOBILE } from './gallery.js';
import { BLOCKS_CSS, BLOCKS_CSS_MOBILE } from './blocks.js';

const px = n => `${Number(n) || 0}px`;
const em = n => `${Number(n) || 0}em`;

// <link> tags for the Google fonts the design uses (one per family, so one bad
// family cannot break the others).
export function fontLinks(design) {
  const ids = new Set(Object.values(design.fonts || {}));
  const fams = [...ids].map(fontById).filter(f => f.google);
  if (!fams.length) return '';
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...fams.map(f => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.google}&amp;display=swap">`),
  ].join('\n');
}

function activeRule(style) {
  switch (style) {
    case 'underline': return 'text-decoration:underline;text-underline-offset:3px;';
    case 'bold': return 'font-weight:600;';
    case 'none': return '';
    default: return 'font-style:italic;';
  }
}

export function themeVars(design) {
  const d = design;
  const c = d.colors;
  const t = d.text;
  return `:root{
  --bg:${c.background};--text:${c.text};--para:${c.paragraph};--muted:${c.muted};--caption:${c.caption};
  --link:${c.link};--accent:${c.accent};--accent-text:${c.accentText};--line:${c.line};--lb-bg:${d.lightbox.background};--lb-fg:${c.text};
  --font-title:${fontById(d.fonts.title).stack};--font-nav:${fontById(d.fonts.nav).stack};
  --font-heading:${fontById(d.fonts.heading).stack};--font-body:${fontById(d.fonts.body).stack};
  --title-size:${px(d.title.size)};--title-size-m:${px(d.title.mobileSize)};--title-ls:${em(d.title.letterSpacing)};
  --title-ls-m:${em(d.title.mobileLetterSpacing ?? d.title.letterSpacing)};--title-weight:${d.title.weight};--title-style:${d.title.italic ? 'italic' : 'normal'};--title-tt:${d.title.uppercase ? 'uppercase' : 'none'};
  --logo-h:${px(d.logo.height)};
  --nav-size:${px(d.nav.size)};--nav-sub-size:${px(d.nav.subSize)};--nav-ls:${em(d.nav.letterSpacing)};
  --nav-tt:${d.nav.uppercase ? 'uppercase' : 'none'};--nav-gap:${px(d.nav.gap)};
  --p:${px(t.p)};--p-s:${px(t.small)};--p-l:${px(t.large)};--meta:${px(t.meta)};--lh:${t.lineHeight};
  --h1:${px(t.h1)};--h2:${px(t.h2)};--h3:${px(t.h3)};--hw:${t.headingWeight};--h-ls:${em(t.headingLetterSpacing)};
  --cap:${px(d.captions.size)};
  --sidebar-w:${px(d.spacing.sidebarWidth)};--pad-x:${px(d.spacing.padX)};--pad-top:${px(d.spacing.padTop)};
  --btn-radius:${px(d.buttons.radius)};--btn-tt:${d.buttons.uppercase ? 'uppercase' : 'none'};
}
.nav a.active,.nav-folder.has-active>summary{${activeRule(d.nav.active)}}`;
}

const BASE = `
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.35;-webkit-text-size-adjust:100%;text-size-adjust:100%}
img{max-width:100%}
a{color:var(--link)}

/* ---------- header ---------- */
.site-header{background:var(--bg);z-index:100}
.site-title{display:inline-block;font-family:var(--font-title);font-size:var(--title-size);letter-spacing:var(--title-ls);font-weight:var(--title-weight);font-style:var(--title-style);text-transform:var(--title-tt);line-height:1.35;text-decoration:none;color:var(--text)}
.site-logo img{display:block;height:var(--logo-h);width:auto;max-width:100%}
.nav{display:flex;flex-direction:column;gap:var(--nav-gap);font-family:var(--font-nav);font-size:var(--nav-size);letter-spacing:var(--nav-ls);text-transform:var(--nav-tt)}
.nav a{color:var(--text);text-decoration:none}
.nav-spacer{height:10px}
.nav-folder{margin:0}
.nav-folder>summary{list-style:none;cursor:pointer;color:var(--text)}
.nav-folder>summary::-webkit-details-marker{display:none}
.nav-folder[open]>summary{font-style:italic}
.nav-sub{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.nav-sub a{text-transform:none;letter-spacing:.02em;font-size:var(--nav-sub-size);line-height:1.25}
.menu-toggle{display:none;background:none;border:0;cursor:pointer;padding:6px;position:absolute;top:24px;right:16px;z-index:1001;width:28px;height:22px;flex-direction:column;justify-content:space-between;box-sizing:content-box}
.menu-toggle span{display:block;width:100%;height:2px;background:var(--text);transition:transform .3s ease,opacity .3s ease}
.menu-toggle.open span:nth-child(1){transform:translateY(10px) rotate(45deg)}
.menu-toggle.open span:nth-child(2){opacity:0}
.menu-toggle.open span:nth-child(3){transform:translateY(-10px) rotate(-45deg)}
.content{min-height:100vh}
.site-footer{padding:24px var(--pad-x) 32px;font-size:var(--p-s);color:var(--muted)}
.site-footer a{color:inherit}

@media (min-width:781px){
  .layout-sidebar .site-header{position:fixed;top:0;left:0;width:var(--sidebar-w);height:100vh;padding:28px 18px;overflow-y:auto}
  .layout-sidebar .site-title{margin-bottom:28px}
  .layout-sidebar .content{margin-left:var(--sidebar-w);padding:var(--pad-top) var(--pad-x)}
  .layout-sidebar .site-footer{margin-left:var(--sidebar-w)}

  .layout-topbar .site-header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:32px;padding:22px var(--pad-x)}
  .layout-topbar .nav{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px calc(var(--nav-gap) * 1.6)}
  .layout-topbar .nav-spacer{height:auto;width:10px}
  .layout-topbar .content{padding:var(--pad-top) var(--pad-x)}

  .layout-centered .site-header{padding:36px var(--pad-x) 20px;text-align:center}
  .layout-centered .site-title{margin-bottom:18px}
  .layout-centered .nav{flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px calc(var(--nav-gap) * 1.6)}
  .layout-centered .nav-spacer{height:auto;width:10px}
  .layout-centered .content{padding:var(--pad-top) var(--pad-x)}

  .layout-topbar .nav-folder,.layout-centered .nav-folder{position:relative}
  .layout-topbar .nav-folder[open]>summary,.layout-centered .nav-folder[open]>summary{font-style:normal}
  .layout-topbar .nav-sub,.layout-centered .nav-sub{position:absolute;top:calc(100% + 12px);left:-16px;min-width:220px;margin:0;padding:16px;background:var(--bg);box-shadow:0 8px 28px rgba(0,0,0,.09);text-align:left;z-index:200}
}

@media (max-width:780px){
  .site-header{position:fixed;top:0;left:0;right:0;width:100%;height:auto;padding:20px 20px 16px;z-index:1000;border-bottom:1px solid rgba(0,0,0,.06);text-align:left}
  .site-title{font-size:var(--title-size-m);letter-spacing:var(--title-ls-m);margin:0;padding-right:44px}
  .site-logo img{height:calc(var(--logo-h) * .75)}
  .menu-toggle{display:flex}
  .nav{position:fixed;inset:0;background:var(--bg);z-index:999;padding:90px 28px 40px;gap:22px;font-size:15px;letter-spacing:.1em;overflow-y:auto;-webkit-overflow-scrolling:touch;opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .3s ease,transform .3s ease,visibility .3s}
  .nav.open{opacity:1;visibility:visible;transform:translateY(0)}
  .nav-sub{margin-top:12px;padding-left:8px;gap:12px}
  .nav-sub a{font-size:14px}
  .content{margin-left:0;padding:96px 16px 48px}
  .site-footer{padding:24px 16px 32px}
}

/* ---------- page and sections ---------- */
.anim-ready [data-anim] .page>.s{transition:opacity .9s ease,transform .9s ease}
.anim-ready [data-anim] .page>.s:not(.in-view){opacity:0}
.anim-ready [data-anim="rise"] .page>.s:not(.in-view){transform:translateY(28px)}
.page{max-width:var(--page-w,none)}
.page.center{margin-left:auto;margin-right:auto}
.s{margin:var(--sa,0px) 0 var(--sp,48px);max-width:var(--s-w,none)}
.s.center{margin-left:auto;margin-right:auto}
.s.right{margin-left:auto}
.s:last-child{margin-bottom:0}
.s.has-bg{background:var(--s-bg);padding-top:var(--s-pad);padding-bottom:var(--s-pad)}
.s.has-bg:not(.bg-full){padding-left:24px;padding-right:24px}
.s.bg-full{box-shadow:0 0 0 100vmax var(--s-bg);clip-path:inset(0 -100vmax)}
.s.has-fg,.s.has-fg .rt,.s.has-fg .rt h1,.s.has-fg .rt h2,.s.has-fg .rt h3,.s.has-fg .rt h4,.s.has-fg .rt a,.s.has-fg figcaption,.s.has-fg .g-cap{color:var(--s-fg)}

/* rich text */
.rt{font-size:var(--fs,var(--p));line-height:var(--lh);color:var(--para);--pm:1.25em}
.rt.size-small{--fs:var(--p-s)}
.rt.size-large{--fs:var(--p-l)}
.rt.lh-tight{line-height:1.35;--pm:1em}
.rt.lh-loose{line-height:1.65;--pm:1.23em}
.rt p{margin:0 0 var(--pm)}
.rt h1,.rt h2,.rt h3,.rt h4{font-family:var(--font-heading);font-weight:var(--hw);letter-spacing:var(--h-ls);line-height:1.35;color:var(--text);margin:0 0 .2em}
.rt h1{font-size:var(--h1)}.rt h2{font-size:var(--h2)}.rt h3{font-size:var(--h3)}.rt h4{font-size:1.05em}
.rt p.large{font-size:var(--p-l)}.rt p.small{font-size:var(--p-s)}
.rt p.muted{color:var(--muted);font-size:var(--meta)}
.rt .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
.rt .indent-1{margin-left:2em}.rt .indent-2{margin-left:4em}.rt .indent-3{margin-left:6em}
.rt a{color:var(--link);text-decoration:underline}
.rt ul,.rt ol{margin:0 0 1em;padding-left:1.4em}
.rt li{margin:0 0 .3em}
.rt blockquote{margin:0 0 1em;padding-left:1em;border-left:2px solid var(--line)}
.rt>:last-child{margin-bottom:0}
.rt .align-center{text-align:center}.rt .align-right{text-align:right}.rt .align-justify{text-align:justify}
.ta-center .rt{text-align:center}.ta-right .rt{text-align:right}.ta-justify .rt p{text-align:justify}

/* figures */
.fig{margin:0}
.fig img{display:block;width:100%;height:auto}
.fig figcaption,.g-cap{margin-top:.75rem;font-size:var(--cap);line-height:1.35;color:var(--caption)}
.fig a{display:block}
.cap-small figcaption{margin-top:18px;font-size:calc(var(--cap) - 1px);opacity:.667}

${GALLERY_CSS}/* image and text */
.s-imagetext{display:grid;grid-template-columns:var(--it-cols,1fr 1fr);gap:40px;align-items:var(--it-valign,center)}
.s-imagetext.image-right .fig{order:2}

/* article list */
.posts{display:flex;flex-direction:column;gap:60px}
.post-title{margin:0 0 6px;font-family:var(--font-heading);font-size:var(--h2);font-weight:var(--hw);letter-spacing:var(--h-ls);color:var(--text);line-height:1.35}
.post-title a{color:inherit;text-decoration:none}
.post-venue{margin:0 0 12px;font-size:15px;line-height:1.5;font-weight:600;color:var(--para);letter-spacing:.01em}
.post-date{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5}
.post-image{margin:0 0 14px}
.post-image img{width:100%;height:auto;display:block}
.post-excerpt{margin:0 0 12px;font-size:15px;line-height:1.5;color:var(--para)}
.read-more{display:inline-block;margin-top:4px;font-size:14px;color:var(--text);text-decoration:underline;letter-spacing:.04em;text-transform:uppercase}

/* CV */
.cv-section{margin-bottom:2.5rem}
.cv-section:last-child{margin-bottom:0}
.cv-heading{font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px;color:var(--text)}
.cv-item{display:flex;gap:16px;margin-bottom:8px;font-size:14px;line-height:1.45}
.cv-year{flex:0 0 60px;color:var(--muted);font-size:13px}
.cv-text{flex:1;color:var(--para)}
.cv-text a{color:inherit}

/* buttons */
.btn-row{display:flex}
.btn-row.center{justify-content:center}.btn-row.right{justify-content:flex-end}
.btn{display:inline-block;padding:13px 26px;border:1px solid var(--accent);border-radius:var(--btn-radius);font-family:var(--font-nav);font-size:13px;letter-spacing:.08em;text-transform:var(--btn-tt);text-decoration:none;line-height:1.2;cursor:pointer;background:transparent;color:var(--accent)}
.btn.solid{background:var(--accent);color:var(--accent-text)}
.btn.link{border-color:transparent;padding-left:0;padding-right:0;text-decoration:underline}
.btn:hover{opacity:.82}

/* video */
.video-frame{position:relative;aspect-ratio:16/9;background:#000}
.video-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}

/* spacer */
.s-spacer{height:var(--h,48px);display:flex;align-items:center}
.s-spacer hr{width:100%;border:0;border-top:1px solid var(--line);margin:0}

/* contact form */
.contact-form{display:grid;gap:14px}
.contact-form label{display:grid;gap:6px;font-size:13px;letter-spacing:.04em;color:var(--text)}
.contact-form input,.contact-form textarea{font:inherit;font-size:15px;padding:10px 12px;border:1px solid #cfcfcf;border-radius:0;background:var(--bg);color:var(--text);width:100%}
.contact-form textarea{min-height:160px;resize:vertical}
.contact-form .hp{position:absolute;left:-9999px}
.form-status{margin:0;font-size:13px;color:var(--muted)}
.form-success{font-size:15px;color:var(--para)}

${BLOCKS_CSS}@media (max-width:780px){
  .page{max-width:none}
  .s-imagetext{grid-template-columns:1fr;gap:20px}
  .s-imagetext.image-right .fig{order:0}
${GALLERY_CSS_MOBILE}  .post-title{font-size:calc(var(--h2) * .846);margin-bottom:4px}
  .post-venue,.post-excerpt{font-size:14px;line-height:1.55}
  .post-date{font-size:12px;line-height:1.55}
  .fig figcaption{white-space:normal}
  .cv-item{gap:12px;font-size:13px}
  .cv-year{flex:0 0 50px;font-size:12px}
  .cv-heading{font-size:12px}
${BLOCKS_CSS_MOBILE}}
`;

export function renderCss(site) {
  return `/* Generated by the site editor (/admin). Change the look in Site Styles, not here. */\n${themeVars(site.design)}\n${BASE.trim()}\n${sectionExtrasCss(site)}`;
}

// ---------- Edit Section: section colors, background images, height ----------
// Added only for sites that use them, so every other page keeps exactly the
// same stylesheet.

// A section with its own text color (Colors tab): everything inside follows it.
const SECTION_THEME_CSS = `/* section colors */
.s.has-fg{--text:var(--s-fg);--para:var(--s-fg);--link:var(--s-fg);--caption:var(--s-fg);--accent:var(--s-fg);--accent-text:var(--s-on,var(--bg))}
.s.has-fg .contact-form input,.s.has-fg .contact-form textarea{background:transparent;border-color:currentColor}
`;

// A cover image behind the section (Background tab). With "Extend to the edges
// of the screen" the image reaches the sides of the window (or the sidebar) and
// an inset content width narrows the content, not the image.
const SECTION_IMAGE_CSS = `/* section background images */
.content{overflow-x:clip}
.s.has-bgimg{position:relative;isolation:isolate;padding-top:var(--s-pad,48px);padding-bottom:var(--s-pad,48px)}
.s.has-bgimg:not(.bg-full){padding-left:24px;padding-right:24px}
.s.has-bgimg.bg-full{max-width:none}
.s.has-bgimg.bg-full:not(.center):not(.right){padding-right:max(0px,100% - var(--s-w,100%))}
.s.has-bgimg.bg-full.center{padding-left:max(0px,(100% - var(--s-w,100%)) / 2);padding-right:max(0px,(100% - var(--s-w,100%)) / 2)}
.s.has-bgimg.bg-full.right{padding-left:max(0px,100% - var(--s-w,100%))}
.s-bgimg{position:absolute;top:0;right:0;bottom:0;left:0;z-index:-1;overflow:hidden;pointer-events:none}
.s-bgimg img{display:block;width:100%;height:100%;max-width:none;object-fit:cover}
.s-bgimg.has-ov::after{content:"";position:absolute;top:0;right:0;bottom:0;left:0;background:var(--s-ov)}
@media (min-width:781px){
  .s.has-bgimg.bg-full>.s-bgimg{left:calc(-1 * var(--pad-x));right:calc(-1 * var(--pad-x))}
  .page[style*="--page-w"]:not(.center)>.s.has-bgimg.bg-full>.s-bgimg{right:calc(100% - 100vw + var(--pad-x))}
  .layout-sidebar .page[style*="--page-w"]:not(.center)>.s.has-bgimg.bg-full>.s-bgimg{right:calc(100% - 100vw + var(--sidebar-w) + var(--pad-x))}
  .page.center[style*="--page-w"]>.s.has-bgimg.bg-full>.s-bgimg{left:calc((100% - 100vw) / 2);right:calc((100% - 100vw) / 2)}
  .layout-sidebar .page.center[style*="--page-w"]>.s.has-bgimg.bg-full>.s-bgimg{left:calc((100% - 100vw + var(--sidebar-w)) / 2);right:calc((100% - 100vw + var(--sidebar-w)) / 2)}
}
@media (max-width:780px){
  .s.has-bgimg.bg-full>.s-bgimg{left:-16px;right:-16px}
}
`;

// Section height and vertical alignment (Design tab of a Fluid Engine section):
// the section is at least its number of rows tall; when that is more than its
// blocks need, the blocks sit at the top, middle or bottom.
const SECTION_HEIGHT_CSS = `/* section height and vertical alignment */
.s-blocks.va-top>.fe,.s-blocks.va-middle>.fe,.s-blocks.va-bottom>.fe{display:flex;flex-direction:column;aspect-ratio:24 / var(--fe-rows,8)}
.s-blocks.va-middle>.fe{justify-content:center}
.s-blocks.va-bottom>.fe{justify-content:flex-end}
.va-top>.fe>.fe-grid,.va-middle>.fe>.fe-grid,.va-bottom>.fe>.fe-grid{min-height:0}
@media (min-width:781px){
  .va-top>.fe>.fe-grid,.va-middle>.fe>.fe-grid,.va-bottom>.fe>.fe-grid{grid-auto-rows:minmax(calc(100cqw / 24),auto)}
}
`;

function sectionExtrasCss(site) {
  const color = /^#[0-9a-f]{3,8}$/i;
  const secs = site.pages.flatMap(p => p.sections || []);
  let css = '';
  if (secs.some(s => color.test(s.fg || ''))) css += SECTION_THEME_CSS;
  if (secs.some(s => s.bgImage)) css += SECTION_IMAGE_CSS;
  if (secs.some(s => s.vAlign)) css += SECTION_HEIGHT_CSS;
  return css;
}
