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

/* ---------------------------------------------------------------
 * Photographing an invoice is not reading one. Whoever takes the
 * delivery can put the picture in; what it cost stays management's.
 * ------------------------------------------------------------- */
const PIC = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const photograph = c => c.post('/api/invoices/file', {
  invoiceId: null, filename: 'vergers.png', mime: 'image/png', data: PIC.toString('base64') });

test('a cook cannot photograph an invoice until told they may', async () => {
  const c = await asCook();
  a.equal((await photograph(c)).status, 403);
});

test('granting it lets them add a picture — and nothing else', async () => {
  const d = await asDir();
  a.equal((await d.post('/api/users/mr/invoice')).json.invoice, true);

  const c = await asCook();
  const up = await photograph(c);
  a.equal(up.status, 200, 'the picture goes in');

  /* and that is the whole of it */
  a.equal((await c.get('/api/invoices/file/' + up.json.id)).status, 403, 'cannot open it again');
  a.equal((await c.get('/api/invoices/unread')).status, 403, 'cannot see the pile');
  a.equal((await c.del('/api/invoices/file/' + up.json.id)).status, 403, 'cannot delete it');

  /* management can read what was left for them */
  a.equal((await d.get('/api/invoices/file/' + up.json.id)).status, 200);
});

test('the invoice grant toggles, and management cannot be granted it', async () => {
  const d = await asDir();
  a.equal((await d.post('/api/users/mr/invoice')).json.invoice, true);
  a.equal((await d.post('/api/users/mr/invoice')).json.invoice, false);
  a.equal((await d.post('/api/users/vb/invoice')).status, 400, 'the chef always can');
  a.equal((await d.post('/api/users/zz/invoice')).status, 404, 'and an unknown id is refused');
});

test('a cook cannot grant it to themselves', async () => {
  const c = await asCook();
  a.equal((await c.post('/api/users/mr/invoice')).status, 403);
});

test('revoking access takes the invoice grant with it', async () => {
  const d = await asDir();
  await d.post('/api/users/mr/invoice');
  await d.del('/api/users/mr/access');
  const { rows } = await h.pool.query("SELECT can_invoice FROM users WHERE id = 'mr'");
  a.equal(rows[0].can_invoice, false);
});

/* ---------------------------------------------------------------
 * Ten tabs is nine too many for a commis. What a person can open is
 * what their job touches — and the server has to agree, not just the
 * bottom bar.
 * ------------------------------------------------------------- */
test('a cook is refused every screen that is not theirs', async () => {
  const c = await asCook();
  for (const [method, path] of [
    ['get', '/api/melba/summary'],
    ['get', '/api/invoices/unread'],
    ['post', '/api/users/es/order'],
    ['post', '/api/users/es/invoice'],
  ]) {
    const r = await c[method](path);
    a.ok(r.status === 403 || r.status === 401,
      `${method.toUpperCase()} ${path} answered ${r.status}, not a refusal`);
  }
});
