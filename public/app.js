
(function(){
"use strict";

/* ============ static reference data ============ */

var MELBA = {
  home:"https://app.melba.io/home",
  recipes:"https://app.melba.io/recipes",
  ingredients:"https://app.melba.io/ingredients",
  suppliers:"https://app.melba.io/suppliers",
  stock:"https://app.melba.io/stocks/ingredients/stock-transactions",
  analytics:"https://app.melba.io/home/analytics/5",
  extensions:"https://app.melba.io/extensions"
};
var COMBO = "https://app.combohr.com/plannings/week?location=80325&team=100604&date=";

/* Cuisine brigade, week 24-30 Aug 2026, from Combo */
var BRIGADE = window.__BOOT__.brigade || [];
PEOPLE = BRIGADE;   /* same array, so a refresh reaches both */

var PEOPLE;   /* aliased below, once BRIGADE exists */
var MGMT = {ee:1, vb:1, ha:1};
function isMgmt(p){ return !!(p && MGMT[p.id]); }
function canOrder(p){
  if(!p) return false;
  if(MGMT[p.id]) return true;
  var a = S.accounts && S.accounts[p.id];
  return !!(a && a.order);
}

var SHIFT_COLOR = {
  /* each carries white initials, so each clears 4.5:1 against white */
  /* drawn from the room: brass, plum-iron, the blue tile, rust, olive, steel.
     Each carries white initials, so each clears 4.5:1 against white. */
  "Prep Day":"#7A5B1B","Prep Night":"#5D4260","Dinner":"#275D86",
  "Coupure":"#8E4425","Lunch":"#4F6136","Leave":"#545A5F","Direction":"#2C3438"
};

var ON_MENU = ["Artichoke","Garlic Gribiche","Pickled Onion","Fish Tartare","Chopped Parsley","Urfa Oil","Caper Leaves","Onion Foam","Langoustine","Cream Oseille","Tzatziki","YellowTail","Lobster butter","Pomelo","Szabzi","Szabzi Tuille","Confit Leeks","Leek Juice","Sabayon Tomer","Fish Stock","Rouget","Leek Velouté / ND","Duck","Orange Gel","Celery Gel","Crumble Tanzia","Duck Jus","Pate","Mantu","Hamoud","Hamoud VEG","pickles coliflowers","Carrot Caviar","FENNEL CONFIT","Topi Confit","Veg Stock","Harif Oil","GF Bread","Brunoise Apple","Brunoise Mango (+green)","Brunoise Rhubarbe","cheese trat /gf/ND","Filo Cones / GF","Cherry BR","LOBSTER TARTAR","Fish Tartar","Razor Clams","Tarama / VEG","BR Mushrooms","Fig Gel","Ayran / ND","Cucumber Salad","Mahleb foam","sake cream","lemon cream","peas","peas jus","moule","toro tuna","mohamara","Gel Carrot Coriandre","Smokey Carrot","Bisque","Bisque Vege","Brocoli","Brunoise Chili","Brunoise Celeri","Cod","Cream Herbs","Cream Herbs ND","Fried chickpeas","Girolle","Muscade Vinaigar","Eggplant VG","Thina foam","B.egg","Relish","Bottarga","Meluhia powder","Sweetbread","Mustard leaves cream","Honey/Mustard Cream","Tempura","Zucchini flours","Zucchini Chiffonade","Veal Jus","Croutons"];
var ON_MENU_KEY = (function(){ var m={}; ON_MENU.forEach(function(x){ m[x.toLowerCase().replace(/[^a-z0-9]/g,"")]=1; }); return m; })();
function onMenu(name){ return !!ON_MENU_KEY[String(name||"").toLowerCase().replace(/[^a-z0-9]/g,"")]; }
var PREP_EXTRA = ["Onion Foam", "Cream Oseille", "Tzatziki", "Lobster butter", "Pomelo", "Brunoise Apple", "Brunoise Mango (+green)", "Brunoise Rhubarbe"];
var _prepList = null;
function PREP_LIST_get(){
  if(_prepList) return _prepList;
  /* On the board the master list is inline. In the hosted build the port
     strips it and hands it over in __BOOT__ instead — either way this is
     the printed sheet's order, and everything else follows it. */
  var SRC = (typeof PREP_SRC !== "undefined" && PREP_SRC)
    || (window.__BOOT__ && window.__BOOT__.prepSrc) || {};
  var seen = {}, out = [];
  ["A","B","C","D"].forEach(function(k){
    (SRC[k]||[]).forEach(function(t){
      var i = t.toLowerCase().replace(/[^a-z0-9]/g,"");
      if(!i || seen[i]) return; seen[i] = 1; out.push(t);
    });
  });
  PREP_EXTRA.forEach(function(t){
    var i = t.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(seen[i]) return; seen[i] = 1; out.push(t);
  });
  _prepList = out; return out;
}


var CLEAN_SRC = [["Organise all deliveries","General","8h-9h","Daily"],["Dishwasher","Plonge","9h","Daily"],["Staff food","General","12h","Daily"],["Fish ordering list","General","12h30","Daily"],["Clean fridge floor with javel","Cold","","Daily"],["Check dates in the fridge","Cold","","Daily"],["Make the report of the day","General","","Daily"],["Cleaning the dryer","General","","Weekly"],["Cleaning the shockfreezer","Cold","","Weekly"],["Deep cleaning fridge walls","Cold","","Weekly"],["Check closing of Saturday","General","","Weekly"],["List of all throwing of the week","General","","Weekly"]];

var CLEAN_SEED = CLEAN_SRC.map(function(c){ return [c[0] + (c[2]?" · "+c[2]:""), c[1], c[3]]; });

/* HACCP round - matches Melba's Hygiene & Traceability module */
var HACCP_SEED = [
  ["Fridge 1 — temperature (°C)","Cold","temp"],
  ["Fridge 2 — temperature (°C)","Cold","temp"],
  ["Cold room — temperature (°C)","Cold","temp"],
  ["Freezer — temperature (°C)","Cold","temp"],
  ["Fryer oil — polarity check","Hot","oil"],
  ["Delivery — temperature + use-by","Garde-manger","check"],
  ["Secondary labels / use-by dates on","General","check"],
  ["Traceability — lot labels kept","General","check"],
  ["Blast chilling — reading","Hot","temp"],
  ["Cleaning signed off end of service","General","check"]
];

/* ============ state ============ */

var S = (window.__BOOT__ && window.__BOOT__.state) || {};
/* The sign-in screen renders before any board has arrived, so S must be
 * safe to read from the very first paint. */
S.accounts = S.accounts || {};
S.prep = S.prep || []; S.orders = S.orders || []; S.clean = S.clean || []; S.haccp = S.haccp || [];
S.waste = S.waste || []; S.transfers = S.transfers || []; S.proteins = S.proteins || [];
S.notes = S.notes || []; S.invoices = S.invoices || []; S.prices = S.prices || {};
S.recArch = S.recArch || {}; if(S.priceJump == null) S.priceJump = 10;

var RECIPES    = window.__BOOT__.recipes;
var ORDER_CATS = window.__BOOT__.orderCats;
var SUPPLIERS  = window.__BOOT__.suppliers;
S.prep = S.prep || []; S.orders = S.orders || []; S.clean = S.clean || [];
S.haccp = S.haccp || []; S.pinned = S.pinned || []; S.log = S.log || [];
S.proteins = S.proteins || []; S.notes = S.notes || [];
S.waste = S.waste || []; S.transfers = S.transfers || [];
S.accounts = S.accounts || {};
S.recArch = S.recArch || {};
S.invoices = S.invoices || []; S.prices = S.prices || {};
if(S.priceJump == null) S.priceJump = 10;
S.rev = S.rev || 1;

var TABS_ALL = ["service","prep","orders","recipes","clean","pertes","transferts","invoices","haccp","direction"];
function TABS_get(){
  return TABS_ALL.filter(function(t){
    if(t === "direction") return isMgmt(me);
    if(t === "invoices")  return isMgmt(me);
    if(t === "orders")    return canOrder(me);
    return true;
  });
}
var TAB_LABEL = {service:"Service",prep:"Prep",orders:"Orders",recipes:"Recipes",clean:"Cleaning",haccp:"HACCP",pertes:"Waste",transferts:"Transfers",invoices:"Invoices",direction:"Management"};
var tab = "service";
try { var t = sessionStorage.getItem("sp.tab"); if (TABS_ALL.indexOf(t)>=0) tab = t; } catch(e){}

var me = null;
try { var m = localStorage.getItem("sp.me"); if(m){ me = PEOPLE.filter(function(p){return p.id===m})[0] || null; } } catch(e){}

var readOnly = false, busy = false, toastMsg = null, toastT = null;

/* direction */
var dirOpen = false, codeErr = null;
var rq = "", openRec = null;
var showOld = false, recView = "menu";
var openInv = null;
var share = null, copied = false;
var loginErr = null, loginMode = "code";
try { dirOpen = sessionStorage.getItem("sp.dir") === "1"; } catch(e){}

/* melba live (director only) */
var mcp = null, mcpTried = false;
var MELBA_SERVER = "melba";
var live = { me:null, meErr:null, cat:null, catErr:null, reorder:null, reorderErr:null, reorderBusy:false, at:null };
var unwatch = [];

/* ============ helpers ============ */

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function todayISO(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function mondayISO(iso){
  var p=iso.split("-"), d=new Date(+p[0],+p[1]-1,+p[2]);
  var wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function prettyDate(iso){
  var p=iso.split("-"), d=new Date(+p[0],+p[1]-1,+p[2]);
  return d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
}
function hhmm(ts){ if(!ts) return ""; var d=new Date(ts);
  return String(d.getHours()).padStart(2,"0")+"h"+String(d.getMinutes()).padStart(2,"0"); }
function byId(id){ return PEOPLE.filter(function(p){return p.id===id})[0]; }
function stamp(){ return me ? {by:me.id,at:Date.now()} : {by:null,at:Date.now()}; }
function nameOf(id){ var p=byId(id); return p?p.name.split(" ")[0]:"—"; }

var DAY = todayISO();
var WEEK = mondayISO(DAY);
var HAS_ROTA = (WEEK === "2026-08-24");

function onToday(){
  return BRIGADE.map(function(p){ return {p:p, s:p.shifts[DAY]||null}; });
}

/* ============ persistence ============ */



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

function toast(t){
  toastMsg = t; render();
  clearTimeout(toastT);
  toastT = setTimeout(function(){ toastMsg = null; render(); }, 2600);
}

/* ============ actions ============ */

var A = {};

A.pick = function(id){
  me = byId(id);
  if(mcp && isMgmt(me)) startLive();
  try { localStorage.setItem("sp.me", id); } catch(e){}
  render();
};
A.forget = function(){ api("POST", "/api/logout").then(function(){ me = null; CSRF = ""; render(); }); };

function list(kind){ return S[kind]; }

A.toggle = function(kind, id){
  if(!me){ toast("Tell us who you are first"); return; }
  var L = list(kind);
  for(var i=0;i<L.length;i++){ if(L[i].id===id){
    if(L[i].done){ L[i].done=false; L[i].by=null; L[i].at=null; }
    else { var s=stamp(); L[i].done=true; L[i].by=s.by; L[i].at=s.at; }
    break; } }
  save();
};

A.remove = function(kind, id){
  S[kind] = list(kind).filter(function(x){ return x.id!==id; });
  save();
};


/* ---- where a new line belongs -------------------------------------
 * Typing a product in should put it where the printed list has it, not
 * at the bottom of the sheet. Anything that is not on the printed list
 * is genuinely new, so that does go last. ------------------------- */
function rankKey(s){ return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

var _prepRank = null;
function prepRank(){
  if(_prepRank) return _prepRank;
  _prepRank = {};
  PREP_LIST_get().forEach(function(t, i){
    var k = rankKey(t);
    if(k && !(k in _prepRank)) _prepRank[k] = i;
  });
  return _prepRank;
}

var _catRank = null;
function catRank(){
  if(_catRank) return _catRank;
  _catRank = {}; var i = 0;
  Object.keys(ORDER_CATS).forEach(function(c){
    ORDER_CATS[c].forEach(function(pn){
      var k = rankKey(pn);
      if(k && !(k in _catRank)) _catRank[k] = i++;
    });
  });
  return _catRank;
}

/* Slide `item` in before the first line that the list puts after it.
 * `inGroup` narrows the comparison to one supplier, so each supplier's
 * block ends up in catalogue order without lines jumping between blocks. */
function insertRanked(arr, item, rank, inGroup){
  var r = rank[rankKey(item.title)];
  if(r === undefined){ arr.push(item); return arr.length - 1; }
  for(var i = 0; i < arr.length; i++){
    if(inGroup && !inGroup(arr[i])) continue;
    var ri = rank[rankKey(arr[i].title)];
    if(ri !== undefined && ri > r){ arr.splice(i, 0, item); return i; }
  }
  arr.push(item);
  return arr.length - 1;
}

/* Read out to a supplier in the order their own catalogue runs. */
function byCatalogue(list){
  var rank = catRank();
  return list.map(function(o, i){ return {o: o, i: i}; }).sort(function(a, b){
    var ra = rank[rankKey(a.o.title)], rb = rank[rankKey(b.o.title)];
    if(ra === undefined && rb === undefined) return a.i - b.i;
    if(ra === undefined) return 1;
    if(rb === undefined) return -1;
    return ra === rb ? a.i - b.i : ra - rb;
  }).map(function(x){ return x.o; });
}

A.addPrep = function(){
  /* The prep form is one field. It read three, and threw on the two that
     were never rendered — which is why nothing could be added to the sheet.
     Read what is there; treat the rest as optional. */
  var t = document.getElementById("prep-t");
  if(!t || !t.value.trim()){ if(t) t.focus(); return; }
  var q  = document.getElementById("prep-q");
  var st = document.getElementById("prep-s");
  insertRanked(S.prep, {
    id:uid(), title:t.value.trim(),
    qty: q ? q.value.trim() : "",
    station: st ? st.value : "",
    restr:"", adv:false, done:false, by:null, at:null,
    addedBy: me ? me.id : null
  }, prepRank());
  t.value = ""; if(q) q.value = "";
  save();
};

A.addOrder = function(){
  var t = document.getElementById("ord-t"), q = document.getElementById("ord-q"), s = document.getElementById("ord-s"), u = document.getElementById("ord-u");
  if(!t.value.trim()){ t.focus(); return; }
  var line = {id:uid(),title:t.value.trim(),qty:q.value.trim(),supplier:s.value,urgent:u.checked,done:false,by:null,at:null,addedBy:me?me.id:null};
  insertRanked(S.orders, line, catRank(), function(o){ return o.supplier === line.supplier; });
  t.value=""; q.value=""; u.checked=false; save();
};

A.addPin = function(){
  var t = document.getElementById("pin-t"), u = document.getElementById("pin-u");
  if(!t.value.trim()){ t.focus(); return; }
  var url = u.value.trim();
  if(url && !/^https:\/\/app\.melba\.io\//.test(url)){ toast("Paste an app.melba.io link"); return; }
  S.pinned.push({id:uid(),name:t.value.trim(),url:url,addedBy:me?me.id:null});
  t.value=""; u.value=""; save();
};

A.setVal = function(id, v){
  for(var i=0;i<S.haccp.length;i++){ if(S.haccp[i].id===id){ S.haccp[i].value=v; break; } }
};

A.loadPrep = function(){
  var have = {};
  S.prep.forEach(function(p){ have[p.title.toLowerCase()] = 1; });
  var n = 0;
  PREP_LIST_get().forEach(function(t){
    if(have[t.toLowerCase()]) return;
    S.prep.push({id:uid(),title:t,restr:"",adv:false,done:false,by:null,at:null});
    n++;
  });
  save(n ? n + " lines loaded" : "The sheet is already complete");
};

A.setRestr = function(id, v){
  for(var i=0;i<S.prep.length;i++){ if(S.prep[i].id===id){ S.prep[i].restr = v; break; } }
};

A.adv = function(id){
  if(!me){ toast("Tell us who you are first"); return; }
  for(var i=0;i<S.prep.length;i++){ if(S.prep[i].id===id){ S.prep[i].adv = !S.prep[i].adv; break; } }
  save();
};

A.addProt = function(){
  var n = document.getElementById("pr-n"), c = document.getElementById("pr-c");
  if(!n.value.trim()){ n.focus(); return; }
  S.proteins.push({id:uid(), name:n.value.trim(), count:c.value.trim()});
  n.value=""; c.value=""; save();
};
A.setProt = function(id, v){
  for(var i=0;i<S.proteins.length;i++){ if(S.proteins[i].id===id){ S.proteins[i].count = v; break; } }
};
A.addNote = function(){
  var t = document.getElementById("nt-t");
  if(!t.value.trim()){ t.focus(); return; }
  var st = stamp();
  S.notes.push({id:uid(), text:t.value.trim(), by:st.by, at:st.at});
  t.value=""; save();
};
A.addWaste = function(){
  var p = document.getElementById("w-p"), a = document.getElementById("w-a"), w = document.getElementById("w-w");
  if(!p.value.trim()){ p.focus(); return; }
  var st = stamp();
  S.waste.push({id:uid(), title:p.value.trim(), qty:a.value.trim(), why:w.value.trim(), by:st.by, at:st.at});
  p.value=""; a.value=""; w.value=""; save();
};
A.addTransfer = function(){
  var p = document.getElementById("t-p"), a = document.getElementById("t-a"), d = document.getElementById("t-d");
  if(!p.value.trim()){ p.focus(); return; }
  var st = stamp();
  S.transfers.push({id:uid(), title:p.value.trim(), qty:a.value.trim(), when:d.value.trim(), by:st.by, at:st.at});
  p.value=""; a.value=""; d.value=""; save();
};

A.newDay = function(){
  S.serviceDate = DAY;
  S.clean = CLEAN_SEED.map(function(c){ return {id:uid(),title:c[0],station:c[1],freq:c[2],done:false,by:null,at:null}; });
  S.haccp = HACCP_SEED.map(function(h){ return {id:uid(),title:h[0],station:h[1],kind:h[2],value:"",done:false,by:null,at:null}; });
  S.prep = S.prep.filter(function(x){ return !x.done; });
  save("New service open");
};


/* ---- direction: code gate ---- */
function hash4(v){
  var h = 5381, str = "shabour::" + String(v);
  for(var i=0;i<str.length;i++){ h = ((h*33) ^ str.charCodeAt(i)) >>> 0; }
  return h.toString(36);
}

A.setCode = function(){
  var a = document.getElementById("dc1").value.trim();
  var b = document.getElementById("dc2").value.trim();
  if(!/^\d{4}$/.test(a)){ codeErr = "Four digits, no more, no less."; render(); return; }
  if(a !== b){ codeErr = "The two codes do not match."; render(); return; }
  codeErr = null; S.dirCode = hash4(a);
  dirOpen = true; try{ sessionStorage.setItem("sp.dir","1"); }catch(e){}
  save("Management code saved");
};

A.unlock = function(){
  var v = document.getElementById("dcx").value.trim();
  if(hash4(v) !== S.dirCode){ codeErr = "Code refused."; render(); return; }
  codeErr = null; dirOpen = true;
  try{ sessionStorage.setItem("sp.dir","1"); }catch(e){}
  startLive(); render();
};

A.lock = function(){
  dirOpen = false; try{ sessionStorage.removeItem("sp.dir"); }catch(e){}
  stopLive(); render();
};

A.approve = function(id){
  if(!me){ toast("Tell us who you are first"); return; }
  for(var i=0;i<S.orders.length;i++){ if(S.orders[i].id===id){
    var o = S.orders[i];
    if(o.approved){ o.approved=false; o.approvedBy=null; o.approvedAt=null; }
    else { o.approved=true; o.approvedBy=me.id; o.approvedAt=Date.now(); }
    break; } }
  save();
};

/* ---- melba, read server-side with the house key ---- */
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

A.arch = function(id){
  for(var i=0;i<S.prep.length;i++){ if(S.prep[i].id===id){ S.prep[i].arch = !S.prep[i].arch; break; } }
  save();
};
A.showOld = function(){ showOld = !showOld; render(); };
A.recView = function(v){ recView = v; openRec = null; render(); };
A.recArch = function(name){
  if(S.recArch[name]) delete S.recArch[name]; else S.recArch[name] = 1;
  save();
};

A.rec = function(id){ openRec = (openRec === id ? null : id); render(); };
A.clearq = function(){ rq = ""; render(); };


/* ---- export to WhatsApp ---- */

function dayLabel(){
  var p = DAY.split("-"), d = new Date(+p[0], +p[1]-1, +p[2]);
  return d.toLocaleDateString("en-GB", {day:"numeric", month:"long"});
}

function buildShare(kind, key){
  var head = "*CHEF VIP - " + esc0(ORG) + "*", lines = [], title = "";

  if(kind === "order"){
    var open = S.orders.filter(function(o){ return !o.done && (key === "*" || o.supplier === key); });
    title = key === "*" ? "Order list" : key;
    lines = open.map(function(o){
      return "- " + o.title + (o.qty ? "  " + o.qty : "") + (o.urgent ? "  (URGENT)" : "")
        + (key === "*" ? "   [" + o.supplier + "]" : "");
    });
  } else if(kind === "prep"){
    var todo = S.prep.filter(function(p){ return !p.done; });
    title = "Prep left";
    lines = todo.map(function(p){
      return "- " + p.title + (p.restr ? "  (" + p.restr + ")" : "") + (p.adv ? "  [ADV]" : "");
    });
    if(S.proteins.length){
      lines.push("");
      lines.push("*Protein*");
      S.proteins.forEach(function(x){ lines.push("- " + x.name + ": " + (x.count || "-")); });
    }
    if(S.notes.length){
      lines.push("");
      lines.push("*Note*");
      S.notes.forEach(function(n){ lines.push("- " + n.text); });
    }
  } else if(kind === "waste"){
    title = "Waste";
    lines = S.waste.map(function(x){
      return "- " + x.title + (x.qty ? "  " + x.qty : "") + (x.why ? "  - " + x.why : "");
    });
  } else if(kind === "transfers"){
    title = "Transfers";
    lines = S.transfers.map(function(x){
      return "- " + x.title + (x.qty ? "  " + x.qty : "") + (x.when ? "  " + x.when : "");
    });
  } else if(kind === "invoice"){
    var v = S.invoices.filter(function(x){ return x.id === key; })[0];
    if(v){
      title = "Prices - " + v.supplier + (v.number ? " " + v.number : "");
      var mv = invMoves(v);
      var moved = mv.filter(function(m){ return m.d != null && Math.abs(m.d) >= 0.5; });
      lines = (moved.length ? moved : mv).map(function(m){
        return "- " + m.l.product + ": " + (m.prev ? money(m.prev.price) + " -> " : "")
          + money(m.l.price) + (m.d != null ? "  (" + pct(m.d) + ")" : "  (new)")
          + (jumped(m.d) ? "  <<" : "");
      });
      if(moved.length && moved.length < mv.length){
        lines.push(""); lines.push("(" + (mv.length - moved.length) + " unchanged)");
      }
    } else { title = "Prices"; }
  } else if(kind === "clean"){
    var left = S.clean.filter(function(c){ return !c.done; });
    title = "Cleaning left";
    lines = left.map(function(c){ return "- " + c.title; });
  } else if(kind === "haccp"){
    title = "HACCP round";
    lines = S.haccp.map(function(x){
      return (x.done ? "[x] " : "[ ] ") + x.title + (x.value ? "  " + x.value + " C" : "");
    });
  }

  if(!lines.length) lines = ["(nothing)"];
  var body = head + "\n*" + title + "* - " + dayLabel() + "\n\n" + lines.join("\n")
    + "\n\n" + (me ? me.name : "Chef VIP");
  return {title: title, text: body};
}

function esc0(x){ return String(x == null ? "" : x); }
var ORG = "Shabour";

A.share = function(kind, key){
  share = buildShare(kind, key); copied = false; render();
};
A.closeShare = function(){ share = null; copied = false; render(); };
A.copyShare = function(){
  if(!share) return;
  var done = function(){ copied = true; render(); };
  try {
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(share.text).then(done)["catch"](selectFallback);
      return;
    }
  } catch(e){}
  selectFallback();
};
function selectFallback(){
  var ta = document.getElementById("shtxt");
  if(ta){ ta.focus(); ta.select(); }
  toast("Select all and copy");
}

function shareBtn(kind, key, label){
  return '<button class="btn sm wa" data-act="share" data-kind="' + kind + '" data-key="'
    + esc(key || "*") + '">' + icoWA() + (label || 'WhatsApp') + '</button>';
}

function icoWA(){
  return '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">'
    + '<path fill="currentColor" d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.4A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3.1.8.8-3-.2-.3A8 8 0 1 1 12 20zm4.4-5.8c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.6.1a6.6 6.6 0 0 1-3.2-2.8c-.2-.4.2-.4.6-1.2a.5.5 0 0 0 0-.5c0-.1-.6-1.4-.8-1.9s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3A2.8 2.8 0 0 0 6.7 12a4.9 4.9 0 0 0 1 2.6 11 11 0 0 0 4.3 3.8c1.6.6 2.2.7 3 .6a2.5 2.5 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c-.1-.1-.2-.2-.4-.3z"/></svg>';
}


/* ---- opening something outside the board ----
 * The board runs in a sandboxed frame, and some of them refuse to let a
 * page navigate away. So every outside link is an ordinary anchor first,
 * and if the frame swallows it we hand over the address to copy instead. */
function extLink(url, label, cls){
  return '<a class="btn ' + (cls || '') + '" href="' + esc(url) + '" target="_blank" rel="noopener"'
    + ' data-ext="' + esc(url) + '" data-lbl="' + esc(label) + '">' + esc(label) + ' ↗</a>';
}

A.ext = function(url, label){
  var win = null;
  try { win = window.open(url, "_blank", "noopener"); } catch(e){}
  if(win) return;
  share = { title: label || "Open this", text: url };
  copied = false; render();
};

function shareModal(){
  if(!share) return "";
  var link = "https://wa.me/?text=" + encodeURIComponent(share.text);
  return '<div class="mod"><div class="mbox">'
    + '<h3>' + esc(share.title) + '</h3>'
    + '<p>Send it as it is, or copy the text and paste it wherever you like.</p>'
    + '<textarea id="shtxt" class="shtxt" readonly rows="10">' + esc(share.text) + '</textarea>'
    + '<div class="shrow">'
    + '<a class="btn pri wa" href="' + esc(link) + '" target="_blank" rel="noopener">' + icoWA() + 'Open WhatsApp</a>'
    + '<button class="btn" data-act="copyShare">' + (copied ? 'Copied' : 'Copy text') + '</button>'
    + '<button class="btn" data-act="closeShare">Close</button>'
    + '</div></div></div>';
}


/* ---- sign in: email + personal code ---- */

function h4(v){
  var h = 5381, str = "shabour::" + String(v);
  for(var i=0;i<str.length;i++){ h = ((h*33) ^ str.charCodeAt(i)) >>> 0; }
  return h.toString(36);
}

function accountFor(email){
  var e = String(email||"").trim().toLowerCase();
  if(!e) return null;
  var ids = Object.keys(S.accounts);
  for(var i=0;i<ids.length;i++){
    var a = S.accounts[ids[i]];
    if(a && a.email && a.email.toLowerCase() === e) return {id: ids[i], acc: a};
  }
  return null;
}

function enrolled(id){ var a = S.accounts && S.accounts[id]; return !!(a && a.email && a.code); }
function anyEnrolled(){ return PEOPLE.some(function(p){ return enrolled(p.id); }); }

A.login = function(){
  var e = document.getElementById("lg-e"), c = document.getElementById("lg-c");
  api("POST", "/api/login", {email: e.value.trim(), code: c.value.trim()}).then(function(r){
    if(!r.ok){ loginErr = (r.json && r.json.error) || "Sign in failed."; render(); return; }
    loginErr = null; boot();
  })["catch"](function(){ loginErr = "Server unreachable."; render(); });
};

A.loginMode = function(m){ loginMode = m; loginErr = null; render(); };

/* enrolment, from the management side */
A.setEmail = function(id, v){
  S.accounts[id] = S.accounts[id] || {email:"", code:""};
  S.accounts[id].email = String(v||"").trim();
};
A.setPin = function(id){
  var f = document.getElementById("ac-" + id);
  var v = (f ? f.value : "").trim(), a = S.accounts[id] || {};
  if(!/^\d{4}$/.test(v)){ toast("Four digits"); return; }
  if(!a.email){ toast("Add the email first"); return; }
  api("POST", "/api/users/" + id + "/code", {email: a.email, code: v}).then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    f.value = ""; toast(nameOf(id) + " can sign in now"); boot();
  })["catch"](function(){ toast("Could not save"); });
};
A.grantOrder = function(id){
  api("POST", "/api/users/" + id + "/order").then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    toast(r.json.canOrder ? nameOf(id) + " can order now" : nameOf(id) + " can no longer order"); boot();
  })["catch"](function(){ toast("Could not save"); });
};

A.clearAcc = function(id){
  api("DELETE", "/api/users/" + id + "/access").then(function(r){
    if(!r.ok){ toast((r.json && r.json.error) || "Could not save"); return; }
    toast("Access removed"); boot();
  })["catch"](function(){ toast("Could not save"); });
};

function viewLogin(){
  var un = PEOPLE.filter(function(p){ return !enrolled(p.id); });

  if(loginMode === "name" && un.length){
    return '<div class="mod"><div class="mbox"><h3>No code yet</h3>'
      + '<p>Pick your name to get started. Ask ' + esc(nameOf("vb")) + ' or Eyal to set you up with an email and a code.</p>'
      + '<div class="plist">' + un.map(function(p){
          var sh = p.shifts[DAY];
          var col = sh ? (SHIFT_COLOR[sh[0]]||"#545A5F") : "#545A5F";
          return '<button class="pbtn" data-act="pick" data-id="' + p.id + '">'
            + '<span class="av" style="background:' + col + '">' + esc(p.ini) + '</span>'
            + '<span><span class="pn">' + esc(p.name)
            + (p.role ? ' <span class="chip ac" style="text-transform:none">' + esc(p.role) + '</span>' : '') + '</span>'
            + '<span class="ps">' + (p.always ? 'Direction' : (sh ? esc(sh[0]) + ' · ' + esc(sh[1]) : 'off today')) + '</span></span></button>';
        }).join("") + '</div>'
      + '<div class="shrow" style="margin-top:12px"><button class="btn" data-act="loginMode" data-m="code">Back to sign in</button></div>'
      + '</div></div>';
  }

  return '<div class="mod"><div class="mbox"><h3>Sign in</h3>'
    + '<p>Your work email and your four-digit code. Everything you tick is signed with your name.</p>'
    + (loginErr ? '<div class="err" style="color:var(--crit);font-size:12.5px;font-weight:600;margin-bottom:10px">' + esc(loginErr) + '</div>' : '')
    + '<input id="lg-e" class="lgin" type="email" autocomplete="username" placeholder="you@restaurantshabour.com" data-enter="login">'
    + '<input id="lg-c" class="pin" inputmode="numeric" maxlength="4" placeholder="••••" data-enter="login">'
    + '<button class="btn pri" data-act="login" style="width:100%;justify-content:center">Sign in</button>'
    + (un.length ? '<div class="shrow" style="margin-top:10px"><button class="btn" data-act="loginMode" data-m="name">I have no code yet</button></div>' : '')
    + (!anyEnrolled() ? '<p style="margin:12px 0 0;font-size:12px;color:var(--ink3)">No accounts exist yet. Open Management and set them up under Access.</p>' : '')
    + '</div></div>';
}

function viewAccess(){
  var h = '<div class="sec"><div class="sec-h"><h2>Access</h2>'
    + '<span class="sub">' + PEOPLE.filter(function(p){ return enrolled(p.id); }).length
    + ' / ' + PEOPLE.length + ' set up</span></div>'
    + '<div class="ban q"><div class="bi">🔑</div><div><div class="bd">'
    + 'Give someone an email and a four-digit code and they sign in with it. Be clear-eyed about what this is: '
    + 'a name tag with a lock, not a password. The codes live in the page, so anyone who can read its source can read them. '
    + 'What actually keeps strangers out is who you share the board with. The Orders button hands someone the order list \u2014 management always has it.'
    + '</div></div></div><div class="card">';

  h += PEOPLE.map(function(p){
    var a = S.accounts[p.id] || {};
    var ok = enrolled(p.id);
    return '<div class="acrow">'
      + '<span class="av" style="background:' + (ok ? 'var(--av-ok)' : 'var(--av-mute)') + '">' + esc(p.ini) + '</span>'
      + '<span class="acname">' + esc(p.name)
      + (p.role ? ' <span class="chip ac" style="text-transform:none">' + esc(p.role) + '</span>' : '')
      + (isMgmt(p) ? ' <span class="chip ok" style="text-transform:none">management</span>' : '') + '</span>'
      + '<input class="acmail" type="email" value="' + esc(a.email || "") + '" placeholder="email" data-mail="' + p.id + '">'
      + '<input id="ac-' + p.id + '" class="acpin" inputmode="numeric" maxlength="4" placeholder="••••">'
      + '<button class="btn sm" data-act="setPin" data-id="' + p.id + '">' + (ok ? 'New code' : 'Set') + '</button>'
      + '<button class="btn sm' + (canOrder(p) ? ' pri' : '') + '" data-act="grantOrder" data-id="' + p.id + '"'
      + (MGMT[p.id] ? ' disabled title="Management always can"' : '') + '>Orders</button>'
      + (ok ? '<button class="x" data-act="clearAcc" data-id="' + p.id + '" aria-label="Remove access">&times;</button>' : '')
      + '</div>';
  }).join("");

  return h + '</div></div>';
}


/* ---- invoices: what the supplier actually charged ---- */

function pnorm(v){ return String(v == null ? "" : v).replace(/\s+/g," ").trim().toLowerCase(); }
function pkey(sup, prod){ return pnorm(sup) + "::" + pnorm(prod); }
function lastPrice(sup, prod){
  var h = S.prices[pkey(sup, prod)];
  return (h && h.length) ? h[h.length-1] : null;
}
function delta(oldP, newP){
  if(oldP == null || !isFinite(oldP) || oldP === 0 || newP == null) return null;
  return ((newP - oldP) / oldP) * 100;
}
function jumped(d){ return d != null && Math.abs(d) >= (S.priceJump || 10); }
function money(n){ return (n == null || !isFinite(n)) ? "—" : "€" + Number(n).toFixed(2); }
function pct(d){ return d == null ? "" : (d > 0 ? "+" : "") + d.toFixed(1) + "%"; }

A.addInvoice = function(){
  var sup = document.getElementById("iv-s"), no = document.getElementById("iv-n"), dt = document.getElementById("iv-d");
  var st = stamp();
  S.invoices.unshift({
    id: uid(), supplier: sup.value, number: no.value.trim(), date: dt.value.trim() || DAY,
    status: "draft", lines: [], by: st.by, at: st.at
  });
  no.value = ""; dt.value = "";
  save("Invoice started");
};
A.openInv = function(id){ openInv = (openInv === id ? null : id); render(); };
A.useName = function(id, name){
  var p = document.getElementById("il-p-" + id);
  if(p){ p.value = name; p.focus(); }
  render();
};

A.quickLine = function(id, name, price){
  for(var i=0;i<S.invoices.length;i++){ if(S.invoices[i].id===id){
    S.invoices[i].lines.push({id:uid(), product:name, qty:"", price:parseFloat(price)});
    break; } }
  save();
};

A.addLine = function(id){
  var p = document.getElementById("il-p-" + id), q = document.getElementById("il-q-" + id), u = document.getElementById("il-u-" + id);
  if(!p.value.trim()){ p.focus(); return; }
  /* Only fix how a known name was typed. Never change which product it is. */
  var fixed = canonical(p.value);
  if(fixed) p.value = fixed;
  for(var i=0;i<S.invoices.length;i++){ if(S.invoices[i].id===id){
    S.invoices[i].lines.push({id:uid(), product:p.value.trim(), qty:q.value.trim(), price:parseFloat(u.value)});
    break; } }
  p.value=""; q.value=""; u.value=""; save();
};
A.rmLine = function(id, lid){
  for(var i=0;i<S.invoices.length;i++){ if(S.invoices[i].id===id){
    S.invoices[i].lines = S.invoices[i].lines.filter(function(l){ return l.id!==lid; }); break; } }
  save();
};
A.applyInv = function(id){
  var v = null;
  for(var i=0;i<S.invoices.length;i++){ if(S.invoices[i].id===id){ v = S.invoices[i]; break; } }
  if(!v || !v.lines.length){ toast("No lines to apply"); return; }
  var st = stamp(), n = 0;
  v.lines.forEach(function(l){
    if(l.price == null || !isFinite(l.price)) return;
    var k = pkey(v.supplier, l.product);
    S.prices[k] = S.prices[k] || [];
    S.prices[k].push({at: st.at, price: l.price, inv: v.number || "", by: st.by, date: v.date});
    n++;
  });
  v.status = "done"; v.appliedBy = st.by; v.appliedAt = st.at;
  save(n + " price" + (n===1?"":"s") + " recorded");
};
A.setJump = function(v){
  var n = parseFloat(v);
  if(isFinite(n) && n > 0 && n < 200) S.priceJump = n;
};
A.rmInv = function(id){ S.invoices = S.invoices.filter(function(v){ return v.id!==id; }); save(); };

function invMoves(v){
  return v.lines.map(function(l){
    var prev = lastPrice(v.supplier, l.product);
    var d = prev ? delta(prev.price, l.price) : null;
    return {l:l, prev:prev, d:d};
  });
}


/* ---- uploading the invoice itself ----
 * Only the hosted app can hold a file. On the board there is nowhere to
 * put one, so the control simply is not drawn there. One source, two
 * honest behaviours. */
function isHosted(){ try { return !!window.__BOOT__; } catch(e){ return false; } }

A.pickFile = function(id){
  var f = document.getElementById("iv-f-" + (id || "new"));
  if(f) f.click();
};

A.upload = function(id, input){
  var file = input && input.files && input.files[0];
  if(!file) return;
  if(file.size > 8 * 1024 * 1024){ toast("That file is over 8 MB"); input.value = ""; return; }
  toast("Uploading " + file.name);
  var reader = new FileReader();
  reader.onload = function(){
    var b64 = String(reader.result).split(",")[1] || "";
    api("POST", "/api/invoices/file", {
      invoiceId: id || null, filename: file.name, mime: file.type || "application/octet-stream", data: b64
    }).then(function(r){
      input.value = "";
      if(!r.ok){ toast((r.json && r.json.error) || "Upload failed"); return; }
      toast("Uploaded — ask Claude to read it");
      boot();
    })["catch"](function(){ input.value = ""; toast("Upload failed"); });
  };
  reader.onerror = function(){ toast("Could not read that file"); };
  reader.readAsDataURL(file);
};

function uploadRow(id){
  if(!isHosted()) return "";
  return '<div class="add">'
    + '<input type="file" id="iv-f-' + (id || "new") + '" accept="image/*,application/pdf" '
    + 'capture="environment" style="display:none" data-upload="' + (id || "") + '">'
    + '<button class="btn" data-act="pickFile" data-id="' + (id || "") + '">📷 Photograph or attach the invoice</button>'
    + '</div>';
}

function fileChip(v){
  if(!v.file) return "";
  return '<a class="chip ac" href="/api/invoices/file/' + esc(v.file.id) + '" target="_blank" rel="noopener">'
    + esc(v.file.filename || "invoice") + '</a>';
}


/* ---- what the board can work out on its own ---- */

/* Every supplier's latest price for one product, cheapest first. */
function acrossSuppliers(product){
  var want = pnorm(product), out = [];
  Object.keys(S.prices).forEach(function(k){
    var parts = k.split("::");
    if(parts[1] !== want) return;
    var hist = S.prices[k];
    if(!hist || !hist.length) return;
    out.push({supplier: parts[0], price: hist[hist.length-1].price, seen: hist[hist.length-1].at});
  });
  return out.sort(function(a,b){ return a.price - b.price; });
}

/* Is someone else cheaper for this, by enough to be worth saying? */
function cheaperElsewhere(supplier, product, price){
  var all = acrossSuppliers(product);
  if(all.length < 2) return null;
  var best = all[0];
  if(pnorm(best.supplier) === pnorm(supplier)) return null;
  if(!isFinite(price) || price <= 0) return null;
  var save = ((price - best.price) / price) * 100;
  if(save < 5) return null;
  return {supplier: best.supplier, price: best.price, save: save};
}

/* Products the kitchen is not buying from whoever sells them cheapest. */
function overpaying(){
  var seen = {}, out = [];
  Object.keys(S.prices).forEach(function(k){
    var product = k.split("::")[1];
    if(!product || seen[product]) return;
    seen[product] = 1;
    var all = acrossSuppliers(product);
    if(all.length < 2) return;
    var worst = all[all.length-1], best = all[0];
    var gap = ((worst.price - best.price) / worst.price) * 100;
    if(gap < 5) return;
    out.push({product: product, best: best, worst: worst, gap: gap});
  });
  return out.sort(function(a,b){ return b.gap - a.gap; });
}

/* The names this supplier has invoiced before — one tap instead of typing,
 * and it keeps the price history from splitting on a spelling. */
function boughtBefore(supplier){
  var sup = pnorm(supplier), out = [], pool = knownProducts();
  Object.keys(S.prices).forEach(function(k){
    var parts = k.split("::");
    if(parts[0] !== sup) return;
    var hist = S.prices[k];
    /* the key is normalised; show the name the way the kitchen writes it */
    out.push({name: pool[parts[1]] || parts[1], price: hist[hist.length-1].price});
  });
  return out.sort(function(a,b){ return a.name < b.name ? -1 : 1; }).slice(0, 24);
}

/* Only ever fix HOW a known product was typed - case, spacing, a stray
 * accent. Never guess at WHICH product was meant: "carot" is not close
 * enough to "Carrot" to rewrite silently, and it is close enough to
 * "Small carotte" to be rewritten into the wrong thing entirely. A wrong
 * product on an invoice is a wrong price on a wrong item.
 * Anything less than certain is offered as a suggestion, not applied. */
function knownProducts(){
  var pool = {};
  Object.keys(ORDER_CATS).forEach(function(c){
    ORDER_CATS[c].forEach(function(p){ pool[pnorm(p)] = p; });
  });
  Object.keys(S.prices).forEach(function(k){
    var n = k.split("::")[1];
    if(n && !pool[n]) pool[n] = n;
  });
  return pool;
}

/* Same product, typed differently. Safe to apply. */
function canonical(text){
  var pool = knownProducts(), q = pnorm(text);
  if(!q) return null;
  if(pool[q] && pool[q] !== text) return pool[q];
  var loose = q.replace(/[^a-z0-9]/g, "");
  var hit = Object.keys(pool).filter(function(k){
    return k.replace(/[^a-z0-9]/g, "") === loose;
  })[0];
  return (hit && pool[hit] !== text) ? pool[hit] : null;
}

/* Did you mean? Offered, never applied. */
function nearestProducts(text){
  var pool = knownProducts(), q = pnorm(text);
  if(q.length < 3) return [];
  var keys = Object.keys(pool);
  var starts = keys.filter(function(k){ return k.indexOf(q) === 0; });
  var holds  = keys.filter(function(k){ return starts.indexOf(k) < 0 && k.indexOf(q) >= 0; });
  return starts.concat(holds).slice(0, 4).map(function(k){ return pool[k]; });
}

function viewInvoices(){
  if(!isMgmt(me)){
    return '<div class="gate"><div class="lock">⛔</div><h2>Management only</h2>'
      + '<p>Invoices move what everything costs. Eyal, Valentin and Hajir.</p></div>';
  }

  var h = '<div class="sec"><div class="sec-h"><h2>Invoices</h2>'
    + '<span class="sub">' + S.invoices.length + ' logged</span></div>'
    + '<div class="ban"><div class="bi">🧾</div><div>'
    + '<div class="bt">How an invoice gets in here</div>'
    + '<div class="bd"><b>1.</b> Photograph it, or save the PDF.<br>'
    + '<b>2.</b> Send it to Claude in the chat and say <em>&ldquo;read this invoice&rdquo;</em>.<br>'
    + '<b>3.</b> The lines appear below with what each product cost last time.<br>'
    + '<b>4.</b> Check what moved, then Apply.'
    + '</div>'
    + '<div class="bd" style="margin-top:8px;color:var(--ink3)">'
    + (isHosted() ? '' : 'There is no upload button on this board \u2014 a published page cannot hold a file. The hosted app has one. ')
    + 'Claude reads the invoice instead of Melba\'s scanner, which costs you nothing; '
    + 'Melba charges a credit a page. You can also start one by hand below.'
    + '</div></div></div>';

  h += '<div class="card"><div class="add" style="border-top:0">'
    + '<select id="iv-s">' + SUPPLIERS.map(function(x){ return '<option>' + esc(x) + '</option>'; }).join("") + '</select>'
    + '<input id="iv-n" placeholder="Invoice no." style="flex:1 1 130px" data-enter="addInvoice">'
    + '<input id="iv-d" placeholder="Date" value="' + esc(DAY) + '" style="flex:0 0 130px" data-enter="addInvoice">'
    + '<button class="btn pri" data-act="addInvoice">Start</button></div>'
    + uploadRow(null)
    + '<div class="kv"><span>Flag a jump over</span>'
    + '<span><input class="pcount" aria-label="Price jump alert threshold, percent" value="' + esc(String(S.priceJump)) + '" data-jump="1"> <b>%</b></span></div></div></div>';

  if(!S.invoices.length){
    return h + '<div class="card"><div class="empty">No invoices yet.</div></div>';
  }

  h += '<div class="card">' + S.invoices.map(function(v){
    var open = openInv === v.id;
    var moves = invMoves(v);
    var flags = moves.filter(function(m){ return jumped(m.d); }).length;
    var total = v.lines.reduce(function(a,l){
      var q = parseFloat(l.qty); return a + ((isFinite(q)?q:1) * (isFinite(l.price)?l.price:0)); }, 0);

    var head = '<button class="rhead' + (open?' on':'') + '" data-act="openInv" data-id="' + v.id + '">'
      + '<span class="rname">' + esc(v.supplier)
      + (v.number ? ' <span class="chip">' + esc(v.number) + '</span>' : '')
      + fileChip(v)
      + (v.status === "done" ? ' <span class="chip ok">applied</span>' : ' <span class="chip wa">draft</span>')
      + (flags ? ' <span class="chip cr">' + flags + ' jump' + (flags===1?'':'s') + '</span>' : '')
      + '</span>'
      + '<span class="rcount">' + money(total) + '</span>'
      + '<span class="rchev">' + (open ? "−" : "+") + '</span></button>';

    if(!open) return '<div class="rrow">' + head + '</div>';

    var body = '<div class="rbody" style="background:var(--surface2)">'
      + '<div class="sheet-h"><span class="sh-p" style="padding-left:0">product</span>'
      + '<span class="sh-r">was</span><span class="sh-r">now</span><span class="sh-r">move</span></div>'
      + (moves.length ? moves.map(function(m){
          var cls = jumped(m.d) ? (m.d > 0 ? 'cr' : 'ok') : '';
          return '<div class="prow">'
            + '<span class="pname">' + esc(m.l.product)
            + (m.l.qty ? ' <span class="chip">' + esc(m.l.qty) + '</span>' : '') + '</span>'
            + '<span class="sh-r mono" style="color:var(--ink3)">' + (m.prev ? money(m.prev.price) : 'first') + '</span>'
            + '<span class="sh-r mono" style="color:var(--ink);font-weight:600">' + money(m.l.price) + '</span>'
            + '<span class="sh-r">'
            + (m.d == null ? '<span class="chip">new</span>'
                           : '<span class="chip ' + cls + '">' + pct(m.d) + '</span>')
            + (function(){
                var ch = cheaperElsewhere(v.supplier, m.l.product, m.l.price);
                return ch ? ' <span class="chip wa" style="text-transform:none">'
                  + esc(ch.supplier) + ' ' + money(ch.price) + '</span>' : '';
              })() + '</span>'
            + '<button class="x" data-act="rmLine" data-id="' + v.id + '" data-lid="' + m.l.id + '" aria-label="Remove">&times;</button>'
            + '</div>';
        }).join("") : '<div class="empty">No lines yet.</div>')
      + '<div class="add">'
      + '<input id="il-p-' + v.id + '" class="w" list="cat" placeholder="Product">'
      + catalogueHTML()
      + '<input id="il-q-' + v.id + '" placeholder="Qty" style="flex:0 0 86px">'
      + '<input id="il-u-' + v.id + '" placeholder="Unit €" inputmode="decimal" style="flex:0 0 104px">'
      + '<button class="btn pri" data-act="addLine" data-id="' + v.id + '">Add line</button></div>'
      + (function(){
          var typed = (typeof document !== "undefined" && document.getElementById("il-p-" + v.id));
          var near = typed ? nearestProducts(typed.value || "") : [];
          if(!near.length) return '';
          return '<div class="add" style="gap:6px;padding-top:0"><span class="chip">did you mean</span>'
            + near.map(function(n){
                return '<button class="btn sm" data-act="useName" data-id="' + v.id + '" data-p="' + esc(n) + '">' + esc(n) + '</button>';
              }).join("") + '</div>';
        })()
      + (function(){
          var prev = boughtBefore(v.supplier);
          if(!prev.length) return '';
          var have = {}; v.lines.forEach(function(l){ have[pnorm(l.product)] = 1; });
          var left = prev.filter(function(p){ return !have[pnorm(p.name)]; });
          if(!left.length) return '';
          return '<div class="add" style="gap:6px"><span class="chip">bought before</span>'
            + left.map(function(p){
                return '<button class="btn sm" data-act="quickLine" data-id="' + v.id + '"'
                  + ' data-p="' + esc(p.name) + '" data-u="' + p.price + '">'
                  + esc(p.name) + ' <span style="opacity:.6">' + money(p.price) + '</span></button>';
              }).join("") + '</div>';
        })()
      + uploadRow(v.id)
      + '<div class="shrow" style="margin-top:14px">'
      + (v.status !== "done"
          ? '<button class="btn pri" data-act="applyInv" data-id="' + v.id + '">Apply these prices</button>'
          : '<span class="chip ok">applied ' + esc(nameOf(v.appliedBy)) + ' · ' + hhmm(v.appliedAt) + '</span>')
      + shareBtn("invoice", v.id, "Send what moved")
      + '<button class="btn" data-act="rmInv" data-id="' + v.id + '">Delete</button>'
      + '</div></div>';

    return '<div class="rrow">' + head + body + '</div>';
  }).join("") + '</div>';

  var over = overpaying();
  if(over.length){
    h += '<div class="sec" style="margin-top:24px"><div class="sec-h"><h2>Cheaper elsewhere</h2>'
      + '<span class="sub">same product, two suppliers</span></div><div class="card">'
      + over.map(function(o){
          return '<div class="kv"><span>' + esc(o.product) + '</span><b>'
            + '<span class="chip ok" style="text-transform:none">' + esc(o.best.supplier) + ' ' + money(o.best.price) + '</span> '
            + '<span class="chip cr" style="text-transform:none">' + esc(o.worst.supplier) + ' ' + money(o.worst.price) + '</span> '
            + '<span class="chip">' + o.gap.toFixed(0) + '% apart</span></b></div>';
        }).join("")
      + '<div class="note">Latest price from each supplier who has invoiced this product. '
      + 'Worth a look before the next order — though a pack size or a quality difference '
      + 'can explain a gap the board cannot see.</div></div></div>';
  }

  var keys = Object.keys(S.prices).filter(function(k){ return S.prices[k].length > 1; });
  if(keys.length){
    h += '<div class="sec" style="margin-top:24px"><div class="sec-h"><h2>Price history</h2>'
      + '<span class="sub">' + keys.length + ' moved more than once</span></div><div class="card">'
      + keys.sort().map(function(k){
          var hist = S.prices[k], first = hist[0].price, last = hist[hist.length-1].price;
          var d = delta(first, last);
          var name = k.split("::")[1] || k, sup = k.split("::")[0];
          return '<div class="kv"><span>' + esc(name) + ' <span class="chip ac">' + esc(sup) + '</span></span>'
            + '<b>' + money(first) + ' → ' + money(last)
            + (d != null ? ' <span class="chip ' + (jumped(d) ? (d>0?'cr':'ok') : '') + '">' + pct(d) + '</span>' : '')
            + '</b></div>';
        }).join("") + '</div></div>';
  }

  return h;
}


A.tab = function(t){ tab = t; moreOpen = false; try{ sessionStorage.setItem("sp.tab",t); }catch(e){} render(); };
A.more = function(){ moreOpen = !moreOpen; render(); };
A.search = function(){
  var q = document.getElementById("rq").value.trim();
  window.open(MELBA.recipes + (q ? "?search=" + encodeURIComponent(q) : ""), "_blank", "noopener");
};

/* ============ render ============ */


/* ---- tab icons (24px, stroked) ---- */
var ICO = {
  service:  '<path d="M4 7h16M4 12h16M4 17h10"/>',
  prep:     '<path d="M6 3v8a3 3 0 0 0 6 0V3M9 11v10"/><path d="M17 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6zM17 12v9"/>',
  orders:   '<path d="M3 5h2l2.4 10.4A2 2 0 0 0 9.3 17h7.5a2 2 0 0 0 2-1.6L20 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  recipes:  '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/>',
  clean:    '<path d="M8 3h8l1 6H7z"/><path d="M9 9v5a3 3 0 0 0 6 0V9"/><path d="M12 17v4"/>',
  pertes:   '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  transferts:'<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  haccp:    '<path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  invoices: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  direction:'<path d="M12 3l2.6 5.6 6 .8-4.4 4.3 1.1 6-5.3-2.9L6.7 19.7l1.1-6L3.4 9.4l6-.8z"/>',
  more:     '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
function ico(k){
  return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[k]||'') + '</svg>';
}
/* The bottom bar holds four. Which four depends on the job: a director
 * lives in orders and invoices, a commis lives in the prep sheet and the
 * book. Everything else is one tap away under More. */
function primaryFor(p){
  if(isMgmt(p))   return ["service","prep","orders","invoices"];
  if(canOrder(p)) return ["service","prep","orders","recipes"];
  return ["service","prep","recipes","clean"];
}
var moreOpen = false;

function icoCheck(){ return '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></svg>'; }

function rowHTML(kind, it, extra){
  var who = it.done && it.by ? nameOf(it.by) + " · " + hhmm(it.at) : "";
  return '<div class="row'+(it.done?" done":"")+'">'
    + '<button class="tick" data-act="toggle" data-kind="'+kind+'" data-id="'+it.id+'" aria-pressed="'+(!!it.done)+'" aria-label="Tick">'+icoCheck()+'</button>'
    + '<div class="rmain">'
    + '<div class="rt">'+esc(it.title)+(it.qty?' <span class="chip">'+esc(it.qty)+'</span>':'')+'</div>'
    + '<div class="rmeta">'
    + (it.station?'<span class="chip">'+esc(it.station)+'</span>':'')
    + (it.freq?'<span class="chip '+(it.freq==="Weekly"?"wa":"")+'">'+esc(it.freq)+'</span>':'')
    + (it.supplier?'<span class="chip ac">'+esc(it.supplier)+'</span>':'')
    + (it.urgent?'<span class="chip cr">urgent</span>':'')
    + (kind==="orders" ? (it.approved?'<span class="chip ok">approved '+esc(nameOf(it.approvedBy))+'</span>':'<span class="chip wa">awaiting sign-off</span>') : '')
    + (extra||'')
    + (who?'<span class="chip ok">'+esc(who)+'</span>':'')
    + '</div></div>'
    + '<button class="x" data-act="remove" data-kind="'+kind+'" data-id="'+it.id+'" aria-label="Remove">&times;</button>'
    + '</div>';
}

function listCard(kind, items, emptyTxt, extraFn){
  if(!items.length) return '<div class="card"><div class="empty">'+esc(emptyTxt)+'</div></div>';
  return '<div class="card">' + items.map(function(it){
    return rowHTML(kind, it, extraFn?extraFn(it):"");
  }).join("") + '</div>';
}

function progress(items){
  var d = items.filter(function(x){return x.done}).length;
  return {done:d,total:items.length,pct:items.length?Math.round(d/items.length*100):0};
}

function statHTML(label, val, items){
  var p = items ? progress(items) : null;
  return '<div class="st"><div class="sv">'+val+'</div><div class="sl">'+esc(label)+'</div>'
    + (p?'<div class="bar"><i style="width:'+p.pct+'%"></i></div>':'') + '</div>';
}

function viewService(){
  var team = onToday();
  var on = team.filter(function(x){ return x.p.always || (x.s && x.s[0]!=="Leave"); });
  var cooksOn = team.filter(function(x){ return !x.p.always && x.s && x.s[0]!=="Leave"; });
  var h = "";

  if(!HAS_ROTA){
    h += '<div class="ban q"><div class="bi">📅</div><div><div class="bt">Rota out of date</div>'
      + '<div class="bd">This board carries the week of 24–30 August 2026. Open Combo for the current week, then ask me to refresh it.</div>'
      + '<div style="margin-top:8px">' + extLink(COMBO+WEEK, "Open Combo", "sm") + '</div></div></div>';
  } else if(!cooksOn.length){
    var pw = DAY.split("-"), wd = new Date(+pw[0], +pw[1]-1, +pw[2]).getDay();
    h += '<div class="ban"><div class="bi">🌙</div><div>'
      + '<div class="bt">' + (wd === 0 ? 'Closed Sunday' : 'Nobody on the rota today') + '</div>'
      + '<div class="bd">'
      + (wd === 0
          ? 'The one day the kitchen shuts.'
          : 'Combo has the whole brigade resting today \u2014 an exception, not the usual week. The kitchen normally runs Monday to Saturday and closes Sundays only.')
      + '</div></div></div>';
  }

  if(S.serviceDate !== DAY){
    h += '<div class="ban"><div class="bi">🔔</div><div><div class="bt">Open today\'s service</div>'
      + '<div class="bd">Cleaning and the HACCP round reset to zero. Unfinished prep is kept.</div>'
      + '<div style="margin-top:8px"><button class="btn pri sm" data-act="newDay">Open service</button></div></div></div>';
  }

  h += '<div class="stat">'
    + statHTML("On today", on.length, null)
    + statHTML("Prep", progress(S.prep).done+"/"+progress(S.prep).total, S.prep)
    + statHTML("Cleaning", progress(S.clean).done+"/"+progress(S.clean).total, S.clean)
    + statHTML("HACCP", progress(S.haccp).done+"/"+progress(S.haccp).total, S.haccp)
    + '</div>';

  h += '<div class="sec"><div class="sec-h"><h2>The brigade</h2><span class="sub">'+esc(prettyDate(DAY))+'</span>'
    + '<span class="act">' + extLink(COMBO+WEEK, "Combo", "sm") + '</span></div>'
    + '<div class="brig">' + team.map(function(x){
        var s = x.s, off = !x.p.always && (!s || s[0]==="Leave");
        var col = x.p.always ? SHIFT_COLOR["Direction"] : (s ? (SHIFT_COLOR[s[0]]||"#545A5F") : "#545A5F");
        return '<div class="person'+(off?" off":"")+'">'
          + '<span class="stripe" style="background:'+col+'"></span>'
          + '<span class="av" style="background:'+col+'">'+esc(x.p.ini)+'</span>'
          + '<span class="pi"><span class="pn">'+esc(x.p.name)
          + (x.p.role?' <span class="chip ac" style="text-transform:none">'+esc(x.p.role)+'</span>':'')+'</span>'
          + '<span class="ps">'+(x.p.always?'Direction · every day':(s?esc(s[0])+' · '+esc(s[1]):'off'))+'</span></span></div>';
      }).join("") + '</div></div>';

  return h;
}

function lkHTML(i,t,d,u){
  return '<a class="lk" href="'+u+'" target="_blank" rel="noopener"><span class="li">'+i+'</span>'
    + '<span><span class="lt">'+esc(t)+'</span><span class="ld">'+esc(d)+'</span></span></a>';
}

function viewPrep(){
  var live = S.prep.filter(function(x){ return !x.arch; });
  var old  = S.prep.filter(function(x){ return x.arch; });
  var d = live.filter(function(x){ return x.done; }).length;
  var advN = live.filter(function(x){ return x.adv; }).length;

  var h = '<div class="sec"><div class="sec-h"><h2>On the menu</h2>'
    + '<span class="sub">' + d + ' / ' + live.length + ' done &middot; ' + advN + ' ADV</span>'
    + '<span class="act">' + shareBtn("prep") + '<button class="btn sm" data-act="loadPrep">Load the list</button></span></div>';

  if(!live.length){
    h += '<div class="card"><div class="empty">Nothing on the menu.<br><br>'
      + '<button class="btn pri" data-act="loadPrep">Load the list (' + PREP_LIST_get().length + ' lines)</button></div></div>';
  } else {
    h += '<div class="card">' + sheetHead()
      + '<div class="sheetgrid">' + live.map(prepRow).join("") + '</div>' + prepForm() + '</div>';
  }
  h += '</div>';

  h += '<div class="sec"><div class="sec-h">'
    + '<button class="btn sm" data-act="showOld">' + (showOld ? '\u2212' : '+') + ' Old preps</button>'
    + '<span class="sub">' + old.length + ' put aside</span></div>';
  if(showOld){
    h += old.length
      ? '<div class="card">' + sheetHead() + '<div class="sheetgrid">' + old.map(prepRow).join("") + '</div></div>'
      : '<div class="card"><div class="empty">Nothing archived.</div></div>';
  }
  h += '</div>';

  h += '<div class="sec"><div class="sec-h"><h2>Protein</h2><span class="sub">portions</span></div><div class="card">'
    + (S.proteins.length ? S.proteins.map(function(x){
        return '<div class="kv"><span>' + esc(x.name) + '</span>'
          + '<input class="pcount" value="' + esc(x.count || "") + '" placeholder="0P" data-prot="' + x.id + '">'
          + '<button class="x" data-act="removeProt" data-id="' + x.id + '" aria-label="Remove">&times;</button></div>';
      }).join("") : '<div class="empty">No counts yet. Langoustine, Cod, Sweetbread, Lamb, Chicken\u2026</div>')
    + '<div class="add"><input id="pr-n" class="w" placeholder="Protein \u2014 e.g. Langoustine" data-enter="addProt">'
    + '<input id="pr-c" placeholder="67P" style="flex:0 0 76px" data-enter="addProt">'
    + '<button class="btn pri" data-act="addProt">Add</button></div></div></div>';

  h += '<div class="sec"><div class="sec-h"><h2>Note</h2></div><div class="card">'
    + (S.notes.length ? S.notes.map(function(n){
        return '<div class="row"><span class="rmain"><span class="rt">' + esc(n.text) + '</span>'
          + '<span class="rmeta">' + (n.by ? '<span class="chip">' + esc(nameOf(n.by)) + ' &middot; ' + hhmm(n.at) + '</span>' : '') + '</span></span>'
          + '<button class="x" data-act="remove" data-kind="notes" data-id="' + n.id + '" aria-label="Remove">&times;</button></div>';
      }).join("") : '<div class="empty">Nothing noted for this service.</div>')
    + '<div class="add"><input id="nt-t" class="w" placeholder="e.g. New croutons for quails with flavors" data-enter="addNote">'
    + '<button class="btn pri" data-act="addNote">Note it</button></div></div></div>';

  return h;
}

function sheetHead(){
  var one = '<div class="sheet-h"><span class="sh-p">product</span>'
    + '<span class="sh-r">restriction</span><span class="sh-a">ADV</span></div>';
  return '<div class="sheet-hd">' + one + one + '</div>';   /* second shows only two-up */
}

function prepRow(it){
  return '<div class="prow' + (it.done ? ' done' : '') + '">'
    + '<button class="tick" data-act="toggle" data-kind="prep" data-id="' + it.id + '" aria-pressed="' + (!!it.done) + '" aria-label="Done">' + icoCheck() + '</button>'
    + '<span class="pname">' + esc(it.title) + '</span>'
    + '<input class="prestr" value="' + esc(it.restr || "") + '" placeholder="&mdash;" data-restr="' + it.id + '">'
    + '<button class="advbox' + (it.adv ? ' on' : '') + '" data-act="adv" data-id="' + it.id + '" aria-pressed="' + (!!it.adv) + '" aria-label="ADV">' + (it.adv ? icoCheck() : '') + '</button>'
    + '<button class="x mv" data-act="arch" data-id="' + it.id + '" title="' + (it.arch ? 'Put back on the menu' : 'Put aside') + '" aria-label="Move">' + (it.arch ? '\u2191' : '\u2193') + '</button>'
    + '<button class="x" data-act="remove" data-kind="prep" data-id="' + it.id + '" aria-label="Remove">&times;</button>'
    + '</div>';
}

function prepForm(){
  return '<div class="add">'
    + '<input id="prep-t" class="w" placeholder="Add a line" data-enter="addPrep">'
    + '<button class="btn pri" data-act="addPrep">Add</button></div>';
}

function viewWaste(){
  var h = '<div class="sec"><div class="sec-h"><h2>Waste</h2>'
    + '<span class="sub">' + S.waste.length + ' line' + (S.waste.length === 1 ? '' : 's') + '</span>'
    + '<span class="act">' + shareBtn("waste") + '</span></div><div class="card">'
    + '<div class="sheet-h"><span class="sh-p">product</span><span class="sh-r">amount</span><span class="sh-a2">why</span></div>';
  h += (S.waste.length ? S.waste.map(function(x){
      return '<div class="prow">'
        + '<span class="pname" style="padding-left:12px">' + esc(x.title) + '</span>'
        + '<span class="pqty">' + esc(x.qty || "—") + '</span>'
        + '<span class="pwhy">' + esc(x.why || "—") + '</span>'
        + '<span class="chip">' + esc(nameOf(x.by)) + '</span>'
        + '<button class="x" data-act="remove" data-kind="waste" data-id="' + x.id + '" aria-label="Remove">&times;</button></div>';
    }).join("") : '<div class="empty">Nothing thrown. Good day.</div>');
  h += '<div class="add"><input id="w-p" class="w" list="cat" placeholder="Product" data-enter="addWaste">'
    + catalogueHTML()
    + '<input id="w-a" placeholder="Amount" style="flex:0 0 80px" data-enter="addWaste">'
    + '<input id="w-w" class="w" placeholder="Why — use-by, breakage, mistake…" data-enter="addWaste">'
    + '<button class="btn pri" data-act="addWaste">Add</button></div></div></div>';
  return h;
}

function viewTransfers(){
  var h = '<div class="sec"><div class="sec-h"><h2>Transfers</h2>'
    + '<span class="sub">' + S.transfers.length + ' line' + (S.transfers.length === 1 ? '' : 's') + '</span>'
    + '<span class="act">' + shareBtn("transfers") + '</span></div><div class="card">'
    + '<div class="sheet-h"><span class="sh-p">product</span><span class="sh-r">amount</span><span class="sh-a2">date</span></div>';
  h += (S.transfers.length ? S.transfers.map(function(x){
      return '<div class="prow">'
        + '<span class="pname" style="padding-left:12px">' + esc(x.title) + '</span>'
        + '<span class="pqty">' + esc(x.qty || "—") + '</span>'
        + '<span class="pwhy">' + esc(x.when || "—") + '</span>'
        + '<span class="chip">' + esc(nameOf(x.by)) + '</span>'
        + '<button class="x" data-act="remove" data-kind="transfers" data-id="' + x.id + '" aria-label="Remove">&times;</button></div>';
    }).join("") : '<div class="empty">No transfers logged.</div>');
  h += '<div class="add"><input id="t-p" class="w" list="cat" placeholder="Product" data-enter="addTransfer">'
    + '<input id="t-a" placeholder="Amount" style="flex:0 0 80px" data-enter="addTransfer">'
    + '<input id="t-d" placeholder="Date" style="flex:0 0 110px" data-enter="addTransfer">'
    + '<button class="btn pri" data-act="addTransfer">Add</button></div></div></div>';
  return h;
}

function catalogueHTML(){
  var seen = {}, opts = [];
  Object.keys(ORDER_CATS).forEach(function(c){
    ORDER_CATS[c].forEach(function(p){
      var k = p.toLowerCase();
      if(seen[k]) return; seen[k] = 1;
      opts.push('<option value="' + esc(p) + '">' + esc(c) + '</option>');
    });
  });
  return '<datalist id="cat">' + opts.join("") + '</datalist>';
}

function viewOrders(){
  if(!canOrder(me)){
    return '<div class="gate"><div class="lock">\u26d4</div><h2>Not your list</h2>'
      + '<p>Ordering is for management and whoever they hand it to. Ask Eyal, Valentin or Hajir.</p></div>';
  }
  var open = S.orders.filter(function(o){return !o.done});
  var bySup = {};
  open.forEach(function(o){ (bySup[o.supplier]=bySup[o.supplier]||[]).push(o); });
  Object.keys(bySup).forEach(function(k){ bySup[k] = byCatalogue(bySup[k]); });
  var sups = Object.keys(bySup).sort();
  var done = S.orders.filter(function(o){return o.done});

  var h = '<div class="sec"><div class="sec-h"><h2>Orders</h2><span class="sub">'
    + open.length + ' to place · grouped by supplier</span>'
    + '<span class="act">' + shareBtn("order","*","Send all") + '</span></div>';

  h += '<div class="card">'
    + '<div class="add" style="border-top:0">'
    + '<input id="ord-t" class="w" list="cat" placeholder="Product — type to search your list" data-enter="addOrder">'
    + catalogueHTML()
    + '<input id="ord-q" placeholder="Qty" style="flex:0 0 74px" data-enter="addOrder">'
    + '<select id="ord-s">'+SUPPLIERS.map(function(s){return '<option>'+esc(s)+'</option>'}).join("")+'</select>'
    + '<label class="chip" style="cursor:pointer"><input type="checkbox" id="ord-u" aria-label="Mark this order urgent" style="margin:0 6px 0 0"> urgent</label>'
    + '<button class="btn pri" data-act="addOrder">Add</button></div></div>';

  if(!open.length){
    h += '<div class="card" style="margin-top:10px"><div class="empty">Nothing to order right now.</div></div>';
  } else {
    h += sups.map(function(s){
      var urg = bySup[s].some(function(o){return o.urgent});
      return '<div class="sec-h" style="margin-top:14px"><h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:'+(urg?'var(--crit)':'var(--ink2)')+'">'+esc(s)+'</h2>'
        + '<span class="sub">'+bySup[s].length+' line'+(bySup[s].length>1?'s':'')+'</span>'
        + '<span class="act">' + shareBtn("order", s) + '</span></div>'
        + listCard("orders", bySup[s], "");
    }).join("");
  }
  if(done.length){
    h += '<div class="sec-h" style="margin-top:18px"><h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3)">Ordered</h2></div>'
      + listCard("orders", done, "");
  }
  return h + '</div>';
}

function viewRecipes(){
  var q = rq.trim().toLowerCase();
  var list = RECIPES.filter(function(r){
    if(!q) return true;
    if(r.n.toLowerCase().indexOf(q) >= 0) return true;
    return r.i.some(function(x){ return x.toLowerCase().indexOf(q) >= 0; });
  });

  var scope = list.filter(function(r){
    return recView === "archive" ? !!S.recArch[r.n] : !S.recArch[r.n];
  });
  var nArch = RECIPES.filter(function(r){ return !!S.recArch[r.n]; }).length;

  var h = '<div class="sec"><div class="sec-h"><h2>' + (recView === "archive" ? 'Old menus' : 'The book') + '</h2>'
    + '<span class="sub">' + scope.length + ' recipes</span></div>'
    + '<div class="card"><div class="add" style="border-top:0">'
    + '<input id="rq" class="w" placeholder="Search a recipe or an ingredient\u2026" value="' + esc(rq) + '" data-live="rq">'
    + (rq ? '<button class="btn" data-act="clearq">Clear</button>' : '')
    + '</div><div class="add" style="border-top:1px solid var(--line)">'
    + '<button class="btn sm' + (recView === "menu" ? ' pri' : '') + '" data-act="recView" data-v="menu">In the menu &middot; ' + (RECIPES.length - nArch) + '</button>'
    + '<button class="btn sm' + (recView === "archive" ? ' pri' : '') + '" data-act="recView" data-v="archive">Old menus &middot; ' + nArch + '</button>'
    + '</div></div>';
  list = scope;

  if(!list.length){
    return h + '<div class="card" style="margin-top:10px"><div class="empty">Nothing for &ldquo;' + esc(rq) + '&rdquo;.</div></div></div>';
  }

  h += '<div class="card" style="margin-top:10px"><div class="bookgrid">' + list.map(function(r){
    var id = "r" + RECIPES.indexOf(r);
    var open = openRec === id;
    var body = "";
    if(open){
      body = '<div class="rbody">'
        + (r.i.length ? '<div class="rsub">Ingredients</div><ul class="ring">'
            + r.i.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>' : '')
        + (r.m.length ? '<div class="rsub">Method</div><p class="rmeth">'
            + r.m.map(esc).join(" ") + '</p>' : '')
        + '</div>';
    }
    return '<div class="rrow">'
      + '<button class="rhead' + (open ? ' on' : '') + '" data-act="rec" data-id="' + id + '" aria-expanded="' + open + '">'
      + '<span class="rname">' + esc(r.n)
      + (onMenu(r.n) ? ' <span class="chip ok" style="text-transform:none">on the sheet</span>' : '') + '</span>'
      + '<span class="rcount">' + r.i.length + '</span>'
      + '<span class="rchev">' + (open ? "−" : "+") + '</span></button>'
      + '<button class="x mv rmv" data-act="recArch" data-name="' + esc(r.n) + '" title="' + (S.recArch[r.n] ? 'Put back in the book' : 'Move to old menus') + '">' + (S.recArch[r.n] ? '↑' : '↓') + '</button>'
      + body + '</div>';
  }).join("") + '</div></div>';

  return h + '</div>';
}

function viewClean(){
  if(!S.clean.length){
    return '<div class="sec"><div class="sec-h"><h2>Cleaning</h2></div>'
      + '<div class="card"><div class="empty">The cleaning round is not open.<br><br>'
      + '<button class="btn pri" data-act="newDay">Open service</button></div></div></div>';
  }
  var p = progress(S.clean);
  var zones = {};
  S.clean.forEach(function(c){ (zones[c.station]=zones[c.station]||[]).push(c); });
  var h = '<div class="sec"><div class="sec-h"><h2>Cleaning</h2><span class="sub">'+p.done+' / '+p.total+' · '+p.pct+'%</span>'
    + '<span class="act">' + shareBtn("clean") + '</span></div>';
  h += Object.keys(zones).map(function(z){
    return '<div class="sec-h" style="margin-top:14px"><h2 style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink2)">'+esc(z)+'</h2></div>'
      + listCard("clean", zones[z], "");
  }).join("");
  return h + '</div>';
}

function viewHaccp(){
  if(!S.haccp.length){
    return '<div class="sec"><div class="sec-h"><h2>HACCP</h2></div>'
      + '<div class="card"><div class="empty">The HACCP round is not open.<br><br>'
      + '<button class="btn pri" data-act="newDay">Open service</button></div></div></div>';
  }
  var p = progress(S.haccp);
  var h = '<div class="sec"><div class="sec-h"><h2>HACCP round</h2><span class="sub">'+p.done+' / '+p.total+'</span>'
    + '<span class="act">' + shareBtn("haccp") + '</span></div>'
    + '<div class="ban q"><div class="bi">🌡️</div><div><div class="bd">Service readings. What you type here is an reminder — the official register stays in Melba, Hygiene &amp; Traceability.</div></div></div>';
  h += listCard("haccp", S.haccp, "", function(it){
    if(it.kind !== "temp") return "";
    return '<input class="tempin" aria-label="Temperature reading" value="'+esc(it.value||"")+'" placeholder="°C" data-val="'+it.id+'">';
  });
  return h + '</div>';
}


function snapWhen(ts){
  if(!ts) return "—";
  var d = new Date(ts);
  return d.toLocaleDateString("en-GB",{day:"numeric",month:"short"}) + " " + hhmm(ts);
}

function fmtEuro(n){
  if(typeof n !== "number") return "—";
  return "€" + n.toFixed(2);
}

function viewDirection(){
  if(!isMgmt(me)){
    return '<div class="gate"><div class="lock">\u26d4</div><h2>Management only</h2>'
      + '<p>This side is for Eyal, Valentin and Hajir. Sign in with one of those accounts to see it.</p></div>';
  }

  var h = '<div class="sec-h" style="margin-bottom:14px"><h2 style="font-size:15px">Management</h2>'
    + '<span class="sub">Eyal · Valentin · Hajir</span>'
    + '<span class="act"><button class="btn sm" data-act="whoami">Sign out</button></span></div>';

  /* --- 1a. Melba reading (visible to everyone holding the code) --- */
  var sn = S.melbaSnap;
  if(sn){
    h += '<div class="sec"><div class="sec-h"><h2>Last Melba reading</h2>'
      + '<span class="sub">'+esc(snapWhen(sn.at))+' · by '+esc(sn.by||"—")+'</span></div><div class="card">'
      + '<div class="kv"><span>Establishment</span><b>'+esc(sn.org||"—")+'</b></div>'
      + '<div class="kv"><span>Products in Melba</span><b>'+(sn.products!=null?sn.products:"—")+'</b></div>'
      + '<div class="kv"><span>Ingredient stock automated</span><b style="color:'
      + (sn.autoIngredientStock?'var(--ok)':'var(--crit)')+'">'+(sn.autoIngredientStock?'yes':'no')+'</b></div>'
      + '<div class="kv"><span>Recipe stock automated</span><b style="color:'
      + (sn.autoRecipeStock?'var(--ok)':'var(--crit)')+'">'+(sn.autoRecipeStock?'yes':'no')+'</b></div>'
      + '<div class="kv"><span>Below reorder threshold</span><b>'+sn.reorderLines+' line'+(sn.reorderLines===1?'':'s')
      + ' · '+fmtEuro(sn.reorderAmount)+'</b></div>'
      + (sn.note?'<div class="note">'+esc(sn.note)+'</div>':'')
      + '<div class="note">These figures are read off Eyal\'s Melba account and written into the board. Valentin and Hajir read them here without touching the account.</div>'
      + '</div></div>';
  }

  /* --- 1b. melba en direct (seulement pour un viewer qui a son propre connecteur) --- */
  h += '<div class="sec"><div class="sec-h"><h2>Melba live</h2>'
    + '<span class="sub">'+(live.at?'upd '+hhmm(live.at):'your own connector')+'</span></div><div class="card">';
  if(!mcp){
    h += '<div class="note">'+(mcpTried
      ? 'Live Melba data is not available in this view. The rest of the board works normally.'
      : 'Connecting to Melba…')+'</div>';
  } else {
    if(live.meErr && !live.me){
      h += '<div class="note" style="color:var(--crit)">'+esc(mcpMsg(live.meErr))+'</div>';
    } else if(live.me){
      var org = live.me.organization || {};
      var usr = live.me.user || {};
      h += '<div class="kv"><span>Establishment</span><b>'+esc(org.name||"—")+'</b></div>'
        + '<div class="kv"><span>Compte</span><b>'+esc((usr.firstName||"")+" "+(usr.lastName||""))+'</b></div>'
        + '<div class="kv"><span>Ingredient stock automated</span><b style="color:'
        + (org.automateIngredientStocks?'var(--ok)':'var(--crit)')+'">'
        + (org.automateIngredientStocks?'yes':'no')+'</b></div>'
        + '<div class="kv"><span>Recipe stock automated</span><b style="color:'
        + (org.automateRecipeStocks?'var(--ok)':'var(--crit)')+'">'
        + (org.automateRecipeStocks?'yes':'no')+'</b></div>';
      if(!org.automateIngredientStocks){
        h += '<div class="note">While stock is not automated in Melba, the reorder below will never find anything to order — there are no quantities to compare against a threshold.</div>';
      }
    } else {
      h += '<div class="note">Reading Melba…</div>';
    }

    if(live.catErr && !live.cat){
      h += '<div class="kv"><span>Catalogue</span><b style="color:var(--crit)">unavailable</b></div>';
    } else if(live.cat){
      var tc = live.cat.totalCount;
      var page = live.cat.data || [];
      var recipes = page.filter(function(x){ return x.recipe; }).length;
      var stale = page.filter(function(x){ return x.isStale; }).length;
      h += '<div class="kv"><span>Products in Melba</span><b>'+(typeof tc==="number"?tc:"—")+'</b></div>'
        + '<div class="kv"><span>Sur les '+page.length+' last read</span><b>'+recipes+' recipes · '+stale+' to recompute</b></div>';
    }
  }
  h += '</div></div>';

  /* --- 2. reorder --- */
  h += '<div class="sec"><div class="sec-h"><h2>Reorder</h2><span class="sub">7-day threshold</span>'
    + '<span class="act"><button class="btn sm'+(mcp?'':' hid')+'" data-act="reorder"'+(live.reorderBusy?' disabled':'')+'>'
    + (live.reorderBusy?'Calculating…':'Calculate')+'</button></span></div><div class="card">';
  if(live.reorderErr){
    h += '<div class="note" style="color:var(--crit)">'+esc(mcpMsg(live.reorderErr))+'</div>';
  } else if(live.reorder){
    var d = live.reorder.details || {};
    h += '<div class="kv"><span>Melba summary</span><b>'+esc(live.reorder.summary||"—")+'</b></div>'
      + '<div class="kv"><span>Lines</span><b>'+(d.totalLines!=null?d.totalLines:"—")+'</b></div>'
      + '<div class="kv"><span>Estimated amount ex. VAT</span><b>'+fmtEuro(d.totalAmount)+'</b></div>'
      + '<div class="note">This is a preview. Nothing was ordered — creating the purchase orders in Melba is a separate step, and I will ask you supplier by supplier.</div>';
  } else {
    h += '<div class="note">'+(mcp?'Run the calculation to see what falls below threshold, grouped by supplier.':'Melba is not reachable from this view.')+'</div>';
  }
  h += '</div></div>';

  /* --- 3. orders to approve --- */
  var pend = S.orders.filter(function(o){ return !o.done && !o.approved; });
  h += '<div class="sec"><div class="sec-h"><h2>To approve</h2><span class="sub">'+pend.length+' line'+(pend.length===1?'':'s')+'</span></div>';
  if(!pend.length){
    h += '<div class="card"><div class="empty">Nothing waiting.</div></div>';
  } else {
    h += '<div class="card">' + pend.map(function(o){
      return '<div class="row"><button class="tick" data-act="approve" data-id="'+o.id+'" aria-label="Tick">'+icoCheck()+'</button>'
        + '<div class="rmain"><div class="rt">'+esc(o.title)+(o.qty?' <span class="chip">'+esc(o.qty)+'</span>':'')+'</div>'
        + '<div class="rmeta"><span class="chip ac">'+esc(o.supplier)+'</span>'
        + (o.urgent?'<span class="chip cr">urgent</span>':'')
        + (o.addedBy?'<span class="chip">asked by '+esc(nameOf(o.addedBy))+'</span>':'')
        + '</div></div></div>';
    }).join("") + '</div>';
  }
  h += '</div>';

  /* --- 4. the brigade, management side --- */
  var score = {};
  BRIGADE.forEach(function(p){ score[p.id] = 0; });
  ["prep","clean","haccp","orders"].forEach(function(k){
    S[k].forEach(function(it){ if(it.done && it.by != null && score[it.by] != null) score[it.by]++; });
  });
  var ranked = BRIGADE.slice().sort(function(a,b){ return score[b.id]-score[a.id]; });

  h += '<div class="sec"><div class="sec-h"><h2>Who did what</h2><span class="sub">since the service opened</span></div>'
    + '<div class="card">' + ranked.map(function(p){
        var s = p.shifts[DAY];
        return '<div class="kv"><span>'+esc(p.name)
          + (p.role?' <span class="chip ac" style="text-transform:none">'+esc(p.role)+'</span>':'')
          + (s?'':' <em style="opacity:.6">· repos</em>')+'</span><b>'+score[p.id]+'</b></div>';
      }).join("") + '</div></div>';

  h += '<div class="sec"><div class="sec-h"><h2>Absences</h2><span class="sub">Combo · week 35</span>'
    + '<span class="act">' + extLink(COMBO+WEEK, "Combo", "sm") + '</span></div>'
    + '<div class="card">'
    + '<div class="kv"><span>Samuel CHARUET</span><b style="color:var(--warn)">paid leave · Fri + Sat</b></div>'
    + '<div class="kv"><span>Lior HAGAI</span><b style="color:var(--crit)">unjustified absence · Tue → Sat</b></div>'
    + '<div class="note">Lior does not appear on the brigade\'s shared board — that is a management matter, not a service one. Tell me if you want him back on it.</div>'
    + '</div></div>';

  h += '<div class="sec"><div class="sec-h"><h2>Open in Melba</h2>'
    + '<span class="sub">app.melba.io</span></div><div class="lg">'
    + [["🍽","Recipes","the book itself",MELBA.recipes],
       ["🥬","Ingredients","costs and supplier",MELBA.ingredients],
       ["🚚","Suppliers","the address book",MELBA.suppliers],
       ["📦","Stock movements","in and out",MELBA.stock],
       ["📈","Analysis","food cost",MELBA.analytics],
       ["🔌","Extensions","connect Claude",MELBA.extensions]].map(function(l){
        return '<a class="lk" href="' + esc(l[3]) + '" target="_blank" rel="noopener"'
          + ' data-ext="' + esc(l[3]) + '" data-lbl="' + esc(l[1]) + '">'
          + '<span class="li">' + l[0] + '</span><span><span class="lt">' + esc(l[1]) + '</span>'
          + '<span class="ld">' + esc(l[2]) + '</span></span></a>';
      }).join("") + '</div></div>';

  h += viewAccess();

  /* --- 5. haccp compliance --- */
  var hp = progress(S.haccp), cp = progress(S.clean);
  var temps = S.haccp.filter(function(x){ return x.kind==="temp" && x.value; });
  h += '<div class="sec"><div class="sec-h"><h2>Today\'s compliance</h2></div><div class="card">'
    + '<div class="kv"><span>HACCP round signed</span><b style="color:'+(hp.pct===100?'var(--ok)':'var(--warn)')+'">'+hp.done+' / '+hp.total+'</b></div>'
    + '<div class="kv"><span>Cleaning signed</span><b style="color:'+(cp.pct===100?'var(--ok)':'var(--warn)')+'">'+cp.done+' / '+cp.total+'</b></div>'
    + '<div class="kv"><span>Temperatures taken</span><b>'+temps.length+' / '+S.haccp.filter(function(x){return x.kind==="temp"}).length+'</b></div>'
    + (temps.length? temps.map(function(t){
        return '<div class="kv"><span>'+esc(t.title.replace(/ — temperature \(°C\)/,""))+'</span><b>'+esc(t.value)+' °C</b></div>';
      }).join("") : '')
    + '<div class="note">The official register stays in Melba, Hygiene &amp; Traceability. This mirrors the service in progress.</div>'
    + '</div></div>';

  return h;
}

function chrome(){
  var counts = {
    prep: S.prep.filter(function(x){return !x.done}).length,
    orders: S.orders.filter(function(x){return !x.done}).length,
    clean: S.clean.filter(function(x){return !x.done}).length,
    haccp: S.haccp.filter(function(x){return !x.done}).length,
    recipes: 0,
    pertes: S.waste.length,
    invoices: isMgmt(me) ? S.invoices.filter(function(v){return v.status!=="done"}).length : 0,
    transferts: S.transfers.length,
    direction: isMgmt(me) ? S.orders.filter(function(o){return !o.done && !o.approved}).length : 0,
    orders: canOrder(me) ? S.orders.filter(function(o){return !o.done}).length : 0,
    service: 0
  };
  var h = '<header class="top"><div class="top-in">'
    + '<span class="brand">CHEF <em>VIP</em></span>'
    + '<span class="datechip">Shabour<b>'+esc(prettyDate(DAY))+'</b></span>'
    + (me
        ? '<button class="me" data-act="whoami"><span class="av">'+esc(me.ini)+'</span><span>'+esc(me.name.split(" ")[0])+'</span></button>'
        : '<button class="btn pri" data-act="whoami">Sign in</button>')
    + '</div></header>';

  if(tab === "direction" && !isMgmt(me)) tab = "service";
  if(tab === "orders" && !canOrder(me)) tab = "service";
  if(tab === "invoices" && !isMgmt(me)) tab = "service";
  var visible = TABS_get();
  h += '<nav class="tabs"><div class="tabs-in">' + visible.map(function(t){
      return '<button class="tab" role="tab" aria-selected="'+(t===tab)+'" data-act="tab" data-tab="'+t+'">'
        + esc(TAB_LABEL[t])
        + (counts[t] ? '<span class="n">'+counts[t]+'</span>' : '') + '</button>';
    }).join("") + '</div></nav>';

  var primary = primaryFor(me).filter(function(t){ return visible.indexOf(t) >= 0; });
  var rest    = visible.filter(function(t){ return primary.indexOf(t) < 0; });
  var restN   = rest.reduce(function(a,t){ return a + (counts[t]||0); }, 0);
  h += '<nav class="botnav">' + primary.map(function(t){
      return '<button class="tab" role="tab" aria-selected="'+(t===tab)+'" data-act="tab" data-tab="'+t+'">'
        + ico(t) + '<span>' + esc(TAB_LABEL[t]) + '</span>'
        + (counts[t] ? '<span class="n">'+counts[t]+'</span>' : '') + '</button>';
    }).join("")
    + '<button class="tab" aria-selected="'+(rest.indexOf(tab)>=0)+'" data-act="more">'
    + ico("more") + '<span>More</span>'
    + (restN ? '<span class="n">'+restN+'</span>' : '') + '</button></nav>';

  var body = tab==="service"?viewService():tab==="prep"?viewPrep():tab==="orders"?viewOrders()
    : tab==="recipes"?viewRecipes():tab==="clean"?viewClean()
    : tab==="pertes"?viewWaste():tab==="transferts"?viewTransfers()
    : tab==="invoices"?viewInvoices()
    : tab==="direction"?viewDirection():viewHaccp();

  h += '<main><div class="wrap">'
    + (readOnly?'<div class="ban q"><div class="bi">👁️</div><div><div class="bt">Read only</div><div class="bd">You can see everything, but your ticks will not be saved for the others.</div></div></div>':'')
    + body + '</div></main>';

  if(!me) h += viewLogin();

  if(moreOpen){
    h += '<div class="mod" data-act="more"><div class="mbox">'
      + '<h3>Everything else</h3><p>The rest of the board \u2014 tap to go there.</p><div class="plist">'
      + rest.map(function(t){
          return '<button class="pbtn" data-act="tab" data-tab="' + t + '">'
            + '<span class="av" style="background:' + (t===tab?'var(--av)':'var(--av-mute)') + '">'
            + ico(t) + '</span>'
            + '<span><span class="pn">' + esc(TAB_LABEL[t]) + '</span>'
            + (counts[t] ? '<span class="ps">' + counts[t] + ' open</span>' : '') + '</span></button>';
        }).join("")
      + '</div></div></div>';
  }

  h += shareModal();
  if(toastMsg) h += '<div class="toast">'+esc(toastMsg)+'</div>';
  return h;
}

function render(){
  var root = document.getElementById("root");
  var focus = document.activeElement;
  var fid = focus && focus.id ? focus.id : null;
  var fsel = focus && focus.selectionStart != null ? focus.selectionStart : null;
  var vals = {};
  root.querySelectorAll("input").forEach(function(i){ if(i.id) vals[i.id]=i.value; });
  root.innerHTML = chrome();
  root.querySelectorAll("input").forEach(function(i){ if(i.id && vals[i.id]!=null && !i.value) i.value=vals[i.id]; });
  if(fid){ var el = document.getElementById(fid); if(el){ el.focus(); try{ if(fsel!=null) el.setSelectionRange(fsel,fsel); }catch(e){} } }
}

/* ============ events ============ */

document.addEventListener("keydown", function(e){
  if(e.key !== "Escape") return;
  if(moreOpen){ moreOpen = false; render(); return; }
  if(typeof shareOpen !== "undefined" && shareOpen){ shareOpen = false; render(); }
});

document.addEventListener("click", function(e){
  var ext = e.target.closest("[data-ext]");
  if(ext){
    var url = ext.getAttribute("data-ext"), opened = null;
    try { opened = window.open(url, "_blank", "noopener"); } catch(err){}
    if(!opened){ e.preventDefault(); A.ext(url, ext.getAttribute("data-lbl")); }
    return;
  }
  var b = e.target.closest("[data-act]");
  if(!b) return;
  var act = b.getAttribute("data-act");
  if(act==="toggle") return A.toggle(b.getAttribute("data-kind"), b.getAttribute("data-id"));
  if(act==="remove") return A.remove(b.getAttribute("data-kind"), b.getAttribute("data-id"));
  if(act==="tab")    return A.tab(b.getAttribute("data-tab"));
  if(act==="more"){
    /* only the backdrop itself closes the sheet */
    if(b.classList.contains("mod") && e.target !== b) return;
    return A.more();
  }
  if(act==="addInvoice") return A.addInvoice();
  if(act==="openInv")    return A.openInv(b.getAttribute("data-id"));
  if(act==="addLine")    return A.addLine(b.getAttribute("data-id"));
  if(act==="rmLine")     return A.rmLine(b.getAttribute("data-id"), b.getAttribute("data-lid"));
  if(act==="applyInv")   return A.applyInv(b.getAttribute("data-id"));
  if(act==="rmInv")      return A.rmInv(b.getAttribute("data-id"));
  if(act==="pickFile")   return A.pickFile(b.getAttribute("data-id"));
  if(act==="quickLine")  return A.quickLine(b.getAttribute("data-id"), b.getAttribute("data-p"), b.getAttribute("data-u"));
  if(act==="useName")    return A.useName(b.getAttribute("data-id"), b.getAttribute("data-p"));
  if(act==="pick")   return A.pick(b.getAttribute("data-id"));
  if(act==="whoami") return A.forget();
  if(act==="addPrep")  return A.addPrep();
  if(act==="addOrder") return A.addOrder();
  if(act==="addPin")   return A.addPin();
  if(act==="newDay")   return A.newDay();
  if(act==="rec")      return A.rec(b.getAttribute("data-id"));
  if(act==="clearq")   return A.clearq();
  if(act==="arch")     return A.arch(b.getAttribute("data-id"));
  if(act==="showOld")  return A.showOld();
  if(act==="recView")  return A.recView(b.getAttribute("data-v"));
  if(act==="recArch")  return A.recArch(b.getAttribute("data-name"));
  if(act==="share")    return A.share(b.getAttribute("data-kind"), b.getAttribute("data-key"));
  if(act==="copyShare")return A.copyShare();
  if(act==="closeShare")return A.closeShare();
  if(act==="login")    return A.login();
  if(act==="loginMode")return A.loginMode(b.getAttribute("data-m"));
  if(act==="setPin")   return A.setPin(b.getAttribute("data-id"));
  if(act==="clearAcc") return A.clearAcc(b.getAttribute("data-id"));
  if(act==="grantOrder") return A.grantOrder(b.getAttribute("data-id"));
  if(act==="loadPrep") return A.loadPrep();
  if(act==="adv")      return A.adv(b.getAttribute("data-id"));
  if(act==="addProt")  return A.addProt();
  if(act==="addNote")  return A.addNote();
  if(act==="addWaste") return A.addWaste();
  if(act==="addTransfer") return A.addTransfer();
  if(act==="removeProt"){ S.proteins = S.proteins.filter(function(x){return x.id!==b.getAttribute("data-id")}); return save(); }
  if(act==="setCode")  return A.setCode();
  if(act==="unlock")   return A.unlock();
  if(act==="lock")     return A.lock();
  if(act==="approve")  return A.approve(b.getAttribute("data-id"));
  if(act==="reorder")  return A.reorder();
});

document.addEventListener("keydown", function(e){
  if(e.key!=="Enter") return;
  var t = e.target;
  if(t && t.dataset && t.dataset.enter){ e.preventDefault(); A[t.dataset.enter](); }
});

document.addEventListener("input", function(e){
  var t = e.target;
  if(t && t.dataset && t.dataset.live === "rq"){ rq = t.value; openRec = null; render(); }
});

document.addEventListener("change", function(e){
  var t = e.target;
  if(t && t.dataset && t.dataset.val){ A.setVal(t.dataset.val, t.value); save(); }
  if(t && t.dataset && t.dataset.restr){ A.setRestr(t.dataset.restr, t.value); save(); }
  if(t && t.dataset && t.dataset.prot){ A.setProt(t.dataset.prot, t.value); save(); }
  if(t && t.dataset && t.dataset.mail){ A.setEmail(t.dataset.mail, t.value); save(); }
  if(t && t.dataset && t.dataset.jump){ A.setJump(t.value); save(); }
  if(t && t.dataset && t.dataset.upload !== undefined){ A.upload(t.dataset.upload || null, t); }
});

/* ============ boot ============ */

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
