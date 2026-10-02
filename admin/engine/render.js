// Turns content/site.json into the public HTML pages. The editor uses the same
// functions for its live preview (opts.edit = true adds the hooks it needs), so
// what Joni sees while editing is what gets published.

import { formatDate } from './schema.js';
import { renderCss, fontLinks } from './css.js';
import {
  esc, lines, hash, pageById, isLive, pageFile, pageHref, postsOf, editAttr, imgTag, takeEager, placeholder,
  sectionOpen, field, sizeAttrs, videoEmbedUrl,
} from './util.js';
import { renderGallery } from './gallery.js';
import { renderBlocksSection, mobileLayout } from './blocks.js';

export { esc, hash, pageById, isLive, pageFile, pageHref, postsOf, imgTag, videoEmbedUrl, mobileLayout };

// ---------- header and navigation ----------

function navItems(site, items, activeId, opts, depth = 0) {
  let out = '';
  for (const it of items) {
    if (it.type === 'page') {
      const p = pageById(site, it.page);
      if (!p || !isLive(p)) continue;
      const label = p.navTitle || p.title;
      const active = p.id === activeId;
      out += `<a href="${esc(pageFile(site, p))}"${active ? ' class="active" aria-current="page"' : ''}${opts.edit ? ` data-page="${esc(p.id)}"` : ''}>${lines(label)}</a>`;
    } else if (it.type === 'folder' && depth === 0) {
      const inner = navItems(site, it.children || [], activeId, opts, 1);
      if (!inner) continue;
      const open = (it.children || []).some(c => c.type === 'page' && c.page === activeId);
      out += `<details class="nav-folder${open ? ' has-active' : ''}"${open ? ' open' : ''}><summary class="nav-label">${lines(it.label)}</summary><div class="nav-sub">${inner}</div></details>`;
    } else if (it.type === 'link' && it.url) {
      out += `<a href="${esc(it.url)}"${it.newTab ? ' target="_blank" rel="noopener"' : ''}>${lines(it.label || it.url)}</a>`;
    } else if (it.type === 'spacer') {
      out += '<div class="nav-spacer" aria-hidden="true"></div>';
    }
  }
  return out;
}

export function renderHeader(site, page, opts) {
  const s = site.settings;
  const d = site.design;
  const home = pageHref(site, s.homePage);
  const logo = d.logo.media && site.media[d.logo.media]
    ? `<a class="site-title site-logo" href="${esc(home)}">${imgTag(site, d.logo.media, opts, { alt: s.siteName, eager: true })}</a>`
    : `<a class="site-title" href="${esc(home)}">${lines(s.headerTitle || s.siteName)}</a>`;
  const activeId = page.kind === 'post' ? page.parent : page.id;
  return `<header class="site-header"${opts.edit ? ' data-zone="header"' : ''}>
  ${logo}
  <button class="menu-toggle" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>
  <nav class="nav" id="site-nav">${navItems(site, site.nav, activeId, opts)}</nav>
</header>`;
}

export function renderFooter(site, opts) {
  const f = site.settings.footer;
  if (!f && !opts.edit) return '';
  if (!f) return `<footer class="site-footer" data-zone="footer"></footer>`;
  return `<footer class="site-footer"${opts.edit ? ' data-zone="footer"' : ''}><div class="rt"${editAttr(opts, 'site', 'settings.footer', 'inline')}>${f}</div></footer>`;
}

// ---------- sections ----------

