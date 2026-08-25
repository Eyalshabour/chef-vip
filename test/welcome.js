'use strict';
/*
 * The first screen has to answer the shift's first question.
 *
 * A cook opening the board at 7am wants what is left to make, and wants to
 * know what goes into it without walking to the office for the folder. So:
 * today's sheet is on the welcome screen, it ticks off from there, and a
 * line whose name the book knows opens its own recipe under it.
 *
 * The one rule that matters more than the feature: the board never answers
 * a name with a recipe that is not that name. A near miss is offered as a
 * choice, never shown as the answer.
 *
 *   node test/welcome.js
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'welcome-secret';

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
  const ctx = await browser.newContext({ viewport: { width: 414, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#lg-e', 'eyal@restaurantshabour.com');
  await page.fill('#lg-c', '2011');
  await page.click('[data-act="login"]');
  await page.waitForSelector('[data-act="tab"]', { state: 'attached', timeout: 8000 });
  await page.waitForTimeout(400);

  console.log('\nthe welcome screen carries today’s work\n');

  /* the tab strip exists three times over (rail, bottom bar, and the
     shortcut on the sheet) — click whichever one this width shows */
  const goTab = t => page.evaluate(tab => {
    const all = [...document.querySelectorAll(`[data-act="tab"][data-tab="${tab}"]`)];
    (all.find(e => e.offsetParent) || all[0]).click();
  }, t);

  const svc = () => page.evaluate(() => {
    const heads = [...document.querySelectorAll('.sec-h h2')].map(e => e.textContent.trim());
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    return {
      heads,
      rows: sec ? [...sec.querySelectorAll('.srow .cname')].map(e => e.textContent.trim()) : [],
      sub: sec ? (sec.querySelector('.sub') || {}).textContent : '',
      hasForm: !!(sec && sec.querySelector('[data-act="addPrep"]')),
      empty: !!(sec && sec.querySelector('.empty')),
    };
  });

  /* an empty sheet says so, and still offers the box to fill it */
  let v = await svc();
  if (v.heads.includes('To do today')) ok('the welcome screen has today’s sheet on it');
  else bad('today’s sheet is on the welcome screen', JSON.stringify(v.heads));
  if (v.empty && v.hasForm) ok('an empty sheet says so and still offers the box');
  else bad('the empty sheet offers a way to fill it', JSON.stringify(v));

  /* it sits above the brigade: what is left to make comes before who is in */
  const iTodo = v.heads.indexOf('To do today'), iBrig = v.heads.indexOf('The brigade');
  if (iTodo >= 0 && iBrig >= 0 && iTodo < iBrig) ok('and it reads before the brigade');
  else bad('the sheet reads before the brigade', `todo ${iTodo}, brigade ${iBrig}`);

  /* a line typed on the welcome screen lands on the welcome screen */
  await page.fill('#prep-t-todo', 'Confit Leeks');
  await page.click('[data-act="addPrep"][data-where="todo"]');
  await page.waitForTimeout(700);
  v = await svc();
  if (v.rows.includes('Confit Leeks')) ok('a line typed here goes onto today’s sheet, not into the drawer');
  else bad('a typed line lands on the sheet', JSON.stringify(v.rows));

  /* the same box on the prep tab, under the catalogue, files it as a product */
  await goTab('prep');
  await page.waitForTimeout(400);
  await page.fill('#prep-t-cat', 'Zaatar butter for the pass');
  await page.click('[data-act="addPrep"][data-where="cat"]');
  await page.waitForTimeout(700);
  const onSheet = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    return [...sec.querySelectorAll('.pname')].map(e => e.textContent.trim());
  });
  if (!onSheet.includes('Zaatar butter for the pass'))
    ok('and the box under the catalogue files a product without putting it on the sheet');
  else bad('the catalogue box does not touch today’s sheet', JSON.stringify(onSheet));

  /* --- the recipe under the line --- */
  await goTab('service');
  await page.waitForTimeout(400);

  const rowFor = title => page.evaluate(t => {
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    const row = [...sec.querySelectorAll('.srow')]
      .find(r => (r.querySelector('.cname') || {}).textContent.trim() === t);
    if (!row) return null;
    return {
      hasBtn: !!row.querySelector('[data-act="srec"]'),
      open: row.getAttribute && !!row.querySelector('.rbody'),
      body: (row.querySelector('.rbody') || {}).textContent || '',
      name: (row.querySelector('.rbody .rsub') || {}).textContent || '',
      picks: [...row.querySelectorAll('[data-act="srecUse"]')].map(b => b.textContent.trim()),
      pickNote: (row.querySelector('.rpt') || {}).textContent || '',
    };
  }, title);

  const openRec = title => page.evaluate(t => {
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    const row = [...sec.querySelectorAll('.srow')]
      .find(r => (r.querySelector('.cname') || {}).textContent.trim() === t);
    row.querySelector('[data-act="srec"]').click();
  }, title);

  let r = await rowFor('Confit Leeks');
  if (r && r.hasBtn) ok('a line the book knows carries a Recipe button');
  else bad('a known line carries a Recipe button', JSON.stringify(r));

  await openRec('Confit Leeks');
  await page.waitForTimeout(400);
  r = await rowFor('Confit Leeks');
  is(r.name, 'Confit Leeks', 'and it opens that recipe, named, under the line');
  if (r.body.length > 40) ok(`with what goes in it (${r.body.trim().split('\n')[0].slice(0, 40)}…)`);
  else bad('the recipe has content', JSON.stringify(r.body));
  is(r.picks.length, 0, 'an exact name is never dressed up as a guess');

  /* the honest case: a line the book has no name for */
  await goTab('prep');
  await page.waitForTimeout(300);
  await page.fill('#prep-t-todo', 'Fish Tartare');
  await page.click('[data-act="addPrep"][data-where="todo"]');
  await page.waitForTimeout(700);
  await goTab('service');
  await page.waitForTimeout(400);

  r = await rowFor('Fish Tartare');
  if (r && r.hasBtn) {
    await openRec('Fish Tartare');
    await page.waitForTimeout(400);
    r = await rowFor('Fish Tartare');
    is(r.body, '', 'a name the book does not have shows no recipe at all');
    if (/closest/i.test(r.pickNote)) ok('it says so, and offers the near names as a choice');
    else bad('the near names are offered as a choice', JSON.stringify(r.pickNote));
    if (r.picks.length && !r.picks.includes('Fish Tartare'))
      ok(`the cook picks from ${r.picks.length} — the board does not pick for him`);
    else bad('the board offers rather than decides', JSON.stringify(r.picks));

    /* and once he picks, that is what he reads */
    const want = r.picks[0];
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll('.sec')]
        .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
      const row = [...sec.querySelectorAll('.srow')]
        .find(r2 => (r2.querySelector('.cname') || {}).textContent.trim() === 'Fish Tartare');
      row.querySelector('[data-act="srecUse"]').click();
    });
    await page.waitForTimeout(400);
    r = await rowFor('Fish Tartare');
    is(r.name, want, 'and the one he picks is the one that opens');
  } else {
    ok('a line with nothing near it in the book carries no button at all');
  }

  /* ticking off from the welcome screen */
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    const row = [...sec.querySelectorAll('.srow')]
      .find(r => (r.querySelector('.cname') || {}).textContent.trim() === 'Confit Leeks');
    row.querySelector('[data-act="toggle"]').click();
  });
  await page.waitForTimeout(700);
  const done = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.sec')]
      .find(s => (s.querySelector('h2') || {}).textContent === 'To do today');
    const rows = [...sec.querySelectorAll('.srow')];
    return {
      struck: rows.some(r => r.querySelector('.crow.done')
        && r.querySelector('.cname').textContent.trim() === 'Confit Leeks'),
      last: (rows[rows.length - 1].querySelector('.cname') || {}).textContent.trim(),
      sub: (sec.querySelector('.sub') || {}).textContent.trim(),
    };
  });
  if (done.struck) ok('a line ticks off without leaving the welcome screen');
  else bad('the line ticks off here', JSON.stringify(done));
  is(done.last, 'Confit Leeks', 'and a finished line sinks to the bottom, out of the way');
  if (/^1 \/ /.test(done.sub)) ok(`the count follows it (${done.sub})`);
  else bad('the count follows', done.sub);

  /* the same tick is the same tick on the prep tab */
  await goTab('prep');
  await page.waitForTimeout(400);
  const alsoDone = await page.evaluate(() =>
    [...document.querySelectorAll('.prow.done .pname')].map(e => e.textContent.trim()));
  if (alsoDone.includes('Confit Leeks')) ok('and the prep sheet already knows it is done');
  else bad('the tick is the same tick on both screens', JSON.stringify(alsoDone));

  if (errors.length) bad('no console errors', errors.slice(0, 2).join(' | '));
  else ok('no console errors');

  await ctx.close();
  await browser.close();
  await h.stop();

  console.log(`\n  ${checks} checks passed${failures ? `, ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('welcome test failed:', e); process.exit(2); });
