'use strict';
const { test } = require('node:test');
const a = require('node:assert/strict');
const p = require('../src/prices');

test('key is stable across casing, spacing and padding', () => {
  a.equal(p.key('Vergers — Veg', 'Big  Onion'), p.key('  vergers — veg ', 'big onion'));
});

test('delta is a percentage, signed', () => {
  a.equal(p.delta(1.80, 2.16).toFixed(1), '20.0');
  a.equal(p.delta(2.00, 1.50).toFixed(1), '-25.0');
  a.equal(p.delta(1.00, 1.00), 0);
});

test('delta refuses to divide by zero or by nothing', () => {
  a.equal(p.delta(0, 5), null);
  a.equal(p.delta(null, 5), null);
  a.equal(p.delta(5, null), null);
  a.equal(p.delta(5, NaN), null);
  a.equal(p.delta(Infinity, 5), null);
});

test('a jump is measured on size, not direction', () => {
  a.equal(p.jumped(12, 10), true);
  a.equal(p.jumped(-12, 10), true, 'a 12% drop is as worth knowing as a rise');
  a.equal(p.jumped(9.9, 10), false);
  a.equal(p.jumped(10, 10), true, 'the threshold itself counts');
  a.equal(p.jumped(null, 10), false);
});

test('first sighting of a product is new, not a move', () => {
  const r = p.compare({ supplier: 'vergers', lines: [{ product: 'Carrot', qty: '10', price: 1.8 }] }, {});
  a.equal(r.lines[0].isNew, true);
  a.equal(r.lines[0].delta, null);
  a.equal(r.flagged.length, 0);
});

test('second invoice measures against the first', () => {
  const inv1 = { supplier: 'vergers', number: 'A1', lines: [{ product: 'Carrot', qty: '10', price: 1.8 }] };
  const { history } = p.apply(inv1, {}, { at: 1, by: 'ee' });
  const inv2 = { supplier: 'vergers', number: 'A2', lines: [{ product: 'Carrot', qty: '10', price: 2.16 }] };
  const r = p.compare(inv2, history, 10);
  a.equal(r.lines[0].delta.toFixed(1), '20.0');
  a.equal(r.flagged.length, 1);
  a.equal(r.moved.length, 1);
});

test('apply never mutates the history it was handed', () => {
  const before = {};
  const { history, recorded } = p.apply(
    { supplier: 's', lines: [{ product: 'x', price: 1 }] }, before, { at: 1 });
  a.deepEqual(before, {}, 'the caller keeps its own copy');
  a.equal(recorded, 1);
  a.equal(history['s::x'].length, 1);
});

test('apply skips lines with no usable price', () => {
  const { recorded, history } = p.apply({
    supplier: 's',
    lines: [{ product: 'a', price: 2 }, { product: 'b', price: NaN },
            { product: 'c' }, { product: 'd', price: null }],
  }, {}, { at: 1 });
  a.equal(recorded, 1);
  a.deepEqual(Object.keys(history), ['s::a']);
});

test('history accumulates in order', () => {
  let h = {};
  for (const [n, price] of [['A1', 1.0], ['A2', 1.1], ['A3', 1.3]]) {
    h = p.apply({ supplier: 's', number: n, lines: [{ product: 'x', price }] }, h, { at: 1 }).history;
  }
  a.deepEqual(h['s::x'].map(e => e.price), [1.0, 1.1, 1.3]);
  a.equal(p.delta(h['s::x'][0].price, h['s::x'][2].price).toFixed(0), '30');
});

test('the same product from two suppliers stays two histories', () => {
  let h = p.apply({ supplier: 'vergers', lines: [{ product: 'Carrot', price: 1.8 }] }, {}, {}).history;
  h = p.apply({ supplier: 'primeur mondial', lines: [{ product: 'Carrot', price: 2.4 }] }, h, {}).history;
  a.equal(Object.keys(h).length, 2);
  const r = p.compare({ supplier: 'vergers', lines: [{ product: 'Carrot', price: 1.9 }] }, h, 10);
  a.equal(r.lines[0].previous.price, 1.8, 'compares against its own supplier');
});

test('invoice total multiplies quantity by unit price', () => {
  const r = p.compare({ supplier: 's', lines: [
    { product: 'a', qty: '10 kg', price: 1.8 },
    { product: 'b', qty: '5', price: 1.2 },
    { product: 'c', price: 3 },            // no qty counts as one
  ]}, {});
  a.equal(r.total.toFixed(2), '27.00');
});

test('melba matching prefers an exact name over a partial one', () => {
  const items = [{ id: 'si1', productId: 'p1', amount: 9 }, { id: 'si2', productId: 'p2', amount: 4 }];
  const byId = { p1: { id: 'p1', name: 'Carrot juice' }, p2: { id: 'p2', name: 'Carrot' } };
  const m = p.matchMelba({ product: 'carrot' }, items, byId);
  a.equal(m.item.id, 'si2');
  a.equal(m.score, 3);
});

test('melba matching returns nothing rather than a bad guess', () => {
  const items = [{ id: 'si1', productId: 'p1', amount: 9 }];
  const byId = { p1: { id: 'p1', name: 'Comté' } };
  a.equal(p.matchMelba({ product: 'langoustine' }, items, byId), null);
  a.equal(p.matchMelba({ product: '' }, items, byId), null);
});

test('the cheapest supplier for a product is found across the history', () => {
  const h = {
    'vergers — veg::carrot': [{ price: 1.80 }],
    'primeur mondial::carrot': [{ price: 1.44 }],
    'vergers — veg::lemon': [{ price: 3.40 }],
  };
  const all = p.acrossSuppliers('Carrot', h);
  a.equal(all.length, 2);
  a.equal(all[0].supplier, 'primeur mondial', 'cheapest first');
  a.equal(all[0].price, 1.44);
});

test('only the latest price from each supplier counts', () => {
  const h = { 's1::carrot': [{ price: 1.0 }, { price: 3.0 }], 's2::carrot': [{ price: 2.0 }] };
  a.equal(p.acrossSuppliers('carrot', h)[0].supplier, 's2', 's1 is now dearer than it was');
});

test('overpaying names the gap, and ignores a product with one supplier', () => {
  const h = {
    'vergers — veg::carrot': [{ price: 1.80 }],
    'primeur mondial::carrot': [{ price: 1.44 }],
    'vergers — veg::lemon': [{ price: 3.40 }],
  };
  const o = p.overpaying(h);
  a.equal(o.length, 1, 'lemon has nothing to compare against');
  a.equal(o[0].product, 'carrot');
  a.equal(o[0].gap.toFixed(0), '20');
});

test('a difference too small to act on is not reported', () => {
  const h = { 'a::x': [{ price: 1.00 }], 'b::x': [{ price: 0.98 }] };
  a.equal(p.overpaying(h).length, 0);
});

test('canonical fixes how a name was typed', () => {
  const known = ['Carrot', 'Big onion', 'Comté'];
  a.equal(p.canonical('  CARROT ', known), 'Carrot');
  a.equal(p.canonical('big  onion', known), 'Big onion');
  a.equal(p.canonical('Carrot', known), null, 'already right, nothing to do');
});

test('canonical never guesses which product was meant', () => {
  const known = ['Carrot', 'Small carotte', 'Big onion'];
  a.equal(p.canonical('carot', known), null,
    'close to two different products — changing it silently would be worse than leaving it');
  a.equal(p.canonical('onion', known), null, 'a fragment is not a product');
  a.equal(p.canonical('langoustine', known), null);
});
