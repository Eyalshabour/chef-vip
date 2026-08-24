'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');
const { MAX_FAILS } = require('../src/auth');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('the right email and code get you in', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const r = await c.get('/api/state');
  a.equal(r.status, 200);
  a.equal(r.json.user.name, 'Eyal Elovits');
});

test('email matching ignores case and stray spaces', async () => {
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const c = h.client();
  const r = await c.post('/api/login', { email: '  Eyal@RestaurantShabour.com  ', code: '2011' });
  a.equal(r.status, 200);
});

test('a wrong code and an unknown email are indistinguishable', async () => {
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const c = h.client();
  const wrong = await c.post('/api/login', { email: 'eyal@restaurantshabour.com', code: '0000' });
  const unknown = await c.post('/api/login', { email: 'ghost@restaurantshabour.com', code: '2011' });
  a.equal(wrong.status, 401);
  a.equal(unknown.status, 401);
  a.equal(wrong.json.error, unknown.json.error,
    'the message must not reveal whether the account exists');
});

test('someone with no code set cannot sign in', async () => {
  const c = h.client();
  const r = await c.post('/api/login', { email: 'masud@restaurantshabour.com', code: '1234' });
  a.equal(r.status, 401);
});

test('an account locks after repeated wrong codes, then the right code is refused too', async () => {
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const c = h.client();
  for (let i = 0; i < MAX_FAILS; i++) {
    await c.post('/api/login', { email: 'eyal@restaurantshabour.com', code: '0000' });
  }
  const r = await c.post('/api/login', { email: 'eyal@restaurantshabour.com', code: '2011' });
  a.equal(r.status, 429, 'the correct code no longer helps while locked');
  const { rows } = await h.pool.query("SELECT locked_until FROM users WHERE id='ee'");
  a.ok(rows[0].locked_until, 'and the lock is recorded');
});

test('a good sign-in clears the failure count', async () => {
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');
  const c = h.client();
  await c.post('/api/login', { email: 'eyal@restaurantshabour.com', code: '0000' });
  await c.post('/api/login', { email: 'eyal@restaurantshabour.com', code: '2011' });
  const { rows } = await h.pool.query("SELECT fail_count FROM users WHERE id='ee'");
  a.equal(rows[0].fail_count, 0);
});

test('signing out ends the session', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  a.equal((await c.post('/api/logout')).status, 200);
  a.equal((await c.get('/api/state')).status, 401);
});

test('every endpoint refuses a stranger', async () => {
  const c = h.client();
  for (const [m, p] of [['GET','/api/state'], ['PUT','/api/state'],
                        ['POST','/api/users/mr/code'], ['POST','/api/users/mr/order'],
                        ['DELETE','/api/users/mr/access'], ['GET','/api/melba/summary'],
                        ['POST','/api/melba/reorder'], ['POST','/api/melba/prices'],
                        ['POST','/api/melba/apply-prices']]) {
    const r = await c.req(m, p, m === 'GET' || m === 'DELETE' ? undefined : {});
    a.ok([401, 403].includes(r.status), `${m} ${p} -> ${r.status}`);
  }
});

test('two accounts cannot share an email', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const r = await c.post('/api/users/vb/code', { email: 'eyal@restaurantshabour.com', code: '4417' });
  a.equal(r.status, 409);
});

test('management cannot lock itself out', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const r = await c.del('/api/users/ee/access');
  a.equal(r.status, 400);
  a.match(r.json.error, /lock yourself out/);
});

test('codes are stored hashed, never in the clear', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  await c.post('/api/users/vb/code', { email: 'valentin@restaurantshabour.com', code: '4417' });
  const { rows } = await h.pool.query("SELECT code_hash FROM users WHERE id='vb'");
  a.match(rows[0].code_hash, /^\$2[aby]\$/);
  a.ok(!rows[0].code_hash.includes('4417'));
});
