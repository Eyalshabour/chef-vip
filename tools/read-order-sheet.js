#!/usr/bin/env node
'use strict';
/*
 * The ordering list in the app is a copy of the paper one, not a retyping
 * of it. This reads the kitchen's own xlsx and writes seed/order-sheet.json,
 * which is the record the app and its tests are checked against.
 *
 * When Eyal sends a newer sheet:
 *   node tools/read-order-sheet.js "ordering check list shabour.xlsx"
 *   node tools/order-cats.js            # regenerates the app's ORDER_CATS
 *   npm run test:paper
 *
 * No dependencies: an xlsx is a zip of XML, and node has both.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---- the smallest zip reader that can read an xlsx ---- */
function unzip(buf) {
  const files = {};
  /* walk the central directory backwards from the end-of-central-directory */
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    /* the local header repeats the name and extra field at its own lengths */
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.slice(start, start + csize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    off += 46 + nlen + elen + clen;
  }
  return files;
}

const xmlText = frag => frag.replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

function readSheet(file) {
  const z = unzip(fs.readFileSync(file));
  const shared = [];
  const ssXml = z['xl/sharedStrings.xml'];
  if (ssXml) {
    const s = ssXml.toString('utf8');
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(s))) {
      shared.push((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map(xmlText).join(''));
    }
  }
  const sheet = z['xl/worksheets/sheet1.xml'].toString('utf8');
  const cells = new Map();          /* "row,col" -> value */
  /* Most cells in this sheet are empty and self-closing (<c r="BK1" s="85"/>).
     A regex that assumes every <c> has a matching </c> swallows whole runs of
     them and silently reads three products out of eight hundred, so each tag
     is walked and closed explicitly. */
  const re = /<c\s([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(sheet))) {
    const attrs = m[1];
    let inner = '';
    if (m[2] !== '/') {
      const end = sheet.indexOf('</c>', re.lastIndex);
      if (end < 0) break;
      inner = sheet.slice(re.lastIndex, end);
      re.lastIndex = end + 4;
    }
    const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    let col = 0;
    for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    const row = +ref[2];
    const type = /t="([^"]+)"/.exec(attrs);
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
    let val;
    if (type && type[1] === 'inlineStr') val = xmlText(inner);
    else if (!v) continue;
    else if (type && type[1] === 's') val = shared[+v[1]];
    else val = v[1];
    val = String(val == null ? '' : val).trim();
    if (val) cells.set(row + ',' + col, val);
  }
  return cells;
}

const HEADINGS = new Set(['prodact', 'product', 'amount', 'qnt.']);
function column(cells, col, from) {
  const out = [];
  for (const [key, val] of cells) {
    const [r, c] = key.split(',').map(Number);
    if (c !== col || r < (from || 7)) continue;
    if (HEADINGS.has(val.toLowerCase())) continue;
    out.push([r, val]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function build(file) {
  const cells = readSheet(file);
  /* The Daily Orders page's third column runs dairy, then a gap of blank
     rows, then the meat. That gap is the sheet's own divider between the
     two — the split is read from it rather than decided here. */
  const third = column(cells, 12);
  let gap = third.length;
  for (let i = 1; i < third.length; i++) {
    if (third[i][0] - third[i - 1][0] > 3) { gap = i; break; }
  }
  const names = rows => rows.map(x => x[1]);
  return {
    VEG:   names(column(cells, 4)).concat(names(column(cells, 8))),
    DAIRY: names(third.slice(0, gap)).concat(names(column(cells, 32))),
    MEAT:  names(third.slice(gap)),
    DRY:   names(column(cells, 19)).concat(names(column(cells, 24))),
    FISH:  names(column(cells, 45)),
  };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/read-order-sheet.js "<ordering check list.xlsx>"');
    process.exit(2);
  }
  const out = path.join(__dirname, '..', 'seed', 'order-sheet.json');
  const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
  prev.source = path.basename(file);
  prev.sections = build(file);
  fs.writeFileSync(out, JSON.stringify(prev, null, 2) + '\n');
  const n = Object.values(prev.sections).reduce((a, b) => a + b.length, 0);
  for (const [k, v] of Object.entries(prev.sections)) console.log(k.padEnd(6), v.length);
  console.log('wrote seed/order-sheet.json —', n, 'lines off the paper');
}

module.exports = { build, readSheet, unzip };
