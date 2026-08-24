'use strict';
const { test, before, after, beforeEach } = require('node:test');
const a = require('node:assert/strict');
const h = require('./helpers');

before(h.start);
after(h.stop);
beforeEach(h.reset);

test('the board opens with the kitchen\'s own paperwork in it', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const { state, brigade } = (await c.get('/api/state')).json;
  a.equal(state.prep.length, 136);
  a.equal(state.prep.filter(p => !p.arch).length, 87, 'on the menu');
  a.equal(state.prep.filter(p => p.arch).length, 49, 'old preps');
  a.equal(state.clean.length, 12);
  a.equal(state.haccp.length, 10);
  a.equal(brigade.length, 10);
  a.equal(brigade[0].id, 'ee', 'the director sorts first');
});

test('a save moves the revision on', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  a.equal((await c.put('/api/state', { rev: 1, state: { prep: [] } })).json.rev, 2);
  a.equal((await c.put('/api/state', { rev: 2, state: { prep: [] } })).json.rev, 3);
});

test('the second of two simultaneous saves is told, not silently dropped', async () => {
  const c1 = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const c2 = await h.signIn('vb', 'valentin@restaurantshabour.com', '4417');

  const first = await c1.put('/api/state', {
    rev: 1, state: { prep: [], orders: [{ id: 'o1', title: 'Big onion', done: false }] } });
  a.equal(first.json.rev, 2);

  const second = await c2.put('/api/state', { rev: 1, state: { prep: [], orders: [] } });
  a.equal(second.status, 409);
  a.equal(second.json.state.rev, 2, 'the loser is handed the winner');
  a.equal(second.json.state.orders.length, 1, "and the winner's work is intact");
});

test('concurrent writers never lose a revision', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const results = await Promise.all(
    Array.from({ length: 8 }, () => c.put('/api/state', { rev: 1, state: { prep: [] } })));
  a.equal(results.filter(r => r.status === 200).length, 1, 'exactly one wins');
  a.equal(results.filter(r => r.status === 409).length, 7, 'the rest are told');
});

test('every version is kept', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  await c.put('/api/state', { rev: 1, state: { prep: [], notes: [{ id: 'n1', text: 'one' }] } });
  await c.put('/api/state', { rev: 2, state: { prep: [], notes: [{ id: 'n1', text: 'two' }] } });
  const { rows } = await h.pool.query('SELECT rev, by_user FROM board_history ORDER BY rev');
  a.equal(rows.length, 2);
  a.deepEqual(rows.map(r => r.rev), [1, 2]);
  a.ok(rows.every(r => r.by_user === 'ee'), 'and attributed');
});

test('a save without a revision is refused', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  a.equal((await c.put('/api/state', { state: { prep: [] } })).status, 400);
  a.equal((await c.put('/api/state', { rev: '1', state: { prep: [] } })).status, 400);
});

test('the invoice ledger survives a round trip intact', async () => {
  const c = await h.signIn('ee', 'eyal@restaurantshabour.com', '2011');
  const invoices = [{ id: 'i1', supplier: 'vergers — veg', number: 'A-1105', status: 'done',
    lines: [{ id: 'l1', product: 'Carrot', qty: '10 kg', price: 2.16 }] }];
  const prices = { 'vergers — veg::carrot': [{ at: 1, price: 1.8 }, { at: 2, price: 2.16 }] };
  await c.put('/api/state', { rev: 1, state: { prep: [], invoices, prices, priceJump: 12 } });
  const back = (await c.get('/api/state')).json.state;
  a.deepEqual(back.invoices, invoices);
  a.deepEqual(back.prices, prices);
  a.equal(back.priceJump, 12);
});
