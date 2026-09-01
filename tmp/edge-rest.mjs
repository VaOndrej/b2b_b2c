import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });

// --- košík 0 / 1 / N: počítadlo v hlavičce i steppery na kartách
const cart = (path, body) => p.evaluate(async ([pa, bo]) => {
  const r = await fetch(pa, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bo ? JSON.stringify(bo) : undefined });
  return r.status;
}, [path, body]);

await p.goto('http://127.0.0.1:9292/collections/automated-collection', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await cart('/cart/clear.js');
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);

const read = () => p.evaluate(() => {
  const badge = document.querySelector('[data-cart-count], .cart-count, [class*="cart-bubble"], header [class*="count"]');
  const steppers = [...document.querySelectorAll('[data-won-stepper]')];
  return {
    pocitadlo: (badge?.textContent || '').trim().replace(/\s+/g, '') || '—',
    stepperu: steppers.length,
    sMnozstvim: steppers.filter((s) => s.hasAttribute('data-won-qty-value')).length,
    mnozstvi: steppers.map((s) => s.getAttribute('data-won-qty-value')).filter(Boolean),
  };
});
console.log('košík 0:', JSON.stringify(await read()));

// přidej 1 kus přes quick-add
const add = p.locator('[data-won-add]').first();
if (await add.count()) {
  await add.scrollIntoViewIfNeeded();
  await add.click({ force: true });
  await p.waitForTimeout(2500);
  console.log('košík 1:', JSON.stringify(await read()));
  const plus = p.locator('[data-won-stepper][data-won-qty-value] [data-won-plus], [data-won-stepper] .won-pcard__plus').first();
  if (await plus.count()) {
    await plus.click({ force: true }); await p.waitForTimeout(2200);
    console.log('košík 2:', JSON.stringify(await read()));
  } else console.log('košík 2: tlačítko + nenalezeno');
} else console.log('quick-add na stránce není');

// --- velmi dlouhý název: injektuj a změř přetečení
await p.evaluate(() => {
  const t = document.querySelector('.won-pcard__title');
  if (t) t.textContent = 'Extrémně dlouhý název produktu pro ověření zalomení a přetečení karty v mřížce';
});
await p.waitForTimeout(400);
const long = await p.evaluate(() => {
  const c = document.querySelector('.won-pcard');
  const t = document.querySelector('.won-pcard__title');
  return { kartaSirka: Math.round(c.getBoundingClientRect().width), titulekSirka: Math.round(t.getBoundingClientRect().width),
           strankaPreteka: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
});
console.log('dlouhý název:', JSON.stringify(long));
await cart('/cart/clear.js');
await b.close();
