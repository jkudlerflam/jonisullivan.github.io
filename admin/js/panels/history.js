// Version History (website mode): every save of content/site.json, newest
// first. Clicking a save shows that version in the preview, read-only, with a
// banner offering to restore it or go back to the current version.

import { html, useState, useEffect, useRef, Icon, IconButton, Button, Spinner, timeAgo, formatWhen } from '../ui.js';
import { useStore, getState, setState, replaceSite, confirmDialog, toast } from '../store.js';
import { save, scheduleAutoSave } from '../actions.js';
import { normalizeSite } from '../../engine/schema.js';
import { SideHead } from '../app.js';

const PER_PAGE = 30;
const versions = new Map(); // commit sha -> normalized site, so switching back and forth is instant

const firstLine = msg => String(msg || '').split('\n')[0].trim() || 'Saved changes';
const commitDate = c => c.commit?.committer?.date || c.commit?.author?.date || '';
const recent = date => Date.now() - Date.parse(date) < 7 * 24 * 3600 * 1000;

async function loadVersion(sha) {
  if (versions.has(sha)) return versions.get(sha);
  const text = await getState().gh.fileText('content/site.json', sha);
  if (!text) throw new Error('That save has no website content in it.');
  const site = normalizeSite(JSON.parse(text));
  versions.set(sha, site);
  return site;
}

// Back to the working copy. Anything edited before looking at an old version
// still saves on its own.
function backToCurrent() {
  if (!getState().viewing) return;
  setState({ viewing: null });
  scheduleAutoSave();
}

export function HistoryPanel() {
  const viewing = useStore(s => s.viewing);
  const baseSha = useStore(s => s.baseSha);
  const [commits, setCommits] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | more | ready | error
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);
  const request = useRef(0);

  const load = async p => {
    const n = ++request.current;
    setStatus(p === 1 ? 'loading' : 'more');
    try {
      const list = await getState().gh.commits({ path: 'content/site.json', perPage: PER_PAGE, page: p });
      if (n !== request.current) return;
      setCommits(prev => {
        const kept = p === 1 ? [] : prev;
        const seen = new Set(kept.map(c => c.sha));
        return [...kept, ...list.filter(c => !seen.has(c.sha))];
      });
      setPage(p);
      setMore(list.length === PER_PAGE);
      setStatus('ready');
    } catch (e) {
      if (n !== request.current) return;
      setError(e.message);
      setStatus('error');
    }
  };

  // Reload whenever a new save lands; leave the old version when the panel closes.
  useEffect(() => { load(1); }, [baseSha]);
  useEffect(() => () => backToCurrent(), []);

  const open = async (c, latest) => {
    if (latest) { backToCurrent(); return; }
    if (opening || getState().viewing?.sha === c.sha) return;
    setOpening(c.sha);
    try {
      const site = await loadVersion(c.sha);
      setState({ viewing: { sha: c.sha, site, date: commitDate(c), message: firstLine(c.commit?.message) } });
    } catch (e) {
      toast(`This version couldn't be opened. ${e.message}`, { kind: 'error', timeout: 7000 });
    } finally {
      setOpening(null);
    }
  };

  const shown = viewing ? viewing.sha : commits[0]?.sha;
  return html`<aside class="side md-side">
    <${SideHead} title="Version History">
      <${IconButton} icon="refresh" label="Refresh" onClick=${() => load(1)} />
    </${SideHead}>
    <div class="side-scroll">
      <div class="md-body md-body-top">
        <p class="md-lead">Every save is kept here. Click one to look at it. Nothing changes until you choose Restore this version.</p>
      </div>
      ${status === 'loading' && !commits.length ? html`<p class="md-empty"><${Spinner} /> Loading your saves…</p>` : null}
      ${status === 'error' ? html`<div class="md-body"><p class="note error">The history didn't load. ${error} <button type="button" class="linkbtn" onClick=${() => load(1)}>Try again</button></p></div>` : null}
      ${status !== 'loading' && status !== 'error' && !commits.length ? html`<p class="md-empty">No saved versions yet.</p>` : null}
      <ul class="hist md-hist">
        ${commits.map((c, i) => {
          const date = commitDate(c);
          const go = () => open(c, i === 0);
          return html`<li key=${c.sha} class=${c.sha === shown ? 'current' : ''} role="button" tabindex="0"
            aria-current=${c.sha === shown ? 'true' : undefined} title=${i === 0 ? 'The version on your site now' : 'Look at this version'}
            onClick=${go} onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
            <span class="md-hrow">
              <span class="when">${formatWhen(date)}</span>
              ${opening === c.sha ? html`<${Spinner} />` : null}
              ${i === 0 ? html`<span class="md-tag">Current</span>` : null}
            </span>
            <span class="what">${recent(date) ? `${timeAgo(date)} · ` : ''}${firstLine(c.commit?.message)}</span>
          </li>`;
        })}
      </ul>
      ${more ? html`<div class="md-more"><${Button} kind="secondary" small disabled=${status === 'more'} onClick=${() => load(page + 1)}>
        ${status === 'more' ? html`<${Spinner} /> Loading…` : 'Load more'}<//></div>` : null}
    </div>
  </aside>`;
}

// Shown over the preview while an old version is on screen.
export function ViewingBanner() {
  const viewing = useStore(s => s.viewing);
  if (!viewing) return null;

  const restore = async () => {
    const v = getState().viewing;
    if (!v) return;
    const ok = await confirmDialog({
      title: 'Restore this version?',
      message: `Your website will go back to how it was on ${formatWhen(v.date)}, and that version will be published. The current version stays in Version History, so you can switch back to it at any time.`,
      confirmLabel: 'Restore this version',
    });
    if (!ok || getState().viewing?.sha !== v.sha) return;
    replaceSite(structuredClone(v.site), { label: 'restore version' });
    setState({ viewing: null });
    if (await save({ summary: `Restore the version from ${formatWhen(v.date)}` })) toast('Version restored. It will be live in about a minute.');
  };

  return html`<div class="banner md-viewing" role="status">
    <${Icon} name="clock" size=${16} />
    <span>Viewing the version from <b>${formatWhen(viewing.date)}</b></span>
    <${Button} small onClick=${restore}>Restore this version<//>
    <${Button} small kind="secondary" onClick=${backToCurrent}>Back to current<//>
  </div>`;
}
