#!/usr/bin/env node
/*
 * devserver.mjs: local dev server for the site and its browser-based editor.
 *
 * One port serves four things:
 *   /            static files from --site (the editor's /admin/config.json is rewritten to use the mock)
 *   /__gh/...    a mock of the GitHub REST API subset the editor publishes with (repos, git data, contents,
 *                commits, pages). It is backed by a REAL bare git repository through git plumbing, so every
 *                publish can be inspected afterwards with ordinary git commands.
 *   /__live/...  the simulated deployed site: files of the commit GitHub Pages currently reports as built
 *   /__mock/...  test controls without auth: inject failures, push a commit "from elsewhere", read state
 *
 * Usage:
 *   node tools/devserver.mjs --port 8080 --site <dir> --repo <bare-repo.git> --token <token>
 *        [--host 127.0.0.1] [--owner test-owner] [--repo-name test-repo] [--branch main]
 *        [--pages-delay 3] [--token-expiry "2027-01-01 00:00:00 UTC"]
 *
 * Node built-ins only. git always runs through execFile, never a shell, because the file names in this
 * project contain spaces, quotes and parentheses.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { URLSearchParams } from 'node:url';

// ------------------------------------------------------------------ command line

const USAGE = `usage: node devserver.mjs --port 8080 --site <dir> --repo <bare-repo> --token <token>
         [--host 127.0.0.1] [--owner test-owner] [--repo-name test-repo] [--branch main]
         [--pages-delay 3] [--token-expiry "2027-01-01 00:00:00 UTC"]`;

function die(message) {
  console.error(`devserver: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { port: '8080', host: '127.0.0.1', owner: 'test-owner', 'repo-name': 'test-repo',
    branch: 'main', 'pages-delay': '3' };
  const known = ['site', 'repo', 'token', 'token-expiry', ...Object.keys(opts)];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log(USAGE); process.exit(0); }
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(argv[i]);
    if (!m || !known.includes(m[1])) die(`unknown argument ${argv[i]}\n${USAGE}`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || (m[2] === undefined && value.startsWith('--'))) die(`--${m[1]} needs a value`);
    opts[m[1]] = value;
  }
  for (const flag of ['site', 'repo', 'token']) if (!opts[flag]) die(`--${flag} is required\n${USAGE}`);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const SITE = path.resolve(opts.site);
const REPO = path.resolve(opts.repo);
const { token: TOKEN, owner: OWNER, branch: BRANCH, host: HOST } = opts;
const REPO_NAME = opts['repo-name'];
const TOKEN_EXPIRY = opts['token-expiry'];
const PORT = Number(opts.port);
const PAGES_DELAY_MS = Number(opts['pages-delay']) * 1000;
const MAX_BODY = 60 * 1024 * 1024;          // JSON request bodies (base64 images) up to 60 MB
const ZERO_SHA = '0'.repeat(40);
const START = Date.now();
let origin = `http://localhost:${PORT}`;     // corrected once listening (matters for --port 0)

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) die(`bad --port ${opts.port}`);
if (!(PAGES_DELAY_MS >= 0)) die(`bad --pages-delay ${opts['pages-delay']}`);
if (!isRefName(BRANCH)) die(`bad --branch ${BRANCH}`);
if (!fs.existsSync(REPO)) die(`--repo path does not exist: ${REPO}`);
if (!fs.statSync(SITE, { throwIfNoEntry: false })?.isDirectory()) die(`--site is not a directory: ${SITE}`);

// ------------------------------------------------------------------ git plumbing

// Hermetic environment: a user's global config (commit signing, log.showSignature, log.follow, hooks)
// must not change what plumbing does or prints, and stray GIT_* variables must not redirect it.
// Literal pathspecs keep names containing * [ ? : from being read as patterns or magic.
const GIT_ENV = { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: '0' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) {
  delete GIT_ENV[key];
}

/** Run git on the bare repo. Resolves {code, stdout: Buffer, stderr: string}, whatever the exit status. */
function runGit(args, { input, env } = {}) {
  return new Promise((resolve) => {
    const child = execFile('git', ['--git-dir', REPO, ...args],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: { ...GIT_ENV, ...env } },
      (err, stdout, stderr) => resolve({
        code: err ? (Number.isInteger(err.code) ? err.code : -1) : 0,
        stdout,
        stderr: String(stderr).trim() || (err ? err.message : ''),
      }));
    child.stdin?.on('error', () => {});      // git may exit without reading its stdin (EPIPE)
    child.stdin?.end(input ?? '');
  });
}

