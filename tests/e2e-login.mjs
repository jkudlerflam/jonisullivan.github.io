#!/usr/bin/env node
// End-to-end check of getting into the editor, in headless Chrome against the
// mock GitHub server: Jonah's first-time setup (the editing key and Joni's
// five-word password), then Joni signing in with it (typed with capitals and
// spaces, the way a person writes it down), "Remember me", logging out, and
// changing the password. Only the mock server's throwaway test key is used.
//
//   node tests/e2e-login.mjs [--port 8899] [--keep]

import { launch, run, step, openPage, TOKEN, BASE, BARE, git, sleep, STATE, byText } from './lib/harness.mjs';

const buttons = text => byText(`document.querySelectorAll('button')`, text);
const keyInput = `document.querySelector('input[placeholder^="github_pat"]')`;
const confirmInput = `[...document.querySelectorAll('.field')].find(f => f.textContent.includes('Type the password again')).querySelector('input')`;
const loginInput = `document.querySelector('.login input[type="password"]')`;
const editorOpen = `window.__ed && ${STATE}.site && document.querySelector('.topbar, .side')`;

async function main() {
  const { cdp, page } = await launch();
  const tokenStored = () => page.eval(`({ local: localStorage.getItem('site-editor-token'), session: sessionStorage.getItem('site-editor-token') })`);
  let phrase = '';

  await step('with no key on the site yet, the editor offers first-time setup', async () => {
    await page.go(`${BASE}/admin/`);
    await page.waitFor(`document.querySelector('.login h1')?.textContent.includes('Set up the site editor')`, 'the setup screen');
  });

  await step('a wrong key is refused with a message', async () => {
    await page.go(`${BASE}/admin/?setup`);
    await page.waitFor(keyInput, 'the key field');
    await page.fill(keyInput, 'not-a-real-key');
    await page.clickOn(buttons('Check the key'));
    await page.waitFor(`document.querySelector('.note.error')`, 'an error message');
    if (await page.eval(`!!document.querySelector('.passphrase')`)) throw new Error('moved on with a bad key');
  });

  await step('the right key moves on and offers five random words', async () => {
    await page.fill(keyInput, TOKEN);
    await page.clickOn(buttons('Check the key'));
    await page.waitFor(`document.querySelector('.passphrase')`, 'the password step');
    phrase = await page.eval(`document.querySelector('.passphrase').textContent.trim()`);
    if (!/^[a-z]+(-[a-z]+){4}$/.test(phrase)) throw new Error(`not five words with dashes: ${phrase}`);
    await page.clickOn(buttons('Make another'));
    await page.waitFor(`document.querySelector('.passphrase').textContent.trim() !== ${JSON.stringify(phrase)}`, 'a different password');
    phrase = await page.eval(`document.querySelector('.passphrase').textContent.trim()`);
  });

  await step('the two passwords must match, then setup saves and opens the editor', async () => {
    await page.fill(confirmInput, 'something else entirely');
    await page.clickOn(buttons('Save password and open the editor'));
    await page.waitFor(`document.querySelector('.note.error')?.textContent.includes('do not match')`, 'the mismatch message');
    // Typed back the way a person might: capitals and spaces.
    await page.fill(confirmInput, phrase.toUpperCase().replaceAll('-', ' '));
    await page.clickOn(buttons('Save password and open the editor'));
    await page.waitFor(editorOpen, 'the editor to open', 30000);
  });

  await step('setup committed only admin/key.json, and the key is not readable in it', async () => {
    const subject = git(BARE, 'log', '-1', '--format=%s', 'main').trim();
    if (subject !== 'Set the site editor password') throw new Error(`commit message: ${subject}`);
    const changed = git(BARE, 'show', '--name-only', '--format=', 'main').split('\n').filter(Boolean);
    if (changed.join() !== 'admin/key.json') throw new Error(`changed files: ${changed.join(', ')}`);
    const text = git(BARE, 'show', 'main:admin/key.json');
    if (text.includes(TOKEN)) throw new Error('the key is stored in readable form');
    const file = JSON.parse(text);
    if (file.iterations !== 1000000 || !file.salt || !file.iv || !file.data) throw new Error('unexpected key file');
  });

  await step('a new visit shows the sign-in screen, and a wrong password is refused', async () => {
    await page.eval(`localStorage.clear(); sessionStorage.clear()`);
    await page.go(`${BASE}/admin/`);
    await page.waitFor(`document.querySelector('.login') && ${loginInput}`, 'the sign-in screen');
    if (await page.eval(`!!document.querySelector('.login h1')?.textContent.includes('Set up')`)) throw new Error('showed setup instead of sign-in');
    await page.fill(loginInput, 'maple-river-stone-lamp-cloud');
    await page.clickOn(buttons('Sign in'));
    await page.waitFor(`document.querySelector('.note.error')?.textContent.includes("didn't work")`, 'the wrong password message', 20000);
    if ((await tokenStored()).local) throw new Error('stored a key after a wrong password');
  });

  await step('the password works typed with capitals and spaces, and Remember me keeps her signed in', async () => {
    await page.fill(loginInput, `  ${phrase.toUpperCase().replaceAll('-', '  ')} `);
    await page.clickOn(buttons('Sign in'));
    await page.waitFor(editorOpen, 'the editor to open', 30000);
    if ((await tokenStored()).local !== TOKEN) throw new Error('Remember me did not keep the key on this computer');
    await page.go(`${BASE}/admin/`);
    await page.waitFor(editorOpen, 'the editor to open again without a password', 20000);
  });

  await step('Log out returns to the sign-in screen and forgets the key', async () => {
    await page.eval(`window.__ed.setState({ sidePanel: 'settings' })`);
    await page.clickOn(buttons('Log out'));
    await page.waitFor(`document.querySelector('.login') && ${loginInput}`, 'the sign-in screen');
    const t = await tokenStored();
    if (t.local || t.session) throw new Error('the key was kept after logging out');
  });

  await step('without Remember me, a reload keeps her in but a new tab asks for the password', async () => {
    await page.fill(loginInput, phrase);
    await page.clickOn(`document.querySelector('.toggle')`);
    await page.waitFor(`document.querySelector('.toggle')?.classList.contains('on') === false`, 'the switch to turn off');
    await page.clickOn(buttons('Sign in'));
    await page.waitFor(editorOpen, 'the editor to open', 30000);
    const t = await tokenStored();
    if (t.local || t.session !== TOKEN) throw new Error('the key should be kept for this tab only');
    await page.go(`${BASE}/admin/`);
    await page.waitFor(editorOpen, 'the editor after a reload', 20000);
    const other = await openPage(cdp);
    await other.go(`${BASE}/admin/`);
    try {
      await other.waitFor(`document.querySelector('.login') && document.querySelector('.login input[type="password"]')`, 'the sign-in screen in a new tab');
    } catch (e) {
      const seen = await other.eval(`location.href + ' :: ' + document.body.innerText.slice(0, 140).replace(/\\n/g, ' | ')`).catch(() => '(unreadable)');
      throw new Error(`${e.message}; the new tab shows ${seen}`);
    }
  });

  await step('Change password makes a new one and the old one stops working', async () => {
    await page.eval(`window.__ed.setState({ sidePanel: 'settings' })`);
    await page.clickOn(buttons('Change password'));
    await page.waitFor(`document.querySelector('.passphrase')`, 'the new password screen');
    const fresh = await page.eval(`document.querySelector('.passphrase').textContent.trim()`);
    if (fresh === phrase) throw new Error('offered the same password');
    await page.fill(confirmInput, fresh);
    await page.clickOn(buttons('Save password and open the editor'));
    await page.waitFor(editorOpen, 'the editor to open', 30000);
    const subject = git(BARE, 'log', '-1', '--format=%s', 'main').trim();
    if (subject !== 'Set the site editor password') throw new Error(`commit message: ${subject}`);
    // Sign out, then the old password is refused and the new one works.
    await page.eval(`window.__ed.setState({ sidePanel: 'settings' })`);
    await page.clickOn(buttons('Log out'));
    await page.waitFor(`document.querySelector('.login') && ${loginInput}`, 'the sign-in screen');
    await page.fill(loginInput, phrase);
    await page.clickOn(buttons('Sign in'));
    await page.waitFor(`document.querySelector('.note.error')?.textContent.includes("didn't work")`, 'the old password to be refused', 20000);
    await page.fill(loginInput, fresh);
    await page.clickOn(buttons('Sign in'));
    await page.waitFor(editorOpen, 'the editor with the new password', 30000);
  });

  await sleep(100);
  cdp.close();
}

run(main);
