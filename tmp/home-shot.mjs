import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [name, w, h] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `tmp/shots/home-after-packs-${name}.png` });
  await p.close();
}
await b.close();
console.log('done');
