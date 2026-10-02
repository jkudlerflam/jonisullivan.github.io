// Tests for the Fluid Engine block kinds added for Squarespace parity: Form,
// Social Links, Map and Accordion (engine/blocks.js + BLOCK_TYPES). Run with:
//   node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSite, newSection, newBlock, cloneWithNewIds, BLOCK_TYPES, validateSite } from '../admin/engine/schema.js';
import { renderPageHtml, buildSite, mobileLayout } from '../admin/engine/render.js';
import { BLOCKS_CSS, SOCIAL, socialHref } from '../admin/engine/blocks.js';
import { renderCss } from '../admin/engine/css.js';

const root = new URL('../', import.meta.url);
const raw = JSON.parse(await readFile(new URL('content/site.json', root), 'utf8'));
const NEW_KINDS = ['form', 'social', 'map', 'accordion'];

// A copy of the real site with one extra page holding the given blocks.
function siteWith(blocks, settings = {}) {
  const site = normalizeSite(structuredClone(raw));
  Object.assign(site.settings, settings);
  const sec = newSection('blocks', { rows: 8, blocks });
  site.pages.push({
    id: 'p-test-blocks', kind: 'page', title: 'Blocks test', navTitle: '', slug: 'blocks-test', seoTitle: '', description: '',
    socialImage: null, width: null, align: 'left', disabled: false, sections: [sec],
  });
  return { site, page: site.pages.at(-1), sec };
}

const pub = (site, page) => renderPageHtml(site, page);
const edit = (site, page) => renderPageHtml(site, page, { edit: true });
// The markup of one block in a rendered page.
function blockHtml(html, kind) {
  const start = html.indexOf(`class="fe-b k-${kind}`);
  if (start < 0) return null;
  const open = html.lastIndexOf('<div', start);
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  for (let m; (m = re.exec(html));) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (!depth) return html.slice(open, m.index + 6);
  }
  return null;
}

test('the new kinds have complete defaults', () => {
  for (const kind of NEW_KINDS) {
    const def = BLOCK_TYPES[kind];
    assert.ok(def && def.label && def.w > 0 && def.h > 0, kind);
    const b = newBlock(kind, { x: 2, y: 3 });
    assert.equal(b.kind, kind);
    assert.deepEqual(b.d, { x: 2, y: 3, w: def.w, h: def.h });
    for (const k of ['m', 'alignV', 'hideDesktop', 'hideMobile', 'style']) assert.ok(k in b, `${kind}.${k}`);
  }
  assert.deepEqual(Object.values(BLOCK_TYPES).map(d => d.label),
    ['Text', 'Image', 'Button', 'Video', 'Line', 'Quote', 'Code', 'Form', 'Social Links', 'Map', 'Accordion']);
  assert.deepEqual(newBlock('form').fields, { name: true, email: true, subject: false, message: true });
  assert.equal(newBlock('accordion').items.length, 3);
  // Duplicates get fresh ids for their rows too.
  const s = newBlock('social');
  const copy = cloneWithNewIds(s);
  assert.notEqual(copy.links[0].id, s.links[0].id);
});

