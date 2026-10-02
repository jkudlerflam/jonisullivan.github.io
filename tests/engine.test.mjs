// Tests for the site engine (data model, renderer, stylesheet) and the commit
// message helper. Run with:  node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSite, validateSite, slugify, uniqueSlug, isValidSlug, newPage, newSection, newBlock, cloneWithNewIds,
  formatDate, SECTION_TYPES, DEFAULT_DESIGN, FONTS,
} from '../admin/engine/schema.js';
import {
  buildSite, generatedHtmlPaths, renderPageHtml, pageTitle, pageFile, postsOf, videoEmbedUrl, mobileLayout, hash, esc, isLive,
} from '../admin/engine/render.js';
import { renderCss, fontLinks } from '../admin/engine/css.js';
import { describeChanges } from '../admin/js/github.js';

const root = new URL('../', import.meta.url);
const raw = JSON.parse(await readFile(new URL('content/site.json', root), 'utf8'));
const site = () => normalizeSite(structuredClone(raw));

test('normalizeSite fills defaults and is idempotent', () => {
  const a = site();
  assert.equal(a.version, 2);
  assert.deepEqual(Object.keys(a.design.colors).sort(), Object.keys(DEFAULT_DESIGN.colors).sort());
  assert.deepEqual(normalizeSite(a), a);
  for (const p of a.pages) for (const s of p.sections) assert.equal(typeof s.space, 'number', `${p.id}/${s.id} space`);
});

test('text and image sections become Fluid Engine blocks that size to their content', () => {
  const s = site();
  const types = new Set(s.pages.flatMap(p => p.sections.map(x => x.type)));
  assert.deepEqual([...types].sort(), ['blocks', 'cv', 'gallery', 'posts']);
  const mfa = s.pages.find(p => p.id === 'p-mfa-2021');
  assert.equal(mfa.sections[0].blocks[0].kind, 'image');
  assert.equal(mfa.sections[0].blocks[0].fit, 'original');
  assert.equal(mfa.sections[2].blocks[0].textAlign, 'justify');
  const html = renderPageHtml(s, mfa);
  assert.equal((html.match(/fe-grid fe-fit/g) || []).length, 5);
  // A converted site converts no further.
  assert.deepEqual(normalizeSite(s), s);
  // New sections of the old kinds come out as Fluid Engine sections.
  assert.equal(newSection('text').type, 'blocks');
  assert.equal(newSection('imageText').blocks.length, 2);
  assert.equal(newSection('gallery').type, 'gallery');
});

test('the migrated site is valid', () => {
  assert.deepEqual(validateSite(site()), []);
});

