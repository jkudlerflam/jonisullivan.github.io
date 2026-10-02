// Sign-in and first-time setup screens.

import { html, useState, useEffect, Button, TextInput, Toggle, Spinner, Icon } from './ui.js';
import { decryptToken, encryptToken, generatePassphrase, passphraseProblem, normalizePassphrase } from './auth.js';
import { GitHub, commitFiles } from './github.js';

// onToken(token, remember) is called once a working token is available.
export function Login({ config, keyFile, onToken, onSetup }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const submit = async e => {
    e && e.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError('');
    try {
      const token = await decryptToken(keyFile, password);
      await onToken(token, remember);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return html`<div class="login">
    <form class="login-card" onSubmit=${submit}>
      <h1>${config.siteName || 'Your website'}</h1>
      <p class="sub">Sign in to edit your website.</p>
      <div class="field">
        <div class="lbl"><span>Password</span></div>
        <input class="input" type="password" autocomplete="current-password" value=${password} autofocus
          onInput=${e => setPassword(e.target.value)} />
      </div>
      <${Toggle} label="Remember me on this computer" checked=${remember} onChange=${setRemember} />
      ${error ? html`<p class="note error">${error}</p>` : null}
      <${Button} block type="submit" disabled=${busy} onClick=${submit}>${busy ? html`<${Spinner} /> Signing in…` : 'Sign in'}<//>
      <p style="margin:18px 0 0;text-align:center;font-size:13px">
        <button type="button" class="linkbtn" onClick=${() => setHelp(!help)}>Forgot your password?</button>
      </p>
      ${help ? html`<p class="note" style="margin-top:12px">Your password is the five words Jonah gave you, with dashes between them (capital letters and spaces don't matter). If it's lost, Jonah can set a new one: he signs in with the editing key and chooses <b>Settings → Password</b>, or uses the
        <button type="button" class="linkbtn" onClick=${onSetup}>setup page</button>.</p>` : null}
    </form>
  </div>`;
}

// First-time setup (Jonah): paste a GitHub key, choose a passphrase, save the
// encrypted key to the site.
export function Setup({ config, onDone, existingToken = null }) {
  const [step, setStep] = useState(existingToken ? 2 : 1);
  const [token, setToken] = useState(existingToken || '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [phrase, setPhrase] = useState(() => generatePassphrase());
  const [custom, setCustom] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const repo = `${config.owner}/${config.repo}`;

  const verify = async () => {
    setChecking(true);
    setError('');
    try {
      const gh = new GitHub({ ...config, token: token.trim() });
      const info = await gh.repoInfo();
      if (!info.permissions || !info.permissions.push) throw new Error(`This key can read ${repo} but cannot change it. Give it "Contents: Read and write".`);
      await gh.headSha();
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const finish = async () => {
    const problem = custom ? passphraseProblem(phrase) : '';
    if (problem) { setError(problem); return; }
    if (normalizePassphrase(confirmText) !== normalizePassphrase(phrase)) { setError('The two passwords do not match. Type the password again exactly.'); return; }
    setSaving(true);
    setError('');
    try {
      const file = await encryptToken(token.trim(), phrase);
      const gh = new GitHub({ ...config, token: token.trim() });
      await commitFiles(gh, { 'admin/key.json': `${JSON.stringify(file, null, 1)}\n` }, 'Set the site editor password');
      await onDone(token.trim());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return html`<div class="login">
    <div class="login-card wide">
      <h1>${existingToken ? 'Change the editing password' : 'Set up the site editor'}</h1>
      <p class="sub">${existingToken ? 'Choose a new password. The old one stops working once you save.' : 'This takes about five minutes and only has to be done once.'}</p>
      ${step === 1 ? html`
        <p><b>Step 1. Create an editing key on GitHub</b> (signed in as the owner of <code>${repo}</code>).</p>
        <ol>
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>Name it <code>Site editor</code>. Set <b>Expiration</b> to <b>No expiration</b>.</li>
          <li><b>Repository access</b>: <i>Only select repositories</i> → <code>${config.repo}</code>.</li>
          <li><b>Permissions → Repository permissions</b>: <b>Contents: Read and write</b>, and <b>Pages: Read-only</b>.</li>
          <li>Click <b>Generate token</b> and copy it.</li>
        </ol>
        <div class="field"><div class="lbl"><span>Paste the key here</span></div>
          <input class="input mono" type="password" autocomplete="off" value=${token} onInput=${e => setToken(e.target.value)} placeholder="github_pat_…" /></div>
        <p class="help" style="margin:-8px 0 16px">The key never leaves this browser except to talk to GitHub. It is stored on the site only in encrypted form.</p>
        ${error ? html`<p class="note error">${error}</p>` : null}
        <${Button} block disabled=${!token.trim() || checking} onClick=${verify}>${checking ? html`<${Spinner} /> Checking…` : 'Check the key'}<//>
      ` : html`
        ${!existingToken ? html`<p class="note ok"><${Icon} name="check" size=${14} /> The key works and can edit <code>${repo}</code>.</p>` : null}
        <p><b>${existingToken ? 'New password' : 'Step 2. Joni\'s password'}</b></p>
        ${!custom ? html`
          <div class="passphrase">${phrase}</div>
          <div class="row" style="margin-bottom:14px">
            <${Button} kind="secondary" small onClick=${() => setPhrase(generatePassphrase())}>Make another<//>
            <${Button} kind="secondary" small onClick=${() => navigator.clipboard?.writeText(phrase)}>Copy<//>
            <${Button} kind="ghost" small onClick=${() => { setCustom(true); setPhrase(''); }}>Type my own<//>
          </div>
          <p class="help" style="margin:0 0 14px">Five random words are easy to remember and very hard to guess. Write it down for Joni; capital letters and spaces don't matter when typing it.</p>
        ` : html`
          <div class="field"><div class="lbl"><span>Password</span></div><${TextInput} value=${phrase} onChange=${setPhrase} placeholder="at least four words" /></div>
        `}
        <div class="field"><div class="lbl"><span>Type the password again</span></div>
          <input class="input" value=${confirmText} onInput=${e => setConfirmText(e.target.value)} autocomplete="off" /></div>
        ${error ? html`<p class="note error">${error}</p>` : null}
        <${Button} block disabled=${saving} onClick=${finish}>${saving ? html`<${Spinner} /> Saving…` : 'Save password and open the editor'}<//>
      `}
    </div>
  </div>`;
}
