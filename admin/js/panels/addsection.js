// The "Add Section" dialog, like Squarespace's: "+ Add Blank" and "Saved" at
// the top of the left column, then the categories; ready-made layouts with
// small pictures on the right. Every layout builds a fresh section (new ids
// each time) with sample content, then adds it to the page.

import { html, useState, useEffect, useRef, Icon, IconButton, Modal } from '../ui.js';
import { useStore, updateSite, openMenu, toast, undo } from '../store.js';
import { addSection } from '../actions.js';
import { newSection, newBlock, uid, cloneWithNewIds } from '../../engine/schema.js';
import { scrollToSection } from '../preview.js';

// ---------- mini pictures (160 x 100) ----------

const IMG = '#dedede';
const IMG2 = '#c4c4c4';
const TXT = '#d3d3d3';
const HEAD = '#9f9f9f';
const INK = '#232323';
const LINK = '#a9c1ee';

function img(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const k = Math.min(w, h) * 0.2;
  return html`<g>
    <rect x=${x} y=${y} width=${w} height=${h} rx="1.5" fill=${IMG} />
    <path d=${`M${cx - 1.6 * k} ${cy + k}L${cx - 0.4 * k} ${cy - 0.5 * k}L${cx + 0.4 * k} ${cy + 0.4 * k}L${cx + 0.9 * k} ${cy - 0.1 * k}L${cx + 1.6 * k} ${cy + k}Z`} fill=${IMG2} />
    <circle cx=${cx + 0.95 * k} cy=${cy - 0.85 * k} r=${0.3 * k} fill=${IMG2} />
  </g>`;
}
const bar = (x, y, w, fill = TXT, h = 3) => html`<rect x=${x} y=${y} width=${w} height=${h} rx=${h / 2} fill=${fill} />`;
const head = (x, y, w, h = 6) => bar(x, y, w, HEAD, h);
const lines = (x, y, w, n, gap = 6.5, center = false) => Array.from({ length: n }, (_, i) => {
  const lw = n > 1 && i === n - 1 ? Math.round(w * 0.6) : w;
  return bar(center ? x + (w - lw) / 2 : x, y + i * gap, lw);
});
const box = (x, y, w, h, stroke = '#b9b9b9') => html`<rect x=${x} y=${y} width=${w} height=${h} rx="2" fill="#fff" stroke=${stroke} stroke-width="1.2" />`;
const stroke = (d, color = HEAD, w = 1.8) => html`<path d=${d} fill="none" stroke=${color} stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" />`;
const svg = kids => html`<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${kids}</svg>`;

const cvRows = (x, y, n, widths) => Array.from({ length: n }, (_, i) => [bar(x, y + i * 8, 13), bar(x + 19, y + i * 8, widths[i % widths.length])]);
const formPic = rows => [
  ...rows.map((h, i) => [bar(40, 8 + i * 19, 18, HEAD), box(40, 13 + i * 19, 80, h)]),
  html`<rect x="40" y=${16 + rows.length * 19 + Math.max(0, rows[rows.length - 1] - 9)} width="26" height="9" rx="1.5" fill=${INK} />`,
];
const play = (cx, cy) => html`<path d=${`M${cx - 6} ${cy - 8}L${cx + 9} ${cy}L${cx - 6} ${cy + 8}Z`} fill="#fff" />`;
const gridDots = () => {
  const dots = [];
  for (let c = 0; c < 12; c++) for (let r = 0; r < 6; r++) dots.push(html`<circle cx=${22 + c * 10.5} cy=${18 + r * 13} r="0.9" fill="#cfcfcf" />`);
  return dots;
};
const spaceArrows = (y1, y2) => stroke(`M80 ${y1}V${y2}M75.5 ${y1 + 4.5}L80 ${y1}l4.5 4.5M75.5 ${y2 - 4.5}L80 ${y2}l4.5-4.5`, '#8fb0ef', 1.6);
// Opening quotation marks: two dots with tails.
const quoteMarks = (x, y) => html`<g>
  <circle cx=${x + 4.5} cy=${y + 11} r="4.5" fill=${HEAD} />
  <circle cx=${x + 16.5} cy=${y + 11} r="4.5" fill=${HEAD} />
  ${stroke(`M${x + 0.8} ${y + 11}c0-5.5 2.2-9.2 6.6-11.2M${x + 12.8} ${y + 11}c0-5.5 2.2-9.2 6.6-11.2`, HEAD, 2.2)}
</g>`;

// ---------- presets ----------

