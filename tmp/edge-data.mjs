import { chromium } from '@playwright/test';
const b = await chromium.launch();
const rows = [];
const check = async (name, url, fn, w = 1440) => {
  const p = await b.newPage({ viewport: { width: w, height: 1000 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  const res = await p.goto('http://127.0.0.1:9292' + url, { waitUntil: 'load' }).catch(() => null);
  await p.waitForTimeout(1200);
  let out = {};
  try { out = await p.evaluate(fn); } catch (e) { out = { chyba: String(e).slice(0, 60) }; }
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  rows.push({ name, status: res?.status() ?? '—', vw: w, ...out, pretekaStranka: overflow, jsChyby: errs.length });
  await p.close();
};

// prázdná kolekce
await check('prázdná kolekce', '/collections/empty-collection-does-not-exist', () => ({
  karet: document.querySelectorAll('.won-pcard').length,
  emptyState: !!document.querySelector('.won-collection__empty, .won-grid__empty, [class*="empty"]'),
}));
// vyhledávání bez výsledku
await check('search bez výsledku', '/search?q=zzzzqqqxyz', () => ({
  karet: document.querySelectorAll('.won-pcard').length,
  textNaStrance: /nenaš|no result|nic jsme|0 /i.test(document.body.innerText),
}));
// produkt bez fotky / vyprodaný / gift card
for (const [n, h] of [['vyprodaný PDP', 'the-3p-fulfilled-snowboard'], ['gift card PDP', 'gift-card'], ['netrackovaný', 'the-inventory-not-tracked-snowboard']]) {
  await check(n, '/products/' + h, () => ({
    h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 28),
    soldOut: /vyprod|sold out|není skladem/i.test(document.body.innerText),
    atcDisabled: !!document.querySelector('button[name="add"][disabled], .won-pcard__add--soldout, [aria-disabled="true"]'),
    placeholderObrazek: !!document.querySelector('svg.placeholder-svg, .placeholder-svg'),
  }));
}
// mobilní viewport na PLP
await check('PLP mobil', '/collections/automated-collection', () => ({
  karet: document.querySelectorAll('.won-pcard').length,
  nejdelsiTitulek: Math.max(0, ...[...document.querySelectorAll('.won-pcard__title')].map((e) => e.textContent.trim().length)),
}), 390);
// košík 0 položek
await check('prázdný košík', '/cart', () => ({
  textNaStrance: /prázdn|empty/i.test(document.body.innerText),
  polozek: document.querySelectorAll('[data-won-line-key], .cart-item').length,
}));

console.log(JSON.stringify(rows, null, 1));
await b.close();
