'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./db');
const { hash, verify, publicUser, requireUser, requireMgmt, requireOrders, requireInvoice } = require('./auth');
const sec = require('./security');
const melba = require('./melba');
const prices = require('./prices');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(sec.headers);
app.use(express.json({ limit: '12mb' }));   // an 8MB photo is ~11MB once base64'd

app.use(session({
  store: new PgSession({ pool, tableName: 'session', pruneSessionInterval: 900 }),
  name: 'chefvip.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));
app.use(sec.csrf);

const audit = (uid, action, detail) =>
  pool.query('INSERT INTO audit (user_id, action, detail) VALUES ($1,$2,$3)', [uid || null, action, detail || null])
    .catch(() => {});

/* ---------- health ---------- */
app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

/* ---------- auth ---------- */
/* Two limiters, deliberately. Keying only on IP would mean one person
 * mistyping their code throttles the whole brigade, because the kitchen
 * shares one connection. So: a tight limit per email address, and a
 * looser one per address so a single machine cannot sweep every account.
 * The per-account lockout in auth.js is the real defence; these only
 * slow the door down. */
const loginByEmail = sec.rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  key: req => 'e:' + String((req.body && req.body.email) || '').trim().toLowerCase(),
});
const loginByIp = sec.rateLimit({ windowMs: 10 * 60 * 1000, max: 60, key: req => 'i:' + (req.ip || '?') });
const loginLimit = [loginByIp, loginByEmail];

app.set('limiters', { loginByEmail, loginByIp });

app.post('/api/login', loginLimit, async (req, res) => {
  const { email, code } = req.body || {};
  if (!sec.isEmail(email) || !sec.isCode(code)) {
    return res.status(400).json({ error: 'An email and four digits.' });
  }
  const r = await verify(email, code);
  if (r.error === 'locked') {
    await audit(null, 'login_locked', { email: String(email).slice(0, 120) });
    return res.status(429).json({ error: 'Too many wrong codes. Try again in a few minutes.' });
  }
  if (r.error) {
    await audit(null, 'login_failed', { email: String(email).slice(0, 120) });
    return res.status(401).json({ error: 'Wrong email or code.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.uid = r.user.id;
    req.session.isMgmt = r.user.is_mgmt;
    sec.csrfToken(req);
    audit(r.user.id, 'login');
    res.json({ user: publicUser(r.user), csrf: req.session.csrf });
  });
});

app.post('/api/logout', (req, res) => {
  const uid = req.session && req.session.uid;
  req.session.destroy(() => { audit(uid, 'logout'); res.clearCookie('chefvip.sid'); res.json({ ok: true }); });
});

/* ---------- board ---------- */
async function boardPayload(uid) {
  const [{ rows: b }, { rows: people }] = await Promise.all([
    pool.query('SELECT rev, state FROM board WHERE id = 1'),
    pool.query("SELECT * FROM users ORDER BY (id = 'ee') DESC, name"),
  ]);
  const state = b[0].state;
  state.rev = b[0].rev;
  state.accounts = {};
  for (const p of people) {
    state.accounts[p.id] = { email: p.email || '', code: p.code_hash ? 'set' : '',
      order: p.can_order, invoice: p.can_invoice };
  }
  const me = people.find(p => p.id === uid);
  return { state, user: me ? publicUser(me) : null, brigade: people.map(publicUser), readOnly: false };
}

app.get('/api/state', requireUser, async (req, res) => {
  const payload = await boardPayload(req.session.uid);
  payload.csrf = sec.csrfToken(req);
  res.json(payload);
});

app.put('/api/state', requireUser, async (req, res) => {
  const { rev, state } = req.body || {};
  const bad = sec.validateState(state);
  if (bad) return res.status(400).json({ error: bad });
  if (!Number.isInteger(rev)) return res.status(400).json({ error: 'Missing revision.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT rev, state FROM board WHERE id = 1 FOR UPDATE');
    if (rows[0].rev !== rev) {
      await client.query('ROLLBACK');
      return res.status(409).json(await boardPayload(req.session.uid));
    }
    const next = rows[0].rev + 1;
    const clean = { ...state };
    delete clean.accounts;               // permissions live in users, never in the document
    await client.query('INSERT INTO board_history (rev, state, by_user) VALUES ($1,$2,$3)',
      [rows[0].rev, rows[0].state, req.session.uid]);
    await client.query(
      'UPDATE board SET rev = $1, state = $2, updated_at = now(), updated_by = $3 WHERE id = 1',
      [next, clean, req.session.uid]);
    await client.query('COMMIT');
    res.json({ rev: next });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[state] save failed:', e.message);
    res.status(500).json({ error: 'Could not save.' });
  } finally {
    client.release();
  }
});

/* ---------- people & permissions ---------- */
app.post('/api/users/:id/code', requireMgmt, async (req, res) => {
  const { email, code } = req.body || {};
  if (!sec.isId(req.params.id)) return res.status(400).json({ error: 'Unknown person.' });
  if (!sec.isEmail(email)) return res.status(400).json({ error: 'That is not an email.' });
  if (!sec.isCode(code)) return res.status(400).json({ error: 'Four digits.' });
  try {
    const { rowCount } = await pool.query(
      'UPDATE users SET email = $1, code_hash = $2, fail_count = 0, locked_until = NULL WHERE id = $3',
      [String(email).trim(), await hash(code), req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Unknown person.' });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Another account already uses that email.' });
    throw e;
  }
  await audit(req.session.uid, 'set_code', { for: req.params.id });
  res.json({ ok: true });
});

app.post('/api/users/:id/order', requireMgmt, async (req, res) => {
  if (!sec.isId(req.params.id)) return res.status(400).json({ error: 'Unknown person.' });
  const { rows } = await pool.query(
    'UPDATE users SET can_order = NOT can_order WHERE id = $1 AND is_mgmt = false RETURNING can_order',
    [req.params.id]);
  if (!rows.length) return res.status(400).json({ error: 'Management always can.' });
  await audit(req.session.uid, 'grant_order', { for: req.params.id, now: rows[0].can_order });
  res.json({ canOrder: rows[0].can_order });
});

app.post('/api/users/:id/invoice', requireMgmt, async (req, res) => {
  const { id } = req.params;
  if (!sec.isId(id)) return res.status(400).json({ error: 'Unknown person.' });
  const { rows } = await pool.query('SELECT is_mgmt, can_invoice FROM users WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Unknown person.' });
  if (rows[0].is_mgmt) return res.status(400).json({ error: 'Management always can.' });
  const next = !rows[0].can_invoice;
  await pool.query('UPDATE users SET can_invoice = $1 WHERE id = $2', [next, id]);
  audit(req.session.uid, next ? 'invoice_granted' : 'invoice_revoked', { id });
  res.json({ ok: true, invoice: next });
});

app.delete('/api/users/:id/access', requireMgmt, async (req, res) => {
  if (!sec.isId(req.params.id)) return res.status(400).json({ error: 'Unknown person.' });
  if (req.params.id === req.session.uid) return res.status(400).json({ error: 'You cannot lock yourself out.' });
  await pool.query(
    'UPDATE users SET code_hash = NULL, can_order = false, can_invoice = false, fail_count = 0, locked_until = NULL WHERE id = $1',
    [req.params.id]);
  await audit(req.session.uid, 'revoke_access', { for: req.params.id });
  res.json({ ok: true });
});

/* ---------- melba ---------- */
const melbaLimit = sec.rateLimit({ windowMs: 60 * 1000, max: 20 });
const onMelbaError = (res, e) => res.status(e.code === 'not_configured' ? 503 : 502).json({ error: e.message });

app.get('/api/melba/summary', requireMgmt, melbaLimit, async (_req, res) => {
  try { res.json(await melba.summary()); } catch (e) { onMelbaError(res, e); }
});

app.post('/api/melba/reorder', requireMgmt, melbaLimit, async (_req, res) => {
  try { res.json(await melba.reorder(7)); } catch (e) { onMelbaError(res, e); }
});

/* What Melba currently charges, matched to an invoice's lines. Read only. */
app.post('/api/melba/prices', requireMgmt, melbaLimit, async (req, res) => {
  const invoice = (req.body && req.body.invoice) || null;
  if (!invoice || !Array.isArray(invoice.lines)) return res.status(400).json({ error: 'Send an invoice.' });
  try {
    const [items, cat] = await Promise.all([melba.supplyingItems(), melba.products(200)]);
    const byId = {};
    for (const p of (cat && cat.data) || []) byId[p.id] = p;
    res.json({
      at: Date.now(),
      matches: invoice.lines.map(l => {
        const m = prices.matchMelba(l, items, byId);
        return m
          ? { product: l.product, melbaPrice: m.item.amount, supplyingItemId: m.item.id,
              melbaProduct: m.product.name, confidence: m.score === 3 ? 'exact' : 'partial' }
          : { product: l.product, melbaPrice: null };
      }),
    });
  } catch (e) { onMelbaError(res, e); }
});

/* Write the invoice's prices back. Explicit list, one line at a time,
 * each one named — never a blanket "apply everything". */
app.post('/api/melba/apply-prices', requireMgmt, melbaLimit, async (req, res) => {
  const updates = (req.body && req.body.updates) || [];
  if (!Array.isArray(updates) || !updates.length) return res.status(400).json({ error: 'Nothing to apply.' });
  if (updates.length > 100) return res.status(400).json({ error: 'Too many at once.' });
  const done = [], failed = [];
  for (const u of updates) {
    if (typeof u.supplyingItemId !== 'string' || !isFinite(u.amount) || u.amount < 0) {
      failed.push({ ...u, error: 'Bad line.' }); continue;
    }
    try { await melba.setPrice(u.supplyingItemId, u.amount); done.push(u); }
    catch (e) { failed.push({ ...u, error: e.message }); }
  }
  await audit(req.session.uid, 'melba_prices', { applied: done.length, failed: failed.length });
  res.json({ applied: done.length, failed });
});

/* ---------- the invoice itself ---------- */
const crypto = require('crypto');
const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const MAX_FILE = 8 * 1024 * 1024;

app.post('/api/invoices/file', requireInvoice, async (req, res) => {
  const { invoiceId, filename, mime, data } = req.body || {};
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'No file.' });
  if (!FILE_TYPES.has(mime)) return res.status(415).json({ error: 'Photograph or PDF only.' });
  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch { return res.status(400).json({ error: 'Could not read that file.' }); }
  if (!buf.length) return res.status(400).json({ error: 'That file is empty.' });
  if (buf.length > MAX_FILE) return res.status(413).json({ error: 'Over 8 MB.' });

  const id = crypto.randomBytes(9).toString('base64url');
  const name = String(filename || 'invoice').slice(0, 120).replace(/[\r\n\0]/g, '');
  await pool.query(
    'INSERT INTO invoice_files (id, invoice_id, filename, mime, bytes, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, invoiceId || null, name, mime, buf.length, buf, req.session.uid]);
  await audit(req.session.uid, 'invoice_upload', { id, name, bytes: buf.length });
  res.json({ id, filename: name, bytes: buf.length });
});

