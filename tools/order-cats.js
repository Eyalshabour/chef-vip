#!/usr/bin/env node
'use strict';
/*
 * seed/order-sheet.json is what the paper says. This is what the app should
 * hold: the same lines, the same order, with the dairy page's French second
 * spelling merged into the first and each product kept only once.
 *
 *   node tools/order-cats.js            # writes seed/orderCats.json
 *   node tools/order-cats.js --literal  # prints the line for the board
 *
 * The board (content.html) carries the same literal, and the port copies it
 * back into seed/orderCats.json — so if the two ever disagree,
 * test/paper.test.js is the one that notices.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const key = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

function build(paper) {
  const alias = {};
  for (const [from, to] of Object.entries(paper.alias || {})) alias[key(from)] = to;
  const seen = new Set();
  const out = {};
  for (const [section, lines] of Object.entries(paper.sections)) {
    out[section] = [];
    for (const line of lines) {
      const name = alias[key(line)] || line;
      const k = key(name);
      if (seen.has(k)) continue;      /* first mention on the paper wins */
      seen.add(k);
      out[section].push(name);
    }
  }
  return out;
}

if (require.main === module) {
  const paper = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'order-sheet.json'), 'utf8'));
  const cats = build(paper);
  if (process.argv.includes('--literal')) {
    process.stdout.write('var ORDER_CATS = ' + JSON.stringify(cats) + ';\n');
  } else {
    fs.writeFileSync(path.join(root, 'seed', 'orderCats.json'), JSON.stringify(cats));
    for (const [k, v] of Object.entries(cats)) console.log(k.padEnd(6), v.length);
    console.log('wrote seed/orderCats.json —', Object.values(cats).flat().length, 'products');
  }
}

module.exports = { build };