/** Run git and return stdout as text (a Buffer with {binary: true}); throws with git's stderr on failure. */
async function git(args, opts = {}) {
  const r = await runGit(args, opts);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return opts.binary ? r.stdout : r.stdout.toString('utf8');
}

/** One-line output (a sha, an object type), or null when git exits non-zero. */
async function gitLine(args) {
  const r = await runGit(args);
  return r.code === 0 ? r.stdout.toString('utf8').trim() : null;
}

const bare = await runGit(['rev-parse', '--is-bare-repository']);
if (bare.code !== 0) die(`--repo is not a git repository: ${REPO}\n${bare.stderr}`);
if (bare.stdout.toString().trim() !== 'true') console.warn(`devserver: warning: ${REPO} is not a bare repository`);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(status, message) { throw new HttpError(status, message); }

// Branch names and ?ref= / ?sha= values: plain ref characters only, so git can never read one as an
// option or as revision syntax (~ ^ : @{ ..).
function isRefName(s) {
  return typeof s === 'string' && /^[A-Za-z0-9._/-]+$/.test(s) && !s.startsWith('-') && !s.includes('..');
}
const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/i.test(s);
const isoDate = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');      // GitHub style: UTC, no ms
const objectType = (spec) => gitLine(['cat-file', '-t', spec]);                   // blob | tree | commit | null

async function branchTip(branch = BRANCH) {
  return isRefName(branch) ? gitLine(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) : null;
}

/** A branch, tag or sha from a query string, resolved to a full commit sha (null if unknown). */
async function resolveCommit(ref) {
  return isRefName(ref) ? gitLine(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]) : null;
}

/** 422 unless `sha` names an existing object of `type`; returns it lower-cased. */
async function requireObject(sha, type, message) {
  if (!isSha(sha) || (await objectType(sha.toLowerCase())) !== type) fail(422, message);
  return sha.toLowerCase();
}

// git log with one \x1e-led record per commit and NUL-separated fields. The raw message (%B) comes last,
// so multi-line messages parse intact.
const LOG_FORMAT = '--format=%x1e%H%x00%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B';

/** Commits in the shape of GET /git/commits/{sha}. */
async function readCommits(args) {
  const out = await git(['log', '--no-color', LOG_FORMAT, ...args]);
  return out.split('\x1e').slice(1).map((record) => {
    const [sha, tree, parents, an, ae, ad, cn, ce, cd, ...message] = record.split('\0');
    return {
      sha, tree: { sha: tree }, message: message.join('\0').replace(/\n+$/, ''),
      parents: parents ? parents.split(' ').map((p) => ({ sha: p })) : [],
      author: { name: an, email: ae, date: isoDate(ad) },
      committer: { name: cn, email: ce, date: isoDate(cd) },
    };
  });
}

async function readCommit(sha) {
  const full = isSha(sha) ? await resolveCommit(sha.toLowerCase()) : null;
  return full ? (await readCommits(['-1', full]))[0] : null;
}

/** Entries of a tree-ish. `ls-tree -z -l` records are "<mode> <type> <sha> <padded size or ->\t<name>\0". */
async function lsTree(treeish) {
  const out = await git(['ls-tree', '-z', '-l', treeish]);
  return out.split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t');
    const [mode, type, sha, size] = record.slice(0, tab).trim().split(/\s+/);
    return { path: record.slice(tab + 1), mode, type, sha, size: size === '-' ? undefined : Number(size) };
  });
}

// ------------------------------------------------------------------ writes: blobs, trees, commits

// Every mutating git operation goes through this one queue, so concurrent requests cannot interleave
// (for example two ref updates that both pass the fast-forward check).
let queueTail = Promise.resolve();
function serialized(task) {
  const run = queueTail.then(task);
  queueTail = run.catch(() => {});
  return run;
}

const writeBlob = async (bytes) => (await git(['hash-object', '-w', '--stdin'], { input: bytes })).trim();

// A repository path from a request: relative, no empty, "." or ".." segments, nothing inside .git.
const isTreePath = (p) => typeof p === 'string' && !p.includes('\0') &&
  p.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git');

