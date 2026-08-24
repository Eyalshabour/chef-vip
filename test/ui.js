'use strict';
/*
 * The interface, measured in a real browser.
 *
 * Opinions about a design are cheap. These are the things that either hold
 * or do not: can a gloved thumb hit it, can you read it in both themes, does
 * anything sit under the bottom bar, does the page scroll sideways on a
 * phone. Run at three sizes, in light and dark, across every tab.
 *
 *   npm run test:ui
 */
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'ui-secret';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const { chromium } = require('playwright');
const h = require('./helpers');

const VIEWPORTS = [
  { name: 'iPhone',        width: 390,  height: 844,  mobile: true },
  { name: 'iPad portrait', width: 820,  height: 1180, mobile: true },
  { name: 'iPad landscape',width: 1180, height: 820,  mobile: true },
  { name: 'Desktop',       width: 1440, height: 900,  mobile: false },
];
const TABS = ['service', 'prep', 'orders', 'recipes', 'clean', 'pertes', 'transferts', 'invoices', 'haccp', 'direction'];

const findings = [];
let checks = 0;
const note = (where, what, detail) => findings.push({ where, what, detail });
const ok = () => checks++;

/* --- WCAG relative luminance and contrast --- */
function lum(rgb) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const parse = s => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || '');
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
};

