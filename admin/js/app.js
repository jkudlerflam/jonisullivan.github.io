// The editor's frame: left panel (website mode), top bar, the live preview with
// its overlay, floating edit panels, and the hosts for dialogs, menus and toasts.

import { html, useEffect, useRef, useState, Icon, Button, IconButton, Modal, Spinner } from './ui.js';
import {
  useStore, getState, setState, undo, redo, canUndo, canRedo, isDirty, closeModal, closeMenu, dismissToast, confirmDialog,
} from './store.js';
import { setMode, save, discardChanges, goToPage, currentPage } from './actions.js';
import { attachFrame, flushSync } from './preview.js';
import { pageFile } from '../engine/render.js';
import { Overlay } from './overlay.js';
import { FormatBar } from './formatbar.js';
import { PagesPanel, BlogPanel, PageSettingsModal, AddPageModal } from './panels/pages.js';
import { DesignPanel } from './panels/design.js';
import { HeaderPanel, FooterPanel } from './panels/header.js';
import { MediaPanel, MediaPickerModal } from './panels/media.js';
import { SettingsPanel } from './panels/settings.js';
import { HistoryPanel, ViewingBanner } from './panels/history.js';
import { HelpPanel } from './panels/help.js';
import { SectionPanel } from './panels/section.js';
import { AddSectionModal } from './panels/addsection.js';
import { BlockPanel } from './panels/blocks.js';

export function App() {
  const mode = useStore(s => s.mode);
  const [narrowOk, setNarrowOk] = useState(false);
  useShortcuts();
  if (window.innerWidth < 760 && !narrowOk) {
    return html`<div class="login"><div class="login-card">
      <h1>Use a computer to edit</h1>
      <p class="sub">The editor needs a bigger screen. Open this page on your laptop or desktop to change your website.</p>
      <${Button} kind="secondary" block onClick=${() => setNarrowOk(true)}>Continue anyway<//>
    </div></div>`;
  }
  return html`<div class="app">
    <${LeftSide} />
    <div class="main">
      ${mode === 'edit' ? html`<${TopBar} />` : null}
      <${Stage} />
    </div>
    <${Modals} />
    <${Menu} />
    <${Toasts} />
  </div>`;
}

// ---------- keyboard shortcuts in the editor itself ----------

