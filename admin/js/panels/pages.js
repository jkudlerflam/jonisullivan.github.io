// Pages panel (Main Navigation, Not Linked, Deleted Pages), article
// collections, the Add Page dialog and Page Settings. Modeled on Squarespace's
// Pages panel: search at the top right, arrows that fold a section, dropdowns
// for menu items with pages under them, and deleted pages kept for 30 days.

import {
  html, useState, useEffect, useRef, Icon, IconButton, Button, Field, TextInput, Toggle, Segmented, Slider, Modal, Tabs, ImageField,
  timeAgo,
} from '../ui.js';
import { useStore, getState, setState, updateSite, openModal, openMenu, confirmDialog, toast } from '../store.js';
import {
  goToPage, addPage, duplicatePage, deletePage, updatePage, setHomePage, moveNav, unlinkPage, addNavItem,
  updateNavItem, removeNavItem, findSection,
} from '../actions.js';
import { PAGE_TEMPLATES, slugify, isValidSlug, formatDate, navPageIds, uniqueSlug, uid } from '../../engine/schema.js';
import { pageTitle } from '../../engine/render.js';
import { SideHead } from '../app.js';

// ---------- drag and drop state shared by the rows ----------

let dragData = null; // { itemId } for menu items, { pageId } for unlinked pages

function dropZone(e, allowInto) {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (allowInto && y > 0.28 && y < 0.72) return 'into';
  return y < 0.5 ? 'before' : 'after';
}

function Row({ icon, name, off, tags, current, child, acts, onClick, drag, title }) {
  const [zone, setZone] = useState(null);
  const cls = ['prow', current ? 'current' : '', child ? 'child' : '', zone ? `drop-${zone}` : ''].filter(Boolean).join(' ');
  return html`<li class=${cls} title=${title} onClick=${onClick}
    draggable=${!!drag} onDragStart=${drag ? e => { dragData = drag.data; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x'); e.currentTarget.classList.add('dragging'); } : null}
    onDragEnd=${e => { e.currentTarget.classList.remove('dragging'); dragData = null; setZone(null); }}
    onDragOver=${drag ? e => { if (!dragData || !drag.accept(dragData)) return; e.preventDefault(); const z = dropZone(e, drag.into); if (z !== zone) setZone(z); } : null}
    onDragLeave=${() => setZone(null)}
    onDrop=${drag ? e => { e.preventDefault(); const z = dropZone(e, drag.into); setZone(null); if (dragData && drag.accept(dragData)) drag.onDrop(dragData, z); dragData = null; } : null}>
    <span class="pic"><${Icon} name=${icon} size=${17} /></span>
    <span class=${`pname${off ? ' off' : ''}`}>${name}</span>
    ${tags}
    <span class="acts" onClick=${e => e.stopPropagation()}>${acts}</span>
  </li>`;
}

// ---------- Pages panel ----------

const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const folded = { nav: false, unlinked: false }; // folded sections, kept while the editor is open

// Pages in the trash that can still be restored.
function restorable(site, now = Date.now()) {
  return (site.trash || []).filter(e => e && e.page && now - Date.parse(e.deletedAt) < TRASH_DAYS * DAY);
}

