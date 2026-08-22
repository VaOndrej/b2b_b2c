import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [name, w, h] of [['mobile-390', 390, 844], ['desktop-1440', 1440, 1000]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  const g = p.locator('.won-grid--articles').first();
  await g.scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  await g.screenshot({ path: `tmp/wave1-shots/articles-${name}.png` });
  await p.close();
}
await b.close();
console.log('hotovo');