const renderers = {
  text(site, page, sec, opts) {
    if (!sec.html && !opts.edit) return '';
    const sz = sizeAttrs(sec.size, sec.lineHeight);
    const ta = sec.textAlign && sec.textAlign !== 'left' ? `ta-${sec.textAlign}` : '';
    return `${sectionOpen(sec, ['s-text', ta], opts)}<div class="rt${sz.cls}"${sz.style}${editAttr(opts, `s:${sec.id}`, 'html', 'rich')}>${sec.html || ''}</div></section>`;
  },

  image(site, page, sec, opts) {
    if (!site.media[sec.media]) {
      return opts.edit ? `${sectionOpen(sec, ['s-image'], opts)}${placeholder(opts, 'image', 'Click to add an image')}</section>` : '';
    }
    // With a lightbox the image uses the gallery markup that site.js looks for.
    const lightbox = sec.lightbox && !sec.link;
    const img = imgTag(site, sec.media, opts, {
      cls: lightbox ? 'g-img' : '', sizes: `(max-width: 780px) 100vw, ${sec.width || 980}px`, eager: takeEager(opts), full: lightbox,
    });
    const linked = sec.link ? `<a href="${esc(sec.link)}"${sec.newTab ? ' target="_blank" rel="noopener"' : ''}>${img}</a>` : img;
    const cap = field(opts, 'figcaption', lightbox ? 'g-cap' : '', `s:${sec.id}`, 'caption', 'inline', sec.caption, 'Add a caption');
    const capCls = sec.captionStyle === 'small' ? 'cap-small' : '';
    if (lightbox) {
      return `${sectionOpen(sec, ['s-image', 's-gallery', 'g-stack', capCls], opts, {}, ' data-lightbox="1"')}<div class="g-items"><figure class="g-item fig">${img}${cap}</figure></div></section>`;
    }
    return `${sectionOpen(sec, ['s-image', capCls], opts)}<figure class="fig">${linked}${cap}</figure></section>`;
  },

  gallery: renderGallery,

  imageText(site, page, sec, opts) {
    const has = site.media[sec.media];
    const img = has ? imgTag(site, sec.media, opts, { sizes: `(max-width: 780px) 100vw, ${Math.round((sec.width || 1100) * (sec.imageWidth || 50) / 100)}px`, eager: takeEager(opts) })
      : placeholder(opts, 'image', 'Click to add an image');
    if (!has && !opts.edit && !sec.html) return '';
    const cap = has ? field(opts, 'figcaption', '', `s:${sec.id}`, 'caption', 'inline', sec.caption, 'Add a caption') : '';
    const iw = Math.max(20, Math.min(80, sec.imageWidth || 50));
    const cols = sec.imageSide === 'right' ? `${100 - iw}fr ${iw}fr` : `${iw}fr ${100 - iw}fr`;
    const valign = { top: 'start', center: 'center', bottom: 'end' }[sec.verticalAlign] || 'center';
    const sz = sizeAttrs(sec.size, sec.lineHeight);
    return `${sectionOpen(sec, ['s-imagetext', sec.imageSide === 'right' ? 'image-right' : ''], opts, { '--it-cols': cols, '--it-valign': valign })}<figure class="fig">${img}${cap}</figure><div class="rt${sz.cls}"${sz.style}${editAttr(opts, `s:${sec.id}`, 'html', 'rich')}>${sec.html || ''}</div></section>`;
  },

  posts(site, page, sec, opts) {
    const blogId = sec.blog || page.id;
    const posts = postsOf(site, blogId);
    if (!posts.length) {
      return opts.edit ? `${sectionOpen(sec, ['s-posts'], opts)}${placeholder(opts, 'posts', 'Articles you publish in this collection will be listed here')}</section>` : '';
    }
    const items = posts.map(p => {
      const meta = p.post || {};
      const href = esc(pageFile(site, p));
      const scope = `p:${p.id}`;
      const parts = [`<h2 class="post-title"><a href="${href}"${editAttr(opts, scope, 'post.title', 'plain')}>${esc(meta.title || p.title)}</a></h2>`];
      if (sec.showSubtitle) parts.push(field(opts, 'p', 'post-venue', scope, 'post.subtitle', 'plain', esc(meta.subtitle || ''), 'Add a subtitle'));
      if (sec.showDate && meta.date) parts.push(`<p class="post-date">${esc(formatDate(meta.date))}</p>`);
      if (sec.showImage && site.media[meta.image]) {
        parts.push(`<div class="post-image"><a href="${href}">${imgTag(site, meta.image, opts, { sizes: `(max-width: 780px) 100vw, ${sec.width || 780}px`, eager: takeEager(opts) })}</a></div>`);
      }
      if (sec.showExcerpt) parts.push(field(opts, 'p', 'post-excerpt', scope, 'post.excerpt', 'inline', meta.excerpt, 'Add a short excerpt'));
      if (sec.readMore) parts.push(`<a class="read-more" href="${href}">${esc(sec.readMore)}</a>`);
      return `<article class="post"${opts.edit ? ` data-post="${esc(p.id)}"` : ''}>${parts.filter(Boolean).join('\n')}</article>`;
    }).join('\n');
    return `${sectionOpen(sec, ['s-posts'], opts)}<div class="posts">${items}</div></section>`;
  },

  cv(site, page, sec, opts) {
    const scope = `s:${sec.id}`;
    const groups = (sec.groups || []).map(g => {
      const items = (g.items || []).map(it => `<div class="cv-item"${opts.edit ? ` data-cv-item="${esc(it.id)}" data-cv-group="${esc(g.id)}"` : ''}><div class="cv-year"${editAttr(opts, scope, `groups.${g.id}.items.${it.id}.year`, 'plain')}>${esc(it.year || '')}</div><div class="cv-text"${editAttr(opts, scope, `groups.${g.id}.items.${it.id}.html`, 'inline')}>${it.html || ''}</div></div>`).join('\n');
      return `<div class="cv-section"${opts.edit ? ` data-cv-group="${esc(g.id)}"` : ''}><h2 class="cv-heading"${editAttr(opts, scope, `groups.${g.id}.heading`, 'plain')}>${esc(g.heading || '')}</h2>${items}</div>`;
    }).join('\n');
    return `${sectionOpen(sec, ['s-cv'], opts)}${groups}</section>`;
  },

  button(site, page, sec, opts) {
    if (!sec.label) return opts.edit ? `${sectionOpen(sec, ['s-button'], opts)}${placeholder(opts, 'button', 'Button')}</section>` : '';
    const style = sec.style === 'solid' ? ' solid' : sec.style === 'link' ? ' link' : '';
    const align = sec.buttonAlign === 'center' ? ' center' : sec.buttonAlign === 'right' ? ' right' : '';
    const href = sec.url || '#';
    return `${sectionOpen(sec, ['s-button'], opts)}<div class="btn-row${align}"><a class="btn${style}" href="${esc(href)}"${sec.newTab ? ' target="_blank" rel="noopener"' : ''}${editAttr(opts, `s:${sec.id}`, 'label', 'plain')}>${esc(sec.label)}</a></div></section>`;
  },

  video(site, page, sec, opts) {
    const src = videoEmbedUrl(sec.url);
    if (!src) return opts.edit ? `${sectionOpen(sec, ['s-video'], opts)}${placeholder(opts, 'video', 'Paste a YouTube or Vimeo link in the section settings')}</section>` : '';
    const cap = sec.caption ? `<figcaption>${sec.caption}</figcaption>` : '';
    return `${sectionOpen(sec, ['s-video'], opts)}<figure class="fig"><div class="video-frame"><iframe src="${esc(src)}" title="Video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>${cap}</figure></section>`;
  },

  spacer(site, page, sec, opts) {
    return `${sectionOpen(sec, ['s-spacer'], opts, { '--h': `${sec.height ?? 48}px` })}${sec.line ? '<hr>' : ''}</section>`;
  },

  form(site, page, sec, opts) {
    const endpoint = sec.endpoint || site.settings.formEndpoint;
    if (!endpoint) {
      return opts.edit ? `${sectionOpen(sec, ['s-form'], opts)}${placeholder(opts, 'form', 'Contact form: add a form address in Settings → Contact form to switch it on')}</section>` : '';
    }
    const f = sec.fields || {};
    const field = (on, name, label, type = 'text', req = true) => on ? `<label>${label}<input type="${type}" name="${name}"${req ? ' required' : ''}></label>` : '';
    const body = [
      field(f.name, 'name', 'Name'),
      field(f.email, 'email', 'Email', 'email'),
      field(f.subject, 'subject', 'Subject', 'text', false),
      f.message ? '<label>Message<textarea name="message" required></textarea></label>' : '',
      '<input class="hp" type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">',
      `<div><button class="btn solid" type="submit">${esc(sec.buttonLabel || 'Send')}</button></div>`,
      '<p class="form-status" role="status" aria-live="polite"></p>',
    ].join('');
    return `${sectionOpen(sec, ['s-form'], opts)}<form class="contact-form" method="post" action="${esc(endpoint)}" data-endpoint="${esc(endpoint)}" data-success="${esc(sec.successMessage || 'Thank you!')}">${body}</form></section>`;
  },

  embed(site, page, sec, opts) {
    if (!sec.html) return opts.edit ? `${sectionOpen(sec, ['s-embed'], opts)}${placeholder(opts, 'embed', 'Embed code: paste HTML in the section settings')}</section>` : '';
    return `${sectionOpen(sec, ['s-embed'], opts)}<div class="embed">${sec.html}</div></section>`;
  },

  blocks: renderBlocksSection,
};

