// Asset Library: the website-mode panel listing every image on the site, with a
// detail view (description, default caption, where it is used, replace it
// everywhere, delete it). Also the image chooser (Upload / Library) that every
// "Choose image" and "Add images" button in the editor opens.

import {
  html, useState, useEffect, useRef, useMemo, Icon, IconButton, Button, Field, TextInput, Select, Modal, Tabs, Thumb,
  Spinner, mediaPreviewUrl,
} from '../ui.js';
import { useStore, getState, setState, updateSite, toast, confirmDialog, openModal, undo } from '../store.js';
import { importFiles, mediaUsage, replaceMediaEverywhere, removeMedia, goToPage, setMode } from '../actions.js';
import { sanitizeInline, pasteToInline } from '../sanitize.js';
import { formatDate } from '../../engine/schema.js';
import { SideHead } from '../app.js';

// ---------- helpers ----------

const IMAGE_FILE = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?)$/i;
const isImageFile = f => !!f && (String(f.type || '').startsWith('image/') || IMAGE_FILE.test(f.name || ''));
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

const unescape = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const plainText = h => unescape(String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''));
const fileName = m => String(m?.src || '').split('/').pop();
const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const mediaName = m => String(m?.title || m?.alt || fileName(m) || 'Untitled image').trim();

const SORTS = [{ value: 'newest', label: 'Newest' }, { value: 'name', label: 'Name' }];
let lastSort = 'newest'; // shared by the panel and the chooser during a session

