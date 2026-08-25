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

/* ---------------------------------------------------------------
 * The first code. Without this a fresh deployment is a locked door:
 * every code is set by management from inside the app, and a new
 * database has no management signed in to set one.
 * ------------------------------------------------------------- */
const auth = require('../src/auth');

test('the director gets a first code from the environment, once', async () => {
  const before = await auth.verify('eyal@restaurantshabour.com', '4417');
  a.ok(before.error, 'nobody can sign in before a code exists');

  await h.pool.query("UPDATE users SET email = 'eyal@restaurantshabour.com' WHERE id = 'ee'");
  const first = await auth.bootstrap(h.pool, 'ee', '4417');
  a.equal(first.ok, true, 'the first code is accepted');

  const now = await auth.verify('eyal@restaurantshabour.com', '4417');
  a.ok(now.user, 'and it signs him in');

  /* a redeploy must not hand the door back to whoever still knows the old value */
  const again = await auth.bootstrap(h.pool, 'ee', '9999');
  a.equal(again.ok, false);
  a.equal(again.why, 'already set');
  const stale = await auth.verify('eyal@restaurantshabour.com', '9999');
  a.ok(stale.error, 'the second bootstrap code does not work');
});

test('a first code has to be four digits', async () => {
  for (const bad of ['', '12', 'abcd', '12345', '12a4', null, undefined]) {
    const r = await auth.bootstrap(h.pool, 'ee', bad);
    a.equal(r.ok, false, JSON.stringify(bad) + ' is refused');
  }
});

test('BOOTSTRAP_FORCE is the way back in when the code is lost', async () => {
  await h.pool.query("UPDATE users SET email = 'eyal@restaurantshabour.com' WHERE id = 'ee'");
  await auth.bootstrap(h.pool, 'ee', '4417');

  /* without the lever, a code already in place is left alone */
  const refused = await auth.bootstrap(h.pool, 'ee', '8888');
  a.equal(refused.ok, false);
  a.ok((await auth.verify('eyal@restaurantshabour.com', '4417')).user, 'the old code still works');

  /* with it, the code is replaced */
  const forced = await auth.bootstrap(h.pool, 'ee', '8888', { force: true });
  a.equal(forced.ok, true);
  a.equal(forced.replaced, true, 'it says it replaced one, so the seed can say so too');
  a.ok((await auth.verify('eyal@restaurantshabour.com', '8888')).user, 'the new code works');
  a.ok((await auth.verify('eyal@restaurantshabour.com', '4417')).error, 'the old one does not');
});

test('BOOTSTRAP_FORCE also clears a lockout', async () => {
  await h.pool.query("UPDATE users SET email = 'eyal@restaurantshabour.com' WHERE id = 'ee'");
  await auth.bootstrap(h.pool, 'ee', '4417');

  for (let i = 0; i < MAX_FAILS; i++) await auth.verify('eyal@restaurantshabour.com', '0000');
  a.equal((await auth.verify('eyal@restaurantshabour.com', '4417')).error, 'locked',
    'the right code is refused while locked — that is the point of the lock');

  await auth.bootstrap(h.pool, 'ee', '5566', { force: true });
  a.ok((await auth.verify('eyal@restaurantshabour.com', '5566')).user,
    'and the lever gets you back in without waiting out the fifteen minutes');
});
