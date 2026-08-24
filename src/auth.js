'use strict';
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const ROUNDS = 12;

const hash = code => bcrypt.hash(String(code), ROUNDS);

async function verify(email, code) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE lower(email) = lower($1)',
    [String(email || '').trim()]
  );
  const u = rows[0];
  // Compare against a dummy hash when the user is unknown, so a bad email and a
  // bad code take the same time to answer.
  const stored = u && u.code_hash ? u.code_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO';
  const ok = await bcrypt.compare(String(code || ''), stored);
  if (!u || !u.code_hash || !ok) return null;
  return u;
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

module.exports = { hash, verify, publicUser, requireUser, requireMgmt };
