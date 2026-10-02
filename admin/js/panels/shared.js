// Pieces shared by the section and gallery panels: spacing field, caption and
// alt-text helpers, and the one-line rich text box (bold, italic, link).

import { html, useState, useEffect, useRef, useLayoutEffect, Icon, Button, Field, TextInput, Toggle, Slider, LinkInput } from '../ui.js';
import { updateSite } from '../store.js';
import { updateSection } from '../actions.js';
import { SPACE_OPTIONS } from '../../engine/schema.js';
import { sanitizeInline, pasteToInline, escapeHtml } from '../sanitize.js';

// ---------- small shared pieces ----------

const ALIGN3 = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

function SpaceField({ label, value, onChange }) {
  return html`<${Field} label=${label} value=${`${value}px`}>
    <${Slider} value=${value} min=${0} max=${200} unit="px" onChange=${onChange} />
    <div class="se-chips" role="group" aria-label=${`${label} presets`}>
      ${SPACE_OPTIONS.map(o => html`<button type="button" class=${`se-chip${o.px === value ? ' on' : ''}`} title=${`${o.px}px`} onClick=${() => onChange(o.px)}>${o.label}</button>`)}
    </div>
  <//>`;
}

// "Use the artwork caption": copies the caption saved with the image in the
// Asset Library (built from the file name: title, size, medium, year).
function ArtworkCaption({ media, current, onUse }) {
  if (!media || !media.caption || media.caption === current) return null;
  return html`<button type="button" class="linkbtn se-usecap" onClick=${() => onUse(media.caption)}>
    <${Icon} name="copy" size=${14} /> Use the artwork caption
  </button>`;
}

function AltField({ media }) {
  if (!media) return null;
  return html`<${Field} label="Alt text" help="Describes the image for people who use screen readers. It changes everywhere this image is used.">
    <${TextInput} value=${media.alt} placeholder="Describe the image"
      onChange=${v => updateSite(site => { if (site.media[media.id]) site.media[media.id].alt = v; }, { label: 'alt text', coalesce: `alt:${media.id}` })} />
  <//>`;
}

// Picking an image for an empty caption also brings its artwork caption, like
// dropping an image onto the page does.
function chooseImage(sectionId, id) {
  updateSection(sectionId, (s, site) => {
    if (id && !s.caption && site.media[id]?.caption) s.caption = site.media[id].caption;
    s.media = id;
  }, { label: id ? 'choose image' : 'remove image' });
}

// ---------- caption and CV text box (bold, italic, link) ----------

const keepFocus = e => e.preventDefault();

function selectionIn(root) {
  const sel = document.getSelection();
  return !!(root && sel && sel.rangeCount && root.contains(sel.getRangeAt(0).commonAncestorContainer));
}