// Squarespace's categories, in its order.
const CATS = [
  { id: 'intro', label: 'Intro' },
  { id: 'images', label: 'Images' },
  { id: 'galleries', label: 'Galleries' },
  { id: 'text', label: 'Text' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact' },
  { id: 'video', label: 'Video' },
  { id: 'lists', label: 'Lists' },
  { id: 'blog', label: 'Blog' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'layout', label: 'Layout' },
  { id: 'advanced', label: 'Advanced' },
];

const year = () => String(new Date().getFullYear());
const lastYear = () => String(new Date().getFullYear() - 1);
const entry = (y, h) => ({ id: uid('i'), year: y, html: h });
const group = (heading, items) => ({ id: uid('g'), heading, items });
const firstBlog = site => site.pages.find(p => p.kind === 'blog')?.id || null;

// A block placed at x, y with size w x h (in grid cells), plus its own settings.
function block(kind, d, props = {}) {
  const b = newBlock(kind, { x: d.x, y: d.y });
  Object.assign(b, props);
  b.d = { ...d };
  return b;
}

// auto: the section lays itself out from its content (galleries, lists,
// collections); Squarespace marks these with a small "i".
export const PRESETS = [
  // Intro
  {
    id: 'intro-exhibition', cat: 'intro', name: 'Exhibition intro', desc: 'Title, venue and dates above a large installation view.', keys: 'exhibition show opening title dates venue hero installation',
    pic: () => svg([head(50, 7, 60, 7), bar(56, 19, 48), bar(62, 25, 36), img(14, 34, 132, 60)]),
    make: () => newSection('blocks', {
      rows: 16,
      blocks: [
        block('text', { x: 2, y: 0, w: 20, h: 3 }, { textAlign: 'center', html: `<h1>Exhibition Title</h1><p>Gallery Name, City</p><p class="muted">March 1 to April 15, ${year()}</p>` }),
        block('image', { x: 0, y: 4, w: 24, h: 12 }, { fit: 'fill', caption: 'Installation view' }),
      ],
    }),
  },
  {
    id: 'intro-banner', cat: 'intro', name: 'Banner', desc: 'A large title on a dark band. Add a background image in Edit Section.', keys: 'hero header cover title dark background image band',
    pic: () => svg([html`<rect x="8" y="12" width="144" height="76" rx="2" fill=${INK} />`, bar(46, 42, 68, '#ffffff', 8), bar(58, 56, 44, '#8d8d8d')]),
    make: site => {
      const c = site.design.colors || {};
      const s = newSection('text', { textAlign: 'center', bg: c.text || '#111111', fg: c.background || '#ffffff', html: '<h1>Title</h1><p>A short line under the title.</p>' });
      s.rows = 12;
      s.vAlign = 'middle';
      return s;
    },
  },
  {
    id: 'intro-title-text', cat: 'intro', name: 'Title and introduction', desc: 'A centered heading with a sentence or two below it.', keys: 'heading welcome intro center',
    pic: () => svg([head(44, 26, 72, 9), ...lines(36, 46, 88, 3, 7, true)]),
    make: () => newSection('text', { width: 720, align: 'center', textAlign: 'center', html: '<h1>Title</h1><p>One or two sentences that introduce this page.</p>' }),
  },
  {
    id: 'intro-title', cat: 'intro', name: 'Page title', desc: 'One large heading.', keys: 'heading h1 big',
    pic: () => svg([head(28, 38, 92, 13)]),
    make: () => newSection('text', { html: '<h1>Page title</h1>', space: 24 }),
  },

  // Images
  {
    id: 'image', cat: 'images', name: 'Image', desc: 'One large image across the page.', keys: 'photo picture painting artwork',
    pic: () => svg([img(16, 10, 128, 70), bar(16, 86, 46)]),
    make: () => newSection('image'),
  },
  {
    id: 'image-caption', cat: 'images', name: 'Image with caption', desc: 'An artwork with its title and details below.', keys: 'photo painting artwork title',
    pic: () => svg([img(38, 7, 84, 64), bar(38, 77, 52, HEAD), bar(38, 84, 70)]),
    make: () => newSection('image', { width: 900, caption: `<em>Title</em>, oil on canvas, ${year()}` }),
  },
  {
    id: 'image-small', cat: 'images', name: 'Small centered image', desc: 'A smaller image in the middle of the page.', keys: 'photo picture center',
    pic: () => svg([img(56, 10, 48, 64), bar(62, 81, 36)]),
    make: () => newSection('image', { width: 560, align: 'center' }),
  },
  {
    id: 'image-lightbox', cat: 'images', name: 'Image that enlarges', desc: 'Opens large when someone clicks it.', keys: 'lightbox zoom click enlarge',
    pic: () => svg([img(24, 14, 76, 58), box(110, 27, 32, 32, '#9f9f9f'), stroke('M119 36l14 14M119 36h6M119 36v6M133 50h-6M133 50v-6', HEAD, 1.6)]),
    make: () => newSection('image', { width: 700, lightbox: true }),
  },
  {
    id: 'it-left', cat: 'images', name: 'Image and text', desc: 'An image beside a heading and text.', keys: 'image text side by side columns',
    pic: () => svg([img(16, 16, 62, 68), head(88, 30, 48), ...lines(88, 44, 56, 4)]),
    make: () => newSection('imageText', { imageSide: 'left' }),
  },
  {
    id: 'it-right', cat: 'images', name: 'Text and image', desc: 'Text first, with the image on the right.', keys: 'image text side by side columns',
    pic: () => svg([head(16, 30, 48), ...lines(16, 44, 56, 4), img(82, 16, 62, 68)]),
    make: () => newSection('imageText', { imageSide: 'right' }),
  },

  // Galleries
  {
    id: 'gallery-stack', cat: 'galleries', auto: true, name: 'Stacked', desc: 'Large images one after another, like the Painting page.', keys: 'gallery images paintings portfolio column',
    pic: () => svg([img(46, 6, 68, 41), img(46, 53, 68, 41)]),
    make: () => newSection('gallery', { layout: 'stack', width: 900, align: 'center', gap: 34, columns: 1, lightbox: false, bleedMobile: true }),
  },
  {
    id: 'gallery-grid', cat: 'galleries', auto: true, name: 'Grid', desc: 'Rows of images that open large when clicked.', keys: 'gallery images thumbnails portfolio',
    pic: () => svg([0, 1, 2].flatMap(c => [0, 1].map(r => img(22 + c * 40, 9 + r * 43, 36, 36)))),
    make: () => newSection('gallery', { layout: 'grid', columns: 3 }),
  },
  {
    id: 'gallery-square', cat: 'galleries', auto: true, name: 'Square grid', desc: 'Four columns of images cropped to squares.', keys: 'gallery images thumbnails crop square',
    pic: () => svg([0, 1, 2, 3].flatMap(c => [0, 1].map(r => img(22 + c * 30, 19 + r * 31, 26, 26)))),
    make: () => newSection('gallery', { layout: 'grid', columns: 4, aspect: '1:1', gap: 16, captions: false }),
  },
  {
    id: 'gallery-masonry', cat: 'galleries', auto: true, name: 'Masonry', desc: 'Columns of images, each at its own height.', keys: 'gallery images pinterest columns',
    pic: () => svg([img(30, 6, 31, 44), img(30, 54, 31, 40), img(65, 6, 31, 28), img(65, 38, 31, 56), img(100, 6, 31, 38), img(100, 48, 31, 46)]),
    make: () => newSection('gallery', { layout: 'masonry', columns: 3 }),
  },
  {
    id: 'gallery-slideshow', cat: 'galleries', auto: true, name: 'Slideshow', desc: 'One image at a time, with arrows.', keys: 'gallery carousel slider images',
    pic: () => svg([img(36, 8, 88, 64), stroke('M22 34l-6 6 6 6M138 34l6 6-6 6'), html`<circle cx="73" cy="84" r="2.2" fill=${HEAD} />`, html`<circle cx="80" cy="84" r="2.2" fill=${TXT} />`, html`<circle cx="87" cy="84" r="2.2" fill=${TXT} />`]),
    make: () => newSection('gallery', { layout: 'slideshow', width: 1000, align: 'center', lightbox: false, captionAlign: 'center' }),
  },

  // Text
  {
    id: 'text-heading', cat: 'text', name: 'Heading and paragraph', desc: 'A title with a few lines of text.', keys: 'title words write',
    pic: () => svg([head(28, 18, 64, 8), ...lines(28, 36, 104, 6)]),
    make: () => newSection('text', { html: '<h2>Heading</h2><p>Write a few sentences here. Click the text on the page to change it.</p>' }),
  },
  {
    id: 'text-paragraph', cat: 'text', name: 'Paragraph', desc: 'Plain text.', keys: 'words write body',
    pic: () => svg(lines(28, 20, 104, 9)),
    make: () => newSection('text', { html: '<p>Write here. Click the text on the page to change it, and select words to make them bold, italic, or a link.</p>' }),
  },
  {
    id: 'text-columns', cat: 'text', name: 'Two columns', desc: 'Two blocks of text side by side.', keys: 'columns side by side text two',
    pic: () => svg([head(16, 20, 40, 6), ...lines(16, 32, 60, 6), head(84, 20, 40, 6), ...lines(84, 32, 60, 6)]),
    make: () => newSection('blocks', {
      rows: 6,
      blocks: [
        block('text', { x: 0, y: 0, w: 11, h: 6 }, { html: '<h3>First column</h3><p>Write here. Drag the block to move it, or drag its edges to resize it.</p>' }),
        block('text', { x: 13, y: 0, w: 11, h: 6 }, { html: '<h3>Second column</h3><p>Write here. Drag the block to move it, or drag its edges to resize it.</p>' }),
      ],
    }),
  },
  {
    id: 'text-exhibition', cat: 'text', name: 'Exhibition text', desc: 'Title, venue and dates, then a description.', keys: 'show exhibit dates venue',
    pic: () => svg([head(28, 14, 72, 8), bar(28, 28, 58, HEAD), ...lines(28, 42, 104, 6)]),
    make: () => newSection('text', {
      width: 760,
      html: `<h2>Exhibition Title</h2><p class="muted">Gallery Name, City. March 1 to April 15, ${year()}</p><p>Write about the exhibition here: the work in it, and where and when it can be seen.</p>`,
    }),
  },
  {
    id: 'text-quote', cat: 'text', name: 'Quote', desc: 'A quotation and its source.', keys: 'review press blockquote',
    pic: () => svg([quoteMarks(34, 26), ...lines(34, 58, 96, 3), bar(34, 82, 40, HEAD)]),
    make: () => newSection('text', { width: 720, html: `<blockquote><p>A quotation goes here.</p></blockquote><p class="muted">Name, Publication, ${year()}</p>` }),
  },

  // About
  {
    id: 'about-statement', cat: 'about', name: 'Artist statement with image', desc: 'A picture of you or your work beside your statement.', keys: 'artist statement about bio portrait studio',
    pic: () => svg([img(14, 12, 58, 76), head(84, 26, 56), ...lines(84, 40, 62, 6)]),
    make: () => newSection('blocks', {
      rows: 12,
      blocks: [
        block('image', { x: 0, y: 0, w: 10, h: 12 }, { fit: 'fill' }),
        block('text', { x: 12, y: 0, w: 12, h: 12 }, {
          alignV: 'middle',
          html: '<h2>Artist Statement</h2><p>Write about your work: what you make, how you make it, and why.</p><p>A second paragraph can talk about your materials, your process, or the ideas behind a series.</p>',
        }),
      ],
    }),
  },
  {
    id: 'it-small', cat: 'about', name: 'Bio with portrait', desc: 'A narrow image next to a longer text.', keys: 'image text bio about portrait',
    pic: () => svg([img(16, 14, 36, 48), head(62, 16, 52), ...lines(62, 30, 82, 7)]),
    make: () => newSection('imageText', {
      imageWidth: 33, verticalAlign: 'top',
      html: '<h3>About</h3><p>Write a short biography here: where you live and work, where you studied, and where your work has been shown.</p>',
    }),
  },
  {
    id: 'text-statement', cat: 'about', name: 'Statement', desc: 'Larger centered text in a narrow column.', keys: 'artist statement about bio center',
    pic: () => svg(lines(38, 26, 84, 6, 8.5, true)),
    make: () => newSection('text', {
      width: 680, align: 'center', textAlign: 'center', size: 'large', lineHeight: 'loose',
      html: '<p>A short statement about the work. Click here to write your own.</p>',
    }),
  },

  // Contact
  {
    id: 'form', cat: 'contact', name: 'Contact form', desc: 'Name, email and message, sent to your inbox.', keys: 'email message formspree inquiry',
    pic: () => svg(formPic([9, 9, 18])),
    make: () => newSection('form'),
  },
  {
    id: 'form-short', cat: 'contact', name: 'Short message form', desc: 'Just an email address and a message.', keys: 'email message formspree newsletter',
    pic: () => svg(formPic([9, 24])),
    make: () => newSection('form', { fields: { name: false, email: true, subject: false, message: true } }),
  },
  {
    id: 'contact-details', cat: 'contact', name: 'Contact details', desc: 'Email address and links, as text.', keys: 'email instagram address phone social',
    pic: () => svg([bar(32, 30, 24, HEAD), bar(60, 30, 62, LINK), bar(32, 46, 34, HEAD), bar(70, 46, 46, LINK), bar(32, 62, 52)]),
    make: () => newSection('text', {
      width: 600,
      html: '<p><strong>EMAIL:</strong> <a href="mailto:you@example.com">you@example.com</a></p><p><strong>INSTAGRAM:</strong> <a href="https://www.instagram.com/" target="_blank" rel="noopener">@yourname</a></p><p>City, State</p>',
    }),
  },

  // Video
  {
    id: 'video', cat: 'video', name: 'Video', desc: 'A YouTube or Vimeo video.', keys: 'youtube vimeo film movie',
    pic: () => svg([html`<rect x="20" y="12" width="120" height="68" rx="2" fill="#2b2b2b" />`, play(80, 46)]),
    make: () => newSection('video', { width: 900 }),
  },
  {
    id: 'video-caption', cat: 'video', name: 'Video with caption', desc: 'A video with its title and details.', keys: 'youtube vimeo film caption',
    pic: () => svg([html`<rect x="28" y="8" width="104" height="60" rx="2" fill="#2b2b2b" />`, play(80, 38), bar(28, 76, 56, HEAD), bar(28, 84, 74)]),
    make: () => {
      // A video block with a text block under it for the caption.
      const s = newSection('video', { width: 900 });
      const v = s.blocks[0];
      s.blocks.push(block('text', { x: 0, y: v.d.y + v.d.h, w: 24, h: 2 }, { size: 'small', html: `<p><em>Title</em>, video, 3 minutes, ${year()}</p>` }));
      s.rows = v.d.h + 2;
      return s;
    },
  },

  // Lists
  {
    id: 'cv', cat: 'lists', auto: true, name: 'CV', desc: 'Headed lists of years and entries.', keys: 'resume exhibitions education',
    pic: () => svg([head(24, 10, 44, 4), ...cvRows(24, 20, 3, [86, 70, 78]), head(24, 50, 56, 4), ...cvRows(24, 60, 4, [92, 64, 80, 72])]),
    make: () => newSection('cv', {
      groups: [
        group('EDUCATION:', [entry('2021', 'MFA, School Name, City, ST'), entry('2016', 'BFA, School Name, City, ST')]),
        group('SELECTED EXHIBITIONS:', [
          entry(year(), '<em>Exhibition Title</em>, Gallery Name, City, ST'),
          entry(lastYear(), '<em>Exhibition Title</em>, Gallery Name, City, ST'),
        ]),
      ],
    }),
  },
  {
    id: 'cv-exhibitions', cat: 'lists', auto: true, name: 'Exhibition list', desc: 'One list of shows, newest first.', keys: 'cv resume shows exhibitions',
    pic: () => svg([head(24, 12, 60, 4), ...cvRows(24, 24, 7, [96, 74, 88, 66, 92, 80, 70])]),
    make: () => newSection('cv', {
      groups: [group('SELECTED EXHIBITIONS:', [
        entry(year(), '<em>Exhibition Title</em>, Gallery Name, City, ST'),
        entry(lastYear(), '<em>Exhibition Title</em>, Gallery Name, City, ST'),
        entry(String(Number(year()) - 2), '<em>Exhibition Title</em>, Gallery Name, City, ST'),
      ])],
    }),
  },
  {
    id: 'cv-press', cat: 'lists', auto: true, name: 'Press and reviews', desc: 'Articles, reviews and interviews about your work, with links.', keys: 'cv publications reviews bibliography links press interviews',
    pic: () => svg([head(24, 8, 40, 4), ...Array.from({ length: 3 }, (_, i) => [bar(24, 18 + i * 9, 13), bar(43, 18 + i * 9, 54 - (i % 2) * 14, LINK), bar(101 - (i % 2) * 14, 18 + i * 9, 26)]),
      head(24, 52, 46, 4), ...Array.from({ length: 3 }, (_, i) => [bar(24, 62 + i * 9, 13), bar(43, 62 + i * 9, 70 - (i % 2) * 18)])]),
    make: () => newSection('cv', {
      groups: [
        group('PRESS:', [
          entry(year(), '<em><a href="https://example.com" target="_blank" rel="noopener">Article Title</a></em>, Publication Name'),
          entry(lastYear(), '<em>Interview Title</em>, Publication Name'),
        ]),
        group('REVIEWS:', [
          entry(year(), '<em>Review Title</em>, Critic Name, Publication Name'),
          entry(lastYear(), '<em>Review Title</em>, Critic Name, Publication Name'),
        ]),
      ],
    }),
  },
  {
    id: 'reviews-quotes', cat: 'lists', name: 'Quotes from reviews', desc: 'Two short quotes from writing about your work.', keys: 'press reviews quotes critics testimonials',
    pic: () => svg([quoteMarks(18, 22), ...lines(18, 48, 56, 3), bar(18, 72, 34, HEAD), quoteMarks(88, 22), ...lines(88, 48, 56, 3), bar(88, 72, 34, HEAD)]),
    make: () => newSection('blocks', {
      rows: 3,
      blocks: [
        block('quote', { x: 0, y: 0, w: 11, h: 3 }, { html: '<p>A sentence from a review of your work.</p>', attribution: 'Critic Name, Publication' }),
        block('quote', { x: 13, y: 0, w: 11, h: 3 }, { html: '<p>Another sentence, from another review.</p>', attribution: 'Critic Name, Publication' }),
      ],
    }),
  },

  // Blog
  {
    id: 'posts', cat: 'blog', auto: true, name: 'Article list', desc: 'Titles, dates, images and excerpts of your articles.', keys: 'blog writing posts news collection',
    pic: () => svg([head(28, 8, 66, 6), bar(28, 18, 28), img(28, 25, 70, 24), bar(28, 54, 96), head(28, 66, 54, 6), bar(28, 76, 28), bar(28, 84, 90)]),
    make: site => newSection('posts', { blog: firstBlog(site) }),
  },
  {
    id: 'posts-compact', cat: 'blog', auto: true, name: 'Compact article list', desc: 'Just the titles and dates.', keys: 'blog writing posts list titles',
    pic: () => svg([12, 34, 56, 78].flatMap(y => [head(28, y, 74, 5), bar(28, y + 9, 26)])),
    make: site => newSection('posts', { blog: firstBlog(site), showImage: false, showExcerpt: false }),
  },

  // Buttons
  {
    id: 'button', cat: 'buttons', name: 'Button', desc: 'An outlined button that links anywhere.', keys: 'link call to action',
    pic: () => svg([html`<rect x="28" y="40" width="58" height="20" fill="#fff" stroke=${INK} stroke-width="1.4" />`, bar(39, 48.5, 36, INK)]),
    make: () => newSection('button'),
  },
  {
    id: 'button-solid', cat: 'buttons', name: 'Solid button, centered', desc: 'A filled button in the middle of the page.', keys: 'link call to action center',
    pic: () => svg([html`<rect x="51" y="40" width="58" height="20" fill=${INK} />`, bar(62, 48.5, 36, '#fff')]),
    make: () => newSection('button', { style: 'solid', buttonAlign: 'center', label: 'Get in touch' }),
  },
  {
    id: 'button-link', cat: 'buttons', name: 'Text link', desc: 'An underlined link, like "See more work".', keys: 'link more underline',
    pic: () => svg([bar(28, 46, 54, '#7a7a7a'), bar(28, 52, 54, INK, 1.4)]),
    make: () => newSection('button', { style: 'link', label: 'See more work' }),
  },

  // Layout
  {
    id: 'blank-text-image', cat: 'layout', name: 'Text beside image', desc: 'A text block and an image block, ready to move and resize.', keys: 'blocks free grid side by side fluid engine',
    pic: () => svg([...gridDots(), head(22, 24, 44, 6), ...lines(22, 36, 50, 5), img(86, 16, 56, 66),
      html`<rect x="18" y="18" width="60" height="62" rx="2" fill="none" stroke="#8fb0ef" stroke-dasharray="3 2" />`]),
    make: () => newSection('blocks', {
      rows: 10,
      blocks: [
        block('text', { x: 0, y: 0, w: 11, h: 8 }, { html: '<h2>Heading</h2><p>Write about the work here. Drag this block anywhere in the section.</p>' }),
        block('image', { x: 13, y: 0, w: 11, h: 10 }),
      ],
    }),
  },
  {
    id: 'space', cat: 'layout', name: 'Space', desc: 'Empty space between two sections.', keys: 'spacer gap empty',
    pic: () => svg([bar(24, 10, 112, TXT, 10), spaceArrows(30, 70), bar(24, 80, 112, TXT, 10)]),
    make: () => newSection('spacer', { height: 48 }),
  },
  {
    id: 'line', cat: 'layout', name: 'Line', desc: 'A thin line that divides the page.', keys: 'divider rule separator hr',
    pic: () => svg([bar(24, 10, 112, TXT, 10), html`<rect x="24" y="49" width="112" height="1.6" fill="#8a8a8a" />`, bar(24, 80, 112, TXT, 10)]),
    make: () => newSection('spacer', { height: 48, line: true }),
  },
  {
    id: 'space-large', cat: 'layout', name: 'Large space', desc: 'A lot of room, for a pause between parts of a page.', keys: 'spacer gap empty big',
    pic: () => svg([bar(24, 4, 112, TXT, 7), spaceArrows(19, 81), bar(24, 89, 112, TXT, 7)]),
    make: () => newSection('spacer', { height: 140 }),
  },

  // Advanced
  {
    id: 'embed', cat: 'advanced', name: 'Embed code', desc: 'Paste HTML from another website, like a map or a sign-up form.', keys: 'html code iframe map newsletter widget',
    pic: () => svg([stroke('M64 36l-14 14 14 14M96 36l14 14-14 14M86 30l-12 40', '#7d7d7d', 2.4)]),
    make: () => newSection('embed'),
  },

  // Found by searching only; the + Add Blank button is the usual way.
  {
    id: 'blank', cat: 'blank', name: 'Blank section', desc: 'An empty grid. Place text, images and buttons anywhere.', keys: 'empty fluid engine free grid blocks add blank',
    pic: () => svg([html`<rect x="14" y="10" width="132" height="80" rx="3" fill="none" stroke="#c9c9c9" stroke-dasharray="3 3" />`, ...gridDots()]),
    make: () => newSection('blocks'),
  },
];

const catLabel = id => CATS.find(c => c.id === id)?.label || 'Blank';

function matches(text, q) {
  const t = text.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w => t.includes(w));
}

