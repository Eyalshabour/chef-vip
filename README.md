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

## Security

| | |
|---|---|
| Codes | bcrypt, cost 12. Never in the page, never in a response, never in a log. |
| Wrong codes | 8 strikes locks the account for 15 minutes. A correct code will not open a locked account. |
| Unknown email | Answers identically to a wrong code, and takes the same time — an attacker cannot learn who has an account. |
| Login flooding | Ten tries per email per ten minutes, sixty per address. Keyed per email so one person mistyping does not throttle the brigade, who share one connection. |
| Sessions | httpOnly, SameSite=Lax, Secure in production, regenerated on sign-in so a planted session id is useless. |
| CSRF | Double-submit token, required on every write, compared in constant time. |
| Headers | CSP with no inline script, nosniff, DENY framing, no referrer leak, HSTS in production, no `X-Powered-By`. |
| The board | Size- and shape-checked before storage. Permissions live in the `users` table — anything a client posts under `accounts` is dropped. |
| Melba | The key stays on the server. Only management can reach it, rate limited, and price writes are line by line with an explicit id. |
| Audit | Every sign-in, failure, grant and revocation is recorded with who did it. |

What this is *not*: the four-digit codes are convenience credentials for a
kitchen, not passwords. Eight guesses out of ten thousand combinations is
slow going, but they are short by design. Do not reuse them anywhere else.

## Testing

```bash
npm test          # 59 unit and integration tests
npm run test:e2e  # the real interface against a live server
npm run test:all  # both
```

Both need a Postgres to talk to:

```bash
createdb chefvip_test
TEST_DATABASE_URL=postgres://localhost/chefvip_test npm run test:all
```

The end-to-end suite runs `public/app.js` unmodified against a stub DOM and a
real HTTP server. That is deliberate: it is the only layer that catches a
forgotten CSRF header, a renamed field, or a sign-in screen that crashes
before any data arrives — three bugs it found on its first run.

## Changing the interface

The interface is authored in the board (the single-page version) and ported here:

```bash
node tools/port-frontend.js ../kitchen/content.html
```

The port refuses to write a frontend with fewer actions than the board has,
because that is exactly how the two silently drifted apart once — eight
actions short, including the one that ticks things off.

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

## Getting an invoice in

1. Photograph it, or save the PDF.
2. **Invoices → Photograph or attach the invoice.** Straight from the camera on a
   phone; up to 8 MB; photographs and PDFs only.
3. Ask Claude to read it. The lines appear with what each product cost last time.
4. Check what moved, then Apply.

The file is stored in Postgres against the invoice and served back only to a
signed-in management session. `GET /api/invoices/unread` lists everything
uploaded and not yet turned into lines — that is the queue Claude works from.

Claude reads the invoice rather than Melba's own scanner, which charges a credit
a page. The board (the single-page version) has no upload button at all, because
a published page cannot hold a file; the control is drawn only when the app is
hosted.

## Melba

`src/melba.js` reads Melba with one house key, server-side, so the chef and sous
see the figures without needing their own connector.

The **routes** are confirmed — they are the ones Melba's own MCP tools document:
`GET /me`, `POST /supplying-items/search`, `PATCH /supplying-items/{id}`,
`POST /orders`, `POST /invoices/analyze`. What is **not** confirmed is the REST
base host: Melba's MCP endpoint is `https://mcp.melba.io/mcp`, and the REST base
could not be verified from the build environment. Set `MELBA_API_BASE` from
Melba's own documentation before trusting any number this returns. Until it is
set, the Management panel says Melba is not configured and everything else works.

Prices live on **supplying items** — one row per supplier per product, carrying
`amount`. There are 1246 of them in the Shabour account. `POST /api/melba/prices`
matches an invoice's lines against them so "was" is Melba's own number;
`POST /api/melba/apply-prices` writes the new ones back, one line at a time,
each named explicitly.

Worth knowing: stock automation is currently **off** in the Shabour Melba account,
for both ingredients and recipes. Until it is on, the reorder calculation will always
return zero lines — not because nothing is low, but because there are no quantities
to compare against a threshold.

## The daily jobs

Two cron jobs, Europe/Paris, **Monday to Saturday** — the kitchen closes Sundays:

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