/**
 * Build a tree from `baseTree` (sha or null) plus GitHub-style entries, using a throwaway index file.
 * Deletions go through `update-index --index-info` as mode-0 records, because
 * `update-index --force-remove` refuses to run in a bare repository ("must be run in a work tree").
 * Callers must already hold the queue.
 */
async function buildTree(baseTree, entries) {
  if (!Array.isArray(entries)) fail(422, 'Invalid request: "tree" must be an array');
  const base = baseTree == null ? null : await requireObject(baseTree, 'tree', `base_tree ${baseTree} is not a tree`);
  const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `devserver-index-${crypto.randomUUID()}`) };
  try {
    await git(base ? ['read-tree', base] : ['read-tree', '--empty'], { env });
    const present = new Set((await git(['ls-files', '-z'], { env })).split('\0').filter(Boolean));
    const records = [];
    for (const entry of entries) {
      const p = entry?.path;
      if (!isTreePath(p)) fail(422, `Invalid tree path ${JSON.stringify(p)}`);
      if (('content' in entry) === ('sha' in entry)) fail(422, `Entry "${p}" needs exactly one of content or sha`);
      if (entry.sha === null) {                       // delete a file, or every file under a directory
        const doomed = present.has(p) ? [p] : [...present].filter((f) => f.startsWith(`${p}/`));
        if (!doomed.length) console.warn(`devserver: warning: tree deletes missing path "${p}", ignored`);
        for (const f of doomed) { present.delete(f); records.push(`0 ${ZERO_SHA}\t${f}\0`); }
        continue;
      }
      const mode = String(entry.mode ?? '100644');
      if (!['100644', '100755', '120000'].includes(mode)) fail(422, `Unsupported mode ${mode} for "${p}"`);
      if (entry.type !== undefined && entry.type !== 'blob') fail(422, `Unsupported type ${entry.type} for "${p}"`);
      let sha;
      if ('content' in entry) {
        if (typeof entry.content !== 'string') fail(422, `tree.content for "${p}" must be a string`);
        sha = await writeBlob(Buffer.from(entry.content, 'utf8'));
      } else {
        sha = await requireObject(entry.sha, 'blob', `tree.sha ${entry.sha} is not a valid blob`);
      }
      // git itself replaces a file that becomes a directory (or the reverse); mirror that here.
      for (const f of present) if (f.startsWith(`${p}/`) || p.startsWith(`${f}/`)) present.delete(f);
      present.add(p);
      records.push(`${mode} ${sha}\t${p}\0`);
    }
    if (records.length) await git(['update-index', '-z', '--index-info'], { env, input: records.join('') });
    return (await git(['write-tree'], { env })).trim();
  } finally {
    await fs.promises.rm(env.GIT_INDEX_FILE, { force: true });
  }
}

const DEFAULT_AUTHOR = { name: 'Site Editor', email: 'editor@example.com' };
const MOCK_PUSHER = { name: 'Mock Pusher', email: 'pusher@example.com' };

/** {name, email, date?} from a request's author or committer object, over defaults; 422 if malformed. */
function identity(who, fallback) {
  const id = { ...fallback, ...who };
  if ((who != null && typeof who !== 'object') || typeof id.name !== 'string' || !id.name.trim() ||
      typeof id.email !== 'string' || (id.date != null && Number.isNaN(Date.parse(id.date)))) {
    fail(422, 'Invalid author or committer');
  }
  return id;
}

/** Write a commit object with `git commit-tree`; returns its sha. */
async function commitTree(tree, parents, message, author, committer = author) {
  const env = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email };
  if (author.date) env.GIT_AUTHOR_DATE = new Date(author.date).toISOString();
  if (committer.date) env.GIT_COMMITTER_DATE = new Date(committer.date).toISOString();
  const args = ['commit-tree', '--no-gpg-sign', ...parents.flatMap((p) => ['-p', p]), '-m', message, tree];
  return (await git(args, { env })).trim();
}

// ------------------------------------------------------------------ GitHub Pages simulation

// `built` is what the deployed site (/__live) serves. `pending` is a build in progress, which becomes
// `built` PAGES_DELAY_MS after the push that started it; a newer push replaces an unfinished build.
// Until this server sees its first push, the branch tip counts as built.
let built = null;      // {commit, started, finished}
let pending = null;    // {commit, started}

