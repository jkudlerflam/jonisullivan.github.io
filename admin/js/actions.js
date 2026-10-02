// Everything the interface can do to the site, in one place. Panels and the
// preview call these; they go through updateSite() so undo/redo and the draft
// keep working.

import {
  newPage, newSection, cloneWithNewIds, uniqueSlug, isValidSlug, uid, validateSite, normalizeSite, newBlock,
} from '../engine/schema.js';
import { pageById } from '../engine/render.js';
import {
  getState, setState, updateSite, replaceSite, toast, confirmDialog, isDirty, saveDraftNow, undo,
} from './store.js';
import { kv, blobs } from './db.js';
import { prepareImage, parseArtworkFilename, captionFromArtwork, slugifyFilename, blobToBase64 } from './images.js';
import { saveSite, waitForDeploy, ConflictError } from './github.js';

// ---------- paths inside the site ("items.<id>.caption") ----------

function step(obj, key) {
  if (Array.isArray(obj)) return obj.find(x => x && x.id === key);
  return obj?.[key];
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : step(o, k)), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o == null ? o : step(o, k)), obj);
  if (parent == null) return false;
  if (Array.isArray(parent)) {
    const i = parent.findIndex(x => x && x.id === last);
    if (i < 0) return false;
    parent[i] = value;
  } else {
    parent[last] = value;
  }
  return true;
}

// The object a data-edit scope points at: "s:<sectionId>", "p:<pageId>", "site".
export function scopeTarget(site, scope) {
  if (scope === 'site') return site;
  const [kind, id] = scope.split(':');
  if (kind === 'p') return pageById(site, id);
  if (kind === 's') {
    for (const p of site.pages) {
      const s = p.sections.find(x => x.id === id);
      if (s) return s;
    }
  }
  return null;
}

export function findSection(site, sectionId) {
  for (const page of site.pages) {
    const index = page.sections.findIndex(s => s.id === sectionId);
    if (index >= 0) return { page, section: page.sections[index], index };
  }
  return null;
}

export function currentPage(s = getState()) {
  return pageById(s.site, s.pageId);
}

// ---------- navigation between pages ----------

export function goToPage(pageId) {
  setState({ pageId, selection: null, editPanel: null });
}

export function setMode(mode) {
  setState({ mode, selection: null, editPanel: null });
}

// ---------- pages ----------

export function addPage({ template = 'blank', title = 'New page', where = 'nav', folderId = null, blogId = null } = {}) {
  let created;
  updateSite(site => {
    const page = newPage(site, { title, template, parent: blogId });
    created = page;
    site.pages.push(page);
    if (blogId || where === 'unlinked') return;
    const item = { id: uid('n'), type: 'page', page: page.id };
    const folder = folderId ? site.nav.find(n => n.id === folderId) : null;
    (folder ? folder.children : site.nav).push(item);
  }, { label: blogId ? 'add article' : 'add page' });
  goToPage(created.id);
  return created;
}

export function duplicatePage(pageId) {
  let copyId;
  updateSite(site => {
    const page = pageById(site, pageId);
    const copy = cloneWithNewIds(page);
    copy.id = uid('p');
    copy.title = `${page.title} (copy)`;
    copy.navTitle = '';
    copy.slug = uniqueSlug(site, copy.title);
    if (copy.post) { copy.post.title = copy.title; copy.post.draft = true; }
    site.pages.splice(site.pages.indexOf(page) + 1, 0, copy);
    copyId = copy.id;
  }, { label: 'duplicate page' });
  goToPage(copyId);
}

