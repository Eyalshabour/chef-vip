'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', f), 'utf8'));
const brigade = require('../seed/brigade.js');

const MGMT = { ee: 1, vb: 1, ha: 1 };

(async () => {
  for (const p of brigade) {
    await pool.query(
      `INSERT INTO users (id, name, ini, role, is_mgmt, can_order, always_on, shifts)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7)
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

  const { rows } = await pool.query('SELECT rev FROM board WHERE id = 1');
  if (!rows.length) {
    const state = {
      serviceDate: null, rev: 1,
      prep: read('prep.json'), clean: read('clean.json'), haccp: read('haccp.json'),
      orders: [], waste: [], transfers: [], proteins: [], notes: [],
      recArch: {}, melbaSnap: null,
    };
    await pool.query('INSERT INTO board (id, rev, state) VALUES (1, 1, $1)', [state]);
    console.log('board seeded:', state.prep.length, 'prep,', state.clean.length, 'cleaning,', state.haccp.length, 'haccp');
  } else {
    console.log('board already exists at rev', rows[0].rev, '- left alone');
  }
  console.log('seed ok:', brigade.length, 'people');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