test('every live page is built, and nothing else', () => {
  const s = site();
  const files = buildSite(s, { siteJs: '/* js */' });
  const html = Object.keys(files).filter(f => f.endsWith('.html') && f !== '404.html').sort();
  const expected = s.pages.filter(isLive).map(p => pageFile(s, p)).sort();
  assert.deepEqual(html, expected);
  assert.match(files['404.html'], /<base href="\/">/);
  assert.match(files['robots.txt'], /Disallow: \/admin\//);
  assert.equal((files['sitemap.xml'].match(/<loc>/g) || []).length, expected.length);
  assert.ok(files['assets/site.css'].includes(':root{'));
  assert.equal(files['assets/site.js'], '/* js */');
  assert.deepEqual([...generatedHtmlPaths(s)].sort(), expected);
});

test('built pages are well formed and keep the old URLs', () => {
  const s = site();
  const files = buildSite(s, { siteJs: '' });
  for (const f of ['index.html', 'cv.html', 'contact.html', 'writing-about-art.html', 'exhibits-mfa-2021.html',
    'exhibits-during-dessert.html', 'about-art-playing-house.html', 'exhibits.html', 'writing.html']) {
    assert.ok(files[f], `missing ${f}`);
  }
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.html')) continue;
    assert.match(text, /^<!doctype html>/);
    assert.ok(!/undefined|\[object Object\]|NaN/.test(text), `${path} contains a stray value`);
    assert.ok(text.includes('assets/site.css?v='), `${path} links the stylesheet`);
    for (const tag of ['main', 'header', 'nav', 'section', 'figure', 'details']) {
      const open = (text.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
      const close = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(open, close, `${path}: <${tag}> open ${open} close ${close}`);
    }
  }
});

test('page titles from the old site are kept exactly', () => {
  const s = site();
  const t = id => pageTitle(s, s.pages.find(p => p.id === id));
  assert.equal(t('p-painting'), 'Joni Sullivan — Painting');
  assert.equal(t('p-contact'), 'Contact — Joni Sullivan');
  assert.equal(t('p-about-art-public-intimacies'), 'public intimacies — Joni Sullivan');
});

test('navigation marks the current page and opens its folder', () => {
  const s = site();
  const mfa = renderPageHtml(s, s.pages.find(p => p.id === 'p-mfa-2021'));
  assert.match(mfa, /<details class="nav-folder has-active" open>/);
  assert.match(mfa, /<a href="exhibits-mfa-2021.html" class="active" aria-current="page">&quot;MFA CLASS OF<br>2021 EXHIBITION&quot;<\/a>/);
  const post = renderPageHtml(s, s.pages.find(p => p.id === 'p-about-art-kiki-smith'));
  assert.match(post, /<a href="writing-about-art.html" class="active"/);
});

test('hidden gallery images are not published, but are shown in the editor', () => {
  const s = site();
  const home = s.pages.find(p => p.id === 'p-painting');
  const hidden = home.sections[0].items.filter(i => i.hidden).length;
  assert.equal(hidden, 5);
  const pub = renderPageHtml(s, home);
  const edit = renderPageHtml(s, home, { edit: true });
  const count = h => (h.match(/class="g-item[" ]/g) || []).length;
  assert.equal(count(pub), home.sections[0].items.length - hidden);
  assert.equal(count(edit), home.sections[0].items.length);
  assert.match(edit, /g-item ed-hidden/);
});

test('draft articles and disabled pages stay off the site', () => {
  const s = site();
  const post = s.pages.find(p => p.id === 'p-about-art-kiki-smith');
  post.post.draft = true;
  const cv = s.pages.find(p => p.id === 'p-cv');
  cv.disabled = true;
  const files = buildSite(s, { siteJs: '' });
  assert.ok(!files['about-art-kiki-smith.html']);
  assert.ok(!files['cv.html']);
  assert.ok(!files['index.html'].includes('href="cv.html"'));
  assert.ok(!files['writing-about-art.html'].includes('about-art-kiki-smith.html'));
  assert.equal(postsOf(s, 'p-art-writing').length, 5);
});