function settlePages() {
  if (pending && Date.now() >= pending.started + PAGES_DELAY_MS) {
    built = { ...pending, finished: pending.started + PAGES_DELAY_MS };
    pending = null;
  }
}

function recordPush(oldSha, newSha) {
  settlePages();
  built ??= { commit: oldSha, started: START, finished: START };
  pending = { commit: newSha, started: Date.now() };
}

/** `commit` is what pages/builds/latest reports; `live` is what /__live serves. */
async function pagesState() {
  settlePages();
  if (pending) {
    return { status: 'building', commit: pending.commit, live: built.commit, started: pending.started,
      updated: pending.started };
  }
  const b = built ?? { commit: await branchTip(), started: START, finished: START };
  return { status: 'built', commit: b.commit, live: b.commit, started: b.started, updated: b.finished };
}

// ------------------------------------------------------------------ mock GitHub API (/__gh)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'GitHub-Authentication-Token-Expiration, ETag',
};
const apiUrl = (p) => `${origin}/__gh/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO_NAME)}/${p}`;
const failRules = [];  // from POST /__mock/fail: {match, status, count, message}

// Handlers get {req, res, body, params, query} and return [status, json], or respond themselves.
function getRepo() {
  return [200, { name: REPO_NAME, full_name: `${OWNER}/${REPO_NAME}`, default_branch: BRANCH, private: false,
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true } }];
}

function refJson(branch, sha) {
  return { ref: `refs/heads/${branch}`, url: apiUrl(`git/refs/heads/${branch}`),
    object: { sha, type: 'commit', url: apiUrl(`git/commits/${sha}`) } };
}

async function getRef({ params: [branch] }) {
  const sha = await branchTip(branch);
  if (!sha) fail(404, 'Not Found');
  return [200, refJson(branch, sha)];
}

function patchRef({ params: [branch], body }) {
  return serialized(async () => {
    const sha = await requireObject(body.sha, 'commit', 'Object does not exist');
    const current = await branchTip(branch);
    if (!current) fail(422, 'Reference does not exist');
    if (body.force !== true && sha !== current) {
      const { code, stderr } = await runGit(['merge-base', '--is-ancestor', current, sha]);
      if (code === 1) fail(422, 'Update is not a fast forward');
      if (code !== 0) throw new Error(`git merge-base failed: ${stderr}`);
    }
    if (sha !== current) {
      await git(['update-ref', `refs/heads/${branch}`, sha, current]);   // compare-and-swap on the old value
      if (branch === BRANCH) recordPush(current, sha);
    }
    return [200, refJson(branch, sha)];
  });
}

async function getCommit({ params: [sha] }) {
  const commit = await readCommit(sha);
  if (!commit) fail(404, 'Not Found');
  return [200, commit];
}

function postCommit({ body }) {
  return serialized(async () => {
    if (typeof body.message !== 'string' || body.message.includes('\0')) fail(422, '"message" must be a string');
    const tree = await requireObject(body.tree, 'tree', 'Tree SHA does not exist');
    if (!Array.isArray(body.parents ?? [])) fail(422, '"parents" must be an array');
    const parents = [];
    for (const p of body.parents ?? []) {
      parents.push(await requireObject(p, 'commit', 'Parent SHA does not exist or is not a commit object'));
    }
    const author = identity(body.author, DEFAULT_AUTHOR);
    const committer = identity(body.committer, { name: author.name, email: author.email });
    return [201, await readCommit(await commitTree(tree, parents, body.message, author, committer))];
  });
}

function postBlob({ body }) {
  const encoding = body.encoding ?? 'utf-8';
  if (typeof body.content !== 'string') fail(422, 'Invalid request: "content" must be a string');
  if (encoding !== 'utf-8' && encoding !== 'base64') fail(422, `Unsupported encoding ${encoding}`);
  return serialized(async () => {
    const sha = await writeBlob(Buffer.from(body.content, encoding === 'base64' ? 'base64' : 'utf8'));
    return [201, { sha, url: apiUrl(`git/blobs/${sha}`) }];
  });
}

function postTree({ body }) {
  return serialized(async () => {
    const sha = await buildTree(body.base_tree ?? null, body.tree);
    return [201, { sha, url: apiUrl(`git/trees/${sha}`), tree: await lsTree(sha), truncated: false }];
  });
}

