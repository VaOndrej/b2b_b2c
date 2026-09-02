import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [name, w, h] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://127.0.0.1:9292/products/the-videographer-snowboard', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const sec = p.locator('[data-testid="won-panels-section"]').first();
  for (const tab of ['Popis', 'Parametry', 'Nutriční hodnoty', 'Použití']) {
    await sec.getByRole('tab', { name: tab, exact: true }).click();
    await p.waitForTimeout(350);
    await sec.screenshot({ path: `tmp/shots/pdp-tabs-${name}-${tab.split(' ')[0].toLowerCase()}.png` });
  }
  await p.close();
}
await b.close();