test('articles are listed newest first', () => {
  const s = site();
  const dates = postsOf(s, 'p-art-writing').map(p => p.post.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('renamed pages leave a redirect at the old address', () => {
  const s = site();
  s.redirects.push({ from: 'old-cv.html', to: 'p-cv' });
  const files = buildSite(s, { siteJs: '' });
  assert.match(files['old-cv.html'], /http-equiv="refresh" content="0; url=cv.html"/);
  assert.ok(generatedHtmlPaths(s).has('old-cv.html'));
});

test('a new homepage is served at index.html', () => {
  const s = site();
  s.settings.homePage = 'p-cv';
  const files = buildSite(s, { siteJs: '' });
  assert.match(files['index.html'], /class="cv-section"/);
  assert.ok(files['painting.html'], 'the old homepage gets its own address');
  assert.ok(!files['cv.html']);
});

test('slugs', () => {
  assert.equal(slugify('Works on Paper & Prints!'), 'works-on-paper-and-prints');
  assert.equal(slugify('Café Été'), 'cafe-ete');
  assert.equal(slugify(''), 'page');
  assert.ok(isValidSlug('cv-2026'));
  assert.ok(!isValidSlug('admin'));
  assert.ok(!isValidSlug('Bad Slug'));
  const s = site();
  assert.equal(uniqueSlug(s, 'CV'), 'cv-2');
  assert.equal(uniqueSlug(s, 'Admin'), 'admin-page');
});

test('new pages, sections and blocks are complete', () => {
  const s = site();
  const p = newPage(s, { title: 'Drawings', template: 'gallery' });
  assert.equal(p.slug, 'drawings');
  assert.equal(p.sections[0].type, 'gallery');
  const post = newPage(s, { title: 'Review', parent: 'p-art-writing' });
  assert.equal(post.kind, 'post');
  assert.equal(post.post.draft, true);
  for (const type of Object.keys(SECTION_TYPES)) {
    const sec = newSection(type);
    s.pages[0].sections.push(sec);
  }
  s.pages[0].sections.push(newSection('blocks', { blocks: [newBlock('text'), newBlock('image', { x: 12, y: 0 })] }));
  const out = renderPageHtml(s, s.pages[0]);
  assert.ok(!/undefined|NaN/.test(out));
  const copy = cloneWithNewIds(s.pages[0].sections.at(-1));
  assert.notEqual(copy.id, s.pages[0].sections.at(-1).id);
  assert.notEqual(copy.blocks[0].id, s.pages[0].sections.at(-1).blocks[0].id);
});

test('phone layout stacks blocks in reading order and keeps image shape', () => {
  const blocks = [
    { id: 'b', kind: 'image', d: { x: 12, y: 0, w: 12, h: 6 }, m: null },
    { id: 'a', kind: 'text', d: { x: 0, y: 0, w: 12, h: 4 }, m: null },
  ];
  const m = mobileLayout(blocks);
  assert.deepEqual(m.get('a'), { x: 0, y: 0, w: 8, h: 3 });
  assert.deepEqual(m.get('b'), { x: 0, y: 4, w: 8, h: 4 });
});

test('video links', () => {
  assert.equal(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=3'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(videoEmbedUrl('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871');
  assert.equal(videoEmbedUrl('https://example.com/x'), '');
});

test('stylesheet reflects design settings', () => {
  const s = site();
  s.design.colors.background = '#f6f1e7';
  s.design.fonts.heading = 'eb-garamond';
  s.design.layout = 'topbar';
  const css = renderCss(s);
  assert.match(css, /--bg:#f6f1e7/);
  assert.match(css, /--font-heading:"EB Garamond", serif/);
  assert.match(fontLinks(s.design), /family=EB\+Garamond/);
  assert.match(renderPageHtml(s, s.pages[0]), /<body class="layout-topbar/);
  assert.equal(fontLinks(site().design), '');
});

test('every font has a valid Google Fonts request', () => {
  for (const f of FONTS) {
    if (!f.google) continue;
    assert.match(f.google, /^[A-Za-z+]+(:(ital,)?wght@[\d,;.]+|:ital@0;1)?$/, f.id);
  }
});

test('escaping and hashing', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(hash('abc'), hash('abd'));
});

test('dates', () => {
  assert.equal(formatDate('2025-02-21'), 'February 21, 2025');
  assert.equal(formatDate('2020-11-01'), 'November 1, 2020');
});

test('commit messages describe the change', () => {
  const a = site();
  const b = structuredClone(a);
  b.pages.find(p => p.id === 'p-cv').sections[0].groups[0].items[0].year = '2024';
  b.design.colors.background = '#000000';
  const msg = describeChanges(a, b, 2);
  assert.match(msg, /^Edit CV; change site styles; add 2 images/);

  // Deleting a page, restoring it, and emptying Deleted Pages.
  const cv = a.pages.find(p => p.id === 'p-cv');
  const c = structuredClone(a);
  c.pages = c.pages.filter(p => p.id !== 'p-cv');
  c.trash = [{ page: structuredClone(cv), deletedAt: '2026-10-01T12:00:00.000Z' }];
  assert.match(describeChanges(a, c), /^Delete CV/);
  assert.match(describeChanges(c, a), /^Restore CV/);
  const d = structuredClone(c);
  d.trash = [];
  assert.match(describeChanges(c, d), /^Empty Deleted Pages/);
});