/** GET /git/trees/{sha}: top-level entries of a tree (no ?recursive support needed by the editor). */
async function getTree({ params: [sha] }) {
  if (!/^[0-9a-f]{40}$/.test(sha) || (await objectType(sha)) !== 'tree') fail(404, 'Not Found');
  return [200, { sha, url: apiUrl(`git/trees/${sha}`), tree: await lsTree(sha), truncated: false }];
}

async function getContents({ req, res, params: [p = ''], query }) {
  const rel = repoPath(p, 404);
  const ref = query.get('ref') || BRANCH;
  const commit = await resolveCommit(ref);
  if (!commit) fail(404, `No commit found for the ref ${ref}`);
  const spec = rel ? `${commit}:${rel}` : `${commit}^{tree}`;
  const type = await objectType(spec);
  if (type === 'blob') {
    const bytes = await git(['cat-file', 'blob', spec], { binary: true });
    if (/application\/vnd\.github(\.v3)?\.raw/.test(req.headers.accept ?? '')) {
      return void sendBytes(res, 'application/octet-stream', bytes);
    }
    return [200, { type: 'file', name: path.posix.basename(rel), path: rel, sha: await gitLine(['rev-parse', spec]),
      size: bytes.length, encoding: 'base64', content: bytes.toString('base64').replace(/.{1,60}/g, '$&\n') }];
  }
  if (type !== 'tree') fail(404, 'Not Found');
  const kinds = { blob: 'file', tree: 'dir', commit: 'submodule' };
  return [200, (await lsTree(spec)).map((e) => ({ type: kinds[e.type], name: e.path,
    path: rel ? `${rel}/${e.path}` : e.path, sha: e.sha, size: e.size ?? 0 }))];
}

async function listCommits({ query }) {
  const ref = query.get('sha') || BRANCH;
  const start = await resolveCommit(ref);
  if (!start) {
    if (!query.get('sha') && !(await branchTip())) fail(409, 'Git Repository is empty.');
    fail(404, `No commit found for SHA: ${ref}`);
  }
  const int = (v, dflt, max) => Math.min(max, Number.parseInt(v ?? '', 10) >= 1 ? Number.parseInt(v, 10) : dflt);
  const perPage = int(query.get('per_page'), 30, 100);
  const page = int(query.get('page'), 1, 1e6);
  const filter = (query.get('path') ?? '').replace(/^\/+|\/+$/g, '');
  if (filter.includes('\0')) fail(422, 'Invalid path');
  const commits = await readCommits([`--skip=${(page - 1) * perPage}`, '-n', String(perPage), start,
    ...(filter ? ['--', filter] : [])]);
  return [200, commits.map((c) => ({ sha: c.sha, parents: c.parents,
    commit: { message: c.message, author: c.author, committer: c.committer, tree: c.tree } }))];
}

async function latestBuild() {
  const s = await pagesState();
  return [200, { url: apiUrl('pages/builds/latest'), status: s.status, error: { message: null }, commit: s.commit,
    created_at: isoDate(s.started), updated_at: isoDate(s.updated) }];
}

function getPages() {
  return [200, { url: apiUrl('pages'), html_url: `${origin}/__live/`, status: 'built', cname: null }];
}

// [method, pattern for the path after /repos/{owner}/{repo}, handler]. HEAD is routed as GET.
const ROUTES = [
  ['GET', /^$/, getRepo],
  ['GET', /^\/git\/refs?\/heads\/(.+)$/, getRef],
  ['PATCH', /^\/git\/refs\/heads\/(.+)$/, patchRef],
  ['GET', /^\/git\/commits\/([^/]+)$/, getCommit],
  ['POST', /^\/git\/commits$/, postCommit],
  ['POST', /^\/git\/blobs$/, postBlob],
  ['POST', /^\/git\/trees$/, postTree],
  ['GET', /^\/git\/trees\/([0-9a-f]{40})$/, getTree],
  ['GET', /^\/contents(?:\/(.*))?$/, getContents],
  ['GET', /^\/commits$/, listCommits],
  ['GET', /^\/pages\/builds\/latest$/, latestBuild],
  ['GET', /^\/pages$/, getPages],
];

