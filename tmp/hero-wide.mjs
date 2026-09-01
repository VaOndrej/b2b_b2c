import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [label, w, h] of [['desktop-1440', 1440, 1000], ['mobil-390', 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  const hero = p.locator('.won-hero--slider').first();
  await hero.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const box = await hero.boundingBox();
  await p.screenshot({ path: `tmp/ppu-shots/hero-chrome-${label}.png`, clip: {
    x: 0, y: Math.max(0, box.y - 10), width: w, height: Math.min(h, box.height + 40) } });
  console.log(label, 'ok');
  await p.close();
}
await b.close();