export function PagesPanel() {
  const site = useStore(s => s.site);
  const pageId = useStore(s => s.pageId);
  const [view, setView] = useState('pages'); // 'pages' | 'trash'
  const [search, setSearch] = useState(null); // null while the search box is closed
  const [, redraw] = useState(0);
  const searchRef = useRef(null);
  useEffect(() => { if (search === '' && searchRef.current) searchRef.current.focus(); }, [search === null]);
  if (view === 'trash') return html`<${DeletedPages} onBack=${() => setView('pages')} />`;

  const linked = new Set(navPageIds(site));
  const q = (search || '').trim().toLowerCase();
  const hits = p => !q || [p.title, p.navTitle, p.slug].some(v => String(v || '').replace(/\s+/g, ' ').toLowerCase().includes(q));
  const unlinked = site.pages.filter(p => p.kind !== 'post' && !linked.has(p.id) && hits(p));
  const fold = key => { folded[key] = !folded[key]; redraw(n => n + 1); };
  const navOpen = !!q || !folded.nav;
  const unlinkedOpen = !!q || !folded.unlinked;
  const closeSearch = () => setSearch(null);

  const addMenu = (e, where) => {
    const items = [
      { label: 'Page', icon: 'pages', onClick: () => openModal('addPage', { where }) },
      { label: 'Article collection (blog)', icon: 'posts', onClick: () => openModal('addPage', { where, template: 'blog' }) },
    ];
    if (where === 'nav') {
      items.push('sep',
        { label: 'Dropdown', icon: 'folder', onClick: addDropdown },
        { label: 'Link', icon: 'link', onClick: () => addNavItem('link', { label: 'New link', url: 'https://', newTab: true }) },
        { label: 'Spacer', icon: 'spacer', onClick: () => addNavItem('spacer') });
    }
    openMenu(e.currentTarget, items);
  };

  const top = site.nav;
  const dropOnNav = (target, parentId, index) => (data, zone) => {
    if (zone === 'into' && target.type === 'folder') {
      moveNav(data, target.id, (target.children || []).length);
      return;
    }
    const list = parentId ? (top.find(n => n.id === parentId)?.children || []) : top;
    let i = index + (zone === 'after' ? 1 : 0);
    const from = data.itemId ? list.findIndex(n => n.id === data.itemId) : -1;
    if (from >= 0 && from < i) i -= 1;
    moveNav(data, parentId, i);
  };
  const acceptNav = parentId => data => {
    if (!parentId) return true;
    const it = data.itemId && findNav(site.nav, data.itemId);
    return !it || it.type !== 'folder';
  };

  // While searching, rows can't be dragged and only matching pages show.
  const pageRow = (it, parentId, index) => {
    const p = site.pages.find(x => x.id === it.page);
    if (!p || !hits(p)) return null;
    return html`<${PageRow} key=${it.id} page=${p} site=${site} current=${p.id === pageId} child=${!!parentId}
      drag=${q ? null : { data: { itemId: it.id }, accept: acceptNav(parentId), into: false, onDrop: dropOnNav(it, parentId, index) }} />`;
  };

  const rows = [];
  top.forEach((it, i) => {
    if (it.type === 'page') rows.push(pageRow(it, null, i));
    else if (it.type === 'folder') {
      const kids = (it.children || []).map((c, j) => (c.type === 'page' ? pageRow(c, it.id, j) : q ? null : navMiscRow(c, it.id, j, dropOnNav, acceptNav)));
      if (q && !kids.some(Boolean) && !String(it.label || '').toLowerCase().includes(q)) return;
      rows.push(html`<${Row} key=${it.id} icon="folder" name=${it.label || 'Dropdown'} title="Dropdown: its pages open from this menu item"
        drag=${q ? null : { data: { itemId: it.id }, accept: () => true, into: true, onDrop: dropOnNav(it, null, i) }}
        acts=${html`<${IconButton} small icon="gear" label="Dropdown settings" onClick=${() => editNavItem(it)} /><${IconButton} small icon="trash" label="Remove dropdown" onClick=${() => removeDropdown(it)} />`} />`);
      rows.push(...kids);
    } else if (!q) rows.push(navMiscRow(it, null, i, dropOnNav, acceptNav));
  });
  const shownRows = rows.filter(Boolean);
  const none = !!q && !shownRows.length && !unlinked.length;
  const trashCount = restorable(site).length;

  return html`<aside class="side">
    <${SideHead} title="Pages">
      <${IconButton} icon="search" label="Search pages" active=${search !== null} onClick=${() => setSearch(search === null ? '' : null)} />
    </${SideHead}>
    ${search !== null ? html`<div class="pg-search">
      <${Icon} name="search" size=${15} />
      <input ref=${searchRef} class="input" type="search" placeholder="Search by title or web address" aria-label="Search pages" value=${search}
        onInput=${e => setSearch(e.target.value)} onKeyDown=${e => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } }} />
      <${IconButton} small icon="x" label="Close search" onClick=${closeSearch} />
    </div>` : null}
    <div class="side-scroll">
      <div class="plist-head">
        <button type="button" class="pg-fold" aria-expanded=${navOpen ? 'true' : 'false'} disabled=${!!q} onClick=${() => fold('nav')}>
          Main Navigation <${Icon} name=${navOpen ? 'chevD' : 'chevR'} size=${13} />
        </button>
        <${IconButton} small icon="plus" label="Add to Main Navigation" onClick=${e => addMenu(e, 'nav')} />
      </div>
      ${navOpen ? html`<ul class="plist" data-list="nav"
        onDragOver=${e => { if (dragData && !e.target.closest('.prow')) e.preventDefault(); }}
        onDrop=${e => { if (dragData && !e.target.closest('.prow')) { e.preventDefault(); moveNav(dragData, null, top.length); dragData = null; } }}>
        ${shownRows}
        ${!shownRows.length && !none ? html`<li class="plist-empty">${q ? 'No pages in the menu match.' : 'Drag pages here to show them in the menu.'}</li>` : null}
      </ul>` : null}
      <div class="plist-head pg-gap">
        <button type="button" class="pg-fold" aria-expanded=${unlinkedOpen ? 'true' : 'false'} disabled=${!!q} onClick=${() => fold('unlinked')}>
          Not Linked <${Icon} name=${unlinkedOpen ? 'chevD' : 'chevR'} size=${13} />
        </button>
        <${IconButton} small icon="plus" label="Add a page that is not in the menu" onClick=${e => addMenu(e, 'unlinked')} />
      </div>
      ${unlinkedOpen ? html`<ul class="plist" data-list="unlinked"
        onDragOver=${e => { if (dragData && dragData.itemId) { const it = findNav(site.nav, dragData.itemId); if (it?.type === 'page') e.preventDefault(); } }}
        onDrop=${e => { if (dragData?.itemId) { const it = findNav(site.nav, dragData.itemId); if (it?.type === 'page') { e.preventDefault(); unlinkPage(it.page); } } dragData = null; }}>
        ${unlinked.map(p => html`<${PageRow} key=${p.id} page=${p} site=${site} current=${p.id === pageId}
          drag=${q ? null : { data: { pageId: p.id }, accept: () => false, into: false, onDrop: () => {} }} />`)}
        ${q && (unlinked.length || none) ? null : html`<li class="plist-empty">${q ? 'No pages outside the menu match.' : unlinked.length ? 'These pages are published but not in the menu.' : 'Drag a page here to take it out of the menu without deleting it.'}</li>`}
      </ul>` : null}
      ${none ? html`<p class="pg-noresults">No pages match "${search.trim()}". Try part of the title or the web address.</p>` : null}
      <div class="pg-trashlink-wrap">
        <button type="button" class="prow pg-trashlink" onClick=${() => { setSearch(null); setView('trash'); }}>
          <span class="pic"><${Icon} name="trash" size=${17} /></span>
          <span class="pname">Deleted Pages</span>
          ${trashCount ? html`<span class="tag">${trashCount}</span>` : null}
          <${Icon} name="chevR" size=${16} />
        </button>
      </div>
    </div>
  </aside>`;
}

