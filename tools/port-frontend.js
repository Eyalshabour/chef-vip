'use strict';
/*
 * Port the board's interface into this repo.
 *
 * The board (the single-page version) is where the interface is authored.
 * This turns it into the hosted app: same views, same actions, but talking
 * to our own API instead of publishing itself, and reading its data from
 * the server instead of from inline script tags.
 *
 * Run it whenever the board changes:
 *     node tools/port-frontend.js ../kitchen/content.html
 *
 * It refuses to write a frontend that has fewer actions than the board,
 * because that is exactly how the two silently drifted apart once.
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', '..', 'kitchen', 'content.html');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(SRC, 'utf8');

const grab = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${what} in ${SRC}`);
  return m[1];
};

const styles = grab(/<style id="styles">([\s\S]*?)<\/style>/, 'the stylesheet');
const app    = grab(/<script id="app">([\s\S]*?)<\/script>/, 'the app');
const state  = JSON.parse(grab(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/, 'the state').replace(/<\\\//g, '</'));

/* ---- seed data comes out of the board and into the repo ---- */
const json = (re, name) => {
  const v = JSON.parse(grab(re, name));
  fs.writeFileSync(path.join(ROOT, 'seed', name + '.json'), JSON.stringify(v));
  return v;
};
json(/var RECIPES = (\[[\s\S]*?\]);\n/, 'recipes');
json(/var ORDER_CATS = (\{[\s\S]*?\});\n/, 'orderCats');
json(/var SUPPLIERS = (\[[\s\S]*?\]);\n/, 'suppliers');
for (const k of ['prep', 'clean', 'haccp']) {
  fs.writeFileSync(path.join(ROOT, 'seed', k + '.json'), JSON.stringify(state[k]));
}
fs.writeFileSync(path.join(ROOT, 'seed', 'brigade.js'),
  'module.exports = ' + grab(/var BRIGADE = (\[[\s\S]*?\n\];)/, 'the brigade').slice(0, -1) + ';\n');

/* ---- the transform ---- */
const cut = (s, re, what) => {
  const out = s.replace(re, '');
  if (out === s) throw new Error(`transform missed: ${what}`);
  return out;
};
const swap = (s, from, to, what) => {
  if (typeof from === 'string' ? !s.includes(from) : !from.test(s)) throw new Error(`transform missed: ${what}`);
  return s.replace(from, to);
};

let fe = app;

fe = swap(fe, `var stateEl = document.getElementById("state");
var STYLES  = document.getElementById("styles").textContent;
var APPSRC  = document.getElementById("app").textContent;

var S;
try { S = JSON.parse(stateEl.textContent); } catch(e){ S = {}; }`,
`var S = (window.__BOOT__ && window.__BOOT__.state) || {};
/* The sign-in screen renders before any board has arrived, so S must be
 * safe to read from the very first paint. */
S.accounts = S.accounts || {};
S.prep = S.prep || []; S.orders = S.orders || []; S.clean = S.clean || []; S.haccp = S.haccp || [];
S.waste = S.waste || []; S.transfers = S.transfers || []; S.proteins = S.proteins || [];
S.notes = S.notes || []; S.invoices = S.invoices || []; S.prices = S.prices || {};
S.recArch = S.recArch || {}; if(S.priceJump == null) S.priceJump = 10;

var RECIPES    = window.__BOOT__.recipes;
var ORDER_CATS = window.__BOOT__.orderCats;
var SUPPLIERS  = window.__BOOT__.suppliers;`, 'the state header');

for (const [re, what] of [
  [/var RECIPES = \[[\s\S]*?\];\n/, 'inline recipes'],
  [/var ORDER_CATS = \{[\s\S]*?\};\n/, 'inline order catalogue'],
  [/var SUPPLIERS = \[[\s\S]*?\];\n/, 'inline suppliers'],
  [/var PREP_SRC = \{[\s\S]*?\};\n/, 'inline prep source'],
  [/var PREP_NOTES = \[[\s\S]*?\];\n/, 'inline prep notes'],
  [/function buildDoc\(\)\{[\s\S]*?\n\}\n/, 'buildDoc'],
]) fe = cut(fe, re, what);