app.get('/api/invoices/file/:id', requireMgmt, async (req, res) => {
  const { rows } = await pool.query('SELECT filename, mime, data FROM invoice_files WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'No such file.' });
  res.setHeader('Content-Type', rows[0].mime);
  res.setHeader('Content-Disposition', 'inline; filename="' + rows[0].filename.replace(/"/g, '') + '"');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(rows[0].data);
});

/* Everything uploaded and not yet turned into lines - what Claude reads next. */
app.get('/api/invoices/unread', requireMgmt, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, invoice_id, filename, mime, bytes, uploaded_by, created_at' +
    '  FROM invoice_files WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 50');
  res.json({ files: rows });
});

app.post('/api/invoices/file/:id/read', requireMgmt, async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE invoice_files SET read_at = now(), invoice_id = COALESCE($2, invoice_id) WHERE id = $1',
    [req.params.id, (req.body && req.body.invoiceId) || null]);
  if (!rowCount) return res.status(404).json({ error: 'No such file.' });
  res.json({ ok: true });
});

app.delete('/api/invoices/file/:id', requireMgmt, async (req, res) => {
  await pool.query('DELETE FROM invoice_files WHERE id = $1', [req.params.id]);
  await audit(req.session.uid, 'invoice_file_delete', { id: req.params.id });
  res.json({ ok: true });
});