// The media shown for a search and sort: newest first (upload date, then the
// order they were added to the library) or by name.
function listMedia(site, query, sort) {
  const all = Object.values(site.media).map((m, i) => ({ m, i }));
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits = !words.length ? all : all.filter(({ m }) => {
    const hay = `${m.title || ''} ${m.alt || ''} ${plainText(m.caption)} ${fileName(m)}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
  if (sort === 'name') {
    hits.sort((a, b) => mediaName(a.m).localeCompare(mediaName(b.m), undefined, { numeric: true, sensitivity: 'base' }) || a.i - b.i);
  } else {
    hits.sort((a, b) => String(b.m.added || '').localeCompare(String(a.m.added || '')) || b.i - a.i);
  }
  return hits.map(x => x.m);
}

const progressText = p => (p.n > 1 ? `Preparing image ${p.i + 1} of ${p.n}…` : 'Preparing image…');

// Prepares files with importFiles and reports progress. `alive` tells whether
// the component is still on screen when the work finishes.
function useUploader() {
  const [progress, setProgress] = useState(null); // { i, n } while preparing
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const upload = async (fileList, { limit = 0 } = {}) => {
    const given = [...(fileList || [])];
    let files = given.filter(isImageFile);
    if (limit) files = files.slice(0, limit);
    if (!files.length) {
      if (given.length) toast('Please choose image files (JPEG, PNG, WebP or GIF).', { kind: 'error' });
      return [];
    }
    setProgress({ i: 0, n: files.length });
    try {
      return await importFiles(files, { onProgress: (i, n) => { if (alive.current) setProgress({ i, n }); } });
    } finally {
      if (alive.current) setProgress(null);
    }
  };
  return { progress, upload, alive };
}

// A dashed box that takes dropped files or opens the file chooser when clicked.
function DropZone({ onFiles, progress, multiple = true, big = false, compact = false, children }) {
  const input = useRef(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const busy = !!progress;
  const pick = () => { if (!busy) input.current?.click(); };
  const cls = ['dropzone', 'md-drop', big ? 'md-drop-big' : '', compact ? 'md-compact' : '', over ? 'over' : '', busy ? 'md-busy' : ''];
  return html`<div class=${cls.filter(Boolean).join(' ')} role="button" tabindex="0" aria-disabled=${busy ? 'true' : 'false'}
    onClick=${pick}
    onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
    onDragEnter=${e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current += 1; setOver(true); }}
    onDragOver=${e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
    onDragLeave=${e => { e.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
    onDrop=${e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false); if (!busy) onFiles(e.dataTransfer.files); }}>
    <input ref=${input} type="file" accept="image/*,.heic,.heif" multiple=${multiple} hidden
      onClick=${e => e.stopPropagation()}
      onChange=${e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) onFiles(files); }} />
    ${busy ? html`<${Spinner} /><span class="md-drop-title">${progressText(progress)}</span>` : children}
  </div>`;
}

function SearchTools({ query, setQuery, sort, setSort }) {
  return html`<div class="md-tools">
    <div class="md-search"><${Icon} name="search" size=${15} />
      <${TextInput} type="search" value=${query} onChange=${setQuery} placeholder="Search images" aria-label="Search images" />
    </div>
    <${Select} value=${sort} options=${SORTS} onChange=${v => { lastSort = v; setSort(v); }} />
  </div>`;
}

// ---------- a small bold/italic text box (captions, footer) ----------

// Stores clean inline HTML (sanitizeInline): typed text is escaped, Return adds a
// line break, pasted text is cleaned. Exported for the Settings panel's footer.
export function RichLine({ value, onChange, placeholder = '', label = '' }) {
  const ref = useRef(null);
  const focused = useRef(false);
  const initial = useRef(value || '');
  const [fmt, setFmt] = useState({ bold: false, italic: false });

  // Show changes made elsewhere (undo, inline editing) unless she is typing here.
  useEffect(() => {
    const el = ref.current;
    if (el && !focused.current && sanitizeInline(el.innerHTML) !== (value || '')) el.innerHTML = value || '';
  }, [value]);

  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      const sel = document.getSelection();
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return;
      setFmt({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic') });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeInline(el.innerHTML);
    if (clean !== (value || '')) onChange(clean);
  };
  const exec = cmd => {
    ref.current.focus();
    document.execCommand(cmd);
    sync();
    setFmt({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic') });
  };
  const btn = (cmd, title, face) => html`<button type="button" class=${fmt[cmd] ? 'on' : ''} title=${title} aria-label=${title}
    aria-pressed=${fmt[cmd] ? 'true' : 'false'} onMouseDown=${e => { e.preventDefault(); exec(cmd); }}>${face}</button>`;

  return html`<div class="md-rich">
    <div class="md-rich-bar">${btn('bold', 'Bold (⌘B)', html`<b>B</b>`)}${btn('italic', 'Italic (⌘I)', html`<i>I</i>`)}</div>
    <div ref=${ref} class="md-rich-text" contenteditable="true" role="textbox" aria-multiline="true" aria-label=${label}
      spellcheck="true" data-placeholder=${placeholder} dangerouslySetInnerHTML=${{ __html: initial.current }}
      onFocus=${() => { focused.current = true; }}
      onBlur=${() => {
        focused.current = false;
        setFmt({ bold: false, italic: false });
        sync();
        const el = ref.current;
        const clean = sanitizeInline(el.innerHTML);
        if (el.innerHTML !== clean) el.innerHTML = clean;
      }}
      onInput=${sync}
      onPaste=${e => {
        e.preventDefault();
        document.execCommand('insertHTML', false, pasteToInline(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain')));
        sync();
      }}
      onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); sync(); } }}></div>
  </div>`;
}

// ---------- Asset Library panel ----------

export function MediaPanel() {
  const site = useStore(s => s.site);
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(lastSort);
  const { progress, upload } = useUploader();
  const ids = Object.keys(site.media);
  const unused = useMemo(() => new Set(Object.keys(site.media).filter(id => !mediaUsage(site, id).length)), [site]);
  const list = useMemo(() => listMedia(site, query, sort), [site, query, sort]);
  const detail = openId && site.media[openId] ? openId : null;

  const onFiles = async files => {
    const added = await upload(files);
    if (added.length) {
      toast(added.length > 1 ? `${added.length} images added to your library.` : 'Image added to your library.');
      if (lastSort !== 'newest' || query) { setQuery(''); setSort('newest'); lastSort = 'newest'; }
    }
  };

  return html`<aside class="side md-side">
    ${detail ? html`<div class="side-head">
        <${IconButton} icon="chevL" label="Back to all images" onClick=${() => setOpenId(null)} />
        <h2>Image details</h2>
      </div>` : html`<${SideHead} title="Asset Library" />`}
    <div class="side-scroll" hidden=${!!detail}>
      <div class="md-body">
        <${DropZone} onFiles=${onFiles} progress=${progress}>
          <${Icon} name="upload" size=${22} />
          <span class="md-drop-title">Drop images here, or click to upload</span>
          <span class="md-drop-hint">JPEG, PNG, WebP or GIF</span>
        <//>
        ${ids.length ? html`<${SearchTools} query=${query} setQuery=${setQuery} sort=${sort} setSort=${setSort} />
          <div class="md-count"><span>${query ? `${list.length} of ${ids.length} images` : `${ids.length} ${ids.length === 1 ? 'image' : 'images'}`}</span>
            ${unused.size ? html`<span>${unused.size} unused</span>` : null}</div>` : null}
        ${list.length ? html`<div class="thumbs md-grid">
            ${list.map(m => html`<${Thumb} key=${m.id} media=${m} badge=${unused.has(m.id) ? 'Unused' : null}
              aria-label=${`${mediaName(m)}${unused.has(m.id) ? ' (unused)' : ''}`} onClick=${() => setOpenId(m.id)} />`)}
          </div>`
          : ids.length ? html`<p class="md-empty">No images match "${query}".</p>`
            : html`<p class="md-empty">No images yet. Drop some above to start your library.</p>`}
      </div>
    </div>
    ${detail ? html`<${MediaDetail} key=${detail} id=${detail} onBack=${() => setOpenId(null)} />` : null}
  </aside>`;
}

const MEDIA_LABELS = { title: 'image title', alt: 'image description', caption: 'default caption' };

function setMediaField(id, key, value) {
  updateSite(site => { if (site.media[id]) site.media[id][key] = value; }, { label: MEDIA_LABELS[key], coalesce: `media:${id}:${key}` });
}

// mediaUsage, with repeats (two galleries on one page) shown once.
function usesOf(site, id) {
  const seen = new Set();
  return mediaUsage(site, id).filter(u => {
    const k = `${u.pageId}|${u.where}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function openUse(u) {
  if (u.pageId) { goToPage(u.pageId); return; }
  if (u.kind === 'trash') { setState({ sidePanel: 'pages' }); return; }
  if (u.kind === 'saved') { toast('Saved sections are under Add Section, in the Saved category.'); return; }
  if (u.where === 'logo') { setMode('edit'); setState({ editPanel: { kind: 'header' } }); return; }
  setState({ sidePanel: 'settings' });
}

