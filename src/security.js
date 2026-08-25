'use strict';
const crypto = require('crypto');

/* ---------------------------------------------------------------
 * Security headers. Hand-rolled rather than pulling in helmet:
 * one small file we can read in full beats a dependency tree.
 * ------------------------------------------------------------- */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",   // the house face is embedded, not fetched
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

function headers(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.removeHeader('X-Powered-By');
  next();
}

/* ---------------------------------------------------------------
 * CSRF: double-submit. The token lives in the session and must be
 * echoed in a header on every state-changing request. A cross-site
 * form post cannot read the session, so it cannot echo the token.
 * ------------------------------------------------------------- */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function csrf(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.path === '/api/login') return next();   // no session to protect yet
  const sent = req.get('X-CSRF-Token') || '';
  const want = req.session && req.session.csrf;
  if (!want || sent.length !== want.length ||
      !crypto.timingSafeEqual(Buffer.from(sent.padEnd(want.length, '\0')), Buffer.from(want))) {
    return res.status(403).json({ error: 'Stale session. Reload the page and try again.' });
  }
  next();
}

/* ---------------------------------------------------------------
 * Rate limiting. Fixed window, in memory. One kitchen on one Render
 * instance — a shared store would be over-engineering. It bounds
 * password guessing; the per-account lockout in auth.js is the real
 * defence.
 * ------------------------------------------------------------- */
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  const mw = (req, res, next) => {
    const k = key ? key(req) : (req.ip || 'unknown');
    if (k == null) return next();
    const now = Date.now();
    let v = hits.get(k);
    if (!v || v.until <= now) { v = { n: 0, until: now + windowMs }; hits.set(k, v); }
    v.n++;
    if (v.n > max) {
      const secs = Math.ceil((v.until - now) / 1000);
      res.setHeader('Retry-After', String(secs));
      return res.status(429).json({ error: `Too many attempts. Wait ${secs}s.` });
    }
    next();
  };
  mw.reset = () => hits.clear();
  return mw;
}

/* ---------------------------------------------------------------
 * Shape checks. The board is a free-form document, so we bound what
 * it can become rather than validating every field: no unbounded
 * growth, no surprise types.
 * ------------------------------------------------------------- */
const ARRAYS = ['prep', 'orders', 'clean', 'haccp', 'waste', 'transfers', 'proteins', 'notes', 'invoices'];
const MAX_ITEMS = 4000;
const MAX_BYTES = 4 * 1024 * 1024;

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'Bad state.';
  for (const k of ARRAYS) {
    if (state[k] === undefined) continue;
    if (!Array.isArray(state[k])) return `${k} must be a list.`;
    if (state[k].length > MAX_ITEMS) return `${k} is too long.`;
  }
  if (state.prices !== undefined && (typeof state.prices !== 'object' || Array.isArray(state.prices))) {
    return 'prices must be an object.';
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(state)); }
  catch { return 'State could not be read.'; }
  if (bytes > MAX_BYTES) return 'State is too large.';
  return null;
}

const isEmail = v => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isCode = v => typeof v === 'string' && /^\d{4}$/.test(v);
const isId = v => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v);

module.exports = { headers, csrf, csrfToken, rateLimit, validateState, isEmail, isCode, isId, CSP };
