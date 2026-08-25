'use strict';
/*
 * The two lists in the app are copies of two pieces of paper the kitchen
 * already lives by: the ordering checklist (xlsx) and the printed prep sheet
 * (pdf). Every time I have touched them by hand they have drifted — products
 * resorted into headings the paper does not have, a product quietly dropped.
 *
 * seed/order-sheet.json and seed/prep-sheet.json are what the paper actually
 * says, written by tools/read-order-sheet.js and tools/read-prep-sheet.js.
 * These tests hold the app to them, so the next hand-edit that wanders off
 * the paper fails here instead of at 7am in the kitchen.
 */
const { test } = require('node:test');
const a = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

const paper = read('seed/order-sheet.json');
const app = read('seed/orderCats.json');
const key = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* the paper as the app should hold it: aliases applied, first mention wins */
function expected() {
  const alias = {};
  for (const [from, to] of Object.entries(paper.alias)) alias[key(from)] = to;
  const seen = new Set();
  const out = {};
  for (const [section, lines] of Object.entries(paper.sections)) {
    out[section] = [];
    for (const line of lines) {
      const name = alias[key(line)] || line;
      const k = key(name);
      if (seen.has(k)) continue;
      seen.add(k);
      out[section].push(name);
    }
  }
  return out;
}

test('the app files products under the sheet’s own sections, in the sheet’s order', () => {
  a.deepEqual(Object.keys(app), Object.keys(paper.sections));
});

test('nothing on the ordering sheet is missing from the app', () => {
  const have = new Set(Object.values(app).flat().map(key));
  const alias = {};
  for (const [from, to] of Object.entries(paper.alias)) alias[key(from)] = to;
  const lost = [];
  for (const lines of Object.values(paper.sections)) {
    for (const line of lines) {
      const name = alias[key(line)] || line;
      if (!have.has(key(name))) lost.push(line);
    }
  }
  a.deepEqual(lost, [], 'products printed on the sheet that the app cannot order');
});

test('and the app orders nothing the sheet has never heard of', () => {
  const onPaper = new Set(Object.values(paper.sections).flat().map(key));
  for (const to of Object.values(paper.alias)) onPaper.add(key(to));
  const invented = Object.values(app).flat().filter(p => !onPaper.has(key(p)));
  a.deepEqual(invented, [], 'products in the app that are on no order sheet');
});

test('each section reads down the page exactly as it is printed', () => {
  const want = expected();
  for (const section of Object.keys(want)) {
    a.deepEqual(app[section], want[section],
      `${section} does not read in the order the sheet prints it`);
  }
});

test('the sheet’s French second spelling is merged, not shown twice', () => {
  const have = new Set(Object.values(app).flat().map(key));
  for (const from of Object.keys(paper.alias)) {
    a.equal(have.has(key(from)), false,
      `"${from}" is the dairy page's spelling of "${paper.alias[from]}" and should not appear on its own`);
  }
});

/* ---- the prep sheet ---- */
const prepPaper = read('seed/prep-sheet.json');
const boot = fs.readFileSync(path.join(root, 'public', 'data.js'), 'utf8');
const prepApp = JSON.parse(/__BOOT__\.prepSrc = (\{[\s\S]*?\});\n/.exec(boot)[1]);

test('the prep catalogue is the printed sheet, column by column', () => {
  const skip = new Set(prepPaper.notLines.map(key));
  for (const [col, lines] of Object.entries(prepPaper.columns)) {
    a.deepEqual(prepApp[col], lines.filter(l => !skip.has(key(l))),
      `column ${col} of the prep sheet`);
  }
});

test('the lines skipped from the prep sheet are notes, never products', () => {
  /* if this list ever grows a real preparation, it has been lost from the
     kitchen's sheet without anyone noticing */
  a.deepEqual(prepPaper.notLines,
    ['protein', 'NOTE', 'w', 'ristrictions', '1 no mashroom',
     'preperd all without', 'pesctrian NSF']);
});
