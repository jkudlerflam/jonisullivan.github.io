/**
 * sanitize.js: sanitizer and normalizer for the site editor's text fields.
 *
 * Every stored value passes through these functions, so the output is compact,
 * predictable and idempotent: f(f(x)) === f(x) for every input.
 *
 * How it works
 *   1. Parse into an inert <template>: scripts never run, images never load.
 *   2. Walk the DOM into a small block model. Inline content is kept as flat
 *      "runs", {text, m} or {br: true, m}, where m is the sorted list of inline
 *      marks in effect ('strong', 'em', 'u', 's', 'sub', 'sup' or a link).
 *   3. Normalize the runs (whitespace, &nbsp;, <br>, empty blocks) and reshape
 *      the blocks for the target: rich blocks, one inline line, or plain text.
 *   4. Serialize with our own serializer, which re-nests the marks.
 *
 * Rebuilding tags from runs makes "drop empty inline tags" and "merge adjacent
 * identical tags" automatic, and re-parsing the output yields the same runs,
 * which is what makes every function idempotent.
 */

const NBSP = '\u00a0';
const WS = new Set([' ', '\t', '\n', '\r', '\f']); // collapsible HTML whitespace
const dict = (o) => Object.assign(Object.create(null), o); // lookup table without a prototype
const words = (s) => new Set(s.split(' '));

// Removed together with everything inside them.
const DROP = words('script style template iframe object embed form input button select ' +
  'textarea img picture video audio svg math canvas meta link title head noscript xml ' +
  'base noembed noframes applet frame frameset param source track datalist');
// Containers that become paragraph blocks. They take the surrounding block tag
// (normally p), and an empty one vanishes, unlike an explicit empty <p>.
const BOXES = words('div pre section article header footer figure figcaption main nav ' +
  'aside address center li dl dt dd table thead tbody tfoot tr td th caption details ' +
  'summary fieldset legend hgroup');
