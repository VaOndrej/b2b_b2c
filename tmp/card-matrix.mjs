import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'themes/dist/horizon-dev/config/settings_data.json';
const setGlobal = (patch) => {
  const raw = readFileSync(P, 'utf8'); const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i)); Object.assign(d.current, patch);
  writeFileSync(P, raw.slice(0, i) + JSON.stringify(d, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
  const cards = [...document.querySelectorAll('.won-pcard')];
  let withAdd = 0, visibleAdd = 0, stepper = 0, tapOk = 0, tapBad = [], overlapBadge = 0, offsets = new Set();
  for (const c of cards) {
    const add = c.querySelector('.won-pcard__add');
    if (!add) continue;
    withAdd++;
    if (vis(add)) visibleAdd++;
    if (add.classList.contains('won-pcard__add--stepper')) stepper++;
    const r = add.getBoundingClientRect();
    if (r.height >= 43.5) tapOk++; else tapBad.push(Math.round(r.height));
    // horizontal placement relative to its media box
    const media = c.querySelector('.won-pcard__media');
    if (media) {
      const m = media.getBoundingClientRect();
      const left = r.left - m.left, right = m.right - r.right;
      offsets.add(left < right - 4 ? 'start' : right < left - 4 ? 'end' : 'center');
    }
    const badge = c.querySelector('.won-pcard__badges');
    if (badge && vis(add)) {
      const b = badge.getBoundingClientRect();
      if (!(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom)) overlapBadge++;
    }
    // steppers: +/- tap targets
    for (const st of c.querySelectorAll('.won-pcard__step')) {
      const s = st.getBoundingClientRect();
      if (s.width > 0 && (s.width < 43.5 || s.height < 43.5)) tapBad.push(`step ${Math.round(s.width)}x${Math.round(s.height)}`);
    }
  }
  return { cards: cards.length, withAdd, visibleAdd, stepper, tapOk, tapBad: tapBad.slice(0, 4), overlapBadge, offsets: [...offsets].join('|') };
};

const CASES = [
  ['won_card_add_mode', ['button', 'stepper']],
  ['won_card_add_align', ['start', 'center', 'end']],
  ['won_card_add_reveal', ['hover', 'always']],
];
const BASE = { won_card_add_mode: 'stepper', won_card_add_align: 'end', won_card_add_reveal: 'hover' };
const VIEWS = [['desktop', 1440, 1000], ['mobil', 390, 844]];

const b = await chromium.launch();
for (const [key, values] of CASES) {
  for (const v of values) {
    setGlobal({ ...BASE, [key]: v });
    await sleep(14000);
    for (const [vn, w, h] of VIEWS) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.goto('http://127.0.0.1:9292/collections/automated-collection', { waitUntil: 'load' });
      await p.waitForTimeout(1500);
      const m = await p.evaluate(MEASURE);
      console.log(`${key}=${String(v).padEnd(9)} ${vn.padEnd(8)} karet=${m.cards} sQuickAdd=${m.withAdd} viditelnych=${m.visibleAdd} stepper=${m.stepper} tap>=44:${m.tapOk} spatne=${JSON.stringify(m.tapBad)} prekryvBadge=${m.overlapBadge} pozice=${m.offsets}`);
      await p.close();
    }
  }
}
await b.close();