// Like Squarespace, a deleted page goes to Deleted Pages (site.trash) for 30
// days, with the articles of a collection: { page, deletedAt, posts?, redirects?,
// links? } (redirects: old addresses that led to it; links: article lists that
// showed it). Older entries are dropped whenever a page is deleted.
export async function deletePage(pageId) {
  const s = getState();
  const page = pageById(s.site, pageId);
  if (!page) return;
  const posts = s.site.pages.filter(p => p.parent === pageId);
  if (pageId === s.site.settings.homePage) {
    toast('This is your homepage. Choose another homepage before deleting it.', { kind: 'error' });
    return;
  }
  const ok = await confirmDialog({
    title: `Delete "${page.title}"?`,
    message: posts.length
      ? `Its ${posts.length} article${posts.length > 1 ? 's go' : ' goes'} with it. You can restore it from Deleted Pages, at the bottom of the Pages panel, for 30 days.`
      : 'You can restore it from Deleted Pages, at the bottom of the Pages panel, for 30 days.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const remove = new Set([pageId, ...posts.map(p => p.id)]);
  updateSite(site => {
    const now = Date.now();
    const keep = 30 * 24 * 60 * 60 * 1000;
    site.trash = (Array.isArray(site.trash) ? site.trash : []).filter(e => e && e.page && now - Date.parse(e.deletedAt) < keep);
    const entry = { page: pageById(site, pageId), deletedAt: new Date(now).toISOString() };
    const kids = site.pages.filter(p => p.parent === pageId);
    if (kids.length) entry.posts = kids;
    const redirects = site.redirects.filter(r => remove.has(r.to));
    if (redirects.length) entry.redirects = redirects;
    const links = [];
    for (const p of site.pages) for (const sec of p.sections) if (sec.type === 'posts' && sec.blog === pageId && !remove.has(p.id)) links.push(sec.id);
    if (links.length) entry.links = links;
    site.trash.unshift(entry);
    site.pages = site.pages.filter(p => !remove.has(p.id));
    const prune = items => items
      .filter(n => !(n.type === 'page' && remove.has(n.page)))
      .map(n => (n.type === 'folder' ? { ...n, children: prune(n.children || []) } : n));
    site.nav = prune(site.nav);
    site.redirects = site.redirects.filter(r => !remove.has(r.to));
    for (const p of site.pages) for (const sec of p.sections) if (sec.type === 'posts' && remove.has(sec.blog)) sec.blog = null;
  }, { label: 'delete page' });
  if (remove.has(getState().pageId)) goToPage(getState().site.settings.homePage);
  toast(`Deleted "${page.title}". It's in Deleted Pages for 30 days.`, { action: { label: 'Undo', onClick: undo }, timeout: 8000 });
}

// patch may include slug: the old address keeps working through a redirect.
export function updatePage(pageId, patch, opts = {}) {
  updateSite(site => {
    const page = pageById(site, pageId);
    if (!page) return;
    if (patch.slug !== undefined && patch.slug !== page.slug) {
      const old = page.slug;
      if (!isValidSlug(patch.slug) || site.pages.some(p => p.id !== pageId && p.slug === patch.slug)) return;
      if (pageId !== site.settings.homePage) {
        site.redirects = site.redirects.filter(r => r.from !== `${patch.slug}.html`);
        if (!site.redirects.some(r => r.from === `${old}.html`)) site.redirects.push({ from: `${old}.html`, to: pageId });
      }
    }
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'post') page.post = { ...page.post, ...v };
      else page[k] = v;
    }
  }, { label: opts.label || 'page settings', coalesce: opts.coalesce || `page:${pageId}:${Object.keys(patch).join(',')}` });
}

export function setHomePage(pageId) {
  updateSite(site => {
    const page = pageById(site, pageId);
    if (!page || page.kind === 'post') return;
    // Links to the page's own address keep working.
    site.redirects = site.redirects.filter(r => r.from !== `${page.slug}.html`);
    site.redirects.push({ from: `${page.slug}.html`, to: pageId });
    const oldHome = pageById(site, site.settings.homePage);
    if (oldHome) site.redirects = site.redirects.filter(r => !(r.from === `${oldHome.slug}.html` && r.to === oldHome.id));
    site.settings.homePage = pageId;
  }, { label: 'set homepage' });
}

// ---------- navigation menu ----------

function detachNavItem(items, id) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return items.splice(i, 1)[0];
    if (items[i].type === 'folder') {
      const found = detachNavItem(items[i].children || [], id);
      if (found) return found;
    }
  }
  return null;
}

