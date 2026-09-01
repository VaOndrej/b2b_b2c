import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const [n, url] of [
  ['výpis 0 výsledků (filtr)', '/collections/automated-collection?filter.v.price.gte=99999'],
  ['výpis 1 výsledek (filtr)', '/collections/automated-collection?filter.v.price.lte=250'],
  ['search 0 výsledků', '/search?q=zzzqqqxyz'],
]) {
  for (const w of [1440, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 } });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 60)));
    await p.goto('http://127.0.0.1:9292' + url, { waitUntil: 'load' });
    await p.waitForTimeout(1300);
    const r = await p.evaluate(() => {
      const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const cards = document.querySelectorAll('.won-pcard');
      const rails = [...document.querySelectorAll('.won-rail__controls')];
      const liveAffordance = rails.filter((r) => [...r.children].some((c) => !c.hasAttribute('hidden') && vis(c))).length;
      const grid = document.querySelector('.won-collection__grid, .won-grid, [class*="__grid"]');
      return {
        karet: cards.length,
        mrtvaAfordance: liveAffordance,
        vyskaMrizky: grid ? Math.round(grid.getBoundingClientRect().height) : null,
        zprava: (document.querySelector('[class*="empty"], .won-collection__empty')?.textContent || '').trim().slice(0, 46) || '—',
        textNaStrance: /nenaš|no result|0 produkt|žádn|nothing/i.test(document.body.innerText),
      };
    });
    const of = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    console.log(`${n.padEnd(26)} ${String(w).padEnd(5)} karet=${r.karet} mrtvéOvládání=${r.mrtvaAfordance} výškaMřížky=${r.vyskaMrizky} zpráva="${r.zprava}" text=${r.textNaStrance} přetéká=${of} jsChyby=${errs.length}`);
    await p.close();
  }
}
await b.close();
