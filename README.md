# Chef VIP

The kitchen board for Shabour. Prep sheet, order list, recipe book, cleaning round,
HACCP, waste and transfers — with real accounts and a database behind it.

Built from the kitchen's own paperwork: `PREP LIST.pdf`, `ordering check list shabour.xlsx`
and `shabour __ recipe_.pdf`.

## What's in it

| Screen | Who sees it |
|---|---|
| Service — brigade on today, from the Combo rota | everyone |
| Prep — the sheet, with `restriction` / `ADV`, protein counts and notes | everyone |
| Recipes — 86 recipes, current book and old menus | everyone |
| Cleaning, HACCP, Waste, Transfers | everyone |
| **Orders** — grouped by supplier, WhatsApp per supplier | management + anyone granted |
| **Management** — Melba figures, order approval, who did what, access | Eyal, Valentin, Hajir |

Sign-in is email + a four-digit code. Codes are bcrypt-hashed in the database —
unlike the previous single-page version, they are not readable from the page source.

## Running it locally

```bash
cp .env.example .env      # fill in DATABASE_URL and SESSION_SECRET
npm install
npm run migrate
npm run seed
npm run dev
```

Then open http://localhost:3000. Nobody can sign in yet — see below.

## First sign-in (the bootstrap)

The seed creates every person from the Combo rota but gives nobody a code.
Set Eyal's from a psql shell once, then do everyone else from the Access panel:

```sql
-- code 1234, replace it immediately from inside the app
UPDATE users SET email = 'eyal@restaurantshabour.com',
  code_hash = '$2a$12$REPLACE_WITH_A_REAL_HASH' WHERE id = 'ee';
```

Generate the hash with:

```bash
node -e "require('bcryptjs').hash('1234',12).then(console.log)"
```

## Deploying to Render

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` creates the
   web service and the Postgres database and wires `DATABASE_URL` for you.
3. Set `MELBA_API_KEY` and `MELBA_API_BASE` in the service's environment.
4. First deploy runs `migrate` and `seed` automatically.

## Melba

`src/melba.js` reads Melba with one house key, server-side, so the chef and sous
see the figures without needing their own connector.

**`MELBA_API_BASE` is unverified.** Melba's MCP endpoint is `https://mcp.melba.io/mcp`;
the REST base was not something we could confirm. Check it against Melba's own
documentation before trusting any number this returns. Until it is set, the
Management panel says Melba is not configured and everything else works normally.

Worth knowing: stock automation is currently **off** in the Shabour Melba account,
for both ingredients and recipes. Until it is on, the reorder calculation will always
return zero lines — not because nothing is low, but because there are no quantities
to compare against a threshold.

## The daily jobs

Two cron jobs, Europe/Paris, Tuesday to Saturday (the kitchen is closed Sunday and Monday):

- **08:17** — opens the service, resets cleaning and HACCP, keeps unfinished prep,
  pulls the Melba figures and the reorder preview onto the Management panel.
- **15:41** — notes what was left unticked at the end of the day.

Set `RUN_JOBS=` (empty) to turn them off. Run one by hand with `npm run job:daily -- morning`.

## Concurrency

The board is a single JSON document with a revision number. Saves are
compare-and-set: if someone saved first, the client is handed the newer version
and reloads rather than overwriting. Every previous revision is kept in
`board_history`.

## Layout

```
src/
  server.js        express app, routes, sessions
  db.js            postgres pool
  migrate.js       schema
  seed.js          people from the rota, the board's opening state
  auth.js          bcrypt, session guards
  melba.js         Melba client (house key, server-side)
  jobs/daily.js    morning + evening cron
public/
  index.html       shell
  data.js          recipes, order catalogue, suppliers, brigade
  app.js           the whole interface
  styles.css
seed/              the kitchen's data as JSON
```