async function handleApi(req, res, url) {
  for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
  if (req.method === 'OPTIONS') { res.writeHead(204); return void res.end(); }
  const apiPath = url.pathname.slice('/__gh'.length);
  if (injectFailure(res, `${req.method} ${apiPath}${url.search}`)) return;
  const auth = /^(?:bearer|token)\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (auth?.[1].trim() !== TOKEN) fail(401, 'Bad credentials');
  if (TOKEN_EXPIRY) res.setHeader('GitHub-Authentication-Token-Expiration', TOKEN_EXPIRY);
  const repo = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(apiPath);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const [verb, pattern, handler] of repo ? ROUTES : []) {
    const m = verb === method && pattern.exec(repo[3] ?? '');
    if (!m) continue;
    if (decode(repo[1]) !== OWNER || decode(repo[2]) !== REPO_NAME) break;
    const body = method === 'POST' || method === 'PATCH' ? await readJson(req) : {};
    const params = m.slice(1).map((v) => (v === undefined ? v : decode(v)));
    const result = await handler({ req, res, body, params, query: url.query });
    if (result) sendJson(res, ...result);
    return;
  }
  fail(404, 'Not Found');
}

/** Apply the first /__mock/fail rule whose match is a substring of "METHOD /repos/..."; true if it fired. */
function injectFailure(res, key) {
  const i = failRules.findIndex((rule) => key.includes(rule.match));
  if (i < 0) return false;
  const rule = failRules[i];
  if (--rule.count <= 0) failRules.splice(i, 1);
  sendJson(res, rule.status, { message: rule.message });
  return true;
}

// ------------------------------------------------------------------ deployed site, test controls, static

async function serveLive(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method Not Allowed');
  if (url.pathname === '/__live') return redirect(res, `/__live/${url.search}`);
  let rel = repoPath(decode(url.pathname.slice('/__live/'.length)), 403);
  const commit = (await pagesState()).live;            // the built commit, never one still building
  if (!commit) fail(404, 'Not Found');
  const type = await objectType(rel ? `${commit}:${rel}` : `${commit}^{tree}`);
  if (type === 'tree') {
    if (!url.pathname.endsWith('/')) return redirect(res, `${url.pathname}/${url.search}`);
    rel = rel ? `${rel}/index.html` : 'index.html';
  } else if (type !== 'blob') {
    fail(404, 'Not Found');
  }
  const r = await runGit(['cat-file', 'blob', `${commit}:${rel}`]);
  if (r.code !== 0) fail(404, 'Not Found');
  sendBytes(res, contentType(rel), r.stdout);
}

async function handleMock(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /__mock/state') {
    const s = await pagesState();
    return sendJson(res, 200, { branch: BRANCH, head: await branchTip(), built: s.live,
      building: s.status === 'building' ? s.commit : null });
  }
  if (route === 'POST /__mock/fail') {
    const { match, status = 500, count = 1, message = 'Injected failure' } = await readJson(req);
    if (typeof match !== 'string' || !Number.isInteger(status) || status < 100 || status > 599 ||
        !Number.isInteger(count) || count < 1 || typeof message !== 'string') {
      fail(422, 'Expected {match: string, status?: 100-599, count?: integer >= 1, message?: string}');
    }
    failRules.push({ match, status, count, message });
    return sendJson(res, 200, { ok: true, rules: failRules });
  }
  if (route === 'POST /__mock/commit') {          // simulate someone else pushing to the branch
    const { path: file, content, message = 'External change' } = await readJson(req);
    if (typeof content !== 'string' || typeof message !== 'string' || message.includes('\0')) {
      fail(422, 'Expected {path: string, content: string, message?: string}');
    }
    const sha = await serialized(async () => {
      const tip = await branchTip();
      const base = tip ? (await git(['rev-parse', `${tip}^{tree}`])).trim() : null;
      const tree = await buildTree(base, [{ path: file, mode: '100644', type: 'blob', content }]);
      const commit = await commitTree(tree, tip ? [tip] : [], message, MOCK_PUSHER);
      await git(['update-ref', `refs/heads/${BRANCH}`, commit, tip ?? ZERO_SHA]);
      recordPush(tip, commit);
      return commit;
    });
    return sendJson(res, 200, { sha });
  }
  fail(404, 'Not Found');
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method Not Allowed');
  const rel = decode(url.pathname);
  if (rel === '/admin/config.json') return serveConfig(res);
  let file = path.resolve(SITE, `.${rel}`);
  if (file !== SITE && !file.startsWith(SITE + path.sep)) fail(403, 'Forbidden');
  let stat = await fs.promises.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    if (!url.pathname.endsWith('/')) return redirect(res, `${url.pathname}/${url.search}`);
    file = path.join(file, 'index.html');
    stat = await fs.promises.stat(file).catch(() => null);
  }
  if (!stat?.isFile()) {
    // Files saved through the mock API (new uploads) exist only in the mock repo:
    // serve them from the branch tip, as the published site would.
    const relPath = rel.replace(/^\/+/, '');
    const tip = relPath && (await branchTip());
    const spec = tip && `${tip}:${relPath}`;
    if (spec && (await objectType(spec)) === 'blob') {
      const bytes = await git(['cat-file', 'blob', spec], { binary: true });
      res.writeHead(200, { 'Content-Type': contentType(relPath), 'Content-Length': bytes.length });
      return void res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    fail(404, 'Not Found');
  }
  res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': stat.size });
  if (req.method === 'HEAD') return void res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());              // client went away: release the file handle
  stream.pipe(res);
}

