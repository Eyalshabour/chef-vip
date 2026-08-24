'use strict';
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
const isLocal = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', err => console.error('[db] idle client error', err.message));

module.exports = { pool, q: (t, p) => pool.query(t, p) };
