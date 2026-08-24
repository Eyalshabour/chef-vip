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

  /* ---------- the prep sheet ---------- */
  await page.click('[data-act="tab"][data-tab="prep"]');
  await page.waitForSelector('.prow', { timeout: 8000 });

  const names = () => page.$$eval('.sheetgrid .prow .pname', els => els.map(e => e.textContent.trim()));
  const before = await names();
  if (before.length < 30) bad('the sheet is loaded', `only ${before.length} lines`);
  else ok(`the sheet is loaded (${before.length} lines)`);

  const at = 20;
  const target = before[at];
  const above = before[at - 1];

  /* take it off the sheet, the way you would if it were not on today */
  await page.$$eval('.sheetgrid .prow', (rows, i) => {
    const xs = rows[i].querySelectorAll('.x');
    xs[xs.length - 1].click();
  }, at);
  await page.waitForTimeout(350);
  const gone = await names();
  is(gone.indexOf(target), -1, `"${target}" comes off the sheet`);

  /* now type it back in — it must return to its own place, not the bottom */
  await page.fill('#prep-t', target);
  await page.click('[data-act="addPrep"]');
  await page.waitForTimeout(400);
  const after = await names();
  is(after.indexOf(target), at, `"${target}" goes back to line ${at + 1}, not the bottom`);
  is(after[at - 1], above, `it lands under "${above}" again`);
  is(after.length, before.length, 'the sheet is the same length as before');

  /* something the printed list has never heard of belongs at the end */
  await page.fill('#prep-t', 'Zaatar butter for the pass');
  await page.click('[data-act="addPrep"]');
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

  if (errors.length) bad('no console errors', errors.slice(0, 2).join(' | '));
  else ok('no console errors');

  await ctx.close();
  await browser.close();
  await h.stop();

  console.log(`\n  ${checks} checks passed${failures ? `, ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ordering test failed:', e); process.exit(2); });
