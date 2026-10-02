// Settings panel (website mode): site name and browser tab titles, search
// description, web address, social sharing image, browser icon, footer, contact
// form, visitor statistics, password, backup and logging out. Like everything
// outside edit mode, changes here save on their own.

import { html, useState, useEffect, useRef, Icon, Button, Field, TextInput, Select, ImageField, Spinner } from '../ui.js';
import { useStore, getState, setState, updateSite, toast } from '../store.js';
import { blobs } from '../db.js';
import { makeFavicons } from '../images.js';
import { pageTitle, pageById } from '../../engine/render.js';
import { todayIso, slugify } from '../../engine/schema.js';
import { SideHead } from '../app.js';
import { RichLine } from './media.js';

const FORMATS = [
  { value: '{site} — {page}', label: 'Site name, then page title' },
  { value: '{page} — {site}', label: 'Page title, then site name' },
];

const FAVICON_32 = 'images/favicon-32.png';
const FAVICON_180 = 'images/favicon-180.png';

function setSetting(key, value, label) {
  updateSite(site => { site.settings[key] = value; }, { label, coalesce: `settings:${key}` });
}

// Where the editor can show a file of the site: the local copy while it waits
// to be uploaded, otherwise the published file.
function fileUrl(path) {
  const s = getState();
  return s.objectUrls?.[path] || `${s.config?.siteRoot || '../'}${path}`;
}

// ---------- tidy text boxes ----------

const tidyUrl = v => {
  const t = String(v || '').trim();
  if (!t) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
};
const tidyGoat = v => {
  const t = String(v || '').trim();
  const m = /^(?:https?:\/\/)?([a-z0-9-]+)\.goatcounter\.com\b/i.exec(t);
  return (m ? m[1] : t).toLowerCase();
};
const looksLikeSite = v => /^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(v);

// Like TextInput, but tidies the value when she leaves the box (adds https://,
// pulls the code out of a pasted link).
function TidyInput({ value, onChange, tidy, placeholder, label, type = 'text' }) {
  const [local, setLocal] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setLocal(value ?? ''); }, [value]);
  return html`<input class="input" type=${type} value=${local} placeholder=${placeholder} aria-label=${label}
    spellcheck="false" autocomplete="off" autocapitalize="off"
    onFocus=${() => { focused.current = true; }}
    onInput=${e => { setLocal(e.target.value); onChange(e.target.value); }}
    onBlur=${e => {
      focused.current = false;
      const v = tidy(e.target.value);
      setLocal(v);
      if (v !== e.target.value || v !== (value ?? '')) onChange(v);
    }}
    onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`;
}

// ---------- browser tab preview and icon ----------

function TabPreview({ site }) {
  const pageId = useStore(s => s.pageId);
  useStore(s => s.objectUrls);
  const page = pageById(site, pageId) || pageById(site, site.settings.homePage);
  const title = page ? pageTitle(site, { ...page, seoTitle: '' }) : site.settings.siteName;
  const fav = site.settings.favicon;
  const icon = fav ? fileUrl(fav.png32 || fav.png180) : null;
  return html`<div class="md-tabprev" title="How a browser tab shows this page">
    <div class="md-tab">
      ${icon ? html`<img src=${icon} alt="" />` : html`<${Icon} name="globe" size=${14} />`}
      <span>${title}</span>
      <${Icon} name="x" size=${11} />
    </div>
  </div>`;
}

function FaviconField({ site }) {
  useStore(s => s.objectUrls);
  const fav = site.settings.favicon;
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const input = useRef(null);
  const url = fav ? fileUrl(fav.png180 || fav.png32) : null;
  useEffect(() => setBroken(false), [url]);

  const useFile = async file => {
    if (!file) return;
    setBusy(true);
    try {
      const { png32, png180 } = await makeFavicons(file);
      await blobs.set(FAVICON_32, png32);
      await blobs.set(FAVICON_180, png180);
      const s = getState();
      setState({
        pending: { ...s.pending, [FAVICON_32]: true, [FAVICON_180]: true },
        objectUrls: { ...s.objectUrls, [FAVICON_32]: URL.createObjectURL(png32), [FAVICON_180]: URL.createObjectURL(png180) },
      });
      updateSite(site => { site.settings.favicon = { png32: FAVICON_32, png180: FAVICON_180 }; }, { label: 'browser icon' });
      toast('Browser icon updated.');
    } catch (e) {
      toast(e.message || "This image couldn't be used as an icon.", { kind: 'error', timeout: 7000 });
    } finally {
      setBusy(false);
    }
  };

  return html`<div class="md-fav">
      <div class="md-fav-box">${url && !broken ? html`<img src=${url} alt="Current browser icon" onError=${() => setBroken(true)} />` : html`<${Icon} name="globe" size=${26} />`}</div>
      <div class="md-fav-acts">
        <${Button} small kind="secondary" icon=${busy ? null : 'upload'} disabled=${busy} onClick=${() => input.current?.click()}>
          ${busy ? html`<${Spinner} /> Preparing…` : fav ? 'Replace icon' : 'Upload icon'}
        <//>
        ${fav && !busy ? html`<button type="button" class="linkbtn" onClick=${() => updateSite(s => { s.settings.favicon = null; }, { label: 'remove browser icon' })}>Remove</button>` : null}
      </div>
      <input ref=${input} type="file" accept="image/*" hidden onChange=${e => { const f = e.target.files[0]; e.target.value = ''; useFile(f); }} />
    </div>
    <p class="md-help">The little picture in browser tabs and bookmarks, and on phone home screens. Use a square image at least 180 × 180 pixels. Other shapes are cropped to the middle.</p>`;
}

// ---------- backup ----------

