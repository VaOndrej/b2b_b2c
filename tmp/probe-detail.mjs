import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
await p.goto('http://127.0.0.1:9292/products/the-videographer-snowboard', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const out = await p.evaluate(() => {
  const bands = [...document.querySelectorAll('[data-testid="won-band-section"]')];
  const res = bands.map((s) => {
    const blocks = [...s.querySelectorAll('.won-band__blocks > *')].map((el) => {
      const r = el.getBoundingClientRect();
      const h = el.querySelector('h2,h3,.won-table__title,[class*="title"],[class*="heading"]');
      return { label: (h?.textContent || el.className).trim().slice(0, 30), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const br = s.getBoundingClientRect();
    return { section: s.id || s.className, y: Math.round(br.y), h: Math.round(br.height), blocks };
  });
  const order = [...document.querySelectorAll('#MainContent > *')].map((el) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('h1,h2');
    return { id: el.id, label: (head?.textContent || '').trim().slice(0, 28), y: Math.round(r.y), h: Math.round(r.height) };
  });
  return { res, order };
});
console.log(JSON.stringify(out, null, 1));
await p.screenshot({ path: 'tmp/shots/pdp-detail-before.png', fullPage: true });
await b.close();
