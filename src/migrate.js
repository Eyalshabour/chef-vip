'use strict';
const { pool } = require('./db');

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  ini        text NOT NULL,
  role       text,
  email      text UNIQUE,
  code_hash  text,
  is_mgmt    boolean NOT NULL DEFAULT false,
  can_order  boolean NOT NULL DEFAULT false,
  always_on  boolean NOT NULL DEFAULT false,
  shifts     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  fail_count   int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS fail_count int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE TABLE IF NOT EXISTS board (
  id         int PRIMARY KEY DEFAULT 1,
  rev        int NOT NULL DEFAULT 1,
  state      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users(id),
  CONSTRAINT board_single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS board_history (
  id serial PRIMARY KEY,
  rev int NOT NULL,
  state jsonb NOT NULL,
  by_user text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_history_at ON board_history (at DESC);

CREATE TABLE IF NOT EXISTS invoice_files (
  id          text PRIMARY KEY,
  invoice_id  text,
  filename    text NOT NULL,
  mime        text NOT NULL,
  bytes       int  NOT NULL,
  data        bytea NOT NULL,
  uploaded_by text REFERENCES users(id),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_files_invoice ON invoice_files (invoice_id);

CREATE TABLE IF NOT EXISTS audit (
  id serial PRIMARY KEY,
  user_id text,
  action  text NOT NULL,
  detail  jsonb,
  at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire ON "session" (expire);
`;

(async () => {
  await pool.query(SQL);
  console.log('migrations ok');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
