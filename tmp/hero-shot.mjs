import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [label, w, h] of [['mobil-390', 390, 844], ['desktop-1440', 1440, 1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const hero = p.locator('.won-hero__arrows:visible').first();
  if (await hero.count()) {
    await hero.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    const box = await hero.boundingBox();
    if (box) await p.screenshot({ path: `tmp/ppu-shots/hero-arrows-${label}.png`, clip: {
      x: Math.max(0, box.x - 220), y: Math.max(0, box.y - 160),
      width: Math.min(w, box.width + 440), height: Math.min(h, box.height + 320) } });
  }
  const rail = p.locator('[data-won-arrows]:not(.won-hero__arrows):visible').first();
  if (await rail.count()) {
    await rail.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    const box = await rail.boundingBox();
    if (box) await p.screenshot({ path: `tmp/ppu-shots/rail-arrows-${label}.png`, clip: {
      x: Math.max(0, box.x - 220), y: Math.max(0, box.y - 120),
      width: Math.min(w, box.width + 440), height: Math.min(h, box.height + 240) } });
  }
  console.log(label, 'ok');
  await p.close();
}
await b.close();