export function navItemOfPage(site, pageId) {
  let hit = null;
  (function walk(items, parent) {
    for (const it of items) {
      if (it.type === 'page' && it.page === pageId) hit = { item: it, parent };
      if (it.type === 'folder') walk(it.children || [], it);
    }
  })(site.nav, null);
  return hit;
}

// Move a nav item (or an unlinked page, given as { pageId }) to folderId (null = top level) at index.
export function moveNav({ itemId, pageId }, folderId, index) {
  updateSite(site => {
    let item = itemId ? detachNavItem(site.nav, itemId) : null;
    if (!item && pageId) item = { id: uid('n'), type: 'page', page: pageId };
    if (!item) return;
    if (item.type === 'folder' && folderId) folderId = null; // folders do not nest
    const list = folderId ? site.nav.find(n => n.id === folderId)?.children : site.nav;
    if (!list) return;
    list.splice(Math.max(0, Math.min(index, list.length)), 0, item);
  }, { label: 'reorder menu' });
}

export function unlinkPage(pageId) {
  updateSite(site => {
    const hit = navItemOfPage(site, pageId);
    if (hit) detachNavItem(site.nav, hit.item.id);
  }, { label: 'remove from menu' });
}

export function addNavItem(type, props = {}) {
  updateSite(site => {
    const item = { id: uid('n'), type, ...props };
    if (type === 'folder') item.children = item.children || [];
    site.nav.push(item);
  }, { label: `add ${type}` });
}

export function updateNavItem(itemId, patch) {
  updateSite(site => {
    let target = null;
    (function walk(items) { for (const it of items) { if (it.id === itemId) target = it; if (it.children) walk(it.children); } })(site.nav);
    if (target) Object.assign(target, patch);
  }, { label: 'menu item', coalesce: `nav:${itemId}` });
}

export async function removeNavItem(itemId) {
  const site = getState().site;
  let target = null;
  (function walk(items) { for (const it of items) { if (it.id === itemId) target = it; if (it.children) walk(it.children); } })(site.nav);
  if (!target) return;
  if (target.type === 'folder' && target.children?.length) {
    const ok = await confirmDialog({ title: `Remove the folder "${target.label}"?`, message: 'The pages inside it move to the top level of the menu.', confirmLabel: 'Remove folder' });
    if (!ok) return;
  }
  updateSite(s => {
    const item = detachNavItem(s.nav, itemId);
    if (item?.type === 'folder') s.nav.push(...(item.children || []));
  }, { label: 'remove menu item' });
}

// ---------- sections ----------

export function addSection(pageId, index, section) {
  updateSite(site => {
    const page = pageById(site, pageId);
    page.sections.splice(Math.max(0, Math.min(index, page.sections.length)), 0, section);
  }, { label: 'add section' });
  setState({ selection: { sectionId: section.id }, editPanel: { kind: 'section', id: section.id, tab: null } });
  return section.id;
}

export function addSectionOfType(pageId, index, type, overrides = {}) {
  return addSection(pageId, index, newSection(type, overrides));
}

export function updateSection(sectionId, mutator, opts = {}) {
  updateSite(site => {
    const hit = findSection(site, sectionId);
    if (hit) mutator(hit.section, site, hit.page);
  }, { label: opts.label || 'edit section', coalesce: opts.coalesce || null, source: opts.source || null });
}

export function setSectionProps(sectionId, props, label = 'edit section') {
  updateSection(sectionId, s => Object.assign(s, props), { label, coalesce: `sec:${sectionId}:${Object.keys(props).join(',')}` });
}

export function moveSection(sectionId, delta) {
  updateSite(site => {
    const hit = findSection(site, sectionId);
    if (!hit) return;
    const to = hit.index + delta;
    if (to < 0 || to >= hit.page.sections.length) return;
    hit.page.sections.splice(hit.index, 1);
    hit.page.sections.splice(to, 0, hit.section);
  }, { label: 'move section' });
}

export function moveSectionTo(sectionId, toIndex) {
  updateSite(site => {
    const hit = findSection(site, sectionId);
    if (!hit) return;
    hit.page.sections.splice(hit.index, 1);
    hit.page.sections.splice(Math.max(0, Math.min(toIndex, hit.page.sections.length)), 0, hit.section);
  }, { label: 'move section' });
}