/** The editor's config pointed at this mock: <site>/admin/config.json (or {}) with the API fields replaced. */
async function serveConfig(res) {
  const text = await fs.promises.readFile(path.join(SITE, 'admin', 'config.json'), 'utf8')
    .catch((err) => { if (err.code === 'ENOENT') return '{}'; throw err; });
  sendJson(res, 200, { ...JSON.parse(text), apiBase: `${origin}/__gh`, owner: OWNER, repo: REPO_NAME,
    branch: BRANCH, mock: true });
}

// ------------------------------------------------------------------ HTTP plumbing

const TYPES = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2' };
const contentType = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';

// req.url is split by hand: new URL() would normalize ".." segments and hide traversal attempts.
function parseUrl(raw) {
  const q = raw.indexOf('?');
  const pathname = q < 0 ? raw : raw.slice(0, q);
  if (!pathname.startsWith('/')) fail(400, 'Bad request path');
  return { pathname, search: q < 0 ? '' : raw.slice(q), query: new URLSearchParams(q < 0 ? '' : raw.slice(q + 1)) };
}

function decode(s) {
  let out;
  try { out = decodeURIComponent(s); } catch { fail(400, 'Bad request path'); }
  if (out.includes('\0')) fail(400, 'Bad request path');
  return out;
}

/** A decoded path inside the repository: "a//b/" -> "a/b"; "." and ".." segments are refused. */
function repoPath(decoded, status) {
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..')) fail(status, status === 403 ? 'Forbidden' : 'Not Found');
  return segments.join('/');
}

/** Read a JSON object body. Oversized bodies are drained first, so the client sees the 413, not a reset. */
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  }
  if (size > MAX_BODY) fail(413, 'Request body too large');
  if (size === 0) return {};
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Problems parsing JSON'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Problems parsing JSON');
  return body;
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function sendBytes(res, type, bytes) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
  res.end(bytes);
}

function redirect(res, location) {
  res.writeHead(301, { Location: location, 'Content-Length': 0 });
  res.end();
}

async function handle(req, res) {
  const url = parseUrl(req.url);
  const area = /^\/(__gh|__live|__mock)(?:\/|$)/.exec(url.pathname)?.[1];
  if (area === '__gh') return handleApi(req, res, url);
  if (area === '__live') return serveLive(req, res, url);
  if (area === '__mock') return handleMock(req, res, url);
  return serveStatic(req, res, url);
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  res.on('close', () => console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`));
  res.setHeader('Cache-Control', 'no-store');
  // Any exception becomes a JSON error response; the server keeps running.
  handle(req, res).catch((err) => {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return void res.destroy();
    sendJson(res, err instanceof HttpError ? err.status : 500, { message: String(err?.message ?? err) });
  }).catch(() => res.destroy());
});

server.on('error', (err) => die(err.code === 'EADDRINUSE' ? `port ${PORT} on ${HOST} is already in use` : err.message));
server.listen(PORT, HOST, () => {
  origin = `http://localhost:${server.address().port}`;
  console.log(`devserver: site ${origin}/ | api ${origin}/__gh | live ${origin}/__live/ | ` +
    `state ${origin}/__mock/state | repo ${REPO} (${BRANCH})`);
});