// ---------- pages ----------

export function renderSection(site, page, sec, opts) {
  const r = renderers[sec.type];
  opts.site = site; // section background images look up their media (util.js sectionOpen)
  return r ? r(site, page, sec, opts) : '';
}

export function renderSections(site, page, opts) {
  return page.sections.map(sec => renderSection(site, page, sec, opts)).join('\n');
}

export function renderBody(site, page, opts = {}) {
  opts._eagerUsed = false;
  const align = page.align === 'center' ? ' center' : '';
  const width = page.width ? ` style="--page-w:${page.width}px"` : '';
  return `${renderHeader(site, page, opts)}
<main class="content">
<div class="page${align}"${width}${opts.edit ? ` data-pid="${esc(page.id)}"` : ''}>
${renderSections(site, page, opts)}
</div>
</main>
${renderFooter(site, opts)}`;
}

export function pageTitle(site, page) {
  if (page.seoTitle) return page.seoTitle;
  const fmt = site.settings.titleFormat || '{site} — {page}';
  if (page.id === site.settings.homePage && !page.title) return site.settings.siteName;
  return fmt.replace('{site}', site.settings.siteName).replace('{page}', page.title);
}

function absUrl(site, path) {
  if (!site.settings.url || !path) return '';
  try { return new URL(path, site.settings.url.replace(/\/?$/, '/')).href; } catch { return ''; }
}