/* the brigade arrives from the server; PEOPLE must alias it AFTER it exists */
fe = swap(fe, /var BRIGADE = \[[\s\S]*?\n\];\n/,
  'var BRIGADE = window.__BOOT__.brigade || [];\n', 'the brigade');
fe = swap(fe, 'var PEOPLE = BRIGADE;',
  'var PEOPLE;   /* aliased below, once BRIGADE exists */', 'the PEOPLE alias');
fe = swap(fe, 'var BRIGADE = window.__BOOT__.brigade || [];',
  'var BRIGADE = window.__BOOT__.brigade || [];\nPEOPLE = BRIGADE;   /* same array, so a refresh reaches both */', 'the PEOPLE binding');

/* the artifact capability handle is gone; the name is needed for api() */
fe = swap(fe, 'var api = null, readOnly = false,', 'var readOnly = false,', 'the capability handle');

const API = `
/* ---- the only door to the server, so the token is never forgotten ---- */
var CSRF = "";
function api(method, path, body){
  var o = { method: method, headers: {}, credentials: "same-origin" };
  if(body !== undefined){ o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
  if(CSRF && method !== "GET") o.headers["X-CSRF-Token"] = CSRF;
  return fetch(path, o).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(j){
      if(j && j.csrf) CSRF = j.csrf;
      return { status: r.status, ok: r.ok, json: j };
    });
  });
}

var saveT = null, dirty = false;
function save(msg){
  if(readOnly){ render(); return; }
  dirty = true; render();
  clearTimeout(saveT);
  saveT = setTimeout(flush, 350);
  if(msg) toast(msg);
}
function flush(){
  api("PUT", "/api/state", {rev: S.rev, state: S}).then(function(r){
    dirty = false;
    if(r.status === 409){ S = r.json.state; render(); toast("Someone else saved first - reloaded"); return; }
    if(r.status === 401){ me = null; render(); return; }
    if(r.status === 403){ toast("Session expired - reload the page"); render(); return; }
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save, try again"); render(); return; }
    S.rev = r.json.rev; render();
  })["catch"](function(){ dirty = false; toast("Could not save, try again"); render(); });
}
function poll(){
  if(dirty || !me) return;
  api("GET", "/api/state").then(function(r){
    if(r.ok && r.json && r.json.state && r.json.state.rev !== S.rev){ S = r.json.state; render(); }
  })["catch"](function(){});
}
`;
fe = swap(fe, /function save\(msg\)\{[\s\S]*?\n\}\n/, API, 'save()');

fe = swap(fe, /A\.login = function\(\)\{[\s\S]*?\n\};\n/,
`A.login = function(){
  var e = document.getElementById("lg-e"), c = document.getElementById("lg-c");
  api("POST", "/api/login", {email: e.value.trim(), code: c.value.trim()}).then(function(r){
    if(!r.ok){ loginErr = (r.json && r.json.error) || "Sign in failed."; render(); return; }
    loginErr = null; boot();
  })["catch"](function(){ loginErr = "Server unreachable."; render(); });
};
`, 'login');

/* A.forget is a one-liner on the board; a multi-line pattern here runs
 * past it and swallows whatever comes next. */
fe = swap(fe, /A\.forget = function\(\)\{.*?\};\n/,
  'A.forget = function(){ api("POST", "/api/logout").then(function(){ me = null; CSRF = ""; render(); }); };\n', 'sign out');

fe = swap(fe, /A\.setPin = function\(id\)\{[\s\S]*?\n\};\n/,
`A.setPin = function(id){
  var f = document.getElementById("ac-" + id);
  var v = (f ? f.value : "").trim(), a = S.accounts[id] || {};
  if(!/^\\d{4}$/.test(v)){ toast("Four digits"); return; }
  if(!a.email){ toast("Add the email first"); return; }
  api("POST", "/api/users/" + id + "/code", {email: a.email, code: v}).then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    f.value = ""; toast(nameOf(id) + " can sign in now"); boot();
  })["catch"](function(){ toast("Could not save"); });
};
`, 'set code');

