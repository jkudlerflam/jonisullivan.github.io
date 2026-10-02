// Talks to the GitHub REST API. Saving the site is one atomic commit made with
// the Git Data API: upload new images as blobs, build a tree with every
// generated page, commit it on top of main, and move main forward.

import { buildSite, generatedHtmlPaths } from '../engine/render.js';

export class GitHubError extends Error {
  constructor(status, message, friendly) {
    super(friendly || message);
    this.status = status;
    this.detail = message;
  }
}

export class ConflictError extends Error {
  constructor(headSha) {
    super('The website was changed somewhere else since you started editing.');
    this.code = 'CONFLICT';
    this.headSha = headSha;
  }
}

function friendlyMessage(status, message) {
  if (status === 0) return "Can't reach GitHub. Check your internet connection and try again.";
  if (status === 401) return "The editing key isn't working anymore (it may have been revoked). Ask Jonah to set up a new one.";
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub asked us to slow down. Please wait a few minutes and try again.';
  if (status === 403) return "The editing key isn't allowed to change the website. Ask Jonah to check its permissions.";
  if (status === 404) return "Couldn't find the website's files on GitHub.";
  if (status >= 500) return 'GitHub is having trouble right now. Please try again in a minute.';
  return message || `GitHub error ${status}`;
}

export class GitHub {
  constructor({ apiBase = 'https://api.github.com', owner, repo, branch = 'main', token }) {
    Object.assign(this, { apiBase: apiBase.replace(/\/$/, ''), owner, repo, branch, token });
  }

  get base() {
    return `${this.apiBase}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  // Brief outages (network drops, 502/503/504) are retried twice. Every call
  // the editor makes is safe to repeat: blobs, trees and commits are addressed
  // by their content, and moving a branch to the commit it already points at
  // is a no-op.
  async req(method, path, body, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.reqOnce(method, path, body, opts);
      } catch (e) {
        const transient = e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504;
        if (!transient || attempt >= 2) throw e;
        await new Promise(r => setTimeout(r, attempt ? 3000 : 1000));
      }
    }
  }

  async reqOnce(method, path, body, { raw = false, allow404 = false } = {}) {
    let res;
    try {
      res = await fetch(path.startsWith('http') ? path : `${this.base}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, e.message, friendlyMessage(0));
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).message || message; } catch {}
      throw new GitHubError(res.status, message, friendlyMessage(res.status, message));
    }
    if (raw) return res.text();
    return res.status === 204 ? null : res.json();
  }

  repoInfo() { return this.req('GET', ''); }

  async headSha() {
    const ref = await this.req('GET', `/git/ref/heads/${encodeURIComponent(this.branch)}`);
    return ref.object.sha;
  }

  getCommit(sha) { return this.req('GET', `/git/commits/${sha}`); }

  getTree(sha) { return this.req('GET', `/git/trees/${sha}`); }

  // Text of a file at a commit, or null when it does not exist.
  fileText(path, ref) {
    const p = path.split('/').map(encodeURIComponent).join('/');
    return this.req('GET', `/contents/${p}?ref=${encodeURIComponent(ref || this.branch)}`, null, { raw: true, allow404: true });
  }

  async createBlob(base64) {
    const r = await this.req('POST', '/git/blobs', { content: base64, encoding: 'base64' });
    return r.sha;
  }

  createTree(baseTree, tree) { return this.req('POST', '/git/trees', { base_tree: baseTree, tree }); }

  createCommit(message, tree, parents, author) {
    return this.req('POST', '/git/commits', { message, tree, parents, ...(author ? { author } : {}) });
  }

  updateRef(sha) {
    return this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha, force: false });
  }

  commits({ path, perPage = 30, page = 1 } = {}) {
    const q = new URLSearchParams({ sha: this.branch, per_page: String(perPage), page: String(page) });
    if (path) q.set('path', path);
    return this.req('GET', `/commits?${q}`);
  }

  // Latest GitHub Pages build, or null if the token cannot see Pages.
  async pagesBuild() {
    try {
      return await this.req('GET', '/pages/builds/latest', null, { allow404: true });
    } catch (e) {
      if (e.status === 403) return null;
      throw e;
    }
  }
}

// ---------- describing a change ----------

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A short, human description of what changed, used as the commit message.
export function describeChanges(base, site, newImages = 0, summary = '') {
  if (summary) return `${summary}\n\nSaved with the site editor at /admin.`;
  const parts = [];
  const before = new Map(base.pages.map(p => [p.id, p]));
  const after = new Map(site.pages.map(p => [p.id, p]));
  // Pages in Deleted Pages (site.trash) can come back (restore) or go for good (empty).
  const trashed = t => new Set((t || []).map(e => e?.page?.id).filter(Boolean));
  const wasTrashed = trashed(base.trash);
  const inTrash = trashed(site.trash);
  const restored = site.pages.filter(p => !before.has(p.id) && wasTrashed.has(p.id)).map(p => p.title);
  const added = site.pages.filter(p => !before.has(p.id) && !wasTrashed.has(p.id)).map(p => p.title);
  const removed = base.pages.filter(p => !after.has(p.id)).map(p => p.title);
  const purged = [...wasTrashed].filter(id => !after.has(id) && !inTrash.has(id)).length;
  const edited = site.pages.filter(p => before.has(p.id) && !same(before.get(p.id), p)).map(p => p.title);
  const list = names => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '));
  if (edited.length) parts.push(`Edit ${list(edited)}`);
  if (added.length) parts.push(`add ${added.length === 1 ? 'page' : 'pages'} ${list(added)}`);
  if (restored.length) parts.push(`restore ${list(restored)}`);
  if (removed.length) parts.push(`delete ${list(removed)}`);
  if (purged) parts.push(inTrash.size ? `remove ${purged} deleted page${purged > 1 ? 's' : ''} for good` : 'empty Deleted Pages');
  if (!same(base.savedSections || [], site.savedSections || [])) parts.push('update saved sections');
  if (!same(base.nav, site.nav)) parts.push('update the menu');
  if (!same(base.design, site.design)) parts.push('change site styles');
  if (!same(base.settings, site.settings)) parts.push('change settings');
  if (newImages) parts.push(`add ${newImages} image${newImages > 1 ? 's' : ''}`);
  const gone = Object.keys(base.media).filter(id => !site.media[id]).length;
  if (gone) parts.push(`remove ${gone} image${gone > 1 ? 's' : ''} from the library`);
  let msg = parts.join('; ') || 'Update the site';
  msg = msg.charAt(0).toUpperCase() + msg.slice(1);
  return `${msg}\n\nSaved with the site editor at /admin.`;
}

