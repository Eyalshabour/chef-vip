#!/usr/bin/env node
'use strict';
/*
 * The prep catalogue is a copy of the printed sheet. This reads the PDF and
 * writes seed/prep-sheet.json — the record the board is checked against.
 *
 *   node tools/read-prep-sheet.js "PREP LIST.pdf"
 *
 * Needs pdftotext (poppler-utils), which is the only reliable way to keep
 * the four printed columns apart: the sheet's layout IS the data, and a
 * reader that flattens it to a single stream loses which column a line
 * belongs to.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function columns(pdf) {
  let txt;
  try {
    txt = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (e) {
    throw new Error('pdftotext is not installed — apt-get install poppler-utils');
  }
  const lines = txt.split('\n');
  const header = lines.find(l => (l.toLowerCase().match(/product/g) || []).length >= 3);
  if (!header) throw new Error('no header row with three or more "product" columns');
  /* the header's own column positions are the column boundaries */
  const at = [];
  const re = /product/gi;
  let m;
  while ((m = re.exec(header))) at.push(m.index);
  const bounds = at.map((x, i) => [Math.max(0, x - 8), i + 1 < at.length ? at[i + 1] - 8 : 1e6]);
  const cols = at.map(() => []);
  let started = false;
  for (const line of lines) {
    if (line === header) { started = true; continue; }
    if (!started) continue;
    bounds.forEach(([lo, hi], i) => {
      const seg = line.slice(lo, hi).trim();
      if (seg) cols[i].push(seg);
    });
  }
  return { A: cols[0], B: cols[1], C: cols[2], D: cols[3] };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/read-prep-sheet.js "<PREP LIST.pdf>"');
    process.exit(2);
  }
  const out = path.join(__dirname, '..', 'seed', 'prep-sheet.json');
  const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
  prev.source = path.basename(file);
  prev.columns = columns(file);
  fs.writeFileSync(out, JSON.stringify(prev, null, 2) + '\n');
  for (const [k, v] of Object.entries(prev.columns)) console.log(k, v.length);
  console.log('wrote seed/prep-sheet.json');
}

module.exports = { columns };
