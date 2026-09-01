import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'themes/dist/horizon-dev/config/settings_data.json';
const set = (v) => { const raw = readFileSync(P,'utf8'); const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i)); d.current.won_card_add_size = v;
  writeFileSync(P, raw.slice(0,i)+JSON.stringify(d,null,2)+'\n'); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch();
for (const v of ['compact','regular','large']) {
  set(v); await sleep(14000);
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/collections/automated-collection', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const m = {};
    for (const card of document.querySelectorAll('.won-pcard')) {
      const el = card.querySelector('.won-pcard__add'); if (!el) continue;
      el.style.opacity='1'; el.style.translate='none';
      const kind = [...el.classList].filter(c=>c.startsWith('won-pcard__add--')).join(',')||'button';
      const cs = getComputedStyle(el);
      m[kind] = { h: Math.round(el.getBoundingClientRect().height), font: cs.fontSize };
    }
    return m;
  });
  console.log(`${v.padEnd(8)} ${JSON.stringify(r)}`);
  await p.close();
}
await b.close();
