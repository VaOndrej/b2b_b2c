import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [1440, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return b.width > 1 && b.height > 1 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
    const overlap = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const area = (a, b) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return Math.max(0, w) * Math.max(0, h);
    };
    const out = [];
    for (const row of document.querySelectorAll('.won-rail__controls')) {
      if (!vis(row)) continue;
      const sec = (row.closest('.shopify-section')?.id || '?').replace(/^shopify-section-template--\d+__/, '');
      const rr = row.getBoundingClientRect();
      const scope = row.closest('.shopify-section');
      for (const el of scope.querySelectorAll('a[href], button:not([disabled])')) {
        if (row.contains(el) || !vis(el)) continue;
        const er = el.getBoundingClientRect();
        if (!overlap(rr, er)) continue;
        const pct = Math.round((area(rr, er) / (er.width * er.height)) * 100);
        out.push({ sec, prvek: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 22), zakryto: pct });
      }
    }
    return out;
  });
  console.log(`--- ${w}px ---`);
  if (!r.length) console.log('  žádný překryv');
  for (const x of r) console.log(`  ${x.sec.padEnd(16)} „${x.prvek}" zakryto ${x.zakryto} %`);
  await p.close();
}
await b.close();
