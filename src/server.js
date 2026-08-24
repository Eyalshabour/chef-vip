'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const { pool } = require('./db');
const { hash, verify, publicUser, requireUser, requireMgmt } = require('./auth');
const melba = require('./melba');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
}));

const audit = (uid, action, detail) =>
  pool.query('INSERT INTO audit (user_id, action, detail) VALUES ($1,$2,$3)', [uid, action, detail || null])
    .catch(() => {});

/* ---------- health ---------- */
app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

/* ---------- auth ---------- */
app.post('/api/login', async (req, res) => {
  const { email, code } = req.body || {};
  const u = await verify(email, code);
  if (!u) return res.status(401).json({ error: 'Wrong email or code.' });
  req.session.uid = u.id;
  req.session.isMgmt = u.is_mgmt;
  await audit(u.id, 'login');
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const uid = req.session && req.session.uid;
  req.session.destroy(() => { audit(uid, 'logout'); res.json({ ok: true }); });
});

/* ---------- board ---------- */
async function boardPayload(uid) {
  const [{ rows: b }, { rows: people }] = await Promise.all([
    pool.query('SELECT rev, state FROM board WHERE id = 1'),
    pool.query('SELECT * FROM users ORDER BY (id = \'ee\') DESC, name'),
  ]);
  const state = b[0].state;
  state.rev = b[0].rev;
  // Permissions live in the users table; the client reads them off state.accounts.
  state.accounts = {};
  for (const p of people) {
    state.accounts[p.id] = { email: p.email || '', code: p.code_hash ? 'set' : '', order: p.can_order };
  }
  const me = people.find(p => p.id === uid);
  return { state, user: me ? publicUser(me) : null, brigade: people.map(publicUser), readOnly: false };
}

app.get('/api/state', requireUser, async (req, res) => {
  res.json(await boardPayload(req.session.uid));
});

app.put('/api/state', requireUser, async (req, res) => {
  const { rev, state } = req.body || {};
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'Bad state.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT rev, state FROM board WHERE id = 1 FOR UPDATE');
    if (rows[0].rev !== rev) {
      await client.query('ROLLBACK');
      const fresh = await boardPayload(req.session.uid);
      return res.status(409).json(fresh);
    }
    const next = rows[0].rev + 1;
    // Never trust the client with permissions.
    const clean = { ...state };
    delete clean.accounts;
    await client.query('INSERT INTO board_history (rev, state, by_user) VALUES ($1,$2,$3)',
      [rows[0].rev, rows[0].state, req.session.uid]);
    await client.query('UPDATE board SET rev = $1, state = $2, updated_at = now(), updated_by = $3 WHERE id = 1',
      [next, clean, req.session.uid]);
    await client.query('COMMIT');
    res.json({ rev: next });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Could not save.' });
  } finally {
    client.release();
  }
});

/* ---------- people & permissions (management only) ---------- */
app.post('/api/users/:id/code', requireMgmt, async (req, res) => {
  const { email, code } = req.body || {};
  if (!/^\d{4}$/.test(String(code || ''))) return res.status(400).json({ error: 'Four digits.' });
  if (!email) return res.status(400).json({ error: 'Email first.' });
  await pool.query('UPDATE users SET email = $1, code_hash = $2 WHERE id = $3',
    [String(email).trim(), await hash(code), req.params.id]);
  await audit(req.session.uid, 'set_code', { for: req.params.id });
  res.json({ ok: true });
});

app.post('/api/users/:id/order', requireMgmt, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE users SET can_order = NOT can_order WHERE id = $1 AND is_mgmt = false RETURNING can_order',
    [req.params.id]);
  if (!rows.length) return res.status(400).json({ error: 'Management always can.' });
  await audit(req.session.uid, 'grant_order', { for: req.params.id, now: rows[0].can_order });
  res.json({ canOrder: rows[0].can_order });
});

app.delete('/api/users/:id/access', requireMgmt, async (req, res) => {
  await pool.query('UPDATE users SET code_hash = NULL, can_order = false WHERE id = $1', [req.params.id]);
  await audit(req.session.uid, 'revoke_access', { for: req.params.id });
  res.json({ ok: true });
});

/* ---------- melba (management only) ---------- */
app.get('/api/melba/summary', requireMgmt, async (_req, res) => {
  if (!melba.configured()) return res.json({ error: 'Melba is not configured on the server.' });
  try { res.json(await melba.summary()); }
  catch (e) { res.json({ error: e.message }); }
});

app.post('/api/melba/reorder', requireMgmt, async (_req, res) => {
  if (!melba.configured()) return res.json({ error: 'Melba is not configured on the server.' });
  try { res.json(await melba.reorder(7)); }
  catch (e) { res.json({ error: e.message }); }
});

/* ---------- static ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`chef-vip listening on ${port}`);
  if (process.env.RUN_JOBS) require('./jobs/daily').start();
});