function MediaDetail({ id, onBack }) {
  const site = useStore(s => s.site);
  const pending = useStore(s => s.pending);
  const pageId = useStore(s => s.pageId);
  const m = site.media[id];
  if (!m) return null;
  const uses = usesOf(site, id);
  const full = mediaPreviewUrl(m);

  const replace = () => openModal('mediaPicker', {
    onPick: newId => {
      if (!newId || newId === id) return;
      const n = mediaUsage(getState().site, id).length;
      replaceMediaEverywhere(id, newId);
      toast(`Replaced in ${n} ${n === 1 ? 'place' : 'places'}. This image is no longer used.`);
    },
  });

  const del = async () => {
    const ok = await confirmDialog({
      title: 'Delete this image?',
      message: "It will be removed from your Asset Library. The file itself stays in your site's history, so restoring an older version in Version History brings it back.",
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok || !getState().site.media[id]) return;
    removeMedia(id);
    onBack();
    toast('Image deleted from your library.', { action: { label: 'Undo', onClick: undo } });
  };

  return html`<div class="side-scroll"><div class="md-body">
    <a class="md-big" href=${full} target="_blank" rel="noopener" title="Open full size">
      <img src=${mediaPreviewUrl(m, 'medium')} alt=${m.alt || ''} />
    </a>
    <div class="md-name">${mediaName(m)}</div>
    <div class="md-sub">${m.w && m.h ? `${m.w} × ${m.h} pixels` : 'Image'}${pending[m.src] ? ' · not uploaded yet' : ''}</div>

    <${Field} label="Title" help="Helps you find the image in your library. It is not shown on your site.">
      <${TextInput} value=${m.title || ''} onChange=${v => setMediaField(id, 'title', v)} placeholder=${fileName(m)} />
    <//>
    <${Field} label="Description (alt text)" help="Describes the image for people who can't see it, and for search engines. For example: Oil painting of a mother holding her newborn.">
      <${TextInput} multiline rows=${3} value=${m.alt || ''} onChange=${v => setMediaField(id, 'alt', v)} placeholder="Describe what the image shows" />
    <//>
    <${Field} label="Default caption" help="Added under the image when you put it in a gallery. Captions already on your pages stay as they are.">
      <${RichLine} value=${m.caption || ''} onChange=${v => setMediaField(id, 'caption', v)} label="Default caption"
        placeholder="For example: Title, 20x16 inches, oil on canvas, 2025" />
    <//>

    <div class="subhead">Used on</div>
    ${uses.length ? html`<ul class="md-uses">
        ${uses.map(u => html`<li><button type="button" class=${u.pageId && u.pageId === pageId ? 'on' : ''}
          title=${u.pageId ? 'Show this page' : 'Open where it is set'} onClick=${() => openUse(u)}>
          <${Icon} name=${u.pageId ? 'pages' : 'gear'} size=${15} />
          <span class="md-use-name">${u.title}</span>
          <span class="md-use-where">${capitalize(u.where)}</span>
        </button></li>`)}
      </ul>` : html`<p class="md-muted">Not used on any page.</p>`}

    <div class="subhead">File</div>
    <dl class="md-meta">
      <dt>File</dt><dd class="mono">${m.src}</dd>
      ${m.medium ? html`<dt>Smaller copy</dt><dd class="mono">${m.medium.src}</dd>` : null}
      ${m.added ? html`<dt>Added</dt><dd>${formatDate(m.added)}</dd>` : null}
      <dt>Full size</dt><dd><a href=${full} target="_blank" rel="noopener">Open in a new tab</a></dd>
    </dl>

    <div class="md-actions">
      ${uses.length ? html`<${Button} kind="secondary" small icon="refresh" onClick=${replace}>Replace everywhere<//>
        <p class="help">Swap in a different image on every page listed above.</p>
        <p class="help">Images that are in use can't be deleted.</p>`
        : html`<${Button} kind="secondary" small icon="trash" class="btn secondary small md-danger" onClick=${del}>Delete image<//>`}
    </div>
  </div></div>`;
}

// ---------- image chooser ----------

function PickThumb({ m, on, multiple, onClick }) {
  return html`<button type="button" class=${`thumb md-pick${on ? ' selected' : ''}`} title=${mediaName(m)}
    aria-label=${mediaName(m)} aria-pressed=${multiple ? (on ? 'true' : 'false') : undefined} onClick=${onClick}>
    <img src=${mediaPreviewUrl(m, 'medium')} alt="" loading="lazy" draggable="false" />
    ${multiple ? html`<span class="md-check" aria-hidden="true">${on ? html`<${Icon} name="check" size=${14} />` : null}</span>` : null}
  </button>`;
}

// Squarespace-style image chooser. onPick(id), or onPick([ids]) with multiple.
export function MediaPickerModal({ onPick, multiple = false, onClose, tab: startTab }) {
  const site = useStore(s => s.site);
  const total = Object.keys(site.media).length;
  const [tab, setTab] = useState(startTab || (total ? 'library' : 'upload'));
  const [selected, setSelected] = useState([]);
  const [fresh, setFresh] = useState([]); // uploaded in this dialog
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(lastSort);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const { progress, upload, alive } = useUploader();
  const list = useMemo(() => (tab === 'library' ? listMedia(site, query, sort) : []), [site, query, sort, tab]);

  const finish = ids => {
    const ok = ids.filter(id => getState().site.media[id]);
    if (!ok.length) return;
    onClose();
    if (onPick) onPick(multiple ? ok : ok[0]);
  };
  const onFiles = async files => {
    if (progress) return;
    const ids = await upload(files, { limit: multiple ? 0 : 1 });
    if (!ids.length || !alive.current) return;
    if (!multiple) { finish(ids); return; }
    setFresh(f => [...f, ...ids.filter(x => !f.includes(x))]);
    setSelected(sel => [...sel, ...ids.filter(x => !sel.includes(x))]);
  };
  const choose = id => {
    if (!multiple) { finish([id]); return; }
    setSelected(sel => (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]));
  };
  const thumbs = items => html`<div class="thumbs md-pgrid">
    ${items.map(m => html`<${PickThumb} key=${m.id} m=${m} on=${selected.includes(m.id)} multiple=${multiple} onClick=${() => choose(m.id)} />`)}
  </div>`;

  const what = multiple ? 'images' : 'an image';
  const freshMedia = fresh.map(id => site.media[id]).filter(Boolean);
  const uploadPane = html`<div class="md-pane md-upload">
    <${DropZone} big compact=${freshMedia.length > 0} multiple=${multiple} progress=${progress} onFiles=${onFiles}>
      <${Icon} name="upload" size=${30} />
      <span class="md-drop-title">Drag ${what} here</span>
      <span class="md-or">or</span>
      <span class="btn small">Choose ${what} from your computer</span>
      <span class="md-drop-hint">JPEG, PNG, WebP or GIF. Large photos are resized for the web automatically. iPhone photos (HEIC) need to be exported as JPEG first.</span>
    <//>
    ${freshMedia.length ? html`<div class="subhead">Just uploaded</div><div class="md-pscroll">${thumbs(freshMedia)}</div>` : null}
  </div>`;

  const libraryPane = html`<div class="md-pane">
    <${SearchTools} query=${query} setQuery=${setQuery} sort=${sort} setSort=${setSort} />
    ${progress ? html`<div class="note md-progress"><${Spinner} /> ${progressText(progress)}</div>` : null}
    <div class="md-pscroll">
      ${list.length ? thumbs(list)
        : total ? html`<p class="md-empty">No images match "${query}".</p>`
          : html`<p class="md-empty">Your library is empty. <button type="button" class="linkbtn" onClick=${() => setTab('upload')}>Upload images</button></p>`}
    </div>
  </div>`;

  const n = selected.length;
  const footer = multiple ? html`
    <span class="left md-selinfo">${n ? html`${n} selected <button type="button" class="linkbtn" onClick=${() => setSelected([])}>Clear</button>` : 'Click images to select them.'}</span>
    <${Button} kind="secondary" onClick=${onClose}>Cancel<//>
    <${Button} disabled=${!n || !!progress} onClick=${() => finish(selected)}>${n ? `Add ${n} ${n === 1 ? 'image' : 'images'}` : 'Add images'}<//>` : null;

  const dragIn = e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setOver(true); };
  const dragOut = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); };
  return html`<${Modal} title=${multiple ? 'Add images' : 'Choose an image'} size="wide" onClose=${onClose} footer=${footer}>
    <div class="md-picker"
      onDragEnter=${dragIn}
      onDragOver=${e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave=${dragOut}
      onDrop=${e => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); onFiles(e.dataTransfer.files); }}>
      <div class="md-mtabs"><${Tabs} tabs=${[{ id: 'upload', label: 'Upload' }, { id: 'library', label: `Library (${total})` }]} value=${tab} onChange=${setTab} /></div>
      ${tab === 'upload' ? uploadPane : libraryPane}
      ${over ? html`<div class="md-dropover"><${Icon} name="upload" size=${28} /><span>Drop to upload</span></div>` : null}
    </div>
  <//>`;
}
