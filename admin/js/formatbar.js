// The text toolbar that appears while typing in the preview, laid out like
// Squarespace 7.1's: Format menu, bold, italic, strikethrough, link, text color,
// alignment, lists, indent, quote, remove formatting, paste as plain text, and
// (in text blocks) delete. Buttons use onMouseDown + preventDefault so the text
// keeps its selection.

import { html, useState, useEffect, useRef, Icon, IconButton, Button, LinkInput, Toggle, ColorInput } from './ui.js';
import { useStore, getState } from './store.js';
import { updateSection } from './actions.js';
import {
  events, activeField, rectInStage, exec, setBlockStyle, formatState, rememberSelection, applyLink, removeLink,
  linkAtSelection, frameDoc, indent, setTextColor, pastePlain,
} from './preview.js';

const STYLES = [
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'h4', label: 'Heading 4' },
  { id: 'p1', label: 'Paragraph 1' },
  { id: 'p2', label: 'Paragraph 2' },
  { id: 'p3', label: 'Paragraph 3' },
  { id: 'mono', label: 'Monospace' },
  { id: 'meta', label: 'Small gray text' },
];

const ALIGNS = [['justifyLeft', 'alignLeft', 'Left'], ['justifyCenter', 'alignCenter', 'Center'], ['justifyRight', 'alignRight', 'Right'], ['justifyFull', 'justify', 'Justified']];

const keep = fn => e => { e.preventDefault(); fn(); };

