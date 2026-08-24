'use strict';
/*
 * Melba, read and written with one house key, server-side, so the chef
 * and sous see the figures without needing their own connector.
 *
 * The ROUTES below are confirmed — they are the routes Melba's own MCP
 * tools document (GET /me, POST /supplying-items/search, POST /orders,
 * POST /invoices/analyze, ...). What is NOT confirmed is the REST BASE
 * HOST: Melba's MCP endpoint is https://mcp.melba.io/mcp and the REST
 * base was not verifiable from the build environment. Set MELBA_API_BASE
 * from Melba's own documentation before trusting any number here.
 */
const BASE = (process.env.MELBA_API_BASE || '').replace(/\/+$/, '');
const KEY = process.env.MELBA_API_KEY || '';
const TIMEOUT = 15000;

const configured = () => !!(BASE && KEY);

function fail(message, code, status) {
  const e = new Error(message);
  e.code = code; if (status) e.status = status;
  return e;
}

async function call(path, opts = {}) {
  if (!configured()) throw fail('Melba is not configured on the server.', 'not_configured');
  let res;
  try {
    res = await fetch(BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...(opts.headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    throw fail(e.name === 'TimeoutError' ? 'Melba did not answer in time.' : 'Melba is unreachable.', 'network');
  }
  if (res.status === 401 || res.status === 403) throw fail('Melba refused the key.', 'auth', res.status);
  if (!res.ok) throw fail(`Melba answered ${res.status}.`, 'upstream', res.status);
  try { return await res.json(); }
  catch { throw fail('Melba sent something that is not JSON.', 'upstream'); }
}

const search = (path, body = {}) => call(path, {
  method: 'POST',
  body: JSON.stringify({
    count: 100, offset: 0, nextOffset: 0, predicateClassname: 'x',
    defaultSort: {}, sortByFields: [], sortDirection: 'DESC', recipePredicate: false,
    ...body,
  }),
});

const me = () => call('/me');

/* Every supplier price Melba holds, keyed for lookup. 1246 rows today,
 * so page through rather than assuming one call covers it. */
async function supplyingItems() {
  const out = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await search('/supplying-items/search', { offset, nextOffset: offset, predicateClassname: 'supplyingItem' });
    const rows = (page && page.data) || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const setPrice = (id, amount) => call(`/supplying-items/${encodeURIComponent(id)}`, {
  method: 'PATCH',
  body: JSON.stringify({ amount: Number(amount) }),
});

const products = (limit = 200) => call(`/products?limit=${limit}`);

const reorder = (days = 7) => call('/macros/stock-reorder-low', {
  method: 'POST', body: JSON.stringify({ daysOfCoverage: days }),
});

async function summary() {
  const [meRes, cat] = await Promise.all([ me(), products().catch(() => null) ]);
  return { me: meRes, cat, at: Date.now() };
}

module.exports = { configured, call, search, me, summary, reorder, supplyingItems, setPrice, products };
