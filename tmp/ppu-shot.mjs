import { chromium } from '@playwright/test';
const b = await chromium.launch();
const shots = [
  ['kapsle-d3k2', '/products/the-multi-location-snowboard'],
  ['prasek-whey', '/products/the-collection-snowboard-liquid'],
];
for (const [name, path] of shots) {
  for (const [label, w, h] of [['mobil-390', 390, 844], ['desktop-1440', 1440, 1000]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto('http://127.0.0.1:9292' + path, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    const ppu = await p.locator('.won-ppu').first().innerText().catch(() => '(nic)');
    const box = await p.locator('.won-ppu').first().boundingBox().catch(() => null);
    if (box) await p.evaluate(() => document.querySelector('.won-ppu')?.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    await p.screenshot({ path: `tmp/ppu-shots/${name}-${label}.png` });
    console.log(`${name} ${label}: "${ppu.replace(/\n/g, ' ')}" | console errors: ${errs.length}${errs.length ? ' -> ' + errs.slice(0,3).join(' / ') : ''}`);
    await p.close();
  }
}
await b.close();