export function FormatBar() {
  const mode = useStore(s => s.mode);
  const [field, setField] = useState(null);
  const [fmt, setFmt] = useState(null);
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState(null); // 'style' | 'align' | 'color' | 'link'
  const [link, setLink] = useState({ url: '', newTab: false });

  useEffect(() => {
    const update = () => {
      const f = activeField();
      setField(f);
      setFmt(f ? formatState() : null);
      if (!f) setMenu(m => (m === 'link' || m === 'color' ? m : null));
    };
    const offs = [
      events.on('focus', update),
      events.on('format', update),
      events.on('scroll', () => setTick(t => t + 1)),
      events.on('layout', () => setTick(t => t + 1)),
      events.on('load', () => { setField(null); setMenu(null); }),
      events.on('link-request', () => openLink()),
    ];
    return () => offs.forEach(f => f());
  }, []);

  function openLink() {
    if (!activeField()) return;
    rememberSelection();
    const a = linkAtSelection();
    setLink({ url: a ? a.getAttribute('href') : '', newTab: a ? a.getAttribute('target') === '_blank' : false, existing: !!a });
    setMenu('link');
  }

  if (mode !== 'edit') return null;
  if (menu === 'link') return html`<${LinkPopover} link=${link} setLink=${setLink} onClose=${() => setMenu(null)} />`;
  if (menu === 'color') return html`<${ColorPopover} current=${fmt?.color} onClose=${() => setMenu(null)} />`;
  if (!field || !fmt || !field.isConnected || fmt.kind === 'plain') return null;

  // Above the text block, left-aligned like Squarespace's; for tall blocks
  // (long articles) it follows the line being edited.
  let r = rectInStage(field);
  if (!r) return null;
  const sel = frameDoc().getSelection();
  if (r.h > 220 && sel && sel.rangeCount) {
    const rr = sel.getRangeAt(0).getBoundingClientRect();
    const fb = field.getBoundingClientRect();
    if (rr.height) r = { ...r, y: r.y - fb.top + rr.top, h: rr.height };
  }
  const rich = fmt.kind === 'rich';
  const width = rich ? 620 : 170;
  let top = r.y - 50;
  if (top < r.frameTop + 4) top = r.y + r.h + 8;
  const left = Math.max(r.frameLeft + 8, Math.min(r.x, r.frameLeft + r.frameW - width - 8));
  const current = STYLES.find(s => s.id === fmt.style) || STYLES[5];
  const blockId = field.closest('[data-bid]')?.dataset.bid;
  const sectionId = field.closest('[data-sid]')?.dataset.sid;

  return html`<div class="fmt" style=${`left:${left}px;top:${top}px`} onMouseDown=${e => e.preventDefault()}>
    ${rich ? html`
      <button type="button" class="style-select" onMouseDown=${keep(() => setMenu(menu === 'style' ? null : 'style'))}>${current.label}</button>
      ${menu === 'style' ? html`<div class="menu fmt-menu" style="left:0;min-width:200px">
        ${STYLES.map(s => html`<button type="button" onMouseDown=${keep(() => { setBlockStyle(s.id); setMenu(null); })}
          style=${styleLook(s.id)}>${s.id === fmt.style ? html`<${Icon} name="check" size=${14} />` : html`<span style="width:14px"></span>`}${s.label}</button>`)}
      </div>` : null}
      <span class="sep"></span>` : null}
    <${FmtBtn} label="Bold (⌘B)" active=${fmt.bold} onPress=${() => exec('bold')}><b>B</b><//>
    <${FmtBtn} label="Italic (⌘I)" active=${fmt.italic} onPress=${() => exec('italic')}><i style="font-family:Georgia,serif">I</i><//>
    <${FmtBtn} label="Strikethrough" active=${fmt.strike} onPress=${() => exec('strikeThrough')}><${Icon} name="strike" size=${17} /><//>
    <${FmtBtn} label="Link (⌘K)" active=${fmt.link} onPress=${openLink}><${Icon} name="link" size=${17} /><//>
    <${FmtBtn} label="Text color" active=${!!fmt.color} onPress=${() => { rememberSelection(); setMenu('color'); }}><${Icon} name="palette" size=${17} /><//>
    ${rich ? html`
      <span class="sep"></span>
      <${FmtBtn} label="Align" onPress=${() => setMenu(menu === 'align' ? null : 'align')}><${Icon} name="alignLeft" size=${17} /><//>
      ${menu === 'align' ? html`<div class="menu fmt-menu" style="left:250px;min-width:150px">
        ${ALIGNS.map(([cmd, icon, label]) => html`<button type="button" onMouseDown=${keep(() => { exec(cmd); setMenu(null); })}><${Icon} name=${icon} size=${16} />${label}</button>`)}
      </div>` : null}
      <${FmtBtn} label="Bulleted list" active=${fmt.ul} onPress=${() => exec('insertUnorderedList')}><${Icon} name="ul" size=${17} /><//>
      <${FmtBtn} label="Numbered list" active=${fmt.ol} onPress=${() => exec('insertOrderedList')}><${Icon} name="ol" size=${17} /><//>
      <${FmtBtn} label="Decrease indent (⌘[)" onPress=${() => indent(-1)}><${Icon} name="outdent" size=${17} /><//>
      <${FmtBtn} label="Increase indent (⌘])" onPress=${() => indent(1)}><${Icon} name="indent" size=${17} /><//>
      <${FmtBtn} label="Quote" active=${fmt.style === 'quote'} onPress=${() => setBlockStyle(fmt.style === 'quote' ? 'p2' : 'quote')}><${Icon} name="quote" size=${17} /><//>
      <span class="sep"></span>
      <${FmtBtn} label="Remove formatting" onPress=${() => { exec('removeFormat'); setBlockStyle('p2'); }}><${Icon} name="clear" size=${17} /><//>
      <${FmtBtn} label="Paste as plain text (⇧⌘V)" onPress=${pastePlain}><${Icon} name="paste" size=${17} /><//>
      ${blockId && sectionId ? html`<${FmtBtn} label="Delete this text block" onPress=${() => deleteTextBlock(sectionId, blockId)}><${Icon} name="trash" size=${17} /><//>` : null}` : null}
  </div>`;
}

function deleteTextBlock(sectionId, blockId) {
  frameDoc()?.activeElement?.blur();
  updateSection(sectionId, sec => { sec.blocks = sec.blocks.filter(b => b.id !== blockId); }, { label: 'delete block' });
}

function FmtBtn({ label, active, onPress, children }) {
  return html`<button type="button" class=${`ibtn${active ? ' active' : ''}`} title=${label} aria-label=${label} onMouseDown=${keep(onPress)}>${children}</button>`;
}

function styleLook(id) {
  return {
    h1: 'font-size:19px;font-weight:650', h2: 'font-size:17px;font-weight:650', h3: 'font-size:15px;font-weight:650', h4: 'font-size:14px;font-weight:650',
    p1: 'font-size:15px', p2: 'font-size:14px', p3: 'font-size:12.5px', mono: 'font-family:ui-monospace,Menlo,monospace;font-size:12.5px',
    meta: 'font-size:12.5px;color:#8b8b8b',
  }[id];
}