function firstImage(site, page) {
  for (const s of page.sections) {
    if (s.type === 'image' && site.media[s.media]) return s.media;
    if (s.type === 'gallery') {
      const it = (s.items || []).find(i => !i.hidden && site.media[i.media]);
      if (it) return it.media;
    }
    if (s.type === 'imageText' && site.media[s.media]) return s.media;
    if (s.type === 'blocks') {
      const b = (s.blocks || []).find(x => x.kind === 'image' && !x.hideDesktop && site.media[x.media]);
      if (b) return b.media;
    }
  }
  return page.kind === 'post' ? page.post?.image : null;
}

function headTags(site, page, opts) {
  const s = site.settings;
  const title = pageTitle(site, page);
  const desc = page.description || (page.kind === 'post' ? stripTags(page.post?.excerpt || '') : '') || s.description;
  const file = pageFile(site, page);
  const canonical = absUrl(site, file === 'index.html' ? './' : file);
  const imgId = page.socialImage || firstImage(site, page) || s.socialImage;
  const ogImage = imgId && site.media[imgId] ? absUrl(site, site.media[imgId].src) : '';
  const tags = [
    `<title>${esc(title)}</title>`,
    desc ? `<meta name="description" content="${esc(desc)}">` : '',
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    `<meta property="og:type" content="${page.kind === 'post' ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : '',
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    s.favicon?.png32 ? `<link rel="icon" type="image/png" sizes="32x32" href="${esc(s.favicon.png32)}">` : '',
    s.favicon?.png180 ? `<link rel="apple-touch-icon" href="${esc(s.favicon.png180)}">` : '',
  ];
  return tags.filter(Boolean).join('\n');
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export const GENERATED_NOTE = '<!-- Generated by the site editor at /admin. Edit the site there; changes made to this file by hand will be overwritten. -->';

// A complete HTML document for one page.
// opts.edit: preview inside the editor (inline CSS, editing hooks, base href).
// opts.assetVersion: { css, js } hashes for cache busting.
export function renderPageHtml(site, page, opts = {}) {
  const css = opts.css ?? renderCss(site);
  const v = opts.assetVersion || { css: hash(css), js: '' };
  const head = opts.edit
    ? `<base href="${esc(opts.baseHref || '/')}">\n${fontLinks(site.design)}\n<style id="site-css">${css}</style>${opts.editorHead || ''}`
    : `${opts.baseHref ? `<base href="${esc(opts.baseHref)}">\n` : ''}${headTags(site, page, opts)}\n${fontLinks(site.design)}\n<link rel="stylesheet" href="assets/site.css?v=${v.css}">\n<script src="assets/site.js?v=${v.js}" defer></script>${analytics(site)}`;
  const editScript = opts.edit ? `\n<script src="${esc(opts.siteJsUrl || 'admin/engine/site.js')}"></script>` : '';
  return `<!doctype html>
${opts.edit ? '' : `${GENERATED_NOTE}\n`}<html lang="${esc(site.settings.language || 'en')}"${opts.edit ? ' data-editing' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body class="layout-${esc(site.design.layout)} page-${esc(page.slug)}"${site.design.animation && site.design.animation !== 'none' ? ` data-anim="${esc(site.design.animation)}"` : ''}>
${renderBody(site, page, opts)}${editScript}
</body>
</html>
`;
}

function analytics(site) {
  const code = (site.settings.goatcounter || '').trim();
  if (!/^[a-z0-9-]+$/i.test(code)) return '';
  return `\n<script data-goatcounter="https://${code}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`;
}

function renderRedirect(site, target) {
  const href = pageFile(site, target);
  const canonical = absUrl(site, href === 'index.html' ? './' : href);
  return `<!doctype html>
${GENERATED_NOTE}
<html lang="${esc(site.settings.language || 'en')}">
<head>
<meta charset="utf-8">
<title>${esc(pageTitle(site, target))}</title>
<meta http-equiv="refresh" content="0; url=${esc(href)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta name="robots" content="noindex">
</head>
<body><p>This page has moved to <a href="${esc(href)}">${esc(target.title)}</a>.</p><script>location.replace(${JSON.stringify(href)} + location.hash)</script></body>
</html>
`;
}

// Every generated file for the public site: { path: contents }.
// siteJs is the text of admin/engine/site.js (passed in so this stays I/O free).
export function buildSite(site, { siteJs = '' } = {}) {
  const files = {};
  const css = renderCss(site);
  const v = { css: hash(css), js: hash(siteJs) };
  files['assets/site.css'] = css;
  files['assets/site.js'] = siteJs;
  for (const page of site.pages) {
    if (!isLive(page)) continue;
    files[pageFile(site, page)] = renderPageHtml(site, page, { css, assetVersion: v });
  }
  for (const r of site.redirects || []) {
    const target = pageById(site, r.to);
    if (!target || !isLive(target) || files[r.from]) continue;
    files[r.from] = renderRedirect(site, target);
  }
  // GitHub Pages serves 404.html for unknown addresses, at any depth, hence the base.
  const notFound = {
    id: '__404', kind: 'page', slug: '404', title: 'Page not found', seoTitle: '', description: '', width: 780, align: 'left',
    sections: [{ id: 's-404', type: 'text', width: null, align: 'left', space: 0, spaceAbove: 0, size: 'normal', lineHeight: 'normal', textAlign: 'left',
      html: `<h2>Page not found</h2><p>Sorry, this page doesn't exist. <a href="${esc(pageFile(site, pageById(site, site.settings.homePage) || site.pages[0] || { id: '', slug: 'index' }))}">Go to the homepage</a>.</p>` }],
  };
  files['404.html'] = renderPageHtml(site, notFound, { css, assetVersion: v, baseHref: '/' }).replace('<title>', '<meta name="robots" content="noindex">\n<title>');
  const base = (site.settings.url || '').replace(/\/$/, '');
  files['robots.txt'] = `User-agent: *\nDisallow: /admin/\nDisallow: /content/\nDisallow: /tools/\nDisallow: /tests/\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ''}`;
  if (base) {
    const urls = site.pages.filter(isLive).map(p => {
      const file = pageFile(site, p);
      return `  <url><loc>${esc(`${base}/${file === 'index.html' ? '' : file}`)}</loc></url>`;
    });
    files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  }
  return files;
}

// HTML paths a build produces, for working out which old pages to delete.
export function generatedHtmlPaths(site) {
  const paths = new Set();
  for (const p of site.pages) if (isLive(p)) paths.add(pageFile(site, p));
  for (const r of site.redirects || []) {
    const t = pageById(site, r.to);
    if (t && isLive(t)) paths.add(r.from);
  }
  return paths;
}