const HEADING = dict({ h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4' });
const MARK_TAG = dict({ b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', ins: 'u',
  s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup' });
const MARK_ORDER = ['link', 'strong', 'em', 'u', 's', 'sub', 'sup'];
const WEIGHT = dict({ bold: 700, bolder: 700, normal: 400, lighter: 300 });
const CLASSES = ['large', 'small', 'muted', 'mono', 'indent-1', 'indent-2', 'indent-3', 'align-center', 'align-right', 'align-justify'];
// Text colors come only from the editor's own color tool (data-tc), never from
// pasted styles: a site color name, or a custom #rrggbb.
const TEXT_COLOR = /^(#[0-9a-f]{6}|text|para|muted|caption|link|accent)$/i;
const ALIGN = dict({ left: '', start: '', center: 'align-center', middle: 'align-center',
  '-webkit-center': 'align-center', right: 'align-right', end: 'align-right', justify: 'align-justify' });
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// ---------------------------------------------------------------- marks ----
// A mark is a string. A link is encoded as "\0href\0target" (the parser never
// leaves NUL in attributes), so it sorts first and compares by value.
const isLink = (t) => t[0] === '\0';
const isColor = (t) => t[0] === '\x01'; // "\x01#rrggbb" or "\x01accent"
const rank = (t) => (isLink(t) ? 0 : isColor(t) ? 0.5 : MARK_ORDER.indexOf(t));
const sameMarks = (a, b) => a.length === b.length && a.every((t, k) => t === b[k]);
const shared = (a, b) => a.filter((t) => b.includes(t));
const without = (m, t) => m.filter((x) => x !== t);
function withMark(m, t) { // add t in canonical order; a new link (or color) replaces the old one
  return [...m.filter((x) => x !== t && !(isLink(x) && isLink(t)) && !(isColor(x) && isColor(t))), t].sort((x, y) => rank(x) - rank(y));
}

// The style attribute as {property: lowercased value}.
function styleOf(el) {
  const st = dict({});
  for (const decl of (el.getAttribute('style') || '').replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const k = decl.indexOf(':');
    if (k > 0) st[decl.slice(0, k).trim().toLowerCase()] = decl.slice(k + 1).replace(/!\s*important/i, '').trim().toLowerCase();
  }
  return st;
}

// Read an href the way the URL parser will (it drops tabs and newlines and trims
// control characters), then allow only safe schemes. '' means "unwrap the link".
function cleanHref(raw) {
  const href = (raw || '').replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  return !scheme || /^(https?|mailto|tel)$/i.test(scheme[1]) ? href : '';
}

// Marks in effect inside element el: from its tag, then from its inline style.
function marksFor(el, tag, st, m) {
  if (MARK_TAG[tag]) m = withMark(m, MARK_TAG[tag]);
  if (tag === 'a') {
    const href = cleanHref(el.getAttribute('href'));
    const blank = (el.getAttribute('target') || '').trim().toLowerCase() === '_blank';
    if (href) m = withMark(m, `\0${href}\0${blank ? '_blank' : ''}`);
  }
  // Bold at 600 and up, un-bold at normal/400: Google Docs wraps every paste in
  // <b style="font-weight:normal">, which must not make the whole paste bold.
  const w = parseInt(st['font-weight'], 10) || WEIGHT[st['font-weight']];
  if (w >= 600) m = withMark(m, 'strong');
  else if (w) m = without(m, 'strong');
  const fs = st['font-style'] || '';
  if (/^(italic|oblique)/.test(fs)) m = withMark(m, 'em');
  else if (fs === 'normal') m = without(m, 'em');
  const deco = `${st['text-decoration']} ${st['text-decoration-line']} ${st['-webkit-text-decoration-line']}`;
  if (/\bunderline\b/.test(deco) && !m.some(isLink)) m = withMark(m, 'u'); // pasted links are styled underlined
  if (/\bline-through\b/.test(deco)) m = withMark(m, 's');
  const va = st['vertical-align'];
  if (va === 'super' || va === 'sub') m = withMark(m, va === 'super' ? 'sup' : 'sub');
  const tc = (el.getAttribute('data-tc') || '').trim();
  if (TEXT_COLOR.test(tc)) m = withMark(m, `\x01${tc.toLowerCase()}`);
  else if (tc === 'none') m = m.filter((x) => !isColor(x));
  return m;
}

// Whitelisted classes of a block element: its own classes, text-align/align= as
// align-*, and those inherited from flattened containers (div, ul, ...) for the
// groups (alignment, size) that the element does not set itself.
function blockClasses(el, tag, st, inherited) {
  let cls = (el.getAttribute('class') || '').split(/\s+/).filter((c) => CLASSES.includes(c));
  let setsAlign = cls.some((c) => c.startsWith('align-'));
  const attr = tag === 'table' ? '' : el.getAttribute('align'); // <table align> places the table, not its text
  const align = ALIGN[(st['text-align'] || attr || (tag === 'center' ? 'center' : '')).trim().toLowerCase()];
  if (align !== undefined) {
    cls = cls.filter((c) => !c.startsWith('align-'));
    if (align) cls.push(align);
    setsAlign = true;
  }
  const setsSize = cls.includes('large') || cls.includes('small');
  for (const c of inherited) if (c.startsWith('align-') ? !setsAlign : c === 'muted' || !setsSize) cls.push(c);
  return CLASSES.filter((c) => cls.includes(c));
}

// ------------------------------------------------------------- DOM walk ----
// A Flow collects blocks in document order: text blocks {kind:'text', tag, cls,
// runs}, lists {kind:'list', tag, items:[{cls, blocks}]} and quotes {kind:'quote',
// cls, blocks}. Inline content goes into the open text block, which is created on
// demand with the tag and classes of the innermost enclosing block element.
class Flow {
  constructor() {
    this.blocks = [];
    this.cur = null;
    this.pending = { tag: 'p', cls: [] };
  }
  add(run) {
    (this.cur ||= { kind: 'text', ...this.pending, runs: [] }).runs.push(run);
  }
  text(s, ctx) {
    if (!ctx.pre) return this.add({ text: s, m: ctx.marks });
    s.split('\n').forEach((line, k) => { // preformatted text: newlines are line breaks
      if (k) this.add({ br: true, m: ctx.marks });
      if (line) this.add({ text: line, m: ctx.marks });
    });
  }
  finish() { // close the open block, dropping it if it is only collapsible whitespace
    if (this.cur?.runs.some((r) => r.br || [...r.text].some((c) => !WS.has(c)))) this.blocks.push(this.cur);
    this.cur = null;
  }
  push(block) {
    this.finish();
    this.blocks.push(block);
  }
}

// Hidden content is dropped; Word also puts list bullets in mso-list:Ignore spans.
const hidden = (st) => st.display === 'none' || st['mso-list'] === 'ignore' || st['mso-hide'] === 'all';

// Context for an element's children: marks, and whether newlines are significant.
function enter(el, tag, st, ctx) {
  const ws = st['white-space'] || '';
  const pre = tag === 'pre' || /^(pre|break-spaces)/.test(ws) || (ctx.pre && !/^(normal|nowrap)/.test(ws));
  return { ...ctx, marks: marksFor(el, tag, st, ctx.marks), pre };
}

const walk = (parent, ctx, flow) => parent.childNodes.forEach((n) => walkNode(n, ctx, flow));

function walkNode(n, ctx, flow) {
  if (n.nodeType === 3) return flow.text(n.data, ctx);
  if (n.nodeType !== 1) return; // comments, including Word's <![if ...]> markers
  const tag = n.localName.toLowerCase();
  const st = styleOf(n);
  if (DROP.has(tag) || hidden(st)) return;
  const c = enter(n, tag, st, ctx);
  if (tag === 'br') flow.add({ br: true, m: c.marks });
  else if (tag === 'hr') flow.finish();
  else if (tag === 'ul' || tag === 'ol') walkList(n, tag, { ...c, cls: blockClasses(n, tag, st, ctx.cls) }, flow);
  else if (tag === 'blockquote') {
    flow.finish();
    const inner = new Flow(); // the quote carries the classes; its paragraphs start clean
    walk(n, { ...c, cls: [], tag: 'p' }, inner);
    inner.finish();
    if (inner.blocks.length) flow.push({ kind: 'quote', cls: blockClasses(n, tag, st, ctx.cls), blocks: inner.blocks });
  } else if (tag === 'p' || HEADING[tag] || BOXES.has(tag)) {
    const box = BOXES.has(tag);
    const btag = HEADING[tag] || (box ? ctx.tag : 'p');
    const cls = blockClasses(n, tag, st, ctx.cls);
    flow.finish();
    const { pending } = flow;
    const before = flow.blocks.length;
    flow.pending = { tag: btag, cls };
    walk(n, { ...c, tag: btag, cls }, flow);
    flow.finish();
    flow.pending = pending;
    // An empty <p> or <h2> is an empty paragraph; an empty <div> renders as nothing.
    if (!box && flow.blocks.length === before) flow.blocks.push({ kind: 'text', tag: btag, cls, runs: [] });
  } else walk(n, c, flow); // inline or unknown (span, font, o:p, ...): unwrap
}

// <ul>/<ol>: each <li> is walked into its own Flow. A list directly inside a list
// joins the previous item, and stray content becomes an item of its own.
function walkList(el, tag, ctx, flow) {
  flow.finish();
  const list = { kind: 'list', tag, items: [] };
  let loose = null;
  const flush = () => {
    loose?.finish();
    if (loose?.blocks.length) list.items.push({ cls: ctx.cls, blocks: loose.blocks, loose: true });
    loose = null;
  };
  for (const n of el.childNodes) {
    const t = n.nodeType === 1 ? n.localName.toLowerCase() : '';
    if (t === 'li') {
      flush();
      const st = styleOf(n);
      if (hidden(st)) continue;
      const f = new Flow();
      walk(n, { ...enter(n, t, st, ctx), cls: [], tag: 'p' }, f);
      f.finish();
      list.items.push({ cls: blockClasses(n, t, st, ctx.cls), blocks: f.blocks });
    } else if (t === 'ul' || t === 'ol') {
      flush();
      const f = new Flow();
      walkNode(n, ctx, f);
      const last = list.items[list.items.length - 1];
      if (last) last.blocks.push(...f.blocks);
      else if (f.blocks.length) list.items.push({ cls: ctx.cls, blocks: f.blocks });
    } else walkNode(n, ctx, (loose ||= new Flow()));
  }
  flush();
  if (list.items.length) flow.push(list);
}

// -------------------------------------------------------- normalization ----
// Normalize the runs of one block. Returns [] for a blank block (nothing but
// whitespace, &nbsp; and <br>). In inline mode a <br> never leads or doubles.
function normalizeRuns(runs, inline = false) {
  const ch = []; // one entry per character, '\n' standing for <br>
  const mk = [];
  for (const r of runs) {
    if (r.br) { ch.push('\n'); mk.push(r.m); continue; }
    for (const c of r.text) { ch.push(WS.has(c) ? ' ' : c); mk.push(r.m); }
  }
  if (ch.every((c) => c === ' ' || c === '\n' || c === NBSP)) return [];
  // A lone &nbsp; becomes a plain space; two or more in a row are deliberate spacing.
  const fixed = ch.map((c, k) => (c === NBSP && ch[k - 1] !== NBSP && ch[k + 1] !== NBSP ? ' ' : c));
  // Collapse whitespace: no space at the edges, beside a <br>, or twice in a row.
  const oc = [];
  const om = [];
  fixed.forEach((c, k) => {
    let last = oc[oc.length - 1];
    if (c === ' ' && (last === undefined || last === ' ' || last === '\n')) return;
    if (c === '\n' && last === ' ') { oc.pop(); om.pop(); last = oc[oc.length - 1]; }
    if (c === '\n' && inline && (last === undefined || last === '\n')) return;
    oc.push(c);
    om.push(mk[k]);
  });
  // A non-empty block loses its trailing <br>s.
  while (oc[oc.length - 1] === ' ' || oc[oc.length - 1] === '\n') { oc.pop(); om.pop(); }
  const out = [];
  oc.forEach((c, k) => {
    const last = out[out.length - 1];
    if (c === '\n') out.push({ br: true, m: om[k] });
    else if (last && !last.br && sameMarks(last.m, om[k])) last.text += c;
    else out.push({ text: c, m: om[k] });
  });
  // Whitespace and <br>s between two pieces of text form a "gap", and a gap keeps
  // only the marks shared by the text on both sides (and already on its spaces).
  // So <em> </em> unwraps, <b>a</b><br><b>b</b> becomes <strong>a<br>b</strong>,
  // and every tag starts and ends on real text, so none can end up empty.
  const isText = (r) => !r.br && /[^ \u00a0]/.test(r.text);
  for (let i = 0, j; i < out.length; i = j) {
    for (j = i; j < out.length && !isText(out[j]); j++);
    if (j === i) { j++; continue; }
    let m = i > 0 && j < out.length ? shared(out[i - 1].m, out[j].m) : [];
    for (let k = i; k < j; k++) if (!out[k].br) m = shared(m, out[k].m);
    for (let k = i; k < j; k++) out[k].m = m;
  }
  const res = [];
  for (const r of out) {
    const last = res[res.length - 1];
    if (last && !last.br && !r.br && sameMarks(last.m, r.m)) last.text += r.text;
    else res.push(r);
  }
  return res;
}

// Join lines (run arrays) with <br>: blank lines inside stay, blank edges go.
function joinChunks(list) {
  let a = 0;
  let z = list.length;
  while (a < z && !list[a].length) a++;
  while (z > a && !list[z - 1].length) z--;
  return list.slice(a, z).flatMap((c, k) => (k ? [{ br: true, m: [] }, ...c] : c));
}

// A list item holds inline content and nested lists only, so its paragraphs are
// joined with <br>. Returns null for a list left without items.
function shapeList(list) {
  const items = [];
  for (const it of list.items) {
    const parts = [];
    let text = []; // blocks since the last nested list
    const flush = () => {
      const runs = normalizeRuns(joinChunks(lineChunks(shapeBlocks(text, true))));
      if (runs.length) parts.push({ kind: 'runs', runs });
      text = [];
    };
    for (const b of it.blocks) {
      const sub = b.kind === 'list' && shapeList(b);
      if (sub) { flush(); parts.push(sub); } else if (b.kind !== 'list') text.push(b);
    }
    flush();
    if (parts.length || !it.loose) items.push({ cls: it.cls, parts });
  }
  return items.length ? { kind: 'list', tag: list.tag, items } : null;
}

// The rich block structure. Inside a blockquote (inQuote) everything becomes <p>.
function shapeBlocks(blocks, inQuote) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'text') {
      out.push({ kind: 'text', tag: inQuote ? 'p' : b.tag, cls: b.cls, runs: normalizeRuns(b.runs) });
    } else if (inQuote) {
      out.push(...shapeBlocks(b.kind === 'quote' ? b.blocks : b.items.flatMap((it) => it.blocks), true));
    } else if (b.kind === 'quote') {
      const inner = shapeBlocks(b.blocks, true);
      if (inner.length) out.push({ kind: 'quote', cls: b.cls, blocks: inner });
    } else {
      const list = shapeList(b);
      if (list) out.push(list);
    }
  }
  // Blank paragraphs at the edges go; inside, they become <p><br></p>.
  const blank = (b) => b.kind === 'text' && !b.runs.length;
  let a = 0;
  let z = out.length;
  while (a < z && blank(out[a])) a++;
  while (z > a && blank(out[z - 1])) z--;
  return out.slice(a, z);
}

// The lines (run arrays) of a shaped rich structure, in document order. Inline
// and plain output are read from the rich shape, so they agree with it.
function lineChunks(blocks, out = []) {
  for (const b of blocks) {
    if (b.kind === 'text') out.push(b.runs);
    else if (b.kind === 'quote') lineChunks(b.blocks, out);
    else {
      for (const it of b.items) {
        if (!it.parts.length) out.push([]);
        for (const p of it.parts) if (p.kind === 'runs') out.push(p.runs); else lineChunks([p], out);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------- serializing ----
const closeTag = (t) => (isLink(t) ? '</a>' : isColor(t) ? '</span>' : `</${t}>`);
const classAttr = (cls) => (cls.length ? ` class="${cls.join(' ')}"` : '');
function openTag(t) {
  if (isColor(t)) {
    const v = t.slice(1);
    return `<span data-tc="${v}" style="color:${v[0] === '#' ? v : `var(--${v})`}">`;
  }
  if (!isLink(t)) return `<${t}>`;
  const [, href, target] = t.split('\0');
  return `<a href="${escapeHtml(href)}"${target ? ' target="_blank" rel="noopener"' : ''}>`;
}

// Re-nest the marks: keep open what the next run still uses, and open new marks
// longest-lasting first, so that fewer tags have to be split.
function serializeRuns(runs) {
  let html = '';
  const open = [];
  const reach = (t, i) => { while (i < runs.length && runs[i].m.includes(t)) i++; return i; };
  runs.forEach((r, i) => {
    let keep = 0;
    while (keep < open.length && r.m.includes(open[keep])) keep++;
    while (open.length > keep) html += closeTag(open.pop());
    const fresh = r.m.filter((t) => !open.includes(t)).sort((x, y) => reach(y, i) - reach(x, i) || rank(x) - rank(y));
    for (const t of fresh) { html += openTag(t); open.push(t); }
    html += r.br ? '<br>' : escapeHtml(r.text).replace(/\u00a0/g, '&nbsp;');
  });
  while (open.length) html += closeTag(open.pop());
  return html;
}

function serializeBlocks(blocks) {
  return blocks.map((b) => {
    if (b.kind === 'text') return `<${b.tag}${classAttr(b.cls)}>${b.runs.length ? serializeRuns(b.runs) : '<br>'}</${b.tag}>`;
    if (b.kind === 'quote') return `<blockquote${classAttr(b.cls)}>${serializeBlocks(b.blocks)}</blockquote>`;
    const items = b.items.map((it) => {
      const inner = it.parts.map((p) => (p.kind === 'runs' ? serializeRuns(p.runs) : serializeBlocks([p]))).join('');
      return `<li${classAttr(it.cls)}>${inner || '<br>'}</li>`;
    });
    return `<${b.tag}>${items.join('')}</${b.tag}>`;
  }).join('');
}

// ------------------------------------------------------------ public API ----
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
}

function parse(html) {
  const flow = new Flow();
  if (html) {
    const tpl = document.createElement('template'); // inert: nothing runs or loads
    tpl.innerHTML = String(html);
    walk(tpl.content, { marks: [], cls: [], tag: 'p', pre: false }, flow);
    flow.finish();
  }
  return flow.blocks;
}

/** Block content for text sections: p, h1-h4, ul/ol/li, blockquote. */
export function sanitizeRich(html) {
  return serializeBlocks(shapeBlocks(parse(html), false));
}

/** Inline content for captions and CV entries: block boundaries become one <br>. */
export function sanitizeInline(html) {
  return serializeRuns(normalizeRuns(joinChunks(lineChunks(shapeBlocks(parse(html), false))), true));
}

/** Plain text (not HTML): blocks and <br> become '\n' when multiline, else a space. */
export function sanitizePlain(html, { multiline = false } = {}) {
  const lines = lineChunks(shapeBlocks(parse(html), false));
  const text = lines.map((runs) => runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n');
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
}

const newlines = (text) => String(text ?? '').replace(/\r\n?/g, '\n');
const lineRuns = (text) => text.split('\n').flatMap((line, k) => [...(k ? [{ br: true, m: [] }] : []), { text: line, m: [] }]);

/** Plain text to rich HTML: blank lines separate paragraphs, single newlines become <br>. */
export function textToRich(text) {
  const paras = newlines(text).split(/\n\s*\n/).map((p) => normalizeRuns(lineRuns(p.trim())));
  return serializeBlocks(paras.filter((runs) => runs.length).map((runs) => ({ kind: 'text', tag: 'p', cls: [], runs })));
}

const textToInline = (text) => serializeRuns(normalizeRuns(lineRuns(newlines(text)), true));

/** Paste handlers: the clipboard HTML when it has content, else the plain text. */
export function pasteToRich(html, text) {
  return (html && sanitizeRich(html)) || textToRich(text);
}

export function pasteToInline(html, text) {
  return (html && sanitizeInline(html)) || textToInline(text);
}

// ------------------------------------------------------------- self test ----
export function selfTest() {
  const run = { R: sanitizeRich, I: sanitizeInline, P: sanitizePlain, M: (h) => sanitizePlain(h, { multiline: true }),
    T: textToRich, PR: (t) => pasteToRich('', t), PI: (t) => pasteToInline('', t) };
  const fixedPoint = { R: sanitizeRich, T: sanitizeRich, PR: sanitizeRich, I: sanitizeInline, PI: sanitizeInline };
  const cases = [
    ['R', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-ab12"><p dir="ltr" style="line-height:1.38"><span style="font-weight:400">Plain </span><span style="font-weight:700">bold</span><span style="font-style:italic"> it</span></p><br><p dir="ltr"><span style="font-weight:400">Next</span></p></b><br class="Apple-interchange-newline">',
      '<p>Plain <strong>bold</strong><em> it</em></p><p><br></p><p>Next</p>'],
    ['R', '<p><span style="font-weight: bold">a</span> <span style="font-style: italic">b</span> <span style="text-decoration: underline line-through">c</span></p>',
      '<p><strong>a</strong> <em>b</em> <u><s>c</s></u></p>'],
    ['R', '<strong style="font-weight: 400">plain</strong>', '<p>plain</p>'],
    ['R', '<b>bold</b> and <i>italic</i>', '<p><strong>bold</strong> and <em>italic</em></p>'],
    ['R', '<div>one</div><div>two</div>', '<p>one</p><p>two</p>'],
    ['R', '<div><div>a</div><div><div>b</div>c</div></div>', '<p>a</p><p>b</p><p>c</p>'],
    ['R', '<p><a href="javascript:alert(1)">x</a> <a href="jav&#x09;ascript:alert(1)">y</a></p>', '<p>x y</p>'],
    ['R', '<p><a href=" https://e.com/?a=1&amp;b=2 " target="_blank" rel="nofollow" class="x">x</a></p>',
      '<p><a href="https://e.com/?a=1&amp;b=2" target="_blank" rel="noopener">x</a></p>'],
    ['R', '<p><a href="/about" target="_self" rel="nofollow">a</a> <a name="x">b</a></p>', '<p><a href="/about">a</a> b</p>'],
    ['R', '<p class="large bogus muted" id="z" style="color:red">x</p>', '<p class="large muted">x</p>'],
    ['R', '<p style="text-align: center">c</p><p align="right">r</p><h3 style="text-align:justify">j</h3><p style="text-align:left" class="align-center small">l</p>',
      '<p class="align-center">c</p><p class="align-right">r</p><h3 class="align-justify">j</h3><p class="small">l</p>'],
    ['R', '<p>a<script>alert(1)</script><img src=x onerror="alert(1)">b</p><style>p{}</style><iframe src="x"></iframe>', '<p>ab</p>'],
    ['R', '<ul><li><p>one</p><p>two</p></li><li>three</li></ul>', '<ul><li>one<br>two</li><li>three</li></ul>'],
    ['R', '<ul><li>a</li><ul><li>b</li></ul></ul>', '<ul><li>a<ul><li>b</li></ul></li></ul>'],
    ['R', '<p>a<strong></strong><em> </em>b</p>', '<p>a b</p>'],
    ['R', '<p><em>a</em><em>b</em> <i>c</i><em>d</em></p>', '<p><em>ab</em> <em>cd</em></p>'],
    ['R', '<p>x</p><p><br></p>', '<p>x</p>'],
    ['R', '<p>&nbsp;</p><p>a</p><p></p><p>b</p><p><br></p>', '<p>a</p><p><br></p><p>b</p>'],
    ['R', '<p>a&nbsp;b&nbsp;&nbsp;c&nbsp;</p>', '<p>a b&nbsp;&nbsp;c</p>'],
    ['R', '<p>line<br></p><p>x<br><br></p>', '<p>line</p><p>x</p>'],
    ['R', 'loose <b>text</b><p>para</p>tail', '<p>loose <strong>text</strong></p><p>para</p><p>tail</p>'],
    ['R', '<h5>h</h5><h6>i</h6>', '<h4>h</h4><h4>i</h4>'],
    ['R', '<blockquote>q<p>r</p><h2>s</h2></blockquote>', '<blockquote><p>q</p><p>r</p><p>s</p></blockquote>'],
    ['R', '<p><strike>a</strike><del>b</del><ins>c</ins></p>', '<p><s>ab</s><u>c</u></p>'],
    ['R', '<p class=MsoNormal><span lang=EN-US>Word<o:p></o:p></span></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>End</p>',
      '<p>Word</p><p><br></p><p>End</p>'],
    ['R', '<p><a href="#top">t</a> <a href="mailto:a@b.co">m</a> <a href="tel:+1555">p</a> <a href="data:text/html,x">d</a></p>',
      '<p><a href="#top">t</a> <a href="mailto:a@b.co">m</a> <a href="tel:+1555">p</a> d</p>'],
    ['R', 'First<div>Second <b>bold</b></div><div><br></div><div><span style="font-size: 1.2rem;">Big</span>&nbsp;text</div><div><br></div>',
      '<p>First</p><p>Second <strong>bold</strong></p><p><br></p><p>Big text</p>'],
    ['R', '<p><b>a</b><br><b>b</b></p>', '<p><strong>a<br>b</strong></p>'],
    ['R', '', ''],
    ['R', '<p><br></p>', ''],
    ['I', '<p>a</p><p>b</p>', 'a<br>b'],
    ['I', '<h2>T</h2><p><br></p><ul><li><b>x</b></li></ul><br>', 'T<br><strong>x</strong>'],
    ['I', '<p><a href="https://x.y/" target="_blank">l</a><br><br>m</p><script>x</script>',
      '<a href="https://x.y/" target="_blank" rel="noopener">l</a><br>m'],
    ['M', '<p>a  b</p><p>c<br>d</p><p><br></p><p>e</p>', 'a b\nc\nd\n\ne'],
    ['P', '<p>a</p><p>b<br>c &amp; d</p>', 'a b c & d'],
    ['T', 'a & <b> "q"\nline 2\n\n\npara  2', '<p>a &amp; &lt;b&gt; &quot;q&quot;<br>line 2</p><p>para 2</p>'],
    ['PR', 'x\ny', '<p>x<br>y</p>'],
    ['PI', 'a\n\nb', 'a<br>b'],
  ];
  let passed = 0;
  const failures = [];
  const check = (label, got, want) => {
    if (got === want) passed++;
    else failures.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  cases.forEach(([mode, input, want], k) => {
    const got = run[mode](input);
    check(`#${k} ${mode}`, got, want);
    if (fixedPoint[mode]) check(`#${k} ${mode} idempotent`, fixedPoint[mode](got), got);
  });
  return { passed, failed: failures.length, failures };
}
