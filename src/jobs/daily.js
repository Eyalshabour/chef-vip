'use strict';
const cron = require('node-cron');
const { pool } = require('../db');
const melba = require('../melba');

const TZ = 'Europe/Paris';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

async function readBoard() {
  const { rows } = await pool.query('SELECT rev, state FROM board WHERE id = 1');
  return rows[0];
}

async function writeBoard(rev, state, note) {
  const { rowCount } = await pool.query(
    'UPDATE board SET rev = rev + 1, state = $1, updated_at = now() WHERE id = 1 AND rev = $2',
    [state, rev]);
  if (!rowCount) { console.warn('[job] board moved under us, skipping:', note); return false; }
  await pool.query('INSERT INTO audit (user_id, action, detail) VALUES (NULL, $1, $2)',
    [note, { rev: rev + 1 }]).catch(() => {});
  return true;
}

/* Morning: open the service, pull Melba, flag what to order. */
async function morning() {
  const b = await readBoard();
  const s = b.state;
  const day = today();

  if (s.serviceDate !== day) {
    s.serviceDate = day;
    for (const c of s.clean) { c.done = false; c.by = null; c.at = null; }
    for (const h of s.haccp) { h.done = false; h.by = null; h.at = null; h.value = ''; }
    s.prep = (s.prep || []).filter(p => !p.done);
    for (const p of s.prep) { p.done = false; p.by = null; p.at = null; }
  }

  if (melba.configured()) {
    try {
      const sum = await melba.summary();
      const org = (sum.me && sum.me.organization) || {};
      const re = await melba.reorder(7).catch(() => null);
      const d = (re && re.details) || {};
      s.melbaSnap = {
        at: Date.now(), org: org.name || 'Shabour', by: 'Chef VIP',
        products: (sum.cat && sum.cat.totalCount) != null ? sum.cat.totalCount : null,
        autoIngredientStock: !!org.automateIngredientStocks,
        autoRecipeStock: !!org.automateRecipeStocks,
        reorderSuppliers: 0,
        reorderLines: d.totalLines || 0,
        reorderAmount: d.totalAmount || 0,
        note: org.automateIngredientStocks ? '' :
          'Reorder is zero because stock is not automated in Melba - there are no quantities to compare against a threshold.',
      };
    } catch (e) {
      console.warn('[job] melba read failed:', e.message);
    }
  }

  await writeBoard(b.rev, s, 'job_morning');
  console.log('[job] morning done for', day);
}

/* Evening: carry unfinished prep to tomorrow and note what was missed. */
async function evening() {
  const b = await readBoard();
  const s = b.state;

  const left = (s.prep || []).filter(p => !p.arch && !p.done).length;
  const cleanLeft = (s.clean || []).filter(c => !c.done).length;
  const haccpLeft = (s.haccp || []).filter(h => !h.done).length;

  if (left || cleanLeft || haccpLeft) {
    const bits = [];
    if (left) bits.push(left + ' prep');
    if (cleanLeft) bits.push(cleanLeft + ' cleaning');
    if (haccpLeft) bits.push(haccpLeft + ' HACCP');
    s.notes = s.notes || [];
    s.notes.push({
      id: 'j' + Date.now().toString(36),
      text: 'End of service: ' + bits.join(', ') + ' left unticked.',
      by: null, at: Date.now(),
    });
    await writeBoard(b.rev, s, 'job_evening');
  }
  console.log('[job] evening done -', left, 'prep left');
}

function start() {
  const m = process.env.JOB_MORNING || '17 8 * * 2-6';
  const e = process.env.JOB_EVENING || '41 15 * * 2-6';
  cron.schedule(m, () => morning().catch(err => console.error('[job] morning', err)), { timezone: TZ });
  cron.schedule(e, () => evening().catch(err => console.error('[job] evening', err)), { timezone: TZ });
  console.log('[job] scheduled - morning', m, '| evening', e, '|', TZ);
}

module.exports = { start, morning, evening };