// Site colors first (they follow Site Styles if the palette changes), then a custom color.
function ColorPopover({ current, onClose }) {
  const design = useStore(s => s.site.design);
  const [custom, setCustom] = useState(current && current[0] === '#' ? current : '#c0392b');
  const field = activeField();
  const r = field ? rectInStage(field) : null;
  const top = r ? Math.max(r.frameTop + 8, r.y - 8) : 80;
  const left = r ? Math.max(8, Math.min(r.x, r.frameLeft + r.frameW - 300)) : 80;
  const c = design.colors;
  const swatches = [['text', c.text, 'Titles'], ['para', c.paragraph, 'Paragraphs'], ['muted', c.muted, 'Gray'], ['caption', c.caption, 'Captions'], ['link', c.link, 'Links'], ['accent', c.accent, 'Accent']];
  const pick = v => { setTextColor(v); onClose(); };
  return html`<div class="fpanel" style=${`left:${left}px;top:${top}px;right:auto;width:290px;z-index:40`} onKeyDown=${e => { if (e.key === 'Escape') onClose(); }}>
    <div class="fpanel-head" style="cursor:default"><h3>Text color</h3><${IconButton} icon="x" label="Close" small onClick=${onClose} /></div>
    <div class="fpanel-body">
      <div class="subhead">Site colors</div>
      <div class="fmt-swatches">
        ${swatches.map(([key, color, label]) => html`<button type="button" class=${`fmt-sw${current === key ? ' on' : ''}`} title=${label} aria-label=${label} style=${`background:${color}`} onMouseDown=${keep(() => pick(key))}></button>`)}
      </div>
      <div class="subhead">Custom</div>
      <div class="row" style="gap:8px;flex:none">
        <${ColorInput} value=${custom} onChange=${setCustom} />
        <${Button} small onMouseDown=${keep(() => pick(custom))}>Apply<//>
      </div>
      <p style="margin:14px 0 0"><button type="button" class="linkbtn" onMouseDown=${keep(() => pick(null))}>Use the default color</button></p>
    </div>
  </div>`;
}

// Link editor shown in place of the toolbar. The text selection was saved first
// and is restored when the link is applied.
function LinkPopover({ link, setLink, onClose }) {
  const ref = useRef(null);
  const field = activeField();
  const r = field ? rectInStage(field) : null;
  const top = r ? Math.max(r.frameTop + 8, r.y - 8) : 80;
  const left = r ? Math.max(8, Math.min(r.x, r.frameLeft + r.frameW - 340)) : 80;
  useEffect(() => { ref.current?.querySelector('input')?.focus(); }, []);
  const apply = () => {
    const url = (link.url || '').trim();
    if (!url) { removeLink(); onClose(); return; }
    const full = /^(https?:|mailto:|tel:|#|[\w-]+\.html)/i.test(url) ? url
      : url.includes('@') && !url.includes('/') ? `mailto:${url}`
        : /^\+?[\d\s().-]{7,}$/.test(url) ? `tel:${url.replace(/[^\d+]/g, '')}`
          : `https://${url}`;
    applyLink(full, link.newTab);
    onClose();
  };
  return html`<div class="fpanel" ref=${ref} style=${`left:${left}px;top:${top}px;right:auto;width:330px;z-index:40`}
    onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') onClose(); }}>
    <div class="fpanel-head" style="cursor:default"><h3>Link</h3><${IconButton} icon="x" label="Close" small onClick=${onClose} /></div>
    <div class="fpanel-body">
      <div class="field"><${LinkInput} value=${link.url} onChange=${url => setLink({ ...link, url })} placeholder="Web address, email or phone number" /></div>
      <${Toggle} label="Open in a new tab" checked=${link.newTab} onChange=${newTab => setLink({ ...link, newTab })} />
      <div class="row" style="justify-content:flex-end;gap:8px;flex:none">
        ${link.existing ? html`<${Button} kind="ghost" small onClick=${() => { removeLink(); onClose(); }}>Remove link<//>` : null}
        <${Button} small onClick=${apply}>Apply<//>
      </div>
    </div>
  </div>`;
}
