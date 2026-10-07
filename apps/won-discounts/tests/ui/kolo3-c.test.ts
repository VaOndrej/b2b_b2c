// Kolo 3, dávka C (bod 7): výjimky v Množstevních slevách — a list of exceptions, one open at a time
// (docs/won-discounts/nakres-bod7-vyjimky.md). The screens are rendered in the dev harness.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { translator } from "../../app/i18n/index.ts";
import { exceptionTitle, readTiersForm } from "../../app/components/model/tiers.ts";

let prevEnv: string | undefined;
before(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
});
after(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});

async function render(path: string): Promise<string> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  assert.ok(!(context instanceof Response), `${path}: a redirect`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context })).replace(/<script[\s\S]*?<\/script>/g, "");
}

const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** The exceptions of the page, one piece of HTML each, in the order of the list. */
function exceptions(html: string): string[] {
  const list = html.slice(html.indexOf("data-won-exceptions"));
  return list.split(/(?=<div data-won-exception="(?:open|closed)")/).slice(1);
}
const ok = (cond: boolean, message: string) => assert.ok(cond, message);

test("an exception is named by what it is for: the first two names, then how many more", () => {
  const tr = translator("cs");
  const item = (title: string, i: number) => ({ id: `gid://shopify/Product/${i}`, title });
  const scope = (products: string[], collections: string[] = []) => ({ kind: "selection" as const, products: products.map(item), collections: collections.map(item) });
  assert.equal(exceptionTitle(scope(["Kreatin"]), tr), "Kreatin");
  assert.equal(exceptionTitle(scope(["Dárkové poukazy"], ["Vzorky zdarma"]), tr), "Dárkové poukazy, Vzorky zdarma");
  assert.equal(exceptionTitle(scope(["A", "B", "C"], ["D", "E"]), tr), "A, B a další 3");
  assert.equal(exceptionTitle(scope([]), tr), "Zatím nic nevybráno");
  assert.equal(exceptionTitle(scope(["  "]), tr), "Produkt bez názvu");
  assert.equal(exceptionTitle(scope(["A", "B", "C"]), translator("en")), "A, B and 1 more");
});

