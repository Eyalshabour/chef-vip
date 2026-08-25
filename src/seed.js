'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { bootstrap } = require('./auth');

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', f), 'utf8'));
const brigade = require('../seed/brigade.js');

const MGMT = { ee: 1, vb: 1, ha: 1 };

(async () => {
  for (const p of brigade) {
    await pool.query(
      `INSERT INTO users (id, name, ini, role, is_mgmt, can_order, can_invoice, always_on, shifts)
       VALUES ($1,$2,$3,$4,$5,$5,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, ini = EXCLUDED.ini,
             role = EXCLUDED.role, shifts = EXCLUDED.shifts`,
      [p.id, p.name, p.ini, p.role || null, !!MGMT[p.id], !!p.always, p.shifts || {}]
    );
  }
  await pool.query(
    `UPDATE users SET email = 'eyal@restaurantshabour.com'
      WHERE id = 'ee' AND email IS NULL`
  );

  /* BOOTSTRAP_FORCE is the way back in when the code is set but nobody knows
     it any more, or when the account is locked. It is deliberately a lever
     only someone with the deployment's environment can pull. */
  const force = /^(1|true|yes)$/i.test((process.env.BOOTSTRAP_FORCE || '').trim());
  const boot = await bootstrap(pool, 'ee', (process.env.BOOTSTRAP_CODE || '').trim(), { force });
  if (boot.ok && boot.replaced) {
    console.log("director's code RESET from BOOTSTRAP_CODE, and any lock cleared.");
    console.log('!!  Remove BOOTSTRAP_FORCE from the environment now, and change');
    console.log('!!  the code from Management once you are in.');
  } else if (boot.ok) {
    console.log("director's first code set from BOOTSTRAP_CODE — change it in Management once you are in");
  } else if (boot.why !== 'already set') {
    console.warn('');
    console.warn('!!  Nobody can sign in to this deployment yet.');
    console.warn('!!  The director has no code (' + boot.why + ').');
    console.warn('!!  Set BOOTSTRAP_CODE to four digits in the environment and deploy again.');
    console.warn('');
  }

  const { rows } = await pool.query('SELECT rev FROM board WHERE id = 1');
  if (!rows.length) {
    /* The whole shape, not a subset. The frontend fills in anything missing
       now, but a board in the database should still be a complete board. */
    const state = {
      serviceDate: null, rev: 1,
      prep: read('prep.json'), clean: read('clean.json'), haccp: read('haccp.json'),
      orders: [], proteins: [], notes: [],
      invoices: [], pinned: [], log: [], prices: {},
      accounts: {}, recArch: {}, priceJump: 10, melbaSnap: null,
    };
    await pool.query('INSERT INTO board (id, rev, state) VALUES (1, 1, $1)', [state]);
    console.log('board seeded:', state.prep.length, 'prep,', state.clean.length, 'cleaning,', state.haccp.length, 'haccp');
  } else {
    console.log('board already exists at rev', rows[0].rev, '- left alone');
  }
  console.log('seed ok:', brigade.length, 'people');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