// Squarespace's heart icon: keep a copy of a section to add again from
// Add Section > Saved.
export function saveSectionForReuse(sectionId) {
  const hit = findSection(getState().site, sectionId);
  if (!hit) return;
  const names = { blocks: 'Section', gallery: 'Gallery', cv: 'CV list', posts: 'Article list', form: 'Contact form', spacer: 'Spacer' };
  updateSite(site => {
    site.savedSections = site.savedSections || [];
    site.savedSections.unshift({ id: uid('saved'), name: `${names[hit.section.type] || 'Section'} from ${hit.page.title}`, savedAt: new Date().toISOString(), section: cloneWithNewIds(hit.section) });
  }, { label: 'save section' });
  toast('Section saved. Find it under Saved when you add a section.');
}

export function duplicateSection(sectionId) {
  let newId;
  updateSite(site => {
    const hit = findSection(site, sectionId);
    const copy = cloneWithNewIds(hit.section);
    newId = copy.id;
    hit.page.sections.splice(hit.index + 1, 0, copy);
  }, { label: 'duplicate section' });
  setState({ selection: { sectionId: newId } });
}

export async function deleteSection(sectionId) {
  const hit = findSection(getState().site, sectionId);
  if (!hit) return;
  const ok = await confirmDialog({ title: 'Delete this section?', message: 'You can undo this right away with the Undo button.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  updateSite(site => {
    const h = findSection(site, sectionId);
    if (h) h.page.sections.splice(h.index, 1);
  }, { label: 'delete section' });
  setState({ selection: null, editPanel: null });
  toast('Section deleted', { action: { label: 'Undo', onClick: undo }, timeout: 8000 });
}

// ---------- images ----------

function takenPaths(site) {
  const taken = new Set();
  for (const m of Object.values(site.media)) {
    taken.add(m.src);
    if (m.medium) taken.add(m.medium.src);
  }
  return taken;
}

function freePath(taken, slug, ext, suffix = '') {
  let n = 1;
  let path = `images/uploads/${slug}${suffix}.${ext}`;
  while (taken.has(path)) path = `images/uploads/${slug}-${++n}${suffix}.${ext}`;
  return path;
}

const extOf = type => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'jpg');

// Prepares dropped or chosen files and adds them to the media library.
// Returns the new media ids (in the order given). Problems are shown as toasts.
export async function importFiles(fileList, { onProgress } = {}) {
  const files = [...fileList].filter(f => f && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?)$/i.test(f.name)));
  const ids = [];
  const urls = { ...(getState().objectUrls || {}) };
  const pending = { ...getState().pending };
  const newMedia = [];
  const taken = takenPaths(getState().site);
  for (const [i, file] of files.entries()) {
    onProgress && onProgress(i, files.length, file.name);
    try {
      const prep = await prepareImage(file);
      const art = parseArtworkFilename(file.name);
      const slug = slugifyFilename(file.name);
      const main = prep.variants.find(v => v.key === 'main');
      const medium = prep.variants.find(v => v.key === 'medium');
      const mainPath = freePath(taken, slug, extOf(main.type));
      taken.add(mainPath);
      const base = mainPath.replace(/\.[a-z]+$/, '');
      const mediumPath = medium ? `${base}-1200.${extOf(medium.type)}` : null;
      if (mediumPath) taken.add(mediumPath);
      await blobs.set(mainPath, main.blob);
      urls[mainPath] = URL.createObjectURL(main.blob);
      pending[mainPath] = true;
      if (medium) {
        await blobs.set(mediumPath, medium.blob);
        urls[mediumPath] = URL.createObjectURL(medium.blob);
        pending[mediumPath] = true;
      }
      const id = `m-${base.split('/').pop()}`;
      newMedia.push({
        id, src: mainPath, w: main.width, h: main.height,
        ...(medium ? { medium: { src: mediumPath, w: medium.width, h: medium.height } } : {}),
        alt: art.title, title: art.title, caption: captionFromArtwork(art), added: new Date().toISOString().slice(0, 10),
      });
      ids.push(id);
    } catch (e) {
      toast(`${file.name}: ${e.message}`, { kind: 'error', timeout: 7000 });
    }
  }
  if (newMedia.length) {
    setState({ objectUrls: urls, pending });
    updateSite(site => { for (const m of newMedia) site.media[m.id] = m; }, { label: newMedia.length > 1 ? 'add images' : 'add image' });
  }
  return ids;
}

