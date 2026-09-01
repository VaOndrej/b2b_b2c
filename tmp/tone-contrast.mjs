import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
await p.waitForTimeout(1800);
const rows = await p.evaluate(() => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const opaqueBehind = (el) => {
    let n = el.parentElement;
    while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a === 1) return c; n = n.parentElement; }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const out = [];
  for (const row of document.querySelectorAll('.won-rail__controls')) {
    const sec = (row.closest('.shopify-section')?.id || '?').replace(/^shopify-section-template--\d+__/, '');
    const btn = row.querySelector('[data-won-arrows] button');
    if (!btn) continue;
    const behind = opaqueBehind(btn);
    for (const tone of ['surface', 'overlay']) {
      btn.classList.remove('won-rail__arrow--surface', 'won-rail__arrow--overlay');
      btn.classList.add('won-rail__arrow--' + tone);
      const cs = getComputedStyle(btn);
      const plate = over(parse(cs.backgroundColor), behind);
      const glyph = over(parse(cs.color), plate);
      const border = over(parse(cs.borderColor), behind);
      out.push({ sec, tone,
        glyphVsPlate: +ratio(glyph, plate).toFixed(2),
        plateVsPage: +ratio(plate, behind).toFixed(2),
        borderVsPage: +ratio(border, behind).toFixed(2) });
    }
  }
  return out;
});
console.log('sekce                  tón      glyf/plocha  plocha/stránka  okraj/stránka');
for (const r of rows) {
  const bad = r.glyphVsPlate < 4.5 ? '  << text pod 4.5' : '';
  console.log(`${r.sec.padEnd(22)} ${r.tone.padEnd(8)} ${String(r.glyphVsPlate).padEnd(12)} ${String(r.plateVsPage).padEnd(15)} ${String(r.borderVsPage).padEnd(8)}${bad}`);
}
await b.close();