function findNav(items, id) {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.children) { const f = findNav(it.children, id); if (f) return f; }
  }
  return null;
}

function navMiscRow(it, parentId, index, dropOnNav, acceptNav) {
  const isLink = it.type === 'link';
  return html`<${Row} key=${it.id} child=${!!parentId} icon=${isLink ? 'link' : 'spacer'} name=${isLink ? (it.label || it.url) : 'Spacer'}
    drag=${{ data: { itemId: it.id }, accept: acceptNav(parentId), into: false, onDrop: dropOnNav(it, parentId, index) }}
    acts=${html`${isLink ? html`<${IconButton} small icon="gear" label="Link settings" onClick=${() => editNavItem(it)} />` : null}<${IconButton} small icon="trash" label="Remove" onClick=${() => removeNavItem(it.id)} />`} />`;
}

function editNavItem(it) {
  openModal('pageSettings', { navItemId: it.id });
}

// A dropdown is a menu item with pages under it (stored as a 'folder').
function addDropdown() {
  updateSite(site => { site.nav.push({ id: uid('n'), type: 'folder', label: 'Dropdown', children: [] }); }, { label: 'add dropdown' });
}

async function removeDropdown(it) {
  if ((it.children || []).length) {
    const ok = await confirmDialog({
      title: `Remove the dropdown "${it.label || 'Dropdown'}"?`,
      message: 'The pages in it stay in the menu, where the dropdown was. No pages are deleted.',
      confirmLabel: 'Remove dropdown',
    });
    if (!ok) return;
  }
  updateSite(site => {
    const i = site.nav.findIndex(n => n.id === it.id);
    if (i < 0) return;
    const [gone] = site.nav.splice(i, 1);
    site.nav.splice(i, 0, ...(gone.children || []));
  }, { label: 'remove dropdown' });
}