test("stav 1: every exception is one row — its name, what it gives, Upravit and Odebrat; none is open", async () => {
  const html = await render("tiers?plan=pro&state=exceptions");
  const rows = exceptions(html);
  assert.equal(rows.length, 2);
  ok(rows.every((r) => r.startsWith('<div data-won-exception="closed"')), "nothing is open until the merchant edits one");
  assert.deepEqual(
    rows.map((r) => [text(r.match(/data-won-exception-name[^>]*>([\s\S]*?)<\/div>/)![1]!).trim(), text(r.match(/data-won-exception-gives[^>]*>([\s\S]*?)<\/div>/)![1]!).trim()]),
    [
      ["Mikina Won, Podzimní kolekce", "Od 2 ks −30 Kč / 1,20 € za kus, od 6 ks −60 Kč za kus (v EUR se nenabízí)"],
      ["Dárkový poukaz, Vzorek zdarma a další 2", "Bez množstevní slevy"],
    ],
  );
  for (const r of rows) {
    ok(/<s-button variant="secondary"[^>]*aria-expanded="false"[^>]*>Upravit<\/s-button>/.test(r), "Upravit");
    ok(/<s-button variant="tertiary"[^>]*>Odebrat<\/s-button>/.test(r), "Odebrat");
    ok(/data-won-exception-body="true" style="display:none/.test(r), "a closed exception is out of sight");
  }
  const page = text(html);
  ok(page.includes("2 výjimky"), "the section says how many");
  ok(page.includes("Když produkt patří do více výjimek, platí první v seznamu"), "which one wins, once there are two");
  ok(/<s-button[^>]*>Přidat výjimku<\/s-button>/.test(html), "Přidat výjimku");
  // One exception: nothing to say about which wins.
  ok(!text(await render("tiers?plan=pro")).includes("Když produkt patří do více výjimek"), "one exception: no sentence about precedence");
});

test("a closed exception stays in the form: the one Save of the page still saves all of them", async () => {
  const html = await render("tiers?plan=pro&state=exceptions");
  // What a browser would post from the rendered form (the s-* fields and the hidden inputs carry name + value).
  const form = new FormData();
  for (const tag of html.match(/<(?:input|s-number-field)\b[^>]*>/g) ?? []) {
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    if (/type="radio"/.test(tag) && !/\bchecked=""/.test(tag)) continue;
    form.append(name.replace(/&amp;/g, "&"), (tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"));
  }
  const read = readTiersForm(form, { currencies: ["CZK", "EUR"], keptCurrencies: [], titles: new Map() });
  assert.deepEqual(read.errors, []);
  assert.deepEqual(
    read.sets.map((s) => [s.id, s.scope.kind, s.countAcross, s.breaks.map((b) => b.minQty)]),
    [
      ["global", "global", "product", [3, 5, 10]],
      ["t_devautumn", "selection", "cart", [2, 6]],
      ["t_devnone", "selection", "product", []],
    ],
  );
});

test("stav 2: a refused save opens the exception it is about — the sentence, what it is for, the two cards, the levels, Hotovo", async () => {
  const html = await render("tiers?plan=pro&state=exceptions&result=invalid-exception");
  const [first, second] = exceptions(html);
  ok(first!.startsWith('<div data-won-exception="open"'), "the refused one is open");
  ok(second!.startsWith('<div data-won-exception="closed"'), "the other stays a row");
  const body = first!.slice(first!.indexOf("data-won-exception-body"));
  ok(/data-won-exception-body="true" style="display:block/.test(first!), "its fields are in sight");
  ok(text(body).includes("Mikina Won, Podzimní kolekce: od 2 ks −30 Kč / 1,20 € za kus, od 6 ks −60 Kč za kus (v EUR se nenabízí). Zbytek obchodu beze změny."), text(body).slice(0, 200));
  ok(/Pro které produkty a kolekce[\s\S]*Mikina Won[\s\S]*Podzimní kolekce[\s\S]*Vybrat produkty[\s\S]*Vybrat kolekce/.test(text(body)), "what it is for, and the two pickers");
  // The two cards say what each means; "Jiné úrovně" is the stored one.
  const cards = body.slice(body.indexOf("data-won-exception-mode"));
  ok(/checked=""[^>]*value="own"/.test(cards), "Jiné úrovně is picked");
  ok(/Jiné úrovně\s+Vlastní počty kusů a slevy\.\s+Bez množstevní slevy\s+Tyhle produkty slevu za množství nedostanou\./.test(text(cards)), text(cards).slice(0, 200));
  // The levels are the same numbered cards as for the whole store, named by the market.
  assert.equal((body.match(/data-won-tier-row/g) ?? []).length, 2);
  ok(body.includes('label="Sleva za kus: Slovensko (EUR)"') || /label="[^"]*Slovensko \(EUR\)"/.test(body), "a field is named by its market");
  // It counts across the cart and gives amounts, the whole store per product in percent: the two choices are open.
  ok(/data-won-tier-own="open"/.test(body) && text(body).includes("Počítat jinak než zbytek obchodu"), "counting differently is in sight");
  ok(/<s-button variant="primary"[^>]*>Hotovo<\/s-button>/.test(body) && /<s-button variant="tertiary" tone="critical"[^>]*>Odebrat výjimku<\/s-button>/.test(body), "Hotovo and Odebrat výjimku");
  ok(/<s-button variant="secondary"[^>]*aria-expanded="true"[^>]*>Hotovo<\/s-button>/.test(first!), "the row's button closes it");
});

test("'Bez množstevní slevy' shows no levels; on Free the stored exceptions are rows without editing, still removable", async () => {
  const pro = exceptions(await render("tiers?plan=pro&state=exceptions"));
  const none = pro[1]!;
  ok(/checked=""[^>]*value="none"/.test(none), "Bez množstevní slevy is picked");
  assert.equal((none.match(/data-won-tier-row/g) ?? []).length, 0);
  ok(!none.includes("data-won-tier-own"), "nothing about counting either");
  const free = exceptions(await render("tiers?state=exceptions"));
  assert.equal(free.length, 2);
  for (const r of free) {
    ok(!/>Upravit<\/s-button>/.test(r) && !r.includes("data-won-exception-body"), "no editing on Free");
    ok(/>Odebrat<\/s-button>/.test(r), "still removable");
    ok(text(r).includes("Uloženo, ve Free neplatí"), "says it does not apply");
    ok(/<input type="hidden" name="set\.[^"]+\.kept" value="1"/.test(r), "kept as stored");
  }
  ok(text(free[1]!).includes("Dárkový poukaz, Vzorek zdarma a další 2"), "named the same way");
});

test("an exception that counts like the whole store keeps counting and kind folded, with one sentence", async () => {
  // The whole store's set shown as an exception would differ in nothing — the harness has none, so the editor is
  // rendered on its own: the fields are there (submitted), folded, and the sentence says what applies.
  const { TierSetEditor } = await import("../../app/components/tiers/TierSetEditor.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const set = { id: "t_x", scope: { kind: "selection" as const, products: [], collections: [] }, countAcross: "product" as const, breaks: [{ minQty: 3, kind: "percent" as const, percent: 5, amount: {} }] };
  const render1 = (inherit: { count: "line" | "product" | "cart"; kind: "percent" | "amount" }) =>
    renderToString(createElement(LocaleProvider, { locale: "cs" } as Parameters<typeof LocaleProvider>[0], createElement(TierSetEditor, { set, currencies: [], kept: [], pro: true, live: () => null, errorFor: () => undefined, inherit })));
  const same = render1({ count: "product", kind: "percent" });
  ok(/data-won-tier-own="closed"/.test(same), "folded");
  ok(text(same).includes("Teď stejně jako zbytek obchodu: varianty produktu dohromady; sleva: procenta."), text(same).slice(0, 200));
  ok(/name="set\.t_x\.count"/.test(same) && /name="set\.t_x\.kind"/.test(same), "the two choices are still submitted");
  ok(/data-won-tier-own="open"/.test(render1({ count: "line", kind: "percent" })), "a different counting opens it");
});
