'use strict';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-the-suite';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://postgres@127.0.0.1:5433/chefvip_test';

const { pool } = require('../src/db');
const bcrypt = require('bcryptjs');
const realFetch = globalThis.fetch;   // tests may stub the global one

let server, base, app;

async function start() {
  if (base) return base;
  app = require('../src/server');
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function stop() {
  if (server) await new Promise(r => server.close(r));
  await pool.end().catch(() => {});
}

/* A tiny client that carries the session cookie and the CSRF token,
 * so tests exercise the same path a browser does. */
function client() {
  let cookie = '', csrf = '';
  return {
    get csrf() { return csrf; },
    setCsrf(v) { csrf = v; },
    async req(method, path, body) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;
      if (csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
      const res = await realFetch(base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
      });
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) { const m = /^chefvip\.sid=[^;]+/.exec(c); if (m) cookie = m[0]; }
      let json = null;
      try { json = await res.json(); } catch {}
      if (json && json.csrf) csrf = json.csrf;
      return { status: res.status, json, headers: res.headers };
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b); },
    put(p, b) { return this.req('PUT', p, b); },
    del(p) { return this.req('DELETE', p); },
  };
}

/* The opening board, exactly as the seed builds it, so every test starts
 * from the same paperwork rather than from whatever the last test left. */
const fs = require('fs');
const path = require('path');
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', f), 'utf8'));
const FRESH = () => ({
  serviceDate: null, rev: 1,
  prep: read('prep.json'), clean: read('clean.json'), haccp: read('haccp.json'),
  orders: [], waste: [], transfers: [], proteins: [], notes: [],
  invoices: [], prices: {}, recArch: {}, melbaSnap: null, priceJump: 10,
});

async function reset() {
  await pool.query('TRUNCATE audit, board_history, invoice_files, "session" RESTART IDENTITY');
  await pool.query('UPDATE users SET fail_count = 0, locked_until = NULL, code_hash = NULL, can_order = is_mgmt, can_invoice = is_mgmt, email = NULL');
  await pool.query('UPDATE board SET rev = 1, state = $1 WHERE id = 1', [FRESH()]);
  const lim = app && app.get && app.get('limiters');
  if (lim) for (const k of Object.keys(lim)) lim[k].reset();
}

async function give(id, email, code) {
  await pool.query('UPDATE users SET email = $1, code_hash = $2 WHERE id = $3',
    [email, await bcrypt.hash(code, 4), id]);
}

async function signIn(id, email, code) {
  const c = client();
  await give(id, email, code);
  const r = await c.post('/api/login', { email, code });
  if (r.status !== 200) throw new Error(`sign-in failed for ${id}: ${JSON.stringify(r.json)}`);
  return c;
}

module.exports = { start, stop, client, reset, give, signIn, pool };