function useShortcuts() {
  useEffect(() => {
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushSync(); save(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Escape' && !getState().modal) setState({ editPanel: null, selection: null });
    };
    window.addEventListener('keydown', onKey);
    // Like Squarespace: warn before leaving with unsaved edits (the draft would
    // survive in this browser anyway, but the warning is a reminder to Save).
    const beforeUnload = e => {
      const s = getState();
      if (s.save.status === 'saving' || (s.mode === 'edit' && isDirty(s))) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
}

// ---------- left panel (website mode) ----------

const ROOT_ITEMS = [
  { id: 'pages', label: 'Pages', icon: 'pages' },
  { id: 'design', label: 'Design', icon: 'design' },
  { id: 'media', label: 'Asset Library', icon: 'image' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
  { id: 'history', label: 'Version History', icon: 'clock' },
  { id: 'help', label: 'Help', icon: 'help' },
];

// Squarespace keeps Site Styles on the left, in both modes; otherwise the left
// side is the website panels (Pages first), hidden while editing a page.
function LeftSide() {
  const mode = useStore(s => s.mode);
  const stylesOpen = useStore(s => s.stylesOpen);
  const stylesView = useStore(s => s.stylesView);
  if (stylesOpen) {
    return html`<aside class="side styles-dock"><${DesignPanel} key=${stylesView || 'home'} onClose=${() => setState({ stylesOpen: false, stylesView: null })} /></aside>`;
  }
  return mode === 'website' ? html`<${SidePanel} />` : null;
}

function SidePanel() {
  const panel = useStore(s => s.sidePanel);
  if (panel === 'pages') return html`<${PagesPanel} />`;
  if (panel.startsWith('blog:')) return html`<${BlogPanel} blogId=${panel.slice(5)} />`;
  if (panel === 'media') return html`<${MediaPanel} />`;
  if (panel === 'settings') return html`<${SettingsPanel} />`;
  if (panel === 'history') return html`<${HistoryPanel} />`;
  if (panel === 'help') return html`<${HelpPanel} />`;
  return html`<${RootMenu} />`;
}

function RootMenu() {
  const site = useStore(s => s.site);
  const config = useStore(s => s.config);
  const open = id => {
    if (id === 'design') { setState({ stylesOpen: true }); return; }
    setState({ sidePanel: id });
  };
  return html`<aside class="side">
    <div class="root-title">
      <div class="site">${site.settings.siteName}</div>
      <a class="url" href=${config.siteRoot} target="_blank" rel="noopener">${(site.settings.url || config.siteRoot).replace(/^https?:\/\//, '').replace(/\/$/, '')} <${Icon} name="external" size=${12} /></a>
    </div>
    <ul class="root-menu">
      ${ROOT_ITEMS.map(it => html`<li><button type="button" onClick=${() => open(it.id)}><${Icon} name=${it.icon} size=${20} />${it.label}<span class="chev"><${Icon} name="chevR" size=${16} /></span></button></li>`)}
    </ul>
    <div class="side-scroll"></div>
    <div class="side-foot">
      <${SaveStatus} />
      <span style="flex:1"></span>
      <button type="button" class="linkbtn" onClick=${() => import('./main.js').then(m => m.logout())}>Log out</button>
    </div>
  </aside>`;
}

// Header used by every left panel: back arrow, title, optional actions.
export function SideHead({ title, back = 'root', children }) {
  return html`<div class="side-head">
    <${IconButton} icon="chevL" label="Back" onClick=${() => setState({ sidePanel: back })} />
    <h2>${title}</h2>
    ${children}
  </div>`;
}

// ---------- top bar ----------

function SaveStatus() {
  const save$ = useStore(s => s.save);
  const dirty = useStore(s => isDirty(s));
  const mode = useStore(s => s.mode);
  if (save$.status === 'saving') return html`<span class="status"><${Spinner} /> ${save$.message}</span>`;
  if (save$.status === 'error') return html`<span class="status error" title=${save$.message}><${Icon} name="warning" size=${14} /> ${save$.message}</span>`;
  if (dirty) return html`<span class="status dirty">${mode === 'edit' ? 'Unsaved changes' : 'Saving soon…'}</span>`;
  if (save$.status === 'deploying') return html`<span class="status"><${Spinner} /> ${save$.message}</span>`;
  if (save$.status === 'live') return html`<span class="status ok"><${Icon} name="check" size=${14} /> ${save$.message}</span>`;
  return html`<span class="status">All changes saved</span>`;
}

function DeviceToggle() {
  const device = useStore(s => s.device);
  return html`<div class="dev-toggle">
    <${IconButton} small icon="desktop" label="Desktop view" active=${device === 'desktop'} onClick=${() => setState({ device: 'desktop' })} />
    <${IconButton} small icon="mobile" label="Phone view" active=${device === 'mobile'} onClick=${() => setState({ device: 'mobile' })} />
  </div>`;
}

async function exitEditing() {
  flushSync();
  if (isDirty()) {
    const choice = await confirmDialog({
      title: 'Save your changes?',
      message: 'You made changes that are not saved yet.',
      confirmLabel: 'Save',
      cancelLabel: 'Keep editing',
      third: { label: 'Discard changes', value: 'discard' },
    });
    if (choice === true) { if (!(await save())) return; }
    else if (choice === 'discard') { await discardChanges(); }
    else return;
  }
  setMode('website');
}

function TopBar() {
  const mode = useStore(s => s.mode);
  const page = useStore(s => currentPage(s));
  const site = useStore(s => s.site);
  const config = useStore(s => s.config);
  const viewing = useStore(s => s.viewing);
  const editPanel = useStore(s => s.editPanel);
  const saving = useStore(s => s.save.status === 'saving');
  const stylesOpen = useStore(s => s.stylesOpen);
  useStore(s => s.revision);
  if (mode === 'edit') {
    return html`<header class="topbar">
      <${Button} kind="secondary" small onClick=${exitEditing}>Exit<//>
      <${Button} small disabled=${saving} onClick=${() => { flushSync(); save(); }}>Save<//>
      <span style="width:8px"></span>
      <${SaveStatus} />
      <span class="spacer"></span>
      <span class="page-name">${page ? page.title : ''}</span>
      <span class="spacer"></span>
      <${IconButton} icon="undo" label="Undo (⌘Z)" disabled=${!canUndo()} onClick=${undo} />
      <${IconButton} icon="redo" label="Redo (⇧⌘Z)" disabled=${!canRedo()} onClick=${redo} />
      <${IconButton} icon="design" label="Site Styles" active=${stylesOpen} onClick=${() => setState({ stylesOpen: !stylesOpen })} />
      <${DeviceToggle} />
    </header>`;
  }
  const href = page ? `${config.siteRoot}${pageFile(site, page) === 'index.html' ? '' : pageFile(site, page)}` : config.siteRoot;
  return html`<header class="topbar">
    ${!viewing ? html`<${Button} small icon="pencil" onClick=${() => setMode('edit')}>Edit<//>` : null}
    <span class="page-name">${page ? page.title : ''}</span>
    <a class="url-pill" href=${href} target="_blank" rel="noopener" title="Open the live page">${href.replace(/^https?:\/\//, '')} <${Icon} name="external" size=${12} /></a>
    <span class="spacer"></span>
    ${!viewing ? html`<${SaveStatus} />` : null}
    <${DeviceToggle} />
  </header>`;
}

// ---------- the stage: preview, overlay, floating panels ----------

function Stage() {
  const device = useStore(s => s.device);
  const mode = useStore(s => s.mode);
  const editPanel = useStore(s => s.editPanel);
  const viewing = useStore(s => s.viewing);
  const busy = useStore(s => s.busy);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) attachFrame(ref.current); }, []);
  return html`<div class=${`stage${mode === 'website' && !viewing ? ' website' : ''}`}>
    <div class=${`frame-wrap ${device}`}><iframe ref=${ref} title="Page preview"></iframe></div>
    ${mode === 'edit' && !viewing ? html`<${Overlay} /><${FormatBar} />` : null}
    ${mode === 'website' && !viewing ? html`<${WebsiteControls} />` : null}
    ${viewing ? html`<${ViewingBanner} />` : null}
    ${mode === 'edit' && editPanel ? html`<${EditPanel} panel=${editPanel} />` : null}
    ${busy ? html`<div class="banner" style="top:auto;bottom:18px"><${Spinner} /> ${busy}</div>` : null}
  </div>`;
}

// Over the preview outside edit mode, as in Squarespace: EDIT at the top left,
// Site Styles, phone view and the live page at the top right.
function WebsiteControls() {
  const page = useStore(s => currentPage(s));
  const site = useStore(s => s.site);
  const config = useStore(s => s.config);
  const stylesOpen = useStore(s => s.stylesOpen);
  const href = page ? `${config.siteRoot}${pageFile(site, page) === 'index.html' ? '' : pageFile(site, page)}` : config.siteRoot;
  return html`
    <div class="web-edit"><button type="button" class="btn" onClick=${() => setMode('edit')}>EDIT</button></div>
    <div class="web-tools">
      <${IconButton} icon="design" label="Site Styles" active=${stylesOpen} onClick=${() => setState({ stylesOpen: !stylesOpen })} />
      <${DeviceToggle} />
      <a class="ibtn" href=${href} target="_blank" rel="noopener" title="Open the live page" aria-label="Open the live page"><${Icon} name="external" size=${17} /></a>
    </div>`;
}

function EditPanel({ panel }) {
  const close = () => setState({ editPanel: null });
  if (panel.kind === 'section') return html`<${SectionPanel} key=${panel.id} sectionId=${panel.id} tab=${panel.tab} itemId=${panel.itemId} onClose=${close} />`;
  if (panel.kind === 'block') return html`<${BlockPanel} key=${panel.blockId} sectionId=${panel.id} blockId=${panel.blockId} onClose=${close} />`;
  if (panel.kind === 'styles') return html`<${DesignPanel} onClose=${close} />`;
  if (panel.kind === 'header') return html`<${HeaderPanel} onClose=${close} />`;
  if (panel.kind === 'footer') return html`<${FooterPanel} onClose=${close} />`;
  return null;
}

// ---------- dialogs, menus, toasts ----------

function Modals() {
  const modal = useStore(s => s.modal);
  if (!modal) return null;
  switch (modal.kind) {
    case 'confirm': return html`<${ConfirmModal} ...${modal} />`;
    case 'mediaPicker': return html`<${MediaPickerModal} ...${modal} onClose=${closeModal} />`;
    case 'addSection': return html`<${AddSectionModal} ...${modal} onClose=${closeModal} />`;
    case 'pageSettings': return html`<${PageSettingsModal} ...${modal} onClose=${closeModal} />`;
    case 'addPage': return html`<${AddPageModal} ...${modal} onClose=${closeModal} />`;
    default: return null;
  }
}

function ConfirmModal({ title, message, confirmLabel, cancelLabel, danger, third, resolve }) {
  const done = v => { closeModal(); resolve(v); };
  return html`<${Modal} title=${title} onClose=${() => done(false)} footer=${html`
    ${third ? html`<${Button} kind="ghost" class="btn ghost left" onClick=${() => done(third.value)}>${third.label}<//>` : null}
    <${Button} kind="secondary" onClick=${() => done(false)}>${cancelLabel}<//>
    <${Button} kind=${danger ? 'danger' : ''} onClick=${() => done(true)} autofocus>${confirmLabel}<//>`}>
    <p style="margin:0;color:var(--ui-ink-2)">${message}</p>
  <//>`;
}

function Menu() {
  const menu = useStore(s => s.menu);
  useEffect(() => {
    if (!menu) return;
    const close = e => { if (!e.target.closest('.menu')) closeMenu(); };
    const esc = e => { if (e.key === 'Escape') closeMenu(); };
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);
  if (!menu) return null;
  const left = Math.min(menu.x, window.innerWidth - 230);
  const top = Math.min(menu.y, window.innerHeight - 40 * menu.items.length - 20);
  return html`<div class="menu" style=${`left:${left}px;top:${top}px`} role="menu">
    ${menu.items.map(it => (it === 'sep' ? html`<div class="menu-sep"></div>`
      : it.note ? html`<div class="menu-note">${it.note}</div>`
        : html`<button type="button" role="menuitem" class=${it.danger ? 'danger' : ''} onClick=${() => { closeMenu(); it.onClick(); }}>
          ${it.icon ? html`<${Icon} name=${it.icon} size=${16} />` : null}${it.label}</button>`))}
  </div>`;
}

function Toasts() {
  const toasts = useStore(s => s.toasts);
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map(t => html`<div class=${`toast ${t.kind}`}>
      <span>${t.message}</span>
      ${t.action ? html`<button type="button" class="linkbtn" onClick=${() => { dismissToast(t.id); t.action.onClick(); }}>${t.action.label}</button>` : null}
      <button type="button" class="linkbtn" style="color:#bbb" aria-label="Dismiss" onClick=${() => dismissToast(t.id)}>✕</button>
    </div>`)}
  </div>`;
}

export { goToPage };