// ---------- saving ----------

const pool = async (items, limit, fn) => {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
};

// Saves the working copy as one commit. Returns { sha, unchanged }.
//   site, baseSite   working copy and the version it started from
//   baseSha          commit the working copy is based on
//   uploads          [{ path, blob }] new image files
//   siteJs           text of engine/site.js
//   force            true to save over changes made elsewhere
//   onProgress(text) progress messages for the interface
export async function saveSite(gh, { site, baseSite, baseSha, uploads, siteJs, author, force = false, summary = '', onProgress = () => {}, toBase64 }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    onProgress('Checking for changes made elsewhere…');
    const head = await gh.headSha();
    if (head !== baseSha && !force) {
      const remote = await gh.fileText('content/site.json', head);
      if (!remote || !same(JSON.parse(remote), baseSite)) throw new ConflictError(head);
    }

    const blobShas = {};
    let done = 0;
    await pool(uploads, 3, async ({ path, blob }) => {
      onProgress(`Uploading images (${done + 1} of ${uploads.length})…`);
      blobShas[path] = await gh.createBlob(await toBase64(blob));
      done++;
    });

    onProgress('Saving pages…');
    const files = buildSite(site, { siteJs });
    const tree = [{ path: 'content/site.json', mode: '100644', type: 'blob', content: `${JSON.stringify(site, null, 1)}\n` }];
    for (const [path, content] of Object.entries(files)) tree.push({ path, mode: '100644', type: 'blob', content });
    for (const [path, sha] of Object.entries(blobShas)) tree.push({ path, mode: '100644', type: 'blob', sha });

    // Pages that no longer exist: delete their files, but only ones really there.
    const headCommit = await gh.getCommit(head);
    const rootTree = await gh.getTree(headCommit.tree.sha);
    const present = new Set(rootTree.tree.map(e => e.path));
    const keep = generatedHtmlPaths(site);
    for (const path of generatedHtmlPaths(baseSite)) {
      if (!keep.has(path) && present.has(path)) tree.push({ path, mode: '100644', type: 'blob', sha: null });
    }

    const newTree = await gh.createTree(headCommit.tree.sha, tree);
    if (newTree.sha === headCommit.tree.sha) return { sha: head, unchanged: true };
    const message = describeChanges(baseSite, site, uploads.length, summary);
    const commit = await gh.createCommit(message, newTree.sha, [head], author);
    try {
      await gh.updateRef(commit.sha);
      return { sha: commit.sha, unchanged: false };
    } catch (e) {
      // Someone moved main between our read and our write: try once more.
      if (e.status === 422 && attempt === 0) continue;
      throw e;
    }
  }
  throw new Error('Could not save. Please try again.');
}

// Commits a few text files (path -> contents, or null to delete) on top of main.
export async function commitFiles(gh, files, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await gh.headSha();
    const commit = await gh.getCommit(head);
    const tree = Object.entries(files).map(([path, content]) => (content === null
      ? { path, mode: '100644', type: 'blob', sha: null }
      : { path, mode: '100644', type: 'blob', content }));
    const newTree = await gh.createTree(commit.tree.sha, tree);
    const c = await gh.createCommit(message, newTree.sha, [head]);
    try {
      await gh.updateRef(c.sha);
      return c.sha;
    } catch (e) {
      if (e.status !== 422 || attempt) throw e;
    }
  }
  return null;
}

// Waits until GitHub Pages has published `sha`. onStatus('building'|'live'|'slow'|'unknown'|'error').
export async function waitForDeploy(gh, sha, onStatus, { timeoutMs = 5 * 60 * 1000, interval = 4000 } = {}) {
  const start = Date.now();
  let warnedSlow = false;
  while (Date.now() - start < timeoutMs) {
    let build;
    try {
      build = await gh.pagesBuild();
    } catch {
      build = undefined;
    }
    if (build === null) { onStatus('unknown'); return; }
    if (build) {
      if (build.commit === sha && build.status === 'built') { onStatus('live'); return; }
      if (build.commit === sha && build.status === 'errored') { onStatus('error', build.error?.message); return; }
    }
    if (!warnedSlow && Date.now() - start > 2.5 * 60 * 1000) { warnedSlow = true; onStatus('slow'); }
    await new Promise(r => setTimeout(r, interval));
  }
  onStatus('slow');
}