const presetText = p => `${p.name} ${p.desc} ${p.keys || ''} ${catLabel(p.cat)}`;

// A picture for a saved section, from what kind of section it is.
function savedPic(sec) {
  switch (sec?.type) {
    case 'gallery': return svg([0, 1, 2].flatMap(c => [0, 1].map(r => img(30 + c * 34, 14 + r * 36, 30, 32))));
    case 'cv': return svg([head(24, 12, 50, 4), ...cvRows(24, 24, 6, [90, 70, 84, 64])]);
    case 'posts': return svg([12, 34, 56, 78].flatMap(y => [head(28, y, 74, 5), bar(28, y + 9, 26)]));
    case 'form': return svg(formPic([9, 9, 18]));
    case 'spacer': return svg([bar(24, 10, 112, TXT, 10), spaceArrows(30, 70), bar(24, 80, 112, TXT, 10)]);
    default: {
      const blocks = sec?.blocks || [];
      const hasImage = blocks.some(b => b.kind === 'image');
      const hasText = blocks.some(b => b.kind === 'text' || b.kind === 'quote');
      if (hasImage && hasText) return svg([head(18, 26, 50, 6), ...lines(18, 40, 58, 4), img(86, 16, 58, 68)]);
      if (hasImage) return svg([img(24, 12, 112, 76)]);
      return svg([head(28, 20, 70, 8), ...lines(28, 38, 104, 5)]);
    }
  }
}

