import { chromium } from '@playwright/test';
const out = 'tmp/wave1-shots';
const b = await chromium.launch();
for (const [name, w, h] of [['mobile-390', 390, 844], ['desktop-1440', 1440, 1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  for (const sel of ['.won-carousel--scroll-sm', '.won-carousel--grid:not(.won-carousel--scroll-sm)']) {
    const el = p.locator(`won-carousel${sel}`).first();
    await el.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    const tag = sel.includes('not') ? 'grid-plain' : 'grid-scroll';
    await el.screenshot({ path: `${out}/${tag}-${name}.png` });
  }
  const arrows = p.locator('.won-carousel__arrows').first();
  if (await arrows.isVisible().catch(() => false)) {
    await arrows.scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await arrows.screenshot({ path: `${out}/arrows-${name}.png` });
  }
  await p.close();
}
await b.close();
console.log('hotovo');
