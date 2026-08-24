'use strict';
/*
 * Melba, read with the house key so the chef and sous see the numbers
 * without needing their own account.
 *
 * NOTE: MELBA_API_BASE is unverified. Melba's MCP endpoint is
 * https://mcp.melba.io/mcp; the REST base was not something we could confirm.
 * Check it against Melba's docs before trusting anything this returns.
 */
const BASE = (process.env.MELBA_API_BASE || '').replace(/\/+$/, '');
const KEY = process.env.MELBA_API_KEY || '';

function configured() { return !!(BASE && KEY); }

async function call(path, opts = {}) {
  if (!configured()) {
    const e = new Error('Melba is not configured. Set MELBA_API_KEY and MELBA_API_BASE.');
    e.code = 'not_configured';
    throw e;
  }
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const e = new Error(`Melba ${path} returned ${res.status}`);
    e.code = 'upstream';
    e.status = res.status;
    throw e;
  }
  return res.json();
}

const summary = async () => {
  const [me, cat] = await Promise.all([
    call('/me'),
    call('/products?limit=200').catch(() => null),
  ]);
  return { me, cat, at: Date.now() };
};

const reorder = (days = 7) =>
  call('/macros/stock-reorder-low', {
    method: 'POST',
    body: JSON.stringify({ daysOfCoverage: days }),
  });

module.exports = { configured, call, summary, reorder };
