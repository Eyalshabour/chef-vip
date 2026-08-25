'use strict';
/*
 * The board has to survive a board that is older than it is.
 *
 * This is the bug that made the first real deployment look like a broken
 * sign-in button. The seed wrote a state with no `invoices` key. The first
 * thing render() does is count S.invoices. Every test passed because the
 * test fixture was a *complete* board — more complete than the one the real
 * seed wrote — so the shape that shipped was never once rendered.
 *
 * So: put a deliberately incomplete board in the database, sign in, and
 * insist the thing draws.
 *
 *   node test/boot.js
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ui-secret';

const { chromium } = require('playwright');
const h = require('./helpers');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log(`  ok   ${m}`); };
const bad = (m, d) => { failures++; console.log(`  FAIL ${m}\n       ${d}`); };

/* boards as older versions of the app wrote them */
const SHAPES = {
  'the board the first release seeded (no invoices, prices, pinned or log)': {
    serviceDate: null, rev: 1,
    prep: [{ id: 'p1', title: 'Artichoke', done: false }],
    clean: [{ id: 'c1', title: 'Dryer', done: false, station: 'General' }],
    haccp: [{ id: 'h1', title: 'Fridge 1', done: false, kind: 'temp' }],
    orders: [], waste: [], transfers: [], proteins: [], notes: [],
    recArch: {}, melbaSnap: null,
  },
  'a board with nothing in it at all': { rev: 1 },
  'a board from a version that never had a price history': {
    rev: 1, prep: [], clean: [], haccp: [], orders: [], waste: [],
    transfers: [], proteins: [], notes: [], invoices: [], accounts: {},
  },
};

(async () => {
  const base = await h.start();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });

  console.log('\nan old board still draws\n');

  for (const [name, state] of Object.entries(SHAPES)) {
    await h.reset();
    await h.give('ee', 'eyal@restaurantshabour.com', '2011');
    await h.pool.query('UPDATE board SET rev = 1, state = $1 WHERE id = 1', [state]);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    /* the sandbox has no route to the font CDN, and the pre-sign-in probe
     * answers 401 by design */
    const NOISE = /401|503|fonts\.(googleapis|gstatic)|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/;
    page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });

    await page.goto(base, { waitUntil: 'networkidle' });

    /* the sign-in screen itself must draw */
    const signIn = await page.$('#lg-e');
    if (!signIn) { bad(`${name}: the sign-in screen draws`, 'no email field'); await ctx.close(); continue; }

    await page.fill('#lg-e', 'eyal@restaurantshabour.com');
    await page.fill('#lg-c', '2011');
    await page.click('[data-act="login"]');
    await page.waitForTimeout(1200);

    /* and then the board must draw — this is where it went blank */
    const kids = await page.$$eval('#root *', els => els.length).catch(() => 0);
    const tabs = await page.$$eval('[data-act="tab"]', els => els.length).catch(() => 0);
    const stillOnLogin = !!(await page.$('#lg-e'));

    if (kids === 0) bad(`${name}: the board draws after sign-in`, 'the page is blank');
    else if (stillOnLogin) bad(`${name}: the sign-in goes through`, 'still on the sign-in screen');
    else if (tabs === 0) bad(`${name}: the board draws after sign-in`, 'no tabs rendered');
    else ok(`${name} — ${tabs} tabs`);

    if (errors.length) bad(`${name}: no errors on the way in`, errors.slice(0, 2).join(' | '));
    else ok(`${name} — clean console`);

    await ctx.close();
  }

  await browser.close();
  await h.stop();
  console.log(`\n  ${checks} checks passed${failures ? `, ${failures} failed` : ''}\n`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('boot test failed:', e); process.exit(2); });