function PageRow({ page, site, current, child, drag }) {
  const home = page.id === site.settings.homePage;
  const blog = page.kind === 'blog';
  const open = () => {
    goToPage(page.id);
    if (blog) setState({ sidePanel: `blog:${page.id}` });
  };
  return html`<${Row} icon=${home ? 'home' : blog ? 'posts' : 'pages'} name=${page.navTitle ? page.navTitle.replace(/\n/g, ' ') : page.title} off=${page.disabled}
    current=${current} child=${child} onClick=${open} drag=${drag} title=${home ? 'Homepage' : page.disabled ? 'Disabled: not on the live site' : ''}
    tags=${blog ? html`<span class="tag">${site.pages.filter(p => p.parent === page.id).length}</span>` : null}
    acts=${html`
      <${IconButton} small icon="gear" label="Page settings" onClick=${() => openModal('pageSettings', { pageId: page.id })} />
      ${!home ? html`<${IconButton} small icon="trash" label="Delete page" onClick=${() => deletePage(page.id)} />` : null}
      ${blog ? html`<${IconButton} small icon="chevR" label="Articles" onClick=${open} />` : null}`} />`;
}

// ---------- Deleted Pages ----------

function DeletedPages({ onBack }) {
  const site = useStore(s => s.site);
  const entries = restorable(site);
  const all = (site.trash || []).length;
  const describe = e => {
    if (e.page.kind === 'post') {
      const blog = site.pages.find(p => p.id === e.page.parent) || (site.trash || []).find(x => x.page?.id === e.page.parent)?.page;
      return blog ? `Article in ${blog.title}` : 'Article';
    }
    const n = (e.posts || []).length;
    if (e.page.kind === 'blog') return `Collection with ${n} article${n === 1 ? '' : 's'}`;
    return 'Page';
  };
  const empty = async () => {
    const ok = await confirmDialog({
      title: 'Empty the trash?',
      message: all === 1 ? 'The deleted page will be gone for good. It can no longer be restored.' : `All ${all} deleted pages will be gone for good. They can no longer be restored.`,
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return;
    updateSite(s => { s.trash = []; }, { label: 'empty trash' });
    toast('The trash is empty.');
  };
  return html`<aside class="side">
    <div class="side-head">
      <${IconButton} icon="chevL" label="Back to Pages" onClick=${onBack} />
      <h2>Deleted Pages</h2>
    </div>
    <div class="side-scroll">
      <p class="pg-trash-note">Pages you delete stay here for ${TRASH_DAYS} days. A restored page goes to Not Linked, and you can drag it back into the menu.</p>
      <ul class="plist">
        ${entries.map(e => html`<li key=${`${e.page.id}:${e.deletedAt}`} class="prow pg-trashrow" data-page=${e.page.id}>
          <span class="pic"><${Icon} name=${e.page.kind === 'blog' ? 'posts' : 'pages'} size=${17} /></span>
          <span class="pg-trashinfo">
            <span class="pname">${e.page.title || 'Untitled'}</span>
            <span class="pg-trashwhen">${describe(e)}. Deleted ${timeAgo(e.deletedAt)}</span>
          </span>
          <${Button} small kind="secondary" onClick=${() => restorePage(e)}>Restore<//>
        </li>`)}
        ${!entries.length ? html`<li class="plist-empty">No deleted pages.</li>` : null}
      </ul>
      ${all ? html`<div class="pg-trashfoot">
        <${Button} small kind="secondary" icon="trash" class="btn secondary small se-danger" onClick=${empty}>Empty trash<//>
      </div>` : null}
    </div>
  </aside>`;
}

// Puts a deleted page (and a collection's articles) back, outside the menu.
function restorePage(entry) {
  let restored = null;
  let asPage = false;
  updateSite(site => {
    const i = (site.trash || []).findIndex(e => e?.page?.id === entry.page.id && e.deletedAt === entry.deletedAt);
    if (i < 0) return;
    const [e] = site.trash.splice(i, 1);
    const page = e.page;
    const posts = e.posts || [];
    if (site.pages.some(p => p.id === page.id)) {
      const id = uid('p');
      for (const p of posts) p.parent = id;
      page.id = id;
    }
    for (const p of [page, ...posts]) {
      const taken = site.pages.some(x => x.slug === p.slug) || (site.redirects || []).some(r => r.from === `${p.slug}.html`);
      if (taken || !isValidSlug(p.slug)) p.slug = uniqueSlug(site, p.slug || p.title);
    }
    // An article whose collection is gone comes back as an ordinary page.
    if (page.kind === 'post' && !site.pages.some(p => p.id === page.parent)) {
      page.kind = 'page';
      delete page.parent;
      delete page.post;
      asPage = true;
    }
    site.pages.push(page, ...posts);
    // Old addresses that led to the page, unless something else uses them now.
    for (const r of e.redirects || []) {
      const used = site.redirects.some(x => x.from === r.from) || site.pages.some(p => `${p.slug}.html` === r.from);
      if (!used && site.pages.some(p => p.id === r.to)) site.redirects.push(r);
    }
    // Article lists that showed this collection show it again.
    for (const sid of e.links || []) {
      const hit = findSection(site, sid);
      if (hit && hit.section.type === 'posts' && !hit.section.blog) hit.section.blog = page.id;
    }
    restored = page;
  }, { label: 'restore page' });
  if (!restored) return;
  const where = restored.kind === 'post' ? 'its collection' : 'Not Linked';
  toast(asPage ? `Restored "${restored.title}" as a page, in Not Linked. Its collection was deleted.` : `Restored "${restored.title}" to ${where}.`);
}

// ---------- article collection (blog) panel ----------

export function BlogPanel({ blogId }) {
  const site = useStore(s => s.site);
  const pageId = useStore(s => s.pageId);
  const blog = site.pages.find(p => p.id === blogId);
  if (!blog) { setState({ sidePanel: 'pages' }); return null; }
  const posts = site.pages.filter(p => p.parent === blogId)
    .sort((a, b) => (b.post?.date || '').localeCompare(a.post?.date || ''));
  return html`<aside class="side">
    <${SideHead} title=${blog.title} back="pages">
      <${IconButton} icon="gear" label="Collection settings" onClick=${() => openModal('pageSettings', { pageId: blogId })} />
      <${IconButton} icon="plus" label="New article" onClick=${() => { const p = addPage({ title: 'New article', blogId }); setState({ mode: 'edit' }); openModal('pageSettings', { pageId: p.id, tab: 'article' }); }} />
    </${SideHead}>
    <div class="side-scroll">
      <button type="button" class="prow" style="width:calc(100% - 16px);margin:4px 8px 8px;border:0;background:${pageId === blogId ? 'var(--ui-blue-weak)' : 'none'}" onClick=${() => goToPage(blogId)}>
        <span class="pic"><${Icon} name="posts" size=${17} /></span><span class="pname">Article list page</span>
      </button>
      <div class="plist-head"><span>Articles</span></div>
      <ul class="plist">
        ${posts.map(p => html`<li key=${p.id} class=${`prow post-row${p.id === pageId ? ' current' : ''}`} onClick=${() => goToPage(p.id)}>
          <span class="pname">${p.post?.title || p.title}</span>
          ${p.post?.draft ? html`<span class="tag draft">Draft</span>` : html`<span class="pdate">${formatDate(p.post?.date)}</span>`}
          <span class="acts" onClick=${e => e.stopPropagation()}>
            <${IconButton} small icon="gear" label="Article settings" onClick=${() => openModal('pageSettings', { pageId: p.id, tab: 'article' })} />
            <${IconButton} small icon="trash" label="Delete article" onClick=${() => deletePage(p.id)} />
          </span>
        </li>`)}
        ${!posts.length ? html`<li class="plist-empty">No articles yet. Click + to write one.</li>` : null}
      </ul>
    </div>
  </aside>`;
}

// ---------- Add Page dialog ----------

function TemplatePic({ id }) {
  const g = '#d9d9d9';
  const k = '#bdbdbd';
  const pics = {
    blank: html`<rect x="60" y="45" width="40" height="3" rx="1.5" fill=${g}/>`,
    gallery: html`<rect x="45" y="12" width="70" height="40" fill=${g}/><rect x="45" y="58" width="70" height="40" fill=${g}/>`,
    grid: html`${[0, 1, 2].map(c => [0, 1].map(r => html`<rect x=${30 + c * 35} y=${14 + r * 38} width="30" height="32" fill=${g}/>`))}`,
    exhibition: html`<rect x="40" y="10" width="80" height="40" fill=${g}/><rect x="40" y="56" width="50" height="3" fill=${k}/><rect x="40" y="63" width="80" height="3" fill=${g}/><rect x="40" y="69" width="76" height="3" fill=${g}/><rect x="40" y="78" width="80" height="22" fill=${g}/>`,
    text: html`<rect x="35" y="16" width="60" height="7" fill=${k}/>${[0, 1, 2, 3, 4, 5].map(i => html`<rect x="35" y=${32 + i * 8} width=${i === 5 ? 50 : 90} height="3" fill=${g}/>`)}`,
    contact: html`${[0, 1, 2].map(i => html`<rect x="35" y=${14 + i * 8} width=${50 - i * 8} height="3" fill=${g}/>`)}<rect x="35" y="44" width="90" height="10" rx="2" fill="none" stroke=${k}/><rect x="35" y="58" width="90" height="10" rx="2" fill="none" stroke=${k}/><rect x="35" y="72" width="90" height="18" rx="2" fill="none" stroke=${k}/>`,
    cv: html`${[0, 1].map(gp => html`<rect x="30" y=${12 + gp * 44} width="40" height="4" fill=${k}/>${[0, 1, 2].map(i => html`<rect x="30" y=${22 + gp * 44 + i * 8} width="12" height="3" fill=${g}/><rect x="48" y=${22 + gp * 44 + i * 8} width=${70 - i * 10} height="3" fill=${g}/>`)}`)}`,
    blog: html`${[0, 1].map(i => html`<rect x="35" y=${10 + i * 50} width="45" height="6" fill=${k}/><rect x="35" y=${20 + i * 50} width="90" height="26" fill=${g}/>`)}`,
  };
  return html`<svg viewBox="0 0 160 110" preserveAspectRatio="xMidYMid meet">${pics[id] || pics.blank}</svg>`;
}

export function AddPageModal({ where = 'nav', folderId = null, template: preset = null, onClose }) {
  const [template, setTemplate] = useState(preset || 'blank');
  const [title, setTitle] = useState(preset === 'blog' ? 'Writing' : '');
  const create = () => {
    const t = title.trim() || PAGE_TEMPLATES.find(x => x.id === template)?.label || 'New page';
    const p = addPage({ template, title: t, where, folderId });
    onClose();
    if (template === 'blog') setState({ sidePanel: `blog:${p.id}` });
  };
  return html`<${Modal} title="Add a page" size="medium" onClose=${onClose} footer=${html`
    <${Button} kind="secondary" onClick=${onClose}>Cancel<//>
    <${Button} onClick=${create}>Add page<//>`}>
    <${Field} label="Page title"><${TextInput} value=${title} onChange=${setTitle} placeholder="For example: Drawings" autoFocus onEnter=${create} /><//>
    <div class="subhead">Start with a layout</div>
    <div class="cards" style="grid-template-columns:repeat(4,1fr)">
      ${PAGE_TEMPLATES.map(t => html`<button type="button" class=${`card-opt${t.id === template ? ' on' : ''}`} onClick=${() => setTemplate(t.id)} onDblClick=${() => { setTemplate(t.id); setTimeout(create, 0); }}>
        <span class="pic"><${TemplatePic} id=${t.id} /></span>
        <b>${t.label}</b><span class="muted">${t.description}</span>
      </button>`)}
    </div>
    <p class="help">${where === 'nav' ? 'The new page will appear in the menu. You can drag it anywhere in the Pages panel.' : 'The new page will be published but not linked from the menu.'}</p>
  <//>`;
}

// ---------- Page Settings ----------

export function PageSettingsModal({ pageId, navItemId, tab: initialTab, onClose }) {
  if (navItemId) return html`<${NavItemSettings} itemId=${navItemId} onClose=${onClose} />`;
  const site = useStore(s => s.site);
  const page = site.pages.find(p => p.id === pageId);
  const [tab, setTab] = useState(initialTab || 'general');
  if (!page) return null;
  const isPost = page.kind === 'post';
  const tabs = [
    ...(isPost ? [{ id: 'article', label: 'Article' }] : []),
    { id: 'general', label: 'General' },
    { id: 'seo', label: 'SEO' },
    { id: 'social', label: 'Social image' },
  ];
  const set = (patch, label) => updatePage(pageId, patch, { label });
  return html`<${Modal} title=${isPost ? 'Article settings' : 'Page settings'} size="medium" onClose=${onClose} footer=${html`
    <${Button} onClick=${onClose}>Done<//>`}>
    <div style="margin:-6px -24px 18px"><${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} /></div>
    ${tab === 'article' ? html`<${ArticleTab} page=${page} set=${set} />` : null}
    ${tab === 'general' ? html`<${GeneralTab} page=${page} site=${site} set=${set} onClose=${onClose} />` : null}
    ${tab === 'seo' ? html`<${SeoTab} page=${page} site=${site} set=${set} />` : null}
    ${tab === 'social' ? html`
      <${Field} label="Image shown when this page is shared" help="Used by Facebook, iMessage, Instagram links and others. If empty, the first image on the page is used.">
        <${ImageField} value=${page.socialImage} onChange=${id => set({ socialImage: id }, 'social image')} />
      <//>` : null}
  <//>`;
}

function GeneralTab({ page, site, set, onClose }) {
  const home = page.id === site.settings.homePage;
  const [slug, setSlug] = useState(page.slug);
  const taken = site.pages.some(p => p.id !== page.id && p.slug === slug);
  const slugError = !isValidSlug(slug) ? 'Use lowercase letters, numbers and dashes.' : taken ? 'Another page already uses this address.' : '';
  const base = (site.settings.url || getState().config.siteRoot).replace(/\/?$/, '/').replace(/^https?:\/\//, '');
  return html`
    <${Field} label="Page title"><${TextInput} value=${page.title} onChange=${v => set({ title: v, ...(page.kind === 'post' && page.post?.title === page.title ? { post: { title: v } } : {}) }, 'page title')} /><//>
    ${page.kind !== 'post' ? html`<${Field} label="Navigation title" help="What the menu shows. Leave empty to use the page title. Press Return for a line break.">
      <${TextInput} multiline rows=${2} value=${page.navTitle} placeholder=${page.title} onChange=${v => set({ navTitle: v }, 'navigation title')} /><//>` : null}
    <${Field} label="Web address" help=${home ? 'This is your homepage, so it is shown at the main address.' : (slugError || 'Links to the old address keep working.')}>
      <div class="row" style="gap:6px">
        <span class="muted" style="flex:none;font-size:12.5px">${base}</span>
        <input class="input" style="flex:1" value=${slug} disabled=${home} onInput=${e => setSlug(slugify(e.target.value) === 'page' && !e.target.value ? '' : e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          onBlur=${() => { if (!slugError && slug !== page.slug) set({ slug }, 'web address'); else setSlug(page.slug); }} />
        <span class="muted" style="flex:none;font-size:12.5px">.html</span>
      </div>
    <//>
    <${Toggle} label="Enable page" help="Turn off to hide the page from the live site without deleting it." checked=${!page.disabled}
      onChange=${on => { if (!on && home) return; set({ disabled: !on }, on ? 'enable page' : 'disable page'); }} />
    <div class="subhead">Page layout</div>
    <${Field} label="Content width" value=${page.width ? `${page.width}px` : 'Full'}>
      <${Segmented} value=${page.width ? 'custom' : 'full'} options=${[{ value: 'full', label: 'Full width' }, { value: 'custom', label: 'Limited' }]}
        onChange=${v => set({ width: v === 'full' ? null : (page.width || 900) }, 'page width')} />
    <//>
    ${page.width ? html`<${Field}><${Slider} value=${page.width} min=${400} max=${1600} step=${10} unit="px" onChange=${w => set({ width: w }, 'page width')} /><//>
      <${Field} label="Position"><${Segmented} value=${page.align} options=${[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centered' }]} onChange=${a => set({ align: a }, 'page position')} /><//>` : null}
    <div class="subhead">More</div>
    <div class="row" style="flex-wrap:wrap;gap:8px">
      ${!home && page.kind !== 'post' ? html`<${Button} kind="secondary" small icon="home" onClick=${() => setHomePage(page.id)}>Set as homepage<//>` : null}
      <${Button} kind="secondary" small icon="copy" onClick=${() => { onClose(); duplicatePage(page.id); }}>Duplicate<//>
      ${!home ? html`<${Button} kind="secondary" small icon="trash" onClick=${() => { onClose(); deletePage(page.id); }}>Delete<//>` : null}
    </div>`;
}

function SeoTab({ page, site, set }) {
  const shown = page.seoTitle || pageTitle(site, { ...page, seoTitle: '' });
  const desc = page.description || site.settings.description || '';
  const url = `${(site.settings.url || '').replace(/\/$/, '')}/${page.id === site.settings.homePage ? '' : `${page.slug}.html`}`;
  return html`
    <${Field} label="SEO title" help="The title shown in search results and browser tabs.">
      <${TextInput} value=${page.seoTitle} placeholder=${pageTitle(site, { ...page, seoTitle: '' })} onChange=${v => set({ seoTitle: v }, 'SEO title')} /><//>
    <${Field} label="SEO description" value=${`${(page.description || '').length} / 160`} help="One or two sentences describing the page for Google.">
      <${TextInput} multiline rows=${3} value=${page.description} placeholder=${site.settings.description || 'Describe this page…'} onChange=${v => set({ description: v }, 'SEO description')} /><//>
    <div class="subhead">Search result preview</div>
    <div style="padding:14px 16px;border:1px solid var(--ui-line);border-radius:10px;font-family:arial,sans-serif">
      <div style="font-size:12px;color:#202124">${url.replace(/^https?:\/\//, '')}</div>
      <div style="font-size:18px;color:#1a0dab;margin:2px 0">${shown}</div>
      <div style="font-size:13px;color:#4d5156">${desc || html`<i class="muted">No description yet.</i>`}</div>
    </div>`;
}

function ArticleTab({ page, set }) {
  const post = page.post || {};
  const plain = String(post.excerpt || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const escape = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return html`
    <${Toggle} label="Published" help=${post.draft ? 'Draft: only you can see it, in the editor.' : 'Visible on the site and in the article list.'}
      checked=${!post.draft} onChange=${on => set({ post: { draft: !on } }, on ? 'publish article' : 'unpublish article')} />
    <${Field} label="Title in the article list"><${TextInput} value=${post.title} onChange=${v => set({ post: { title: v } }, 'article title')} /><//>
    <${Field} label="Subtitle" help="For example the artist and venue."><${TextInput} value=${post.subtitle} onChange=${v => set({ post: { subtitle: v } }, 'article subtitle')} /><//>
    <${Field} label="Date" help="Articles are listed newest first.">
      <input class="input" type="date" value=${post.date || ''} onInput=${e => set({ post: { date: e.target.value } }, 'article date')} /><//>
    <${Field} label="Short excerpt"><${TextInput} multiline rows=${2} value=${plain} onChange=${v => set({ post: { excerpt: escape(v) } }, 'article excerpt')} /><//>
    <${Field} label="Thumbnail" help="Shown in the article list.">
      <${ImageField} value=${post.image} onChange=${id => set({ post: { image: id } }, 'article thumbnail')} /><//>`;
}


function NavItemSettings({ itemId, onClose }) {
  const site = useStore(s => s.site);
  const it = findNav(site.nav, itemId);
  if (!it) return null;
  const dropdown = it.type === 'folder';
  return html`<${Modal} title=${dropdown ? 'Dropdown settings' : 'Link settings'} onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Done<//>`}>
    <${Field} label=${dropdown ? 'Dropdown title' : 'Link title'} help=${dropdown ? 'Shown in the menu. The pages in the dropdown appear under it.' : 'Press Return for a line break.'}>
      <${TextInput} multiline=${!dropdown} rows=${2} value=${it.label} onChange=${v => updateNavItem(itemId, { label: v })} /><//>
    ${it.type === 'link' ? html`
      <${Field} label="Web address"><${TextInput} value=${it.url} onChange=${v => updateNavItem(itemId, { url: v })} placeholder="https://instagram.com/…" /><//>
      <${Toggle} label="Open in a new tab" checked=${!!it.newTab} onChange=${v => updateNavItem(itemId, { newTab: v })} />` : null}
  <//>`;
}
