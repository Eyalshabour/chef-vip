'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

const asCook = () => h.signIn('mr', 'masud@restaurantshabour.com', '1111');
const asChef = () => h.signIn('vb', 'valentin@restaurantshabour.com', '4417');
const asDir  = () => h.signIn('ee', 'eyal@restaurantshabour.com', '2011');

test('a cook can read and write the board', async () => {
  const c = await asCook();
  a.equal((await c.get('/api/state')).status, 200);
  a.equal((await c.put('/api/state', { rev: 1, state: { prep: [] } })).status, 200);
});

test('a cook cannot reach management', async () => {
  const c = await asCook();
  for (const p of ['/api/melba/summary']) a.equal((await c.get(p)).status, 403);
  a.equal((await c.post('/api/users/es/order')).status, 403);
  a.equal((await c.post('/api/users/es/code', { email: 'e@f.gh', code: '1234' })).status, 403);
  a.equal((await c.del('/api/users/es/access')).status, 403);
});

test('the chef and the director both reach management', async () => {
  for (const signIn of [asChef, asDir]) {
    await h.reset();
    const c = await signIn();
    a.equal((await c.post('/api/users/es/order')).status, 200);
  }
});

test('granting the order list is a management act, and it toggles', async () => {
  const c = await asDir();
  a.equal((await c.post('/api/users/mr/order')).json.canOrder, true);
  a.equal((await c.post('/api/users/mr/order')).json.canOrder, false);
});

test('management cannot be granted or revoked the order list', async () => {
  const c = await asDir();
  const r = await c.post('/api/users/vb/order');
  a.equal(r.status, 400);
  a.match(r.json.error, /always can/);
});

test('an unknown person id is refused, not silently ignored', async () => {
  const c = await asDir();
  a.equal((await c.post('/api/users/nope/order')).status, 400);
  a.equal((await c.post('/api/users/..%2Fetc/order')).status, 400);
  a.equal((await c.post('/api/users/mr%00/order')).status, 400);
});

test('revoking access clears the code and the order grant together', async () => {
  const c = await asDir();
  await c.post('/api/users/mr/code', { email: 'masud@restaurantshabour.com', code: '1111' });
  await c.post('/api/users/mr/order');
  await c.del('/api/users/mr/access');
  const { rows } = await h.pool.query("SELECT code_hash, can_order FROM users WHERE id='mr'");
  a.equal(rows[0].code_hash, null);
  a.equal(rows[0].can_order, false);
  const cook = h.client();
  a.equal((await cook.post('/api/login', { email: 'masud@restaurantshabour.com', code: '1111' })).status, 401);
});

test('management acts are written to the audit trail', async () => {
  const c = await asDir();
  await c.post('/api/users/mr/order');
  await c.post('/api/users/mr/code', { email: 'masud@restaurantshabour.com', code: '1111' });
  const { rows } = await h.pool.query('SELECT action, user_id FROM audit ORDER BY id');
  const actions = rows.map(r => r.action);
  a.ok(actions.includes('grant_order'));
  a.ok(actions.includes('set_code'));
  a.ok(rows.every(r => r.user_id === 'ee' || r.user_id === null));
});
