'use strict';
/*
 * A line you type in has to land where the printed list has it.
 *
 * The sheet is the paper sheet: it runs in a fixed order the brigade knows
 * by heart. Appending to the bottom breaks that — you end up scanning the
 * whole sheet for the one line that is out of place. So: added lines slot
 * into the master list's order, and orders read out in the supplier's own
 * catalogue order.
 *
 *   node test/ordering.js
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ui-secret';

const { chromium } = require('playwright');
const h = require('./helpers');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log(`  ok   ${m}`); };
const bad = (m, d) => { failures++; console.log(`  FAIL ${m}\n       ${d}`); };
const is = (a, b, m) => (String(a) === String(b) ? ok(m) : bad(m, `expected ${b}, got ${a}`));

(async () => {
  const base = await h.start();
  await h.reset();
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#lg-e', 'eyal@restaurantshabour.com');
  await page.fill('#lg-c', '2011');
  await page.click('[data-act="login"]');
  await page.waitForSelector('[data-act="tab"]', { state: 'attached', timeout: 8000 });
  await page.waitForTimeout(300);

  console.log('\nadded lines land where the list puts them\n');

  /* ---------- the prep list ---------- */
  await page.click('[data-act="tab"][data-tab="prep"]');
  await page.waitForSelector('.crow', { timeout: 8000 });

  const names = () => page.$$eval('.catgrid .crow .cname', els => els.map(e => e.textContent.trim()));
  const before = await names();
  if (before.length < 30) bad('the list is loaded', `only ${before.length} products`);
  else ok(`the list is loaded (${before.length} products)`);

  const at = 20;
  const target = before[at];
  const above = before[at - 1];

  /* take it off the list, the way you would if the kitchen stopped making it */
  await page.$$eval('.catgrid .crow', (rows, i) => {
    const b = rows[i].querySelector('.plus');
    /* the catalogue row has no remove button; drop it through the sheet instead */
    b.setAttribute('data-probe', '1');
  }, at);
  await page.evaluate((title) => {
    /* remove through the app's own action, not the DOM */
    const rows = [...document.querySelectorAll('.catgrid .crow')];
    const row = rows.find(r => r.querySelector('.cname').textContent.trim() === title);
    row.querySelector('.plus').click();          // put it on today's sheet
  }, target);
  await page.waitForTimeout(400);

  const onSheet = await page.$$eval('.sheetgrid .prow .pname', els => els.map(e => e.textContent.trim()));
  if (onSheet.includes(target)) ok(`"${target}" goes onto today's sheet with +`);
  else bad("+ puts a product on today's sheet", `sheet holds ${JSON.stringify(onSheet)}`);

  /* and comes back off with the same button */
  await page.evaluate((title) => {
    const rows = [...document.querySelectorAll('.catgrid .crow')];
    const row = rows.find(r => r.querySelector('.cname').textContent.trim() === title);
    row.querySelector('.plus').click();
  }, target);
  await page.waitForTimeout(400);
  const cleared = await page.$$eval('.sheetgrid .prow .pname', els => els.map(e => e.textContent.trim())).catch(() => []);
  is(cleared.includes(target), 'false', `"${target}" comes back off the sheet`);

  /* a typed line lands in the printed list's order, not at the bottom */
  await page.evaluate((title) => {
    const rows = [...document.querySelectorAll('.catgrid .crow')];
    const row = rows.find(r => r.querySelector('.cname').textContent.trim() === title);
    row.scrollIntoView();
  }, target);
  await page.fill('#prep-t-cat', target);
  await page.click('[data-act="addPrep"][data-where="cat"]');
  await page.waitForTimeout(400);
  const after = await names();
  is(after.filter(n => n === target).length, 2, `"${target}" typed in appears a second time`);
  is(after.indexOf(target), at, `and lands at position ${at + 1}, beside its twin, not at the bottom`);
  is(after[at - 1], above, `still under "${above}"`);

  /* something the printed list has never heard of belongs at the end */
  await page.fill('#prep-t-cat', 'Zaatar butter for the pass');
  await page.click('[data-act="addPrep"][data-where="cat"]');
  await page.waitForTimeout(400);
  const withNew = await names();
  is(withNew[withNew.length - 1], 'Zaatar butter for the pass',
     'a line that is not on the printed list goes last');

  /* ---------- the order pad ---------- */
  await page.click('[data-act="tab"][data-tab="orders"]');
  await page.waitForSelector('#ord-t', { timeout: 8000 });

  /* typed out of catalogue order, on purpose */
  for (const p of ['Cucumber', 'Big onion', 'Carrot']) {
    await page.fill('#ord-t', p);
    await page.click('[data-act="addOrder"]');
    await page.waitForTimeout(250);
  }
  const ordered = await page.$$eval('.row .rt', els => els.map(e => e.textContent.trim().split('\n')[0]));
  const seen = ['Big onion', 'Carrot', 'Cucumber'].map(p => ordered.findIndex(t => t.startsWith(p)));
  if (seen.some(i => i < 0)) bad('all three lines are on the pad', JSON.stringify(ordered.slice(0, 6)));
  else if (seen[0] < seen[1] && seen[1] < seen[2])
    ok('the pad reads out in the catalogue order: Big onion, Carrot, Cucumber');
  else bad('the pad reads out in catalogue order', `positions ${seen.join(', ')}`);

  /* ---------- both lists keep only what the kitchen uses ---------- */
  await page.click('[data-act="loadOrdCat"]');
  await page.waitForTimeout(1600);
  const catN = await page.$$eval('.crow.ord', e => e.length);
  if (catN > 100) ok(`the order list loads from the order sheet (${catN} products)`);
  else bad('the order list loads', `only ${catN} products`);

  /* + puts one on the pad, at its catalogue position */
  const first = await page.$eval('.crow.ord .cname', e => e.textContent.trim());
  await page.evaluate(() => document.querySelector('.crow.ord .plus').click());
  await page.waitForTimeout(700);
  const pad = await page.$$eval('.row .rt', els => els.map(e => e.textContent.trim()));
  if (pad.some(t => t.startsWith(first))) ok(`"${first}" goes onto the pad with +`);
  else bad('+ puts a product on the pad', JSON.stringify(pad.slice(0, 4)));

  /* pressing it twice does not double the line */
  await page.evaluate(() => document.querySelector('.crow.ord .plus').click());
  await page.waitForTimeout(600);
  const pad2 = await page.$$eval('.row .rt', els => els.map(e => e.textContent.trim()));
  is(pad2.filter(t => t.startsWith(first)).length, 1, 'and pressing + again does not double it');

  /* the arrow moves one out of the way, and it comes back */
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.crow.ord')];
    rows[1].querySelector('.x').click();
  });
  await page.waitForTimeout(700);
  is(await page.$$eval('.crow.ord', e => e.length), catN - 1, 'the arrow moves a product to Old');
  await page.click('[data-act="showOldOrd"]');
  await page.waitForTimeout(500);
  const oldRows = await page.$$eval('.catgrid .crow:not(.ord)', e => e.length);
  if (oldRows >= 1) ok('and it is sitting in the Old drawer');
  else bad('the Old drawer holds it', `${oldRows} rows`);

  /* ---------- the list stacks two ways ---------- */
  /* Both the pad and the catalogue print supplier headings, so read only the
     section the Load button lives in — that is the catalogue. */
  const listSec = () => page.evaluate(() => {
    const sec = document.querySelector('[data-act="loadOrdCat"]').closest('.sec');
    const walk = [];
    sec.querySelectorAll('.sec-h h2, .csub, .crow.ord .cname').forEach(el => {
      walk.push({ kind: el.matches('h2') ? 'head' : el.matches('.csub') ? 'sub' : 'row',
                  text: el.textContent.trim() });
    });
    return walk;
  });
  /* the ordering sheet's own sections, in the sheet's own order — kept in
     step with seed/order-sheet.json, which test/paper.test.js pins */
  const FAMILIES = Object.keys(require('../seed/order-sheet.json').sections);

  await page.click('[data-act="tab"][data-tab="orders"]');
  await page.waitForTimeout(500);

  /* by supplier is what opens, because that is who you phone */
  const bySup = await listSec();
  const supHeads = bySup.filter(x => x.kind === 'head' && x.text !== 'The list').map(x => x.text);
  const supN = bySup.filter(x => x.kind === 'row').length;
  if (supHeads.length > 1) ok(`the list opens stacked by supplier (${supHeads.length} suppliers)`);
  else bad('the list stacks by supplier', JSON.stringify(supHeads));

  const supOrder = await page.evaluate(() => (window.__BOOT__ && window.__BOOT__.suppliers) || []);
  const supPos = supHeads.map(t => supOrder.indexOf(t));
  if (supPos.every((v, i) => i === 0 || supPos[i - 1] <= v))
    ok('and the suppliers run in the order the calls go out');
  else bad('suppliers run in call order', JSON.stringify(supHeads));

  /* inside one supplier the families run in the printed sheet order */
  let run = [], famOK = true;
  bySup.forEach(x => {
    if (x.kind === 'head') run = [];
    if (x.kind === 'sub') {
      const i = FAMILIES.indexOf(x.text);
      if (i < 0) famOK = false;
      if (run.length && run[run.length - 1] > i) famOK = false;
      run.push(i);
    }
  });
  if (famOK) ok('and inside a supplier the families follow the paper sheet');
  else bad('families follow the sheet inside a supplier', JSON.stringify(bySup.filter(x => x.kind === 'sub').map(x => x.text)));

  /* the other way round */
  await page.click('[data-act="ordGroup"][data-v="cat"]');
  await page.waitForTimeout(500);
  const byFam = await listSec();
  const famHeads = byFam.filter(x => x.kind === 'head' && x.text !== 'The list').map(x => x.text);
  const famExpected = FAMILIES.filter(f => famHeads.indexOf(f) >= 0);
  is(famHeads.join(' '), famExpected.join(' '),
     'by family stacks VEG through FISH, the way the sheet is printed');
  is(byFam.filter(x => x.kind === 'row').length, supN,
     'and no product is lost or doubled by switching');

  /* an Old product says both what it is and who sold it */
  const chips = await page.$$eval('.catgrid .crow:not(.ord)',
    rows => rows.length ? [...rows[0].querySelectorAll('.chip')].map(c => c.textContent.trim()) : []);
  if (chips.length === 2 && FAMILIES.indexOf(chips[0]) >= 0)
    ok(`an Old product still shows its family and supplier (${chips.join(' / ')})`);
  else bad('an Old product shows family and supplier', JSON.stringify(chips));

  await page.click('[data-act="ordGroup"][data-v="sup"]');
  await page.waitForTimeout(400);

  /* the prep list does the same */
  await page.click('[data-act="tab"][data-tab="prep"]');
  await page.waitForTimeout(500);
  const prepBefore = await page.$$eval('.catgrid .crow', e => e.length);
  await page.evaluate(() => document.querySelector('.catgrid .crow .x').click());
  await page.waitForTimeout(800);
  is(await page.$$eval('.catgrid .crow', e => e.length), prepBefore - 1,
     'a prep product moves to Old the same way');

  if (errors.length) bad('no console errors', errors.slice(0, 2).join(' | '));
  else ok('no console errors');

  await ctx.close();
  await browser.close();
  await h.stop();

  console.log(`\n  ${checks} checks passed${failures ? `, ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ordering test failed:', e); process.exit(2); });