// Whether a saved section's background is dark (its picture is drawn light).
function isDark(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || '');
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

const savedDate = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

let lastCat = CATS[0].id; // reopen on the category used last time

export function AddSectionModal({ pageId, index, onClose }) {
  const site = useStore(s => s.site);
  const saved = site.savedSections || [];
  const [cat, setCat] = useState(lastCat);
  const [q, setQ] = useState('');
  const searchRef = useRef(null);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const query = q.trim().toLowerCase();
  const page = site.pages.find(p => p.id === pageId);

  const place = section => {
    if (!page) { onClose(); return; }
    addSection(pageId, typeof index === 'number' ? index : page.sections.length, section);
    onClose();
    // The preview redraws on the next frame; then bring the new section into view.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(section.id)));
  };
  const add = preset => place(preset.make(site));
  const addSaved = s => place(cloneWithNewIds(s.section));
  const addBlank = e => openMenu(e.currentTarget, [
    { label: 'Section', icon: 'layout', onClick: () => place(newSection('blocks')) },
    { note: 'A blank section. Add text, images and buttons, and place them anywhere.' },
  ]);
  const pickCat = id => { lastCat = id; setCat(id); setQ(''); };

  const shown = query ? PRESETS.filter(p => matches(presetText(p), query)) : PRESETS.filter(p => p.cat === cat);
  const savedShown = query ? saved.filter(s => matches(`${s.name} saved`, query)) : saved;
  const showSaved = query ? savedShown.length > 0 : cat === 'saved';
  const count = (query ? shown.length + savedShown.length : 0);

  return html`<${Modal} title="Add Section" size="wide" onClose=${onClose}>
    <div class="addsec se-addsec">
      <div class="addsec-cats" role="tablist" aria-label="Section categories">
        <button type="button" class="se-addblank" onClick=${addBlank} aria-haspopup="menu"><${Icon} name="plus" size=${15} /> Add Blank</button>
        <label class="se-search">
          <${Icon} name="search" size=${16} />
          <input class="input" ref=${searchRef} type="search" placeholder="Search" aria-label="Search sections" value=${q}
            onInput=${e => setQ(e.target.value)}
            onKeyDown=${e => { if (e.key === 'Enter' && query && shown.length === 1 && !savedShown.length) { e.preventDefault(); add(shown[0]); } }} />
        </label>
        <button type="button" role="tab" aria-selected=${!query && cat === 'saved' ? 'true' : 'false'} class=${`se-savedtab${!query && cat === 'saved' ? ' on' : ''}`} onClick=${() => pickCat('saved')}>
          <${Icon} name="heart" size=${15} /> Saved<span class="n">${saved.length}</span>
        </button>
        <div class="se-catsep" role="presentation"></div>
        ${CATS.map(c => html`<button type="button" role="tab" aria-selected=${!query && c.id === cat ? 'true' : 'false'}
          class=${!query && c.id === cat ? 'on' : ''} onClick=${() => pickCat(c.id)}>
          ${c.label}<span class="n">${PRESETS.filter(p => p.cat === c.id).length}</span>
        </button>`)}
      </div>
      <div class="addsec-grid">
        ${query ? html`<p class="se-addsec-head">${count ? `${count} layout${count === 1 ? '' : 's'} for "${q.trim()}"` : ''}</p>` : null}
        ${showSaved ? html`<${SavedList} saved=${savedShown} onAdd=${addSaved} searching=${!!query} />` : null}
        ${!query && cat === 'saved' ? null : shown.map(p => html`<button type="button" key=${p.id} class="layout-card" data-preset=${p.id} title=${`Add: ${p.name}`} onClick=${() => add(p)}>
          <span class="pic">${p.pic()}${p.auto ? html`<span class="se-auto" title="Auto layout" aria-label="Auto layout"><${Icon} name="info" size=${15} /></span>` : null}</span>
          <span class="nm">${p.name}</span>
          <span class="ds">${p.desc}</span>
          ${query ? html`<span class="cat">${catLabel(p.cat)}</span>` : null}
        </button>`)}
        ${query && !count ? html`<p class="se-noresults">No layouts match "${q.trim()}". Try another word, like gallery, text or form.</p>` : null}
      </div>
    </div>
  <//>`;
}