(async () => {
  const base = await h.start();
  await h.reset();
  await h.give('ee', 'eyal@restaurantshabour.com', '2011');

  /* The bundled browser is pinned by the environment, not by our package
   * version, so point straight at it rather than at whatever path this
   * Playwright build expects. */
  const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  console.log('\nthe interface, measured\n');

  for (const vp of VIEWPORTS) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
        hasTouch: vp.mobile,
        deviceScaleFactor: vp.mobile ? 3 : 1,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      /* the sandbox has no route to the font CDN; that is the network, not the app */
      /* Both remaining lines are deliberate and handled: the boot probe asks
       * /api/state before anyone has signed in (401, drawn as the login screen),
       * and the Melba summary answers 503 until MELBA_API_BASE is set. */
      const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)|401 \(Unauthorized\)|503 \(Service Unavailable\)/;
      page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });

      await page.goto(base, { waitUntil: 'networkidle' });

      /* sign in */
      await page.fill('#lg-e', 'eyal@restaurantshabour.com');
      await page.fill('#lg-c', '2011');
      await page.click('[data-act="login"]');
      await page.waitForSelector('[data-act="tab"]', { state: 'attached', timeout: 8000 });
      await page.waitForTimeout(300);

      const label = `${vp.name} ${scheme}`;

      for (const tab of TABS) {
        const sel = `[data-act="tab"][data-tab="${tab}"]`;

        /* Reach the tab the way a thumb would: a visible control if one is
         * on screen, otherwise the More sheet. Only if neither offers it is
         * the tab genuinely unreachable. */
        let reached = false;

        /* never start a hop with a sheet still over the page */
        const stray = await page.$('.mod');
        if (stray && await stray.isVisible()) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(120);
          const still = await page.$('.mod');
          if (still && await still.isVisible()) {
            note(label, 'More sheet does not close', tab);
            await page.evaluate(() => { const m = document.querySelector('.mod'); if (m) m.remove(); });
          }
        }
        const visible = await page.$$(sel);
        for (const el of visible) {
          if (await el.isVisible()) { await el.click(); reached = true; break; }
        }
        if (!reached) {
          const more = await page.$('[data-act="more"]');
          if (more && await more.isVisible()) {
            await more.click();
            await page.waitForTimeout(200);
            /* the sheet is over the page now, so only its own buttons
             * are actually clickable */
            for (const el of await page.$$(`.mod ${sel}`)) {
              if (await el.isVisible()) { await el.click(); reached = true; break; }
            }
          }
        }
        if (!reached) { note(label, 'tab unreachable by touch', tab); continue; }
        await page.waitForTimeout(200);

        const report = await page.evaluate((tabName) => {
          const out = { overflow: null, small: [], contrast: [], covered: [], unnamed: [] };
          const de = document.documentElement;
          if (de.scrollWidth > de.clientWidth + 1) {
            out.overflow = { scroll: de.scrollWidth, client: de.clientWidth };
          }
          const nav = document.querySelector('.botnav');
          const navTop = nav && getComputedStyle(nav).display !== 'none'
            ? nav.getBoundingClientRect().top : null;

          const hit = [...document.querySelectorAll('button, a, input, select, [role="tab"]')];
          for (const el of hit) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || el.type === 'file') continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;

            /* touch target, including any hit slop from ::after */
            let w = r.width, ht = r.height;
            try {
              const after = getComputedStyle(el, '::after');
              if (after.content !== 'none' && after.position === 'absolute') {
                const inset = parseFloat(after.top);
                if (inset < 0) { w -= 2 * inset; ht -= 2 * inset; }
              }
            } catch {}
            const lab = el.closest('label');
            if (lab) {
              const lr = lab.getBoundingClientRect();
              if (lr.width >= 44 && lr.height >= 44) continue;
            }
            if (w < 44 || ht < 44) {
              out.small.push({ tag: el.tagName.toLowerCase(), cls: el.className,
                text: (el.textContent || '').trim().slice(0, 24), w: Math.round(w), h: Math.round(ht) });
            }


            /* does it say what it is */
            let name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.title || '').trim();
            if (!name && el.labels && el.labels.length) name = (el.labels[0].textContent || '').trim();
            if (!name && el.getAttribute('aria-labelledby')) {
              const lb = document.getElementById(el.getAttribute('aria-labelledby'));
              if (lb) name = (lb.textContent || '').trim();
            }
            if (!name) { const w = el.closest('label'); if (w) name = (w.textContent || '').trim(); }
            if (!name && !el.closest('.botnav')) {
              out.unnamed.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30) });
            }
          }

          /* contrast of visible text against what is actually behind it */
          const seen = new Set();
          const texts = [...document.querySelectorAll('body *')].filter(el => {
            const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).length;
            return t > 0;
          });
          for (const el of texts.slice(0, 400)) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            let bg = null, node = el;
            while (node && node !== document.documentElement) {
              const c = getComputedStyle(node).backgroundColor;
              if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
              node = node.parentElement;
            }
            if (!bg) bg = getComputedStyle(document.body).backgroundColor;
            const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400;
            const key = cs.color + '|' + bg + '|' + Math.round(size);
            if (seen.has(key)) continue;
            seen.add(key);
            out.contrast.push({ fg: cs.color, bg, size, weight,
              text: (el.textContent || '').trim().slice(0, 30), cls: String(el.className).slice(0, 24) });
          }
          /* scroll to the very end: whatever is last must clear the bar */
          if (navTop !== null) {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const nav2 = nav.getBoundingClientRect().top;
            const all = [...document.querySelectorAll('main button, main a, main input, main .row, main .card')];
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (!r.height) continue;
              if (r.top < nav2 && r.bottom > nav2 + 4) {
                out.covered.push({ text: (el.textContent || '').trim().slice(0, 24) || el.className });
              }
            }
            window.scrollTo(0, 0);
          }
          return out;
        }, tab);

        if (report.overflow) note(label, `${tab}: page scrolls sideways`, `${report.overflow.scroll} > ${report.overflow.client}`); else ok();
        for (const s of report.small.slice(0, 4)) note(label, `${tab}: target under 44px`, `${s.cls || s.tag} "${s.text}" ${s.w}x${s.h}`);
        if (!report.small.length) ok();
        for (const c of report.covered.slice(0, 3)) note(label, `${tab}: sits under the bottom bar`, c.text);
        if (!report.covered.length) ok();
        for (const u of report.unnamed.slice(0, 3)) note(label, `${tab}: control with no name`, `${u.tag}.${u.cls}`);
        if (!report.unnamed.length) ok();

        for (const c of report.contrast) {
          const fg = parse(c.fg), bg = parse(c.bg);
          if (!fg || !bg || fg.a < 0.5) continue;
          const ratio = contrast(fg.rgb, bg.rgb);
          const large = c.size >= 24 || (c.size >= 18.66 && c.weight >= 700);
          const need = large ? 3 : 4.5;
          if (ratio < need) {
            note(label, `${tab}: contrast ${ratio.toFixed(2)} (needs ${need})`,
              `"${c.text}" ${Math.round(c.size)}px .${c.cls} — ${c.fg} on ${c.bg}`);
          } else ok();
        }
      }

      if (errors.length) note(label, 'console errors', errors.slice(0, 2).join(' | '));
      else ok();

      await ctx.close();
    }
  }

  await browser.close();
  await h.stop();

  console.log(`  ${checks} checks passed`);
  if (!findings.length) { console.log('  nothing to fix\n'); process.exit(0); }

  const grouped = {};
  for (const f of findings) (grouped[f.what] = grouped[f.what] || []).push(f);
  console.log(`  ${findings.length} findings\n`);
  for (const what of Object.keys(grouped).sort()) {
    const g = grouped[what];
    console.log(`  ${what}  (${g.length})`);
    for (const f of g.slice(0, 3)) console.log(`      ${f.where}: ${f.detail}`);
    if (g.length > 3) console.log(`      … and ${g.length - 3} more`);
  }
  console.log();
  process.exit(1);
})().catch(e => { console.error('ui test failed:', e); process.exit(2); });
