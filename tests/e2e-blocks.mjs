#!/usr/bin/env node
// End-to-end check of Fluid Engine blocks in headless Chrome, the way Joni
// arranges a page: add a block from the + ADD BLOCK menu, drag a text block by
// its words, click into text and type, move and duplicate and delete with the
// keyboard, right-click for the block menu, open Layers, look at the phone
// view, and save.
//
//   node tests/e2e-blocks.mjs [--port 8899] [--keep]

import { launch, run, step, TOKEN, BASE, BARE, git, sleep, FRAME, STATE, byText } from './lib/harness.mjs';

const SECTION = 'p-contact';

async function main() {
  const { cdp, page } = await launch();
  await page.go(`${BASE}/admin/?token=${TOKEN}`);
  await page.waitFor(`window.__ed && ${STATE}.site && document.querySelector('.side')`, 'the editor to load', 20000);
  await page.eval(`(async () => { const A = await import('/admin/js/actions.js'); A.goToPage('${SECTION}'); A.setMode('edit'); })()`);
  await page.waitFor(`${FRAME}.querySelector('[data-kind="rich"]')`, 'the Contact page in edit mode');

  // A blank section under the first one, with a text block and a button.
  const sid = await page.eval(`(async () => {
    const A = await import('/admin/js/actions.js');
    const S = await import('/admin/engine/schema.js');
    const specs = [
      { id: 'b-t1', kind: 'text', d: { x: 0, y: 0, w: 10, h: 4 }, html: '<p>Hello there, this is a text block for testing.</p>' },
      { id: 'b-b1', kind: 'button', d: { x: 0, y: 6, w: 6, h: 2 } },
    ];
    const sec = S.newSection('blocks', { rows: 8 });
    sec.blocks = specs.map(sp => { const b = S.newBlock(sp.kind, { x: sp.d.x, y: sp.d.y }); Object.assign(b, sp, { d: { ...sp.d } }); return b; });
    A.addSection('${SECTION}', 1, sec);
    window.__ed.setState({ editPanel: null, selection: { sectionId: sec.id } });
    return sec.id;
  })()`);
  await page.waitFor(`${FRAME}.querySelector('[data-sid="${sid}"] [data-bid="b-t1"]')`, 'the new section in the preview');
  await page.eval(`(() => { const d = ${FRAME}; d.querySelector('[data-sid="${sid}"]').scrollIntoView({ block: 'start' }); d.defaultView.scrollBy(0, -60); })()`);
  await sleep(400);

  const blocks = () => page.eval(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks`);
  const block = async id => (await blocks()).find(b => b.id === id);
  // A point inside a block, as fractions of its box, in window coordinates.
  const at = (id, fx = 0.5, fy = 0.5) => page.eval(`(() => {
    const ifr = document.querySelector('.stage iframe'); const fr = ifr.getBoundingClientRect();
    const el = ifr.contentDocument.querySelector('[data-sid="${sid}"] [data-bid="${id}"]'); const r = el.getBoundingClientRect();
    return { x: fr.left + r.left + r.width * ${fx}, y: fr.top + r.top + r.height * ${fy} };
  })()`);
  const selection = () => page.eval(`${STATE}.selection`);
  const clearToasts = () => page.eval(`window.__ed.setState({ toasts: [] })`);
  const undo = async () => { await page.eval(`import('/admin/js/store.js').then(m => m.undo())`); await sleep(250); await clearToasts(); };

  await step('+ ADD BLOCK opens a searchable menu, and Enter adds the first match', async () => {
    const before = (await blocks()).length;
    await page.clickOn(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('ADD BLOCK'))`);
    await page.waitFor(`document.querySelector('.bk-addmenu input')`, 'the block menu');
    const tiles = await page.eval(`document.querySelectorAll('.bk-addmenu button').length`);
    if (tiles < 10) throw new Error(`only ${tiles} block kinds in the menu`);
    await page.fill(`document.querySelector('.bk-addmenu input')`, 'butt');
    await page.key('Enter');
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.length === ${before + 1}`, 'the new block');
    const added = (await blocks()).at(-1);
    if (added.kind !== 'button') throw new Error(`added a ${added.kind} block, not a button`);
    await page.eval(`window.__ed.setState({ editPanel: null })`);
    await clearToasts();
  });

  await step('dragging a text block by its words moves it on the grid, and undo puts it back', async () => {
    const before = (await block('b-t1')).d;
    const grid = await page.eval(`(() => {
      const g = ${FRAME}.querySelector('[data-sid="${sid}"] .fe-grid'); const cs = ${FRAME}.defaultView.getComputedStyle(g);
      return { col: parseFloat(cs.gridTemplateColumns), gap: parseFloat(cs.columnGap), row: parseFloat(cs.gridTemplateRows) };
    })()`);
    const from = await at('b-t1', 0.3, 0.12);
    await page.drag(from.x, from.y, from.x + (grid.col + grid.gap) * 3, from.y + grid.row * 2, { steps: 10 });
    await sleep(300);
    const after = (await block('b-t1')).d;
    if (after.x !== before.x + 3 || after.y !== before.y + 2) throw new Error(`moved to ${JSON.stringify(after)} from ${JSON.stringify(before)}`);
    if (await page.eval(`!!${FRAME}.activeElement?.dataset?.edit`)) throw new Error('dragging started typing');
    await undo();
    if (JSON.stringify((await block('b-t1')).d) !== JSON.stringify(before)) throw new Error('undo did not put the block back');
  });

  await step('a click in the text puts the cursor there, typing works, and Escape keeps the block selected', async () => {
    const p = await at('b-t1', 0.3, 0.12);
    await page.click(p.x, p.y);
    await page.waitFor(`${FRAME}.activeElement?.dataset?.edit === 's:${sid}|blocks.b-t1.html'`, 'the cursor in the text');
    await page.type('XY');
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.find(b => b.id === 'b-t1').html.includes('XY')`, 'the typed letters in the site');
    await page.key('Escape', { code: 'Escape' });
    await page.waitFor(`!${FRAME}.activeElement?.dataset?.edit`, 'the cursor to leave the text');
    if ((await selection())?.blockId !== 'b-t1') throw new Error('the block is no longer selected');
  });

  await step('arrow keys move the selected block, ⌘D duplicates it, Delete removes the copy', async () => {
    const x = (await block('b-t1')).d.x;
    const count = (await blocks()).length;
    await page.key('ArrowRight');
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.find(b => b.id === 'b-t1').d.x === ${x + 1}`, 'the block to move one column');
    await page.key('d', { meta: true });
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.length === ${count + 1}`, 'the copy');
    await page.key('Delete');
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.length === ${count}`, 'the copy to be deleted');
    if (!(await blocks()).some(b => b.id === 'b-t1')) throw new Error('deleted the original instead of the copy');
    await clearToasts();
  });

  await step('right-click shows the block menu, and Hide on mobile hides it on phones', async () => {
    const p = await at('b-b1', 0.5, 0.5);
    await page.rightClick(p.x, p.y);
    await page.waitFor(`document.querySelector('.menu')`, 'the block menu');
    const items = await page.eval(`[...document.querySelectorAll('.menu button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
    for (const want of ['Duplicate', 'Hide on desktop', 'Hide on mobile', 'Delete']) {
      if (!items.some(i => i.startsWith(want))) throw new Error(`no "${want}" in the menu (${items.join(' | ')})`);
    }
    await page.clickOn(`[...document.querySelectorAll('.menu button')].find(b => b.textContent.trim() === 'Hide on mobile')`);
    await page.waitFor(`${STATE}.site.pages.find(p => p.id === '${SECTION}').sections.find(s => s.id === '${sid}').blocks.find(b => b.id === 'b-b1').hideMobile === true`, 'the button hidden on mobile');
  });

  await step('Layers lists the blocks, and double-clicking a block opens its panel', async () => {
    await page.clickOn(`document.querySelector('.bk-tools button[aria-label="Layers"]')`);
    await page.waitFor(`document.querySelector('.bk-pop')`, 'the Layers list');
    const rows = await page.eval(`document.querySelectorAll('.bk-pop li, .bk-pop [role="listitem"], .bk-pop .bk-layer').length`);
    if (rows < 2) throw new Error(`Layers shows ${rows} rows`);
    await page.key('Escape', { code: 'Escape' });
    // (On text, a double-click selects a word; on other blocks it opens the panel.)
    const p = await at('b-b1', 0.5, 0.5);
    await page.dblclick(p.x, p.y);
    await page.waitFor(`${STATE}.editPanel?.kind === 'block'`, 'the Edit Block panel');
    await page.eval(`window.__ed.setState({ editPanel: null })`);
  });

  await step('on the phone view the blocks stack, the hidden one is faded, and + ADD BLOCK is not offered', async () => {
    await page.eval(`window.__ed.setState({ device: 'mobile' })`);
    await page.waitFor(`document.querySelector('.stage iframe').getBoundingClientRect().width < 500`, 'the phone-width preview');
    await sleep(500);
    // In the editor a block hidden on phones stays on screen, faded, so it can be selected and shown again.
    const r = await page.eval(`(() => {
      const d = ${FRAME}; const sec = d.querySelector('[data-sid="${sid}"]');
      const els = [...sec.querySelectorAll('[data-bid]')];
      const info = el => ({ id: el.dataset.bid, opacity: Number(getComputedStyle(el).opacity), top: Math.round(el.getBoundingClientRect().top), width: Math.round(el.getBoundingClientRect().width) });
      return { blocks: els.map(info), secW: Math.round(sec.querySelector('.fe-grid').getBoundingClientRect().width) };
    })()`);
    const text = r.blocks.find(b => b.id === 'b-t1');
    const button = r.blocks.find(b => b.id === 'b-b1');
    if (!text || !button) throw new Error('a block is missing on the phone view');
    if (button.opacity >= 1) throw new Error('the block hidden on phones is not faded');
    if (text.opacity !== 1) throw new Error('the text block is faded on phones');
    if (r.blocks.some(b => b.width < r.secW * 0.9)) throw new Error(`blocks are not full width on phones: ${r.blocks.map(b => b.width)} of ${r.secW}`);
    if (new Set(r.blocks.map(b => b.top)).size !== r.blocks.length) throw new Error('blocks overlap on phones');
    const hasAddPill = await page.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('ADD BLOCK') && b.getBoundingClientRect().width > 0)`);
    if (hasAddPill) throw new Error('+ ADD BLOCK is offered on the phone view');
    await page.eval(`window.__ed.setState({ device: 'desktop' })`);
  });

  await step('Save publishes the blocks, with the button hidden on phones', async () => {
    const headBefore = git(BARE, 'rev-parse', 'main').trim();
    await page.clickOn(byText(`document.querySelectorAll('.topbar button')`, 'Save'));
    await page.waitFor(`['deploying', 'live'].includes(${STATE}.save.status)`, 'the save', 30000);
    const head = git(BARE, 'rev-parse', 'main').trim();
    if (head === headBefore) throw new Error('no new commit');
    const html = git(BARE, 'show', `${head}:contact.html`);
    for (const want of ['fe-b k-text', 'fe-b k-button', 'hide-m', 'Hello there']) {
      if (!html.includes(want)) throw new Error(`contact.html lacks "${want}"`);
    }
    if (html.includes('data-bid')) throw new Error('editor markings leaked into the published page');
  });

  cdp.close();
}

run(main);