function anchorIn(root) {
  const sel = document.getSelection();
  if (!root || !sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).startContainer;
  if (n.nodeType === 3) n = n.parentNode;
  const a = n && n.closest ? n.closest('a') : null;
  return a && root.contains(a) ? a : null;
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// Same rule as the text toolbar on the page: bare addresses get https://.
function fullUrl(url) {
  if (/^(https?:|mailto:|tel:|#|[\w-]+\.html)/i.test(url)) return url;
  return url.includes('@') && !url.includes('/') ? `mailto:${url}` : `https://${url}`;
}

// A small text box for one line of formatted text (captions, CV entries). What
// it stores is always cleaned with sanitizeInline, like text typed on the page.
// compact: the toolbar only shows while the box is in use.
function RichLine({ value, onChange, placeholder = '', link = false, compact = false, autoFocus = false, label }) {
  const ed = useRef(null);
  const wrap = useRef(null);
  const saved = useRef(null);
  const [active, setActive] = useState(false);
  const [fmt, setFmt] = useState({ bold: false, italic: false, link: false });
  const [linkBox, setLinkBox] = useState(null);

  // Show the stored value, except while someone is typing in this box.
  useLayoutEffect(() => {
    const el = ed.current;
    if (el && document.activeElement !== el && el.innerHTML !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  useEffect(() => {
    if (!autoFocus || !ed.current) return;
    ed.current.focus();
    caretToEnd(ed.current);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const update = () => {
      if (!selectionIn(ed.current)) return;
      const q = c => { try { return document.queryCommandState(c); } catch { return false; } };
      setFmt({ bold: q('bold'), italic: q('italic'), link: !!anchorIn(ed.current) });
    };
    update();
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [active]);

  const emit = () => {
    const el = ed.current;
    if (!el) return;
    const v = sanitizeInline(el.innerHTML);
    if (!v && el.innerHTML) el.innerHTML = ''; // brings the placeholder back
    if (v !== (value || '')) onChange(v);
  };

  const focusBox = () => {
    const el = ed.current;
    if (document.activeElement !== el) el.focus();
    if (!selectionIn(el)) caretToEnd(el);
  };

  const run = command => {
    focusBox();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(command);
    emit();
  };

  const restore = () => {
    ed.current.focus();
    if (saved.current) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
  };

  const openLink = () => {
    focusBox();
    const sel = document.getSelection();
    saved.current = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const a = anchorIn(ed.current);
    setLinkBox({ url: a ? a.getAttribute('href') : '', newTab: a ? a.getAttribute('target') === '_blank' : true, existing: !!a });
  };

  const unlink = () => {
    restore();
    const a = anchorIn(ed.current);
    if (a) {
      const r = document.createRange();
      r.selectNodeContents(a);
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('unlink');
    }
    setLinkBox(null);
    emit();
  };

  const applyLink = () => {
    const url = (linkBox?.url || '').trim();
    if (!url) { unlink(); return; }
    const href = fullUrl(url);
    restore();
    const el = ed.current;
    const a = anchorIn(el);
    if (a) a.setAttribute('href', href);
    else if (document.getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`);
    else document.execCommand('createLink', false, href);
    for (const x of el.querySelectorAll('a')) {
      if (x.getAttribute('href') !== href) continue;
      if (linkBox.newTab) { x.setAttribute('target', '_blank'); x.setAttribute('rel', 'noopener'); } else { x.removeAttribute('target'); x.removeAttribute('rel'); }
    }
    setLinkBox(null);
    emit();
  };

  const onKeyDown = e => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); emit(); return; }
    if (mod && k === 'k' && link) { e.preventDefault(); openLink(); return; }
    if (mod && (k === 'b' || k === 'i')) { e.preventDefault(); run(k === 'b' ? 'bold' : 'italic'); return; }
    if (e.key === 'Escape') { e.preventDefault(); ed.current.blur(); }
  };

  const onPaste = e => {
    e.preventDefault();
    const cd = e.clipboardData;
    document.execCommand('insertHTML', false, pasteToInline(cd.getData('text/html'), cd.getData('text/plain')));
    emit();
  };

  // Leaving the box (not just moving to its toolbar or link box): store the
  // cleaned text and show exactly that.
  const onFocusOut = e => {
    if (wrap.current && e.relatedTarget && wrap.current.contains(e.relatedTarget)) return;
    setActive(false);
    setLinkBox(null);
    const el = ed.current;
    if (!el) return;
    const v = sanitizeInline(el.innerHTML);
    if (v !== (value || '')) onChange(v);
    if (el.innerHTML !== v) el.innerHTML = v;
  };

  const tools = !compact || active;
  return html`<div class=${`se-rt${compact ? ' compact' : ''}${active ? ' active' : ''}`} ref=${wrap}
    onfocusin=${() => setActive(true)} onfocusout=${onFocusOut}>
    <div ref=${ed} class=${`se-rt-ed${compact ? ' rich-mini' : ''}`} contenteditable="true" role="textbox" spellcheck="true"
      aria-label=${label || placeholder} data-placeholder=${placeholder}
      onInput=${emit} onKeyDown=${onKeyDown} onPaste=${onPaste}></div>
    ${tools ? html`<div class="se-rt-tools" onMouseDown=${keepFocus}>
      <button type="button" class=${`se-rt-btn${fmt.bold && active ? ' on' : ''}`} title="Bold (⌘B)" aria-label="Bold" onClick=${() => run('bold')}><b>B</b></button>
      <button type="button" class=${`se-rt-btn${fmt.italic && active ? ' on' : ''}`} title="Italic (⌘I)" aria-label="Italic" onClick=${() => run('italic')}><i>I</i></button>
      ${link ? html`<button type="button" class=${`se-rt-btn${fmt.link && active ? ' on' : ''}`} title="Link (⌘K)" aria-label="Link" onClick=${openLink}><${Icon} name="link" size=${15} /></button>` : null}
    </div>` : null}
    ${linkBox ? html`<div class="se-rt-link"
      onMouseDown=${e => { if (!e.target.closest('input, select, textarea, button, [tabindex]')) e.preventDefault(); }}
      onKeyDown=${e => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); applyLink(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLinkBox(null); restore(); }
      }}>
      <${LinkInput} value=${linkBox.url} onChange=${url => setLinkBox(b => ({ ...b, url }))} />
      <${Toggle} label="Open in a new tab" checked=${linkBox.newTab} onChange=${v => setLinkBox(b => ({ ...b, newTab: v }))} />
      <div class="se-rt-link-btns">
        ${linkBox.existing ? html`<${Button} small kind="ghost" onClick=${unlink}>Remove link<//>` : null}
        <${Button} small kind="secondary" onClick=${() => { setLinkBox(null); restore(); }}>Cancel<//>
        <${Button} small onClick=${applyLink}>Apply<//>
      </div>
    </div>` : null}
  </div>`;
}

export { ALIGN3, SpaceField, ArtworkCaption, AltField, chooseImage, keepFocus, selectionIn, anchorIn, caretToEnd, fullUrl, RichLine };
