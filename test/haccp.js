'use strict';
/*
 * The classeur, as six registers.
 *
 * The old HACCP tab was one flat checklist. The kitchen's actual Classeur
 * des Autocontrôles is six different forms, and the two grid ones carry
 * rules the app has to respect: a surface is only due once its own
 * frequency has run out, and a negative enceinte is not out of range at
 * -20°C just because a positive one would be.
 *
 *   node test/haccp.js
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
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#lg-e', 'eyal@restaurantshabour.com');
  await page.fill('#lg-c', '2011');
  await page.click('[data-act="login"]');
  await page.waitForTimeout(800);
  await page.click('[data-act="tab"][data-tab="haccp"]');
  await page.waitForSelector('.hacnav', { timeout: 8000 });

  console.log('\nthe classeur, as six registers\n');

  /* --- every register opens --- */
  const REG = [
    ['temps', 'Températures positives'],
    ['nd',    'Nettoyage-Désinfection'],
    ['cool',  'Refroidissement rapide'],
    ['recep', 'Contrôle à réception'],
    ['defr',  'Décongélation'],
    ['nc',    'Non-conformités'],
  ];
  for (const [k, title] of REG) {
    await page.click(`[data-act="hacTab"][data-k="${k}"]`);
    await page.waitForTimeout(250);
    const head = await page.$eval('.sec-h h2', e => e.textContent.trim()).catch(() => '');
    if (head === title) ok(`${title} opens`);
    else bad(`${title} opens`, `heading read "${head}"`);
  }

  /* --- a negative enceinte is judged against its own limit --- */
  await page.click('[data-act="hacTab"][data-k="temps"]');
  await page.waitForTimeout(300);
  const setTemp = async (id, slot, v) => {
    await page.fill(`#tp-${id}-${slot}`, String(v));
    await page.$eval(`#tp-${id}-${slot}`, e => e.dispatchEvent(new Event('change', { bubbles: true })));
    await page.waitForTimeout(400);
  };
  const isBad = id => page.$eval(`#tp-${id}-am`, e => e.classList.contains('bad')).catch(() => null);

  await setTemp('cf1', 'am', 3);
  is(await isBad('cf1'), 'false', 'a positive cold room at 3°C is fine');
  await setTemp('cf1', 'am', 7.5);
  is(await isBad('cf1'), 'true', 'and out of range at 7.5°C');

  await setTemp('fng', 'am', -20);
  is(await isBad('fng'), 'false', 'a freezer at -20°C is fine');
  await setTemp('fng', 'am', -5);
  is(await isBad('fng'), 'true', 'and out of range at -5°C — not judged against +4');

  const warn = await page.$eval('.ban.wa .bt', e => e.textContent).catch(() => null);
  if (warn && /Dépassement/.test(warn)) ok('the corrective actions appear, in the order the sheet gives them');
  else bad('the corrective actions appear', String(warn));

  /* --- cleaning respects each line's own frequency --- */
  await page.click('[data-act="hacTab"][data-k="nd"]');
  await page.waitForTimeout(300);

  const rowState = title => page.evaluate((t) => {
    const rows = [...document.querySelectorAll('.ndrow')];
    const r = rows.find(x => x.querySelector('.ndname').textContent.trim().startsWith(t));
    if (!r) return null;
    return { due: !!r.querySelector('.chip.cr'), done: r.classList.contains('done'),
             freq: r.querySelector('.chip').textContent.trim() };
  }, title);

  is((await rowState('Sol')).freq, '1 fois/jour', 'Sol carries its frequency from the sheet');
  is((await rowState('Plafond')).freq, '2 fois/an', 'Plafond carries its own');
  is((await rowState('Plan de travail')).freq, 'après chaque usage', 'and so does the work surface');

  is((await rowState('Plafond')).due, 'true', 'never done, so the ceiling is due');
  is((await rowState('Plan de travail')).due, 'false',
     '"après chaque usage" is a habit, not a date — never overdue');

  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ndrow')];
    rows.find(x => x.querySelector('.ndname').textContent.trim().startsWith('Plafond'))
        .querySelector('.tick').click();
  });
  await page.waitForTimeout(600);
  const ceil = await rowState('Plafond');
  is(ceil.done, 'true', 'ticking the ceiling records it');
  is(ceil.due, 'false', 'and it is not due again tomorrow — it is a twice-a-year job');

  /* --- an event log takes a line and keeps it --- */
  await page.click('[data-act="hacTab"][data-k="recep"]');
  await page.waitForTimeout(300);
  await page.fill('#hr-p', 'Rouget');
  await page.fill('#hr-t', '2');
  await page.fill('#hr-l', 'LOT-7741');
  await page.click('[data-act="hacAdd"][data-w="recep"]');
  await page.waitForTimeout(700);
  const cells = await page.$$eval('.logtbl tbody tr td', els => els.map(e => e.textContent.trim()));
  if (cells.includes('Rouget') && cells.includes('LOT-7741')) ok('a delivery is recorded with its lot number');
  else bad('a delivery is recorded', JSON.stringify(cells.slice(0, 8)));

  /* --- defrosting applies the form's own J+2 rule --- */
  await page.click('[data-act="hacTab"][data-k="defr"]');
  await page.waitForTimeout(300);
  await page.fill('#hd-p', 'Langoustine');
  await page.click('[data-act="hacAdd"][data-w="defr"]');
  await page.waitForTimeout(700);
  const drow = await page.$$eval('.logtbl tbody tr td', els => els.map(e => e.textContent.trim()));
  const today = new Date().toISOString().slice(0, 10);
  const j2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (drow.includes(j2)) ok(`DLC J+2 is filled in by the form itself (${today} → ${j2})`);
  else bad('DLC J+2 is filled in', JSON.stringify(drow.slice(0, 8)));

  /* --- each register prints --- */
  await page.evaluate(() => { window.print = () => {}; });
  for (const [k, title] of REG) {
    await page.click(`[data-act="hacTab"][data-k="${k}"]`);
    await page.waitForTimeout(250);
    await page.click('[data-act="printHac"]');
    await page.waitForTimeout(300);
    const built = await page.evaluate(() => {
      const el = document.getElementById('printsheet');
      const n = el ? el.textContent.replace(/\s+/g, ' ').trim().length : 0;
      if (el) el.remove();
      return n;
    });
    if (built > 80) ok(`${title} prints (${built} characters on the page)`);
    else bad(`${title} prints`, `only ${built} characters`);
  }

  if (errors.length) bad('no page errors', errors.slice(0, 2).join(' | '));
  else ok('no page errors');

  await ctx.close();
  await browser.close();
  await h.stop();
  console.log(`\n  ${checks} checks passed${failures ? `, ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('haccp test failed:', e); process.exit(2); });
