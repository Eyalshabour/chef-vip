'use strict';
/* What an invoice does to the price list — the maths, on its own,
 * so it can be tested without a database or a network. */

/* Trim each half BEFORE joining. Trimming only the joined string leaves
 * "vergers " and "vergers" as different keys, which silently splits a
 * product's price history in two the first time someone types a
 * trailing space. */
const norm = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();
const key = (supplier, product) => `${norm(supplier)}::${norm(product)}`;

function delta(oldPrice, newPrice) {
  if (oldPrice == null || !isFinite(oldPrice) || oldPrice === 0) return null;
  if (newPrice == null || !isFinite(newPrice)) return null;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

const jumped = (d, threshold = 10) => d != null && Math.abs(d) >= threshold;

/* One invoice against the price history: what moved, by how much,
 * and what crosses the threshold. Pure — no side effects. */
function compare(invoice, history = {}, threshold = 10) {
  const lines = (invoice.lines || []).map(l => {
    const k = key(invoice.supplier, l.product);
    const past = history[k] || [];
    const prev = past.length ? past[past.length - 1] : null;
    const d = prev ? delta(prev.price, l.price) : null;
    return { line: l, key: k, previous: prev, delta: d, flagged: jumped(d, threshold), isNew: !prev };
  });
  return {
    lines,
    moved: lines.filter(x => x.delta != null && Math.abs(x.delta) >= 0.5),
    flagged: lines.filter(x => x.flagged),
    fresh: lines.filter(x => x.isNew),
    total: lines.reduce((a, x) => {
      const q = parseFloat(x.line.qty);
      return a + (isFinite(q) ? q : 1) * (isFinite(x.line.price) ? x.line.price : 0);
    }, 0),
  };
}

/* Applying an invoice appends to the history. Never mutates the input. */
function apply(invoice, history = {}, stamp = {}) {
  const next = { ...history };
  let n = 0;
  for (const l of invoice.lines || []) {
    if (l.price == null || !isFinite(l.price)) continue;
    const k = key(invoice.supplier, l.product);
    next[k] = (next[k] || []).concat([{
      at: stamp.at || null, price: l.price,
      inv: invoice.number || '', by: stamp.by || null, date: invoice.date || null,
    }]);
    n++;
  }
  return { history: next, recorded: n };
}

/* Match an invoice line to what Melba holds, so "was" is Melba's number
 * and not just the last thing this board saw. */
function matchMelba(invoiceLine, supplyingItems, productsById) {
  const want = String(invoiceLine.product || '').toLowerCase().trim();
  if (!want) return null;
  let best = null;
  for (const si of supplyingItems) {
    const p = productsById[si.productId];
    if (!p || !p.name) continue;
    const name = p.name.toLowerCase();
    let score = 0;
    if (name === want) score = 3;
    else if (name.includes(want) || want.includes(name)) score = 2;
    else continue;
    if (!best || score > best.score) best = { score, item: si, product: p };
  }
  return best;
}


/* Every supplier's latest price for one product, cheapest first. */
function acrossSuppliers(product, history = {}) {
  const want = key('', product).slice(2);
  const out = [];
  for (const k of Object.keys(history)) {
    const [supplier, prod] = k.split('::');
    if (prod !== want) continue;
    const h = history[k];
    if (!h || !h.length) continue;
    out.push({ supplier, price: h[h.length - 1].price, seen: h[h.length - 1].at });
  }
  return out.sort((a, b) => a.price - b.price);
}

/* Products bought from more than one supplier at meaningfully different prices. */
function overpaying(history = {}, minGap = 5) {
  const seen = new Set(), out = [];
  for (const k of Object.keys(history)) {
    const product = k.split('::')[1];
    if (!product || seen.has(product)) continue;
    seen.add(product);
    const all = acrossSuppliers(product, history);
    if (all.length < 2) continue;
    const best = all[0], worst = all[all.length - 1];
    const gap = ((worst.price - best.price) / worst.price) * 100;
    if (gap < minGap) continue;
    out.push({ product, best, worst, gap });
  }
  return out.sort((a, b) => b.gap - a.gap);
}

/* Fix HOW a known product was typed. Never guess WHICH product was meant. */
function canonical(text, known = []) {
  const pool = {};
  for (const p of known) pool[key('', p).slice(2)] = p;
  const q = key('', text).slice(2);
  if (!q) return null;
  if (pool[q] && pool[q] !== text) return pool[q];
  const loose = q.replace(/[^a-z0-9]/g, '');
  const hit = Object.keys(pool).find(k => k.replace(/[^a-z0-9]/g, '') === loose);
  return hit && pool[hit] !== text ? pool[hit] : null;
}

module.exports = { key, delta, jumped, compare, apply, matchMelba, acrossSuppliers, overpaying, canonical };
