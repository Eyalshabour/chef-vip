'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');
const sec = require('../src/security');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('security headers are set on every response', async () => {
  const c = h.client();
  const r = await c.get('/healthz');
  a.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  a.equal(r.headers.get('x-content-type-options'), 'nosniff');
  a.equal(r.headers.get('x-frame-options'), 'DENY');
  a.equal(r.headers.get('x-powered-by'), null, 'the stack is not advertised');
  a.match(r.headers.get('permissions-policy'), /camera=\(\)/);
});

test('the CSP does not permit inline script', () => {
  a.ok(!/script-src[^;]*unsafe-inline/.test(sec.CSP));
  a.match(sec.CSP, /frame-ancestors 'none'/);
});

test('a state-changing call without the CSRF token is refused', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const stolen = c.csrf;
  c.setCsrf('');
  const r = await c.put('/api/state', { rev: 1, state: { prep: [] } });
  a.equal(r.status, 403);
  a.match(r.json.error, /Reload/);
  c.setCsrf(stolen);
  a.equal((await c.put('/api/state', { rev: 1, state: { prep: [] } })).status, 200);
});

test('a wrong CSRF token is refused, whatever its length', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  for (const bad of ['x', 'x'.repeat(32), 'x'.repeat(200)]) {
    c.setCsrf(bad);
    a.equal((await c.put('/api/state', { rev: 1, state: {} })).status, 403);
  }
});

test('the session cookie is httpOnly and same-site', async () => {
  const c = h.client();
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const res = await fetch((await h.start()) + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'eyal@restaurantshabour.com', code: '2011' }),
  });
  const cookie = (res.headers.getSetCookie() || []).join(';');
  a.match(cookie, /HttpOnly/i);
  a.match(cookie, /SameSite=Lax/i);
});

test('the session id changes on sign-in, so a fixed one cannot be reused', async () => {
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const base = await h.start();
  const first = await fetch(base + '/healthz');
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'eyal@restaurantshabour.com', code: '2011' }),
  });
  const after = (r.headers.getSetCookie() || []).join(';');
  a.match(after, /chefvip\.sid=/, 'a fresh session id is issued at sign-in');
  a.ok(!/chefvip\.sid/.test((first.headers.getSetCookie() || []).join(';')),
    'no session is handed out before sign-in');
});

test('an oversized board is refused rather than stored', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const fat = { prep: Array.from({ length: 5000 }, (_, i) => ({ id: 'x' + i, title: 'x' })) };
  const r = await c.put('/api/state', { rev: 1, state: fat });
  a.equal(r.status, 400);
  a.match(r.json.error, /too long/i);
});

test('a state of the wrong shape is refused', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  for (const bad of [null, 'a string', 42, [1, 2, 3], { prep: 'not a list' }, { prices: [] }]) {
    const r = await c.put('/api/state', { rev: 1, state: bad });
    a.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`);
  }
});

test('the client cannot grant itself permissions through the board', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  await c.put('/api/state', {
    rev: 1,
    state: { prep: [], accounts: { mr: { order: true, code: 'set', email: 'x@y.z' } } },
  });
  const after = await c.get('/api/state');
  a.equal(after.json.state.accounts.mr.order, false, 'permissions come from the users table');
  a.equal(after.json.state.accounts.mr.email, '', 'and not from whatever the client posted');
});

test('login is rate limited', async () => {
  const c = h.client();
  let limited = false;
  for (let i = 0; i < 26; i++) {
    const r = await c.post('/api/login', { email: 'nobody@example.com', code: '0000' });
    if (r.status === 429) { limited = true; a.ok(r.headers.get('retry-after')); break; }
  }
  a.ok(limited, 'guessing gets throttled');
});

test('a malformed login is rejected before it reaches the database', async () => {
  const c = h.client();
  for (const body of [{}, { email: 'not-an-email', code: '1234' },
                      { email: 'a@b.co', code: '12' }, { email: 'a@b.co', code: 'abcd' },
                      { email: 'a@b.co' }, { email: 'a'.repeat(300) + '@b.co', code: '1234' }]) {
    const r = await c.post('/api/login', body);
    a.equal(r.status, 400, JSON.stringify(body));
  }
});

test('no secret is echoed back to the client', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const body = JSON.stringify((await c.get('/api/state')).json);
  a.ok(!body.includes('$2a$'), 'no password hashes');
  a.ok(!body.includes('2011'), 'no codes');
  a.ok(!/MELBA_API_KEY|Bearer /.test(body), 'no keys');
});

test('an unknown api route answers json, not the app shell', async () => {
  const c = h.client();
  const r = await c.get('/api/does-not-exist');
  a.equal(r.status, 404);
  a.equal(r.json.error, 'No such route.');
});
