#!/usr/bin/env node
// End-to-end check of the site editor in headless Chrome, used the way Joni
// uses it: open a page from the Pages panel, click EDIT, type into text, undo
// and redo with the keyboard, apply a theme in Site Styles, drop an image file
// onto the page, add a painting through Edit Gallery, delete and restore a
// page, add a section, save, and then confirm the commit that reached the
// (mock) GitHub repository.
//
//   node tests/e2e-editor.mjs [--port 8899] [--keep]
//
// Signing in is covered by tests/e2e-login.mjs; this one signs in with the
// mock server's ?token= shortcut.

import { launch, run, step, ROOT, TOKEN, BASE, TMP, BARE, git, sleep, FRAME, STATE, byText, writePng, path } from './lib/harness.mjs';

const TYPED = ' Typed by the end-to-end test.';

async function main() {
  const { cdp, page } = await launch();
  const headBefore = git(BARE, 'rev-parse', 'main').trim();

  await step('the editor opens signed in, on the Pages panel', async () => {
    await page.go(`${BASE}/admin/?token=${TOKEN}`);
    await page.waitFor(`window.__ed && ${STATE}.site && document.querySelector('.side')`, 'the editor to load', 20000);
    await page.waitFor(`${FRAME}?.querySelector('.site-header, header')`, 'the preview to render');
  });

  await step('clicking Contact in the Pages panel shows that page', async () => {
    await page.clickOn(byText(`document.querySelectorAll('.side button, .side a, .side [role=button], .side li')`, 'Contact'));
    await page.waitFor(`${STATE}.pageId === 'p-contact'`, 'the Contact page');
    await page.waitFor(`${FRAME}.querySelector('[data-sid]')`, 'the Contact page in the preview');
  });

  await step('EDIT turns on editing', async () => {
    await page.clickOn(`document.querySelector('.web-edit button')`);
    await page.waitFor(`${STATE}.mode === 'edit' && document.querySelector('.topbar')`, 'edit mode');
    await page.waitFor(`${FRAME}.querySelector('[data-kind="rich"]')`, 'editable text in the preview');
  });

  await step('clicking into text and typing changes the page', async () => {
    // Click near the end of the last line of the first text block, then type.
    const at = await page.eval(`(() => {
      const el = ${FRAME}.querySelector('[data-kind="rich"]');
      const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.textContent.trim() ? 1 : 3 });
      let last = null; while (walker.nextNode()) last = walker.currentNode;
      const range = el.ownerDocument.createRange(); range.setStart(last, last.length); range.setEnd(last, last.length);
      const r = range.getClientRects()[0] || last.parentElement.getBoundingClientRect();
      const f = el.ownerDocument.defaultView.frameElement.getBoundingClientRect();
      return { x: f.left + r.right - 1, y: f.top + r.top + r.height / 2 };
    })()`);
    await page.click(at.x, at.y);
    await page.waitFor(`${FRAME}.activeElement?.isContentEditable`, 'the text to take the cursor');
    await page.key('End', { code: 'End' });
    await page.type(TYPED);
    await page.waitFor(`JSON.stringify(${STATE}.site.pages.find(p => p.id === 'p-contact')).includes(${JSON.stringify(TYPED.trim())})`, 'the typed text in the site');
  });

  await step('⌘Z undoes the typing and ⇧⌘Z brings it back', async () => {
    const has = `JSON.stringify(${STATE}.site.pages.find(p => p.id === 'p-contact')).includes(${JSON.stringify(TYPED.trim())})`;
    await page.key('z', { meta: true });
    await page.waitFor(`!(${has}) && !${FRAME}.body.textContent.includes(${JSON.stringify(TYPED.trim())})`, 'the undo');
    // The undone text must stay undone, and the cursor stays in the text.
    await sleep(600);
    if (await page.eval(has)) throw new Error('the undone text came back');
    if (!(await page.eval(`${FRAME}.activeElement?.isContentEditable`))) throw new Error('the cursor left the text after undo');
    await page.key('z', { meta: true, shift: true });
    await page.waitFor(`(${has}) && ${FRAME}.body.textContent.includes(${JSON.stringify(TYPED.trim())})`, 'the redo');
  });

  await step('an article title in the Art Writing list can be typed in and undone', async () => {
    await page.key('Escape', { code: 'Escape' });
    await page.eval(`window.__ed.setState({ pageId: 'p-art-writing' })`);
    await page.waitFor(`${FRAME}.querySelector('.post-title [data-edit]')`, 'the article list');
    const title = `${FRAME}.querySelector('.post-title [data-edit]')`;
    const original = await page.eval(`${title}.textContent`);
    const end = await page.eval(`(() => {
      const el = ${title}; const r = el.getBoundingClientRect(); const f = el.ownerDocument.defaultView.frameElement.getBoundingClientRect();
      return { x: f.left + r.right - 2, y: f.top + r.top + r.height / 2 };
    })()`);
    await page.click(end.x, end.y);
    await page.waitFor(`${FRAME}.activeElement === ${title}`, 'the title to take the cursor');
    await page.key('End', { code: 'End' });
    await page.type(' (draft)');
    const stored = `JSON.stringify(${STATE}.site.pages).includes(${JSON.stringify(original + ' (draft)')})`;
    await page.waitFor(stored, 'the new title in the site');
    await page.key('z', { meta: true });
    await page.waitFor(`!(${stored}) && ${title}.textContent === ${JSON.stringify(original)}`, 'the title to go back');
    await sleep(600);
    if (await page.eval(stored)) throw new Error('the undone title came back');
    await page.key('Escape', { code: 'Escape' });
    await page.eval(`window.__ed.setState({ pageId: 'p-contact' })`);
    await page.waitFor(`${FRAME}.querySelector('[data-kind="rich"]')`, 'the Contact page again');
  });

  await step('Site Styles: a theme changes fonts and colors, and the panel arrow undoes it', async () => {
    await page.key('Escape', { code: 'Escape' });
    await page.clickOn(`document.querySelector('.topbar button[aria-label="Site Styles"]')`);
    await page.waitFor(`document.querySelector('.styles-dock')`, 'the Site Styles panel');
    await page.clickOn(byText(`document.querySelectorAll('.styles-dock .st-row-name')`, 'Themes'));
    await page.clickOn(byText(`document.querySelectorAll('.styles-dock .st-theme-name')`, 'Night'));
    await page.waitFor(`${STATE}.site.design.colors.background === '#111111'`, 'the Night colors');
    await page.waitFor(`getComputedStyle(${FRAME}.body).backgroundColor === 'rgb(17, 17, 17)'`, 'the preview to turn dark');
    await page.clickOn(`document.querySelector('.styles-dock .fpanel-head button[aria-label="Undo"]')`);
    await page.waitFor(`${STATE}.site.design.colors.background === '#ffffff'`, 'the undo of the theme');
    await page.clickOn(`document.querySelector('.styles-dock .fpanel-head button[aria-label="Close"]')`);
  });

  await step('dropping an image file onto a section adds an image block there', async () => {
    const before = await page.eval(`Object.keys(${STATE}.site.media).length`);
    await page.eval(`(async () => {
      const doc = ${FRAME};
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const g = canvas.getContext('2d'); g.fillStyle = '#7a9a6b'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#e8d36a'; g.fillRect(160, 120, 320, 240);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], 'test-drop.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(file);
      const target = doc.querySelector('[data-sid] .fe-grid');
      const r = target.getBoundingClientRect();
      const at = { clientX: r.left + r.width * 0.6, clientY: r.top + r.height + 30, bubbles: true, cancelable: true, dataTransfer: dt };
      window.__drop = () => target.dispatchEvent(new DragEvent('drop', at));
      target.dispatchEvent(new DragEvent('dragenter', at));
      target.dispatchEvent(new DragEvent('dragover', at));
    })()`);
    await page.waitFor(`document.querySelector('.ov-ghost')`, 'the box showing where the image will go');
    await page.eval(`window.__drop()`);
    await page.waitFor(`Object.keys(${STATE}.site.media).length > ${before}`, 'the new image', 15000);
    const block = await page.waitFor(`(() => {
      const st = ${STATE};
      const sec = st.site.pages.find(p => p.id === 'p-contact').sections[0];
      return (sec.blocks || []).find(b => b.kind === 'image' && st.site.media[b.media]?.src.includes('test-drop')) || null;
    })()`, 'an image block in the section');
    if (block.d.w !== 8 || block.d.x < 8) throw new Error(`unexpected place ${JSON.stringify(block.d)}`);
    await page.waitFor(`[...${FRAME}.querySelectorAll('[data-bid] img')].some(i => i.src.startsWith('blob:') || i.src.includes('test-drop'))`, 'the image in the preview');
  });

  await step('Edit Gallery: + then Upload Images adds a painting to the Painting page', async () => {
    const png = writePng(path.join(TMP, 'New Painting.png'), 300, 400);
    await page.eval(`window.__ed.setState({ pageId: 'p-painting', editPanel: null, selection: null })`);
    await page.waitFor(`${FRAME}.querySelector('[data-type="gallery"] img')`, 'the Painting gallery');
    const before = await page.eval(`${STATE}.site.pages.find(p => p.id === 'p-painting').sections[0].items.length`);
    // Hover the gallery, then use the section toolbar as Joni would.
    await page.hoverOn(`${FRAME}.querySelector('[data-type="gallery"] img')`);
    await page.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('EDIT GALLERY'))`, 'the EDIT GALLERY button');
    await page.clickOn(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('EDIT GALLERY'))`);
    await page.waitFor(`document.querySelector('.gl-add')`, 'the gallery images panel');
    await page.clickOn(`document.querySelector('.gl-add')`);
    await page.waitFor(`document.querySelector('.menu')`, 'the add menu');
    page.willChoose([png]);
    await page.clickOn(byText(`document.querySelectorAll('.menu button, .menu [role=menuitem]')`, 'Upload Images'));
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === 'p-painting').sections[0].items.length === ${before + 1}`, 'the new painting in the gallery', 20000);
    await page.waitFor(`[...${FRAME}.querySelectorAll('[data-type="gallery"] img')].some(i => i.src.startsWith('blob:'))`, 'the new painting in the preview');
    await page.clickOn(`document.querySelector('.fpanel-head button[aria-label="Close"]')`);
  });

  await step('Save publishes one commit with the text, the page and the image', async () => {
    await page.clickOn(byText(`document.querySelectorAll('.topbar button')`, 'Save'));
    await page.waitFor(`['deploying', 'live'].includes(${STATE}.save.status)`, 'the save', 30000);
    const head = git(BARE, 'rev-parse', 'main').trim();
    if (head === headBefore) throw new Error('no new commit');
    const changed = git(BARE, 'diff', '--name-only', headBefore, head).split('\n').filter(Boolean);
    for (const f of ['content/site.json', 'contact.html']) if (!changed.includes(f)) throw new Error(`${f} not in the commit (${changed.join(', ')})`);
    if (!changed.some(f => f.startsWith('images/') && f.includes('test-drop'))) throw new Error(`the image is not in the commit (${changed.join(', ')})`);
    const painting = changed.find(f => f.startsWith('images/') && /new[-_ ]painting/i.test(f));
    if (!painting) throw new Error(`the uploaded painting is not in the commit (${changed.join(', ')})`);
    if (!git(BARE, 'show', `${head}:index.html`).includes(painting.split('/').pop().replace(/\.[a-z]+$/, ''))) throw new Error('the homepage does not show the new painting');
    const html = git(BARE, 'show', `${head}:contact.html`);
    if (!html.includes(TYPED.trim())) throw new Error('contact.html does not have the typed text');
    if (git(BARE, 'rev-list', '--count', `${headBefore}..${head}`).trim() !== '1') throw new Error('more than one commit');
  });

  await step('after a reload the saved work is there and nothing is unsaved', async () => {
    await page.go(`${BASE}/admin/?token=${TOKEN}`);
    await page.waitFor(`window.__ed && ${STATE}.site && ${STATE}.baseSite`, 'the editor to load', 20000);
    await page.waitFor(`JSON.stringify(${STATE}.site).includes(${JSON.stringify(TYPED.trim())})`, 'the saved text');
    const dirty = await page.eval(`JSON.stringify(${STATE}.site) !== JSON.stringify(${STATE}.baseSite)`);
    if (dirty) throw new Error('the editor shows unsaved changes after a reload');
  });

  await step('deleting a page puts it in Deleted Pages, and Restore brings it back', async () => {
    const row = byText(`document.querySelectorAll('.side .prow .pname')`, 'Writing');
    const at = await page.center(row);
    await page.mouse('mouseMoved', at.x, at.y, { button: 'none' });
    await page.clickOn(`${row}.closest('.prow').querySelector('button[aria-label="Delete page"]')`);
    await page.waitFor(byText(`document.querySelectorAll('.modal button, [role=dialog] button')`, 'Delete'), 'the delete confirmation');
    await page.clickOn(byText(`document.querySelectorAll('.modal button, [role=dialog] button')`, 'Delete'));
    await page.waitFor(`!${STATE}.site.pages.some(p => p.id === 'p-writing') && ${STATE}.site.trash[0]?.page.id === 'p-writing'`, 'the page in the trash');
    await page.clickOn(`document.querySelector('.pg-trashlink')`);
    await page.waitFor(`document.querySelector('.pg-trashrow[data-page="p-writing"]')`, 'the Deleted Pages list');
    await page.clickOn(byText(`document.querySelectorAll('.pg-trashrow[data-page="p-writing"] button')`, 'Restore'));
    await page.waitFor(`${STATE}.site.pages.some(p => p.id === 'p-writing' && p.slug === 'writing') && !${STATE}.site.trash.length`, 'the restored page');
  });

  await step('Add Section, then + Add Blank and Section, adds an empty Fluid Engine section', async () => {
    await page.eval(`window.__ed.setState({ pageId: 'p-contact', mode: 'edit', editPanel: null, selection: null })`);
    await page.waitFor(`${FRAME}.querySelector('[data-kind="rich"]')`, 'the Contact page in edit mode');
    const count = await page.eval(`${STATE}.site.pages.find(p => p.id === 'p-contact').sections.length`);
    await page.hoverOn(`${FRAME}.querySelector('[data-sid]')`);
    await page.waitFor(`document.querySelector('.ov-add')`, 'the ADD SECTION button');
    await page.clickOn(`[...document.querySelectorAll('.ov-add')].pop()`);
    await page.waitFor(`document.querySelector('.se-addblank')`, 'the Add Section dialog');
    await page.clickOn(`document.querySelector('.se-addblank')`);
    await page.waitFor(`document.querySelector('.menu')`, 'the Add Blank menu');
    await page.clickOn(byText(`document.querySelectorAll('.menu button, .menu [role=menuitem]')`, 'Section'));
    await page.waitFor(`(() => {
      const secs = ${STATE}.site.pages.find(p => p.id === 'p-contact').sections;
      return secs.length === ${count + 1} && secs.some(s => s.type === 'blocks' && !(s.blocks || []).length);
    })()`, 'the new blank section');
    await page.waitFor(`${FRAME}.querySelectorAll('[data-sid]').length === ${count + 1}`, 'the blank section in the preview');
  });

  await step('the phone view narrows the preview', async () => {
    await page.clickOn(`document.querySelector('button[aria-label="Phone view"]')`);
    await page.waitFor(`document.querySelector('.stage iframe, iframe').getBoundingClientRect().width < 500`, 'the phone-width preview');
  });

  cdp.close();
}

run(main);