// ---------- Saved sections (the heart in a section's toolbar) ----------

function SavedList({ saved, onAdd, searching }) {
  const [renaming, setRenaming] = useState(null);
  if (!saved.length) {
    return html`<div class="se-saved-empty">
      <${Icon} name="heart" size=${26} />
      <b>No saved sections yet</b>
      <span>To save a section, point at it on the page and click the heart in its toolbar. It then shows up here, ready to add to any page.</span>
    </div>`;
  }
  const rename = (id, name) => {
    const v = name.trim();
    setRenaming(null);
    if (!v) return;
    updateSite(site => {
      const s = (site.savedSections || []).find(x => x.id === id);
      if (s) s.name = v;
    }, { label: 'rename saved section' });
  };
  const remove = s => {
    updateSite(site => { site.savedSections = (site.savedSections || []).filter(x => x.id !== s.id); }, { label: 'delete saved section' });
    toast(`Deleted the saved section "${s.name}".`, { action: { label: 'Undo', onClick: undo }, timeout: 8000 });
  };
  return saved.map(s => html`<div key=${s.id} class="layout-card se-saved" data-saved=${s.id}>
    <button type="button" class="se-saved-add" title=${`Add: ${s.name}`} onClick=${() => onAdd(s)}>
      <span class=${`pic${isDark(s.section?.bg) ? ' dark' : ''}`} style=${/^#[0-9a-f]{3,8}$/i.test(s.section?.bg || '') ? `background:${s.section.bg}` : ''}>${savedPic(s.section)}</span>
    </button>
    <div class="se-saved-row">
      ${renaming === s.id
        ? html`<${RenameBox} value=${s.name} onDone=${v => rename(s.id, v)} onCancel=${() => setRenaming(null)} />`
        : html`<button type="button" class="nm se-saved-name" title="Add this section" onClick=${() => onAdd(s)}>${s.name}</button>`}
      ${renaming === s.id ? null : html`<span class="se-saved-acts">
        <${IconButton} small icon="pencil" label="Rename" onClick=${() => setRenaming(s.id)} />
        <${IconButton} small icon="trash" label="Delete saved section" onClick=${() => remove(s)} />
      </span>`}
    </div>
    <span class="ds">Saved ${savedDate(s.savedAt)}</span>
    ${searching ? html`<span class="cat">Saved</span>` : null}
  </div>`);
}

function RenameBox({ value, onDone, onCancel }) {
  const [text, setText] = useState(value);
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = v => { if (done.current) return; done.current = true; onDone(v); };
  return html`<input ref=${ref} class="input se-saved-input" value=${text} aria-label="Name of the saved section"
    onInput=${e => setText(e.target.value)}
    onKeyDown=${e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(text); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
    }}
    onBlur=${() => finish(text)} />`;
}