fe = swap(fe, /A\.grantOrder = function\(id\)\{[\s\S]*?\n\};\n/,
`A.grantOrder = function(id){
  api("POST", "/api/users/" + id + "/order").then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    toast(r.json.canOrder ? nameOf(id) + " can order now" : nameOf(id) + " can no longer order"); boot();
  })["catch"](function(){ toast("Could not save"); });
};
`, 'grant orders');

fe = swap(fe, /A\.clearAcc = function\(id\)\{[\s\S]*?\n\};\n/,
`A.clearAcc = function(id){
  api("DELETE", "/api/users/" + id + "/access").then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    toast("Access removed"); boot();
  })["catch"](function(){ toast("Could not save"); });
};
`, 'revoke access');

fe = swap(fe, /\/\* ---- melba[\s\S]*?\nA\.reorder = function\(\)\{[\s\S]*?\n\};\n/,
`/* ---- melba, read server-side with the house key ---- */
function mcpMsg(err){ return (err && err.message) || "Melba unreachable right now."; }
function startLive(){
  api("GET", "/api/melba/summary").then(function(r){
    var j = r.json || {};
    live.me = j.me || null; live.cat = j.cat || null; live.at = j.at || null;
    live.meErr = j.error ? {message: j.error} : null; render();
  })["catch"](function(e){ live.meErr = e; render(); });
}
function stopLive(){}
A.reorder = function(){
  live.reorderBusy = true; live.reorderErr = null; render();
  api("POST", "/api/melba/reorder").then(function(r){
    var j = r.json || {};
    live.reorder = j.error ? null : j; live.reorderErr = j.error ? {message: j.error} : null;
    live.reorderBusy = false; render();
  })["catch"](function(e){ live.reorderErr = e; live.reorderBusy = false; render(); });
};
`, 'melba');

fe = swap(fe, /\/\* ============ boot ============ \*\/[\s\S]*\}\)\(\);\s*$/,
`/* ============ boot ============ */

function boot(){
  api("GET", "/api/state").then(function(r){
    if(r.status === 401){ me = null; render(); return; }
    var j = r.json; if(!j) return;
    S = j.state; me = j.user; readOnly = !!j.readOnly;
    if(j.brigade && j.brigade.length){ BRIGADE.length = 0; j.brigade.forEach(function(p){ BRIGADE.push(p); }); }
    mcp = true; mcpTried = true;
    render();
    if(isMgmt(me)) startLive();
  })["catch"](function(){ render(); });
}

boot();
setInterval(poll, 8000);
document.addEventListener("visibilitychange", function(){ if(!document.hidden) poll(); });
})();
`, 'boot');

/* ---- the guard that would have caught the drift ---- */
const actions = s => new Set([...s.matchAll(/^A\.(\w+) = function/gm)].map(m => m[1]));
const before = actions(app), after = actions(fe);
const lost = [...before].filter(a => !after.has(a));
if (lost.length) {
  console.error('The port dropped actions the board has:', lost.join(', '));
  console.error('Fix the transform above rather than shipping a frontend that cannot do them.');
  process.exit(1);
}
new Function(fe);   // must parse

fs.writeFileSync(path.join(ROOT, 'public', 'app.js'), fe);
fs.writeFileSync(path.join(ROOT, 'public', 'styles.css'), styles);
fs.writeFileSync(path.join(ROOT, 'public', 'data.js'),
  'window.__BOOT__.recipes = ' + fs.readFileSync(path.join(ROOT, 'seed', 'recipes.json'), 'utf8') + ';\n' +
  'window.__BOOT__.orderCats = ' + fs.readFileSync(path.join(ROOT, 'seed', 'orderCats.json'), 'utf8') + ';\n' +
  'window.__BOOT__.suppliers = ' + fs.readFileSync(path.join(ROOT, 'seed', 'suppliers.json'), 'utf8') + ';\n' +
  'window.__BOOT__.brigade = ' + JSON.stringify(require(path.join(ROOT, 'seed', 'brigade.js'))) + ';\n');

console.log(`ported: ${after.size} actions, ${(fe.length / 1024 | 0)}KB app, ${(styles.length / 1024 | 0)}KB css`);
console.log(`seed:   ${state.prep.length} prep, ${state.clean.length} cleaning, ${state.haccp.length} haccp`);
