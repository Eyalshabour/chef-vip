'use strict';
/*
 * The page has to survive its own Content-Security-Policy.
 *
 * We ship script-src 'self' on purpose: no inline script, no inline event
 * handler, no eval. That is a good policy and a quiet one — a violation
 * does not throw at build time, it just leaves the browser with a blank
 * screen. It has already happened once here: the bootstrap object lived in
 * an inline <script>, the browser refused it, and the app rendered nothing
 * while every server test still passed.
 *
 * So these read the shipped files the way a browser would.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const CSP = require('../src/security').CSP || '';

test('the policy still forbids inline script — these tests assume it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'security.js'), 'utf8');
  assert.match(src, /"script-src 'self'"/, 'script-src changed; revisit these tests');
  assert.ok(!/unsafe-inline[^"]*"\s*,?\s*$/m.test(src.split('script-src')[1]?.split('\n')[0] || ''),
    'script-src must not carry unsafe-inline');
});

test('index.html carries no inline script the browser would refuse', () => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter(m => m[1].trim());
  assert.deepStrictEqual(inline.map(m => m[1].trim().slice(0, 60)), [],
    'inline <script> is blocked by script-src \'self\' and the page will not boot');
});

test('nothing in the shipped markup uses an inline event handler', () => {
  for (const f of ['index.html', 'app.js', 'data.js']) {
    const s = read(f);
    const hits = [...s.matchAll(/\son(?:click|change|input|submit|keydown|keyup|focus|blur|load|error|touchstart)\s*=/gi)];
    assert.deepStrictEqual(hits.map(h => s.slice(Math.max(0, h.index - 40), h.index + 40)), [],
      `${f} has an inline handler; CSP refuses it and the control silently does nothing`);
  }
});

test('no eval or Function constructor — script-src forbids both', () => {
  const s = read('app.js');
  assert.ok(!/\beval\s*\(/.test(s), 'eval() is blocked by CSP');
  assert.ok(!/new\s+Function\s*\(/.test(s), 'new Function() is blocked by CSP');
});

test('every script the page loads exists, and the bootstrap comes first', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  assert.ok(srcs.length >= 2, 'expected at least data.js and app.js');
  for (const s of srcs) {
    assert.ok(fs.existsSync(path.join(PUB, s.replace(/^\//, ''))), `${s} is referenced but missing`);
  }
  assert.ok(srcs.indexOf('/data.js') < srcs.indexOf('/app.js'),
    'app.js reads __BOOT__, so data.js has to run first');
});

test('data.js defines __BOOT__ itself rather than trusting the page', () => {
  const d = read('data.js');
  const first = d.split('\n').find(l => l.trim());
  assert.match(first, /window\.__BOOT__\s*=/,
    'data.js must create __BOOT__ — nothing inline is allowed to create it for us');
  for (const k of ['recipes', 'orderCats', 'suppliers', 'brigade', 'prepSrc']) {
    assert.match(d, new RegExp(`__BOOT__\\.${k}\\s*=`), `__BOOT__.${k} is never set`);
  }
});

test('every stylesheet and font host the page uses is allowed by the policy', () => {
  const html = read('index.html');
  const hosts = [...html.matchAll(/<link[^>]*href="(https?:\/\/[^"/]+)/g)].map(m => m[1]);
  for (const h of new Set(hosts)) {
    assert.ok(CSP.includes(h.replace(/^https?:\/\//, '')) || CSP.includes(h),
      `${h} is loaded by the page but not named in the CSP`);
  }
});
