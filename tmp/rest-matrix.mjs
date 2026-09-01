import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'themes/dist/horizon-dev/config/settings_data.json';
const setGlobal = (patch) => {
  const raw = readFileSync(P, 'utf8'); const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i)); Object.assign(d.current, patch);
  writeFileSync(P, raw.slice(0, i) + JSON.stringify(d, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();

// --- Catalog: won_hide_gift_cards, na všech třech výpisových konzumentech
for (const v of [false, true]) {
  setGlobal({ won_hide_gift_cards: v });
  await sleep(14000);
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const [name, url] of [['HP raily', '/'], ['PLP', '/collections/automated-collection'], ['vyhledávání', '/search?q=gift']]) {
    await p.goto('http://127.0.0.1:9292' + url, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
      const titles = [...document.querySelectorAll('.won-pcard__title, .won-pcard a[href*="/products/"]')].map((e) => e.textContent.trim());
      const gift = [...document.querySelectorAll('a[href*="/products/"]')].filter((a) => /gift[-_ ]?card/i.test(a.getAttribute('href') + ' ' + a.textContent)).length;
      return { karet: document.querySelectorAll('.won-pcard').length, giftOdkazu: gift };
    });
    console.log(`won_hide_gift_cards=${String(v).padEnd(5)} ${name.padEnd(13)} karet=${r.karet} giftOdkazů=${r.giftOdkazu}`);
  }
  await p.close();
}

// --- Policy: won_return_enabled × dny, na PDP + structured data
for (const [en, days] of [[false, 14], [true, 0], [true, 14], [true, 90]]) {
  setGlobal({ won_return_enabled: en, won_return_days: days, won_return_country: 'CZ' });
  await sleep(14000);
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/products/the-collection-snowboard-liquid', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const txt = document.body.innerText;
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join(' ');
    const m = ld.match(/"merchantReturnDays"\s*:\s*(\d+)/);
    return { trustText: /vrácen|vrat|return/i.test(txt), ldPolicy: /MerchantReturnPolicy/.test(ld), ldDays: m ? m[1] : '—' };
  });
  console.log(`won_return enabled=${String(en).padEnd(5)} dnů=${String(days).padEnd(3)} textNaPDP=${r.trustText} ldMerchantReturnPolicy=${r.ldPolicy} ldDnů=${r.ldDays}`);
  await p.close();
}

// --- Animation: won_countup_default_duration
for (const d of [400, 1600, 4000]) {
  setGlobal({ won_countup_default_duration: d });
  await sleep(14000);
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[data-won-countup], [data-countup], .won-stat__value')];
    return { prvku: els.length, attrs: els.slice(0, 3).map((e) => e.getAttribute('data-won-countup-duration') || e.getAttribute('data-duration') || '—') };
  });
  console.log(`won_countup_default_duration=${String(d).padEnd(5)} prvků=${r.prvku} duration=${JSON.stringify(r.attrs)}`);
  await p.close();
}
await b.close();
