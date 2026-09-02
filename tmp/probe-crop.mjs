import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1400 } });
await p.goto('http://127.0.0.1:9292/products/the-videographer-snowboard', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'tmp/shots/pdp-detail-tabs-before.png', fullPage: true, clip: { x: 0, y: 1120, width: 1440, height: 790 } });
await b.close();