// Adds new gallery items (for media ids) at index (default: end).
export function addGalleryItems(sectionId, mediaIds, index = null) {
  updateSection(sectionId, (sec, site) => {
    const items = mediaIds.map(id => ({ id: uid('gi'), media: id, caption: site.media[id]?.caption || '', alt: '', link: '', hidden: false }));
    if (index === null) sec.items.push(...items);
    else sec.items.splice(index, 0, ...items);
  }, { label: 'add images' });
}

export function mediaUsage(site, mediaId) {
  const uses = [];
  const hit = (page, where) => uses.push({ pageId: page?.id, title: page ? page.title : 'Site', where });
  const inSections = (sections, mark) => {
    for (const s of sections || []) {
      if (s.media === mediaId) mark(s.type === 'imageText' ? 'image and text' : 'image');
      if (s.bgImage === mediaId) mark('section background');
      if (s.items?.some(i => i.media === mediaId)) mark('gallery');
      if (s.blocks?.some(b => b.media === mediaId)) mark('image block');
    }
  };
  for (const page of site.pages) {
    if (page.socialImage === mediaId) hit(page, 'social image');
    if (page.post?.image === mediaId) hit(page, 'article thumbnail');
    inSections(page.sections, where => hit(page, where));
  }
  if (site.settings.socialImage === mediaId) hit(null, 'social sharing image');
  if (site.design.logo.media === mediaId) hit(null, 'logo');
  // Kept for later: pages in Deleted Pages (they can be restored) and saved sections.
  for (const t of site.trash || []) {
    for (const p of [t.page, ...(t.posts || [])].filter(Boolean)) {
      const mark = where => uses.push({ pageId: null, kind: 'trash', title: `${p.title} (in Deleted Pages)`, where });
      if (p.socialImage === mediaId) mark('social image');
      if (p.post?.image === mediaId) mark('article thumbnail');
      inSections(p.sections, mark);
    }
  }
  for (const saved of site.savedSections || []) {
    inSections([saved.section], where => uses.push({ pageId: null, kind: 'saved', title: `Saved section "${saved.name}"`, where }));
  }
  return uses;
}

export function replaceMediaEverywhere(oldId, newId) {
  updateSite(site => {
    const swap = o => {
      if (Array.isArray(o)) { o.forEach(swap); return; }
      if (!o || typeof o !== 'object') return;
      for (const k of ['media', 'image', 'socialImage', 'bgImage']) if (o[k] === oldId) o[k] = newId;
      Object.values(o).forEach(v => typeof v === 'object' && swap(v));
    };
    swap(site.pages);
    swap(site.trash || []);
    swap(site.savedSections || []);
    if (site.settings.socialImage === oldId) site.settings.socialImage = newId;
    if (site.design.logo.media === oldId) site.design.logo.media = newId;
  }, { label: 'replace image' });
}

export function removeMedia(mediaId) {
  updateSite(site => { delete site.media[mediaId]; }, { label: 'remove image from library' });
}

// ---------- blank sections ----------

export function addBlock(sectionId, kind, at) {
  const block = newBlock(kind, at);
  updateSection(sectionId, sec => { sec.blocks.push(block); }, { label: `add ${kind} block` });
  setState({ selection: { sectionId, blockId: block.id }, editPanel: { kind: 'block', id: sectionId, blockId: block.id } });
  return block.id;
}

// ---------- saving ----------

let saving = null;