function downloadBackup() {
  const site = getState().site;
  const blob = new Blob([`${JSON.stringify(site, null, 1)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(site.settings.siteName || 'site')}-backup-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded.');
}

// ---------- the panel ----------

export function SettingsPanel() {
  const site = useStore(s => s.site);
  const st = site.settings;
  const formats = FORMATS.some(f => f.value === st.titleFormat) ? FORMATS : [...FORMATS, { value: st.titleFormat, label: 'Custom' }];
  const desc = st.description || '';
  const goat = st.goatcounter || '';
  const goatOk = /^[a-z0-9-]+$/i.test(goat);

  return html`<aside class="side md-side">
    <${SideHead} title="Settings" />
    <div class="side-scroll"><div class="md-body">
      <p class="note md-note"><${Icon} name="check" size=${15} /> Changes here are saved and published automatically.</p>

      <div class="subhead">Site</div>
      <${Field} label="Site name" help="Used in browser tabs and search results. The title at the top of your pages is changed with EDIT SITE HEADER in Edit mode.">
        <${TextInput} value=${st.siteName} onChange=${v => setSetting('siteName', v, 'site name')} placeholder="Your name or studio" />
      <//>
      <${Field} label="Browser tab titles">
        <${Select} value=${st.titleFormat} options=${formats} onChange=${v => setSetting('titleFormat', v, 'browser tab titles')} />
        <${TabPreview} site=${site} />
      <//>
      <${Field} label="Site description for search engines" value=${`${desc.length} / 160`}
        help="One or two sentences about you and your work. Google may show it under your site's name. A page can have its own in Page settings.">
        <${TextInput} multiline rows=${3} value=${desc} onChange=${v => setSetting('description', v, 'site description')} placeholder="For example: Paintings and drawings by Joni Sullivan." />
      <//>
      <${Field} label="Website address" help=${st.url && !looksLikeSite(st.url)
        ? html`<span class="md-warn">This doesn't look like a web address. It should look like https://www.example.com</span>`
        : 'Your main web address. It is used for links in search results and when your pages are shared.'}>
        <${TidyInput} value=${st.url} tidy=${tidyUrl} onChange=${v => setSetting('url', v, 'website address')} placeholder="https://www.example.com" label="Website address" />
      <//>

      <div class="subhead">Social sharing image</div>
      <${Field} help="Shown when someone shares a link to your site, for example in iMessage or on Facebook. A page can use its own image instead (Page settings, Social image).">
        <${ImageField} value=${st.socialImage} onChange=${id => setSetting('socialImage', id, 'social sharing image')} />
      <//>

      <div class="subhead">Browser icon</div>
      <${FaviconField} site=${site} />

      <div class="subhead">Footer</div>
      <${Field} label="Footer text" help="Shown at the bottom of every page. Leave it empty for no footer.">
        <${RichLine} value=${st.footer || ''} onChange=${v => setSetting('footer', v, 'footer text')} label="Footer text" placeholder="For example: © 2026 Joni Sullivan" />
      <//>

      <div class="subhead">Contact form</div>
      <p class="md-help md-tight">Contact forms send their messages through Formspree, a free service:</p>
      <ol class="md-steps">
        <li>Make a free account at <a href="https://formspree.io/register" target="_blank" rel="noopener">formspree.io</a> with the email address where you want messages.</li>
        <li>Create a new form and copy its address. It looks like https://formspree.io/f/abcd1234</li>
        <li>Paste it here.</li>
      </ol>
      <${Field} label="Form address" help=${st.formEndpoint && !/^https:\/\/\S+$/i.test(st.formEndpoint)
        ? html`<span class="md-warn">This should be the form address from Formspree, starting with https://</span>`
        : 'Every contact form on your site uses this address.'}>
        <${TidyInput} value=${st.formEndpoint} tidy=${tidyUrl} onChange=${v => setSetting('formEndpoint', v, 'contact form address')} placeholder="https://formspree.io/f/…" label="Form address" />
      <//>

      <div class="subhead">Visitor statistics</div>
      <p class="md-help md-tight">GoatCounter counts visits to your site privately, without cookies. Make a free account at <a href="https://www.goatcounter.com/signup" target="_blank" rel="noopener">goatcounter.com</a>, then enter the code you chose.</p>
      <${Field} label="GoatCounter code" help=${goat && !goatOk
        ? html`<span class="md-warn">Use just the code, like jonisullivan (letters, numbers and dashes).</span>`
        : goat ? html`Your statistics: <a href=${`https://${goat}.goatcounter.com`} target="_blank" rel="noopener">${goat}.goatcounter.com</a>` : 'The first part of your GoatCounter address (yourcode.goatcounter.com).'}>
        <${TidyInput} value=${goat} tidy=${tidyGoat} onChange=${v => setSetting('goatcounter', v, 'visitor statistics')} placeholder="yourcode" label="GoatCounter code" />
      <//>

      <div class="subhead">Password</div>
      <p class="md-help md-tight">The password you use to open this editor.</p>
      <div class="md-btnrow"><${Button} kind="secondary" small icon="lock" onClick=${() => import('../main.js').then(m => m.changePassword())}>Change password<//></div>

      <div class="subhead">Backup</div>
      <p class="md-help md-tight">Saves a copy of all your pages, text and settings to your computer (one file, content/site.json). Your images are not included.</p>
      <div class="md-btnrow"><${Button} kind="secondary" small icon="download" onClick=${downloadBackup}>Download a backup<//></div>

      <hr class="divider" />
      <div class="md-btnrow"><${Button} kind="secondary" small icon="logout" onClick=${() => import('../main.js').then(m => m.logout())}>Log out<//></div>
    </div></div>
  </aside>`;
}