test('form block: contact-form markup that assets/site.js sends', () => {
  const form = { ...newBlock('form'), id: 'b-form1', buttonLabel: 'Send <it>', successMessage: 'Merci "beaucoup"' };
  // No address anywhere: nothing on the live page, a placeholder in the editor.
  let { site, page } = siteWith([form]);
  assert.equal(blockHtml(pub(site, page), 'form'), '<div class="fe-b k-form" style="--d:1 / 1 / span 16 / span 12;--m:1 / 1 / span 3 / span 8"></div>');
  assert.match(blockHtml(edit(site, page), 'form'), /data-empty="form"[^>]*>Form: add your form address in Settings → Contact form to switch it on</);
  // The address from Settings.
  ({ site, page } = siteWith([form], { formEndpoint: 'https://formspree.io/f/abc' }));
  const html = blockHtml(pub(site, page), 'form');
  assert.match(html, /<form class="contact-form" method="post" action="https:\/\/formspree\.io\/f\/abc" data-endpoint="https:\/\/formspree\.io\/f\/abc" data-success="Merci &quot;beaucoup&quot;">/);
  assert.match(html, /<label>Name<input type="text" name="name" required><\/label>/);
  assert.match(html, /<label>Email<input type="email" name="email" required><\/label>/);
  assert.doesNotMatch(html, /name="subject"/);
  assert.match(html, /<textarea name="message" required><\/textarea>/);
  assert.match(html, /name="_gotcha"/);
  assert.match(html, /<button class="btn solid" type="submit">Send &lt;it&gt;<\/button>/);
  assert.match(html, /<p class="form-status" role="status" aria-live="polite"><\/p>/);
  // The block's own address wins; fields follow the toggles.
  ({ site, page } = siteWith([{ ...form, endpoint: 'https://formspree.io/f/own', fields: { name: false, email: true, subject: true, message: false } }], { formEndpoint: 'https://formspree.io/f/abc' }));
  const own = blockHtml(pub(site, page), 'form');
  assert.match(own, /data-endpoint="https:\/\/formspree\.io\/f\/own"/);
  assert.match(own, /<label>Subject<input type="text" name="subject"><\/label>/);
  assert.doesNotMatch(own, /name="name"|name="message"/);
});