// Saves the working copy to GitHub (the Squarespace "Save"). Resolves true on success.
// summary: optional one-line description for the history (otherwise worked out from the changes).
export async function save({ force = false, summary = '' } = {}) {
  if (saving) return saving;
  const s = getState();
  if (s.viewing) return false;
  const problems = validateSite(s.site);
  if (problems.length) {
    setState({ save: { status: 'error', message: problems[0] } });
    toast(problems[0], { kind: 'error', timeout: 8000 });
    return false;
  }
  if (!isDirty() && !force) {
    setState({ save: { status: 'live', message: 'All changes saved' } });
    return true;
  }
  saving = (async () => {
    const site = s.site;
    const pendingPaths = Object.keys(s.pending);
    setState({ save: { status: 'saving', message: 'Saving…' } });
    try {
      const uploads = [];
      for (const path of pendingPaths) {
        const blob = await blobs.get(path);
        if (blob) uploads.push({ path, blob });
      }
      const result = await saveSite(s.gh, {
        site, baseSite: s.baseSite, baseSha: s.baseSha, uploads, siteJs: s.siteJs, force, summary,
        author: s.config.author, toBase64: blobToBase64,
        onProgress: message => setState({ save: { status: 'saving', message } }),
      });
      // Keep anything edited while the save was running as unsaved.
      const stillPending = { ...getState().pending };
      for (const p of pendingPaths) delete stillPending[p];
      setState({ baseSite: site, baseSha: result.sha, pending: stillPending, revision: getState().revision + 1 });
      await saveDraftNow();
      for (const p of pendingPaths) blobs.del(p).catch(() => {});
      if (result.unchanged) {
        setState({ save: { status: 'live', message: 'All changes saved' } });
      } else {
        setState({ save: { status: 'deploying', message: 'Saved. Publishing…', sha: result.sha, at: Date.now() } });
        waitForDeploy(s.gh, result.sha, status => {
          if (getState().save.sha !== result.sha) return;
          const messages = {
            live: 'Saved and live', building: 'Saved. Publishing…', slow: 'Saved. Publishing is taking longer than usual',
            unknown: 'Saved. Live in about a minute', error: 'Saved, but publishing failed',
          };
          setState({ save: { ...getState().save, status: status === 'error' ? 'error' : status === 'live' ? 'live' : 'deploying', message: messages[status] } });
        });
      }
      return true;
    } catch (e) {
      if (e instanceof ConflictError) {
        setState({ save: { status: 'error', message: 'Not saved: the site changed elsewhere' } });
        const choice = await confirmDialog({
          title: 'The website changed somewhere else',
          message: 'Someone (perhaps you, on another computer) saved changes since you started editing. You can load their version (your unsaved changes here are lost), or save yours over it.',
          confirmLabel: 'Save mine anyway',
          cancelLabel: 'Cancel',
          third: { label: 'Load the latest version', value: 'reload' },
        });
        saving = null;
        if (choice === true) return save({ force: true, summary });
        if (choice === 'reload') { await reloadFromGitHub(); }
        return false;
      }
      setState({ save: { status: 'error', message: e.message } });
      toast(e.message, { kind: 'error', timeout: 9000 });
      return false;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

export async function discardChanges() {
  const s = getState();
  for (const path of Object.keys(s.pending)) blobs.del(path).catch(() => {});
  setState({ pending: {} });
  replaceSite(structuredClone(s.baseSite), { resetHistory: true });
  await kv.del('draft').catch(() => {});
  setState({ save: { status: 'idle', message: '' } });
}

// Loads the newest saved version from GitHub, dropping local changes.
export async function reloadFromGitHub() {
  const s = getState();
  const head = await s.gh.headSha();
  const text = await s.gh.fileText('content/site.json', head);
  const site = normalizeSite(JSON.parse(text));
  setState({ baseSite: site, baseSha: head, pending: {} });
  replaceSite(structuredClone(site), { resetHistory: true });
  await kv.del('draft').catch(() => {});
  setState({ save: { status: 'idle', message: '' } });
}

// Outside edit mode, changes made in panels save on their own (like Squarespace).
let autoTimer = null;
export function scheduleAutoSave(delay = 1500) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const s = getState();
    if (s.mode === 'website' && !s.viewing && isDirty()) save();
  }, delay);
}
