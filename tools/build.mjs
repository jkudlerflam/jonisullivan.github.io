#!/usr/bin/env node
// Regenerates the public site from content/site.json, exactly as the editor's
// Save button does. Useful after editing site.json by hand.
//
//   node tools/build.mjs            write the site into the repo root
//   node tools/build.mjs --out DIR  write into another directory instead
//   node tools/build.mjs --check    exit 1 if the committed files are out of date

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSite, validateSite } from '../admin/engine/schema.js';
import { buildSite, GENERATED_NOTE } from '../admin/engine/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : root;
const check = args.includes('--check');

const contentPath = join(root, 'content/site.json');
const original = await readFile(contentPath, 'utf8');
const site = normalizeSite(JSON.parse(original));
const problems = validateSite(site);
if (problems.length) {
  console.error('content/site.json has problems:\n- ' + problems.join('\n- '));
  process.exit(1);
}
const siteJs = await readFile(join(root, 'admin/engine/site.js'), 'utf8');
const files = buildSite(site, { siteJs });

let stale = 0;

// Keep content/site.json in the exact form the editor writes, so the editor's
// first save does not show unrelated differences.
// Only when building into the repository itself: --out leaves it alone.
const normalized = `${JSON.stringify(site, null, 1)}\n`;
if (normalized !== original && outDir === root) {
  stale++;
  if (check) console.log('not normalized: content/site.json');
  else { await writeFile(contentPath, normalized); console.log('normalized content/site.json'); }
}

for (const [path, contents] of Object.entries(files)) {
  const target = join(outDir, path);
  let current = null;
  try { current = await readFile(target, 'utf8'); } catch {}
  if (current === contents) continue;
  stale++;
  if (check) { console.log(`out of date: ${path}`); continue; }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  console.log(`wrote ${path}`);
}

// Generated pages that the site no longer has (renamed or deleted pages).
for (const name of await readdir(outDir)) {
  if (!name.endsWith('.html') || files[name]) continue;
  const text = await readFile(join(outDir, name), 'utf8');
  if (!text.includes(GENERATED_NOTE)) continue;
  stale++;
  if (check) { console.log(`no longer generated: ${name}`); continue; }
  await unlink(join(outDir, name));
  console.log(`removed ${name}`);
}

if (check && stale) process.exit(1);
console.log(stale ? `${stale} file(s) updated.` : 'Everything is up to date.');
