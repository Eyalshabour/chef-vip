'use strict';
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const ROUNDS = 12;
const MAX_FAILS = 8;              // per account
const LOCK_MS = 15 * 60 * 1000;   // then a 15-minute cool-off

/* A real hash of a value nobody can guess, so an unknown email costs
 * exactly as much time as a known one and cannot be told apart. */
const DUMMY = bcrypt.hashSync('::no-such-account::', ROUNDS);

const hash = code => bcrypt.hash(String(code), ROUNDS);

async function verify(email, code) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE lower(email) = lower($1)',
    [String(email || '').trim()]
  );
  const u = rows[0];

  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    await bcrypt.compare(String(code || ''), DUMMY);   // keep the timing flat
    return { error: 'locked', until: u.locked_until };
  }

  const stored = u && u.code_hash ? u.code_hash : DUMMY;
  const ok = await bcrypt.compare(String(code || ''), stored);

  if (!u || !u.code_hash || !ok) {
    if (u) {
      const fails = (u.fail_count || 0) + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS) : null;
      await pool.query(
        'UPDATE users SET fail_count = $1, locked_until = COALESCE($2, locked_until) WHERE id = $3',
        [lock ? 0 : fails, lock, u.id]
      );
    }
    return { error: 'bad' };
  }

  if (u.fail_count || u.locked_until) {
    await pool.query('UPDATE users SET fail_count = 0, locked_until = NULL WHERE id = $1', [u.id]);
  }
  return { user: u };
}

const publicUser = u => ({
  id: u.id, name: u.name, ini: u.ini, role: u.role,
  always: u.always_on, shifts: u.shifts || {},
});

function requireUser(req, res, next) {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Sign in first.' });
  next();
}

function requireMgmt(req, res, next) {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Sign in first.' });
  if (!req.session.isMgmt) return res.status(403).json({ error: 'Management only.' });
  next();
}

async function requireOrders(req, res, next) {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Sign in first.' });
  if (req.session.isMgmt) return next();
  const { rows } = await pool.query('SELECT can_order FROM users WHERE id = $1', [req.session.uid]);
  if (rows[0] && rows[0].can_order) return next();
  res.status(403).json({ error: 'Not your list.' });
}

/* ---------------------------------------------------------------
 * The first code has to come from somewhere.
 *
 * Every code is set by management from inside the app — but a fresh
 * database has no management signed in to set one, so nobody could ever
 * get in. The director's first code therefore comes from the environment,
 * once, and only while his is still unset: a code already in place is
 * never overwritten by a redeploy.
 * ------------------------------------------------------------- */
async function bootstrap(db, id, code) {
  if (!/^\d{4}$/.test(String(code || ''))) return { ok: false, why: 'not four digits' };
  const { rows } = await db.query('SELECT code_hash FROM users WHERE id = $1', [id]);
  if (!rows.length) return { ok: false, why: 'no such person' };
  if (rows[0].code_hash) return { ok: false, why: 'already set' };
  await db.query('UPDATE users SET code_hash = $1, fail_count = 0, locked_until = NULL WHERE id = $2',
    [await hash(code), id]);
  return { ok: true };
}

module.exports = { hash, verify, publicUser, requireUser, requireMgmt, requireOrders, MAX_FAILS, LOCK_MS, bootstrap };