/* ---------- static ----------
 *
 * Deploying used to leave people on an hour-old app.js, because the files
 * were cached by name and the name never changed. Worse than slow: a fresh
 * index.html could pair with a stale app.js and the two disagree about what
 * exists. The brigade saw tabs a week after they were removed.
 *
 * So every asset URL now carries a hash of its own contents. A file that
 * changed gets a new URL and is fetched; a file that did not is served from
 * cache forever. index.html itself is never cached — it is 1KB and it is
 * the thing that names the others.
 */
const PUBLIC = path.join(__dirname, '..', 'public');
const stamp = f => {
  try {
    return crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(PUBLIC, f))).digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
};
const ASSET_V = { 'app.js': stamp('app.js'), 'data.js': stamp('data.js'), 'styles.css': stamp('styles.css') };

const SHELL = (() => {
  let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  for (const [file, v] of Object.entries(ASSET_V)) {
    html = html.split('/' + file + '"').join('/' + file + '?v=' + v + '"');
  }
  return html;
})();

app.use(express.static(PUBLIC, {
  index: false,
  etag: true,
  setHeaders(res, filePath) {
    /* a versioned URL can be kept forever; an unversioned one must be
       revalidated, or we are back where we started */
    const versioned = res.req && res.req.query && res.req.query.v;
    res.setHeader('Cache-Control', versioned
      ? 'public, max-age=31536000, immutable'
      : 'no-cache');
  },
}));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No such route.' });
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(SHELL);
});

app.use((err, req, res, _next) => {
  /* A big photograph arrives as a body the parser rejects before any route
   * sees it. Say so plainly rather than "something went wrong". */
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'That file is too big. Photographs up to 8 MB.' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return res.status(400).json({ error: 'That request could not be read.' });
  }
  console.error('[unhandled]', req.method, req.path, '-', err.message);
  res.status(500).json({ error: 'Something went wrong.' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`chef-vip listening on ${port}`);
    if (process.env.RUN_JOBS) require('./jobs/daily').start();
  });
}

module.exports = app;
