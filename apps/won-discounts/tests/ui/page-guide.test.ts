// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// The explanation at the top of a page (návrh 30 Oct 2026, "Ukázka a kroky"): what the page is for, three steps and
// what the customer sees, on all eleven pages, rendered the way a real request renders them.

const previousEnv = process.env.NODE_ENV;

before(() => {
  process.env.NODE_ENV = "test";
});

after(() => {
  process.env.NODE_ENV = previousEnv;
});

async function render(path: string): Promise<string> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const handler = createStaticHandler([{ id: "preview", path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }]);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  assert.ok(!(context instanceof Response), path);
  assert.equal(context.statusCode, 200, path);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context }));
}

const PAGES: { path: string; page: string; sentence: RegExp; step: RegExp; preview: RegExp; en: RegExp }[] = [
  { path: "discounts", page: "discounts", sentence: /Sleva na produkt, kolekci nebo celou objednávku\./, step: /Zvolíte, jak se uplatní/, preview: /Kód LETO20/, en: /A discount on a product, a collection or the whole order\./ },
  { path: "tiers", page: "tiers", sentence: /Čím víc kusů zákazník koupí, tím nižší má cenu\./, step: /Zákazník vidí ceny/, preview: /Od 5 ks/, en: /The more pieces a customer buys, the lower the price\./ },
  { path: "rewards", page: "rewards", sentence: /když košík dosáhne vámi zvolené částky/, step: /Odměna se přidá sama/, preview: /Ještě 200 Kč a máte dopravu zdarma/, en: /when the cart reaches an amount you choose/ },
  { path: "outlet", page: "outlet", sentence: /Pak se cena sama vrátí\./, step: /Kusy se doprodávají/, preview: /700 Kč/, en: /Then the price returns by itself\./ },
  { path: "campaigns", page: "campaigns", sentence: /Spustí se a skončí sama\./, step: /Akce se sama spustí/, preview: /Black Friday: sleva 20 % do neděle/, en: /It starts and ends by itself\./ },
  { path: "placements", page: "placements", sentence: /co na webu ještě chybí/, step: /Přidáte, co chybí/, preview: /Modře jsou místa/, en: /what is still missing on your store/ },
  { path: "margin", page: "margin", sentence: /Žádná sleva nesrazí cenu pod hranici/, step: /Pokladna hlídá cenu/, preview: /500 Kč, ne 400 Kč/, en: /No discount takes a price below the limit/ },
  { path: "try-cart", page: "tryCart", sentence: /Dřív, než to uvidí zákazník\./, step: /Poskládáte košík/, preview: /Nesčítá se/, en: /Before a customer sees it\./ },
  { path: "analytics", page: "analytics", sentence: /Kolik objednávek mělo slevu/, step: /Won počítá objednávky/, preview: /Z toho se slevou/, en: /How many orders had a discount/ },
  { path: "translations", page: "translations", sentence: /pro každý jazyk obchodu/, step: /Upravíte texty/, preview: /Only 200 CZK away from free shipping/, en: /for every language of your store/ },
  { path: "settings", page: "settings", sentence: /Jak se slevy navzájem kombinují/, step: /Které typy se sčítají/, preview: /Kombinování slev/, en: /How discounts combine/ },
];

for (const { path, page, sentence, step, preview, en } of PAGES) {
  test(`${path}: the page explains itself, with three steps and what the customer sees`, async () => {
    const html = await render(path);
    assert.match(html, new RegExp(`data-won-guide="${page}"`));
    assert.match(html, sentence);
    assert.match(html, step);
    assert.match(html, preview);
    assert.equal(html.match(/data-won-guide-step/g)?.length, 3);
    assert.match(await render(`${path}?locale=en`), en);
  });
}

test("the Pro pages carry the Pro badge in the explanation", async () => {
  for (const path of ["outlet", "campaigns", "try-cart"]) assert.match(await render(path), /data-won-guide-pro/, path);
  for (const path of ["discounts", "tiers", "margin", "settings"]) assert.doesNotMatch(await render(path), /data-won-guide-pro/, path);
});

test("Ochrana marže has one explanation: the old block is gone", async () => {
  assert.doesNotMatch(await render("margin"), /data-won-margin-how|Jak to funguje/);
});

test("the explanation starts open and offers to hide itself", async () => {
  assert.match(await render("tiers"), /data-won-guide-toggle[^>]*>Skrýt vysvětlení/);
});
