import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [n, h] of [['vyprodaný (Omega 3)', 'the-3p-fulfilled-snowboard'],
                      ['dostupný (Elektrolyty)', 'the-inventory-not-tracked-snowboard'],
                      ['gift card', 'gift-card']]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/products/' + h, { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const r = await p.evaluate(() => {
    // The buy box only — a sold-out cross-sell card must not colour the verdict.
    const form = document.querySelector('product-form-component, .product-form, form[action*="/cart/add"]');
    const btn = form?.querySelector('button[name="add"], button[type="submit"]');
    const stock = document.querySelector('[data-testid="won-stock-signal"], .won-stock, [class*="stock-signal"]');
    return {
      maFormular: !!form,
      atcLabel: (btn?.textContent || '').trim().slice(0, 24) || '—',
      atcDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled') === 'true') : null,
      stockText: (stock?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42) || '—',
    };
  });
  console.log(`${n.padEnd(24)} form=${r.maFormular} atc="${r.atcLabel}" disabled=${r.atcDisabled} sklad="${r.stockText}"`);
  await p.close();
}
await b.close();
