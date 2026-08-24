'use strict';
/* End to end, in its own process.
 *
 * Runs the real public/app.js against a stub DOM and a live server, so the
 * wiring between them is actually exercised: the CSRF header, the boot
 * sequence, the shape of every field. It lives outside `node --test`
 * because it replaces globals (fetch, setTimeout, document) and the test
 * runner shares those between files.
 *
 *   npm run test:e2e
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'e2e-secret';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const realFetch = globalThis.fetch;
const realTimeout = setTimeout;
const realClear = clearTimeout;
const wait = ms => new Promise(r => realTimeout(r, ms));

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', f), 'utf8'));

let passed = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  ok   ' + label); passed++; }
  else { console.log('  FAIL ' + label + (detail ? '  — ' + detail : '')); process.exitCode = 1; }
}

/* A DOM thin enough to run the app, honest enough to catch mistakes. */
function makeBrowser(base) {
  const fields = {};
  let html = '', cookie = '';
  const el = id => fields[id] || (fields[id] = { id, value: '', dataset: {}, focus() {}, select() {} });
  const root = { get innerHTML() { return html; }, set innerHTML(v) { html = v; }, querySelectorAll: () => [] };

  /* The app is handed its environment as parameters rather than through
   * globals. Replacing global fetch or setTimeout breaks node's own HTTP
   * client underneath us — this keeps the stub strictly inside the app. */
  const env = {
    window: { __BOOT__: {
      state: {},
      brigade: [{ id: 'ee', name: 'Eyal Elovits', ini: 'EE', role: 'Director', always: true, shifts: {} }],
      recipes: read('recipes.json'), orderCats: read('orderCats.json'), suppliers: read('suppliers.json'),
    } },
    navigator: { clipboard: null },
    document: {
      getElementById: id => (id === 'root' ? root : el(id)),
      addEventListener() {}, activeElement: null, hidden: false,
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn, ms) => realTimeout(fn, Math.min(ms || 0, 50)),
    clearTimeout: t => realClear(t),
    setInterval: () => 0,
    fetch: async (url, opts = {}) => {
      const headers = { ...(opts.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await realFetch(base + url, { ...opts, headers });
      for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const m = /^chefvip\.sid=[^;]+/.exec(c); if (m) cookie = m[0];
      }
      return { status: res.status, ok: res.ok, json: () => res.json() };
    },
  };

  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8')
    .replace('boot();\nsetInterval(poll, 8000);', 'globalThis.__APP__ = { A: A, S: () => S };\nboot();');
  const names = Object.keys(env);
  new Function(...names, src)(...names.map(n => env[n]));

  return { el, get html() { return html; }, app: () => globalThis.__APP__ };
}

(async () => {
  const h = require('./helpers');
  const base = await h.start();
  await h.reset();
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');

  console.log('\nend to end — the real interface against a live server\n');

  for (const [p, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'javascript'],
                           ['/manifest.webmanifest', 'json'], ['/icon.svg', 'svg']]) {
    const r = await realFetch(base + p);
    ok(`serves ${p}`, r.status === 200 && new RegExp(type).test(r.headers.get('content-type') || ''));
  }

  const b = makeBrowser(base);
  await wait(300);
  ok('the sign-in screen renders before any data arrives', /Sign in/.test(b.html));

  b.el('lg-e').value = '  Eyal@RestaurantShabour.com ';
  b.el('lg-c').value = '2011';
  b.app().A.login();
  await wait(900);

  const S = b.app().S();
  ok('the board loads after sign-in', S.prep && S.prep.length === 136, `prep=${S.prep && S.prep.length}`);
  ok('the brigade comes from the database', /Eyal Elovits/.test(b.html));
  ok('the prep sheet is split into menu and archive',
     S.prep.filter(p => !p.arch).length === 87 && S.prep.filter(p => p.arch).length === 49);

  /* The board is driven by delegated clicks, so drive it the same way. */
  const line = S.prep.find(p => !p.arch);
  const app = b.app();
  const tick = app.A.toggle || app.A.tick;
  if (typeof tick === 'function') tick('prep', line.id);
  else { line.done = true; line.by = 'ee'; line.at = Date.now(); app.A.save ? app.A.save() : app.flush(); }
  await wait(900);
  ok('a tick saves — so the CSRF token was carried', b.app().S().rev >= 2, `rev=${b.app().S().rev}`);

  const other = await h.signIn('vb', 'valentin@restaurantshabour.com', '4417');
  const seen = (await other.get('/api/state')).json.state.prep.find(p => p.id === line.id);
  ok('the next person to open the board sees it', seen && seen.done === true);
  ok('and it is signed', seen && seen.by === 'ee');

  const bare = await realFetch(base + '/api/state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev: 1, state: { prep: [] } }),
  });
  ok('a write with no session and no token is refused', bare.status === 403);

  console.log(`\n${passed} checks passed\n`);
  await h.stop();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('e2e failed:', e); process.exit(1); });