test('social links block: icons, safe addresses, sizes', () => {
  assert.equal(socialHref({ platform: 'instagram', url: 'instagram.com/joni' }), 'https://instagram.com/joni');
  assert.equal(socialHref({ platform: 'vimeo', url: 'https://vimeo.com/joni' }), 'https://vimeo.com/joni');
  assert.equal(socialHref({ platform: 'email', url: 'joni@example.com' }), 'mailto:joni@example.com');
  assert.equal(socialHref({ platform: 'email', url: 'mailto:joni@example.com' }), 'mailto:joni@example.com');
  assert.equal(socialHref({ platform: 'email', url: 'not an email' }), '');
  assert.equal(socialHref({ platform: 'x', url: 'javascript:alert(1)' }), '');
  assert.equal(socialHref({ platform: 'x', url: '  ' }), '');
  for (const [id, p] of Object.entries(SOCIAL)) assert.ok(p.label && /^M[\d.\s,a-zA-Z-]+$/.test(p.d), id);
  const block = {
    ...newBlock('social'), id: 'b-soc1', size: 'large', socialAlign: 'center',
    links: [
      { id: 'sl-1', platform: 'instagram', url: 'instagram.com/joni__sullivan' },
      { id: 'sl-2', platform: 'email', url: 'joni@example.com' },
      { id: 'sl-3', platform: 'facebook', url: '' },
      { id: 'sl-4', platform: 'tiktok', url: 'javascript:alert(1)' },
    ],
  };
  const { site, page } = siteWith([block]);
  const html = blockHtml(pub(site, page), 'social');
  assert.match(html, /^<div class="fe-b k-social"[^>]*><div class="sl sl-large sl-center">/);
  assert.match(html, /<a class="sl-a" href="https:\/\/instagram\.com\/joni__sullivan" target="_blank" rel="noopener" aria-label="Instagram" title="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true" fill-rule="evenodd"><path d="M/);
  assert.match(html, /<a class="sl-a" href="mailto:joni@example\.com" aria-label="Email"/);
  assert.equal((html.match(/<a /g) || []).length, 2, 'links without a usable address are left out');
  assert.doesNotMatch(html, /javascript:/);
  // The editor shows every row, the empty ones faded.
  const ed = blockHtml(edit(site, page), 'social');
  assert.equal((ed.match(/<a /g) || []).length, 4);
  assert.equal((ed.match(/sl-off/g) || []).length, 2);
  assert.doesNotMatch(ed, /javascript:/);
  // No links at all.
  const empty = siteWith([{ ...block, links: [] }]);
  assert.match(blockHtml(edit(empty.site, empty.page), 'social'), /data-empty="social"/);
  assert.doesNotMatch(blockHtml(pub(empty.site, empty.page), 'social'), /<a /);
});

test('map block: a Google Maps embed of the address', () => {
  const block = { ...newBlock('map'), id: 'b-map1', address: 'Nassau Hall, Princeton & "NJ"', zoom: 33 };
  const { site, page } = siteWith([block]);
  const html = blockHtml(pub(site, page), 'map');
  assert.match(html, /<div class="map-frame"><iframe src="https:\/\/www\.google\.com\/maps\?q=Nassau%20Hall%2C%20Princeton%20%26%20%22NJ%22&amp;z=20&amp;output=embed" title="Map: Nassau Hall, Princeton &amp; &quot;NJ&quot;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen><\/iframe><\/div>/);
  const none = siteWith([{ ...block, address: '' }]);
  assert.doesNotMatch(blockHtml(pub(none.site, none.page), 'map'), /iframe/);
  assert.match(blockHtml(edit(none.site, none.page), 'map'), /data-empty="map"/);
  // On phones a map keeps its shape, like images and videos.
  const m = mobileLayout([{ ...block, d: { x: 0, y: 0, w: 12, h: 9 } }]);
  assert.deepEqual(m.get('b-map1'), { x: 0, y: 0, w: 8, h: 6 });
});

test('accordion block: <details> items, no script needed', () => {
  const block = {
    ...newBlock('accordion'), id: 'b-acc1', openFirst: true, icon: 'arrow', dividers: false,
    items: [
      { id: 'ai-1', title: 'Sizes & <prices>', html: 'Most are <em>small</em>.' },
      { id: 'ai-2', title: 'Shipping', html: '' },
      { id: 'ai-3', title: '', html: '' },
    ],
  };
  const { site, page } = siteWith([block]);
  const html = blockHtml(pub(site, page), 'accordion');
  assert.equal(html.match(/<details/g).length, 2, 'an item with neither title nor text is left out');
  assert.match(html, /<div class="acc acc-arrow"><details class="acc-item" open><summary class="acc-title"><span>Sizes &amp; &lt;prices&gt;<\/span><i class="acc-ic" aria-hidden="true"><\/i><\/summary><div class="acc-body rt">Most are <em>small<\/em>\.<\/div><\/details><details class="acc-item"><summary/);
  assert.doesNotMatch(html, /<script/);
  const lines = siteWith([{ ...block, openFirst: false, icon: 'plus', dividers: true }]);
  const h2 = blockHtml(pub(lines.site, lines.page), 'accordion');
  assert.match(h2, /<div class="acc acc-lines">/);
  assert.doesNotMatch(h2, / open>/);
  const none = siteWith([{ ...block, items: [] }]);
  assert.match(blockHtml(edit(none.site, none.page), 'accordion'), /data-empty="accordion"/);
});

test('the stylesheet styles the new kinds', () => {
  for (const sel of ['.sl{', '.sl-a svg{', '.fe-b.k-map .map-frame{', '.acc-item>summary{', '.acc-ic::after{', '.acc-arrow .acc-ic{', '.fe-b.k-image.has-style img{']) {
    assert.ok(BLOCKS_CSS.includes(sel), sel);
  }
  const css = renderCss(normalizeSite(structuredClone(raw)));
  assert.ok(css.includes('.acc-item>summary::-webkit-details-marker{display:none}'));
});

test('a page with every new kind builds and stays valid', () => {
  const blocks = NEW_KINDS.map((kind, i) => ({ ...newBlock(kind, { x: 0, y: i * 10 }), id: `b-all-${kind}` }));
  blocks[1].links = [{ id: 'sl-x', platform: 'instagram', url: 'instagram.com/x' }];
  blocks[2].address = 'Philadelphia, PA';
  const { site } = siteWith(blocks, { formEndpoint: 'https://formspree.io/f/xyz' });
  assert.deepEqual(validateSite(site), []);
  const files = buildSite(site, { siteJs: '/* js */' });
  const html = files['blocks-test.html'];
  assert.ok(html, 'page built');
  for (const kind of NEW_KINDS) assert.ok(html.includes(`class="fe-b k-${kind}`), kind);
  assert.match(html, /class="contact-form"/);
  assert.match(html, /maps\?q=Philadelphia%2C%20PA/);
  assert.match(html, /<details class="acc-item">/);
  // Balanced <div>s: the block markup closes everything it opens.
  assert.equal((html.match(/<div\b/g) || []).length, (html.match(/<\/div>/g) || []).length);
  assert.doesNotMatch(html, /data-bid|data-edit|ed-empty/, 'no editor hooks on the live page');
});
