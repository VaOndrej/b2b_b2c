import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// Task 5: every admin screen is reachable in the dev harness (/dev/preview/<screen>)
// with fixtures, WITHOUT Shopify auth and without a database, and renders the real
// screen component in both admin languages. Rendered through React Router's static
// handler, i.e. the same loader → component path as a real request.

const SCREENS: { path: string; expect: RegExp[] }[] = [
  { path: "overview", expect: [/Co běží/, /Stav v obchodě/, /Zatím nezkontrolováno/, /čeká na propsání|čekají na propsání/, /Konfigurace: verze 1 · 6 pravidel/] },
  {
    path: "overview?state=live",
    expect: [/Upozornění/, /LETO15/, /Přesunout vše \(2\)/, /Vrátit zpět/, /Naplánováno od 27\. 11\. 2026/, /3 běží · 1 naplánovaná · 1 neběží/, /cílí na segmenty zákazníků/, /Upravit cílení/],
  },
  {
    path: "overview?state=sync-failed",
    expect: [/Synchronizace selhala 28\. 9\. 2026 16:20/, /Kód slevy „VIP10“ už v Shopify používá jiná sleva/, /Synchronizovat znovu/, /2 běží · 1 naplánovaná · 1 nepropsaná · 1 neběží · 1 vypnutá/, /Nepropsáno/],
  },
  {
    path: "overview?state=moved",
    expect: [/1 sleva přesunuta do Won/, /Na co myslet/, /zbývajících 58/, /Nedokončené přesuny/, /PODZIM20/, /Je v záloze/, /Přesunuté do Won/, /LETO15/, /Vrátit zpět/],
  },
  { path: "overview?state=empty", expect: [/Zatím žádná sleva/, /Nastavení za 3 minuty/, /% na vše/, /Uvítací kód/] },
  { path: "overview?readOnly=1", expect: [/Nastavení jen pro čtení/] },
  { path: "discounts", expect: [/Tvoje slevy/, /Černý pátek/, /v EUR se nenabízí/, /Aktivní slevy s kódem: 1 z 20/, /nepropsáno do Shopify/] },
  { path: "discounts?sync=ok", expect: [/6 slev · 3 běží · 1 naplánovaná · 1 neběží · 1 vypnutá/, /Naplánováno od 27\. 11\. 2026/] },
  { path: "discounts?state=empty", expect: [/Vyber recept/] },
  { path: "discounts?sync=failed", expect: [/Nepropsáno/, /synchronizace selhala/, /Synchronizace selhala 28\. 9\. 2026/] },
  { path: "rule-editor", expect: [/Částka v CZK/, /Částka v EUR/, /nenabízí se/, /Europe\/Prague/, /Pro · odemknout/, /Naplánováno/, /Připravujeme/] },
  { path: "rule-editor?rule=dev-fixture-2", expect: [/VIP10/, /1× na zákazníka/, /Aktivní slevy s kódem: 1 z 20/] },
  { path: "rule-editor?rule=dev-fixture-3", expect: [/HUF/, /Uloženo i pro HUF: 3\u00a0000\u00a0HUF\. Trh je vypnutý, hodnota zůstává\./, /Odebrat hodnotu v HUF/] },
  { path: "rule-editor?rule=dev-fixture-6", expect: [/Neběží/, /V pokladně se zatím neuplatní, proto sleva neběží/] },
  { path: "rule-editor?result=unreadable", expect: [/Uložené nastavení se nepodařilo přečíst/, /Nahradit neplatnou konfiguraci/] },
  { path: "rule-editor?result=sync-failed", expect: [/Uloženo, ale do Shopify se zatím nepropsalo/, /Sleva „Černý pátek“ se do Shopify nepropsala/, /Synchronizovat znovu/] },
  { path: "rule-editor?rule=dev-fixture-2&result=collision", expect: [/nejde použít zároveň, pokladna je nerozliší/, /Upravit kódy/] },
  { path: "rule-editor?rule=dev-fixture-2&result=too-many", expect: [/Aktivních slev s kódem může být nejvýš 20, po uložení by jich bylo 21/] },
  { path: "rule-editor?rule=new&recipe=welcomeCode", expect: [/Nová sleva/, /VITEJ10/, /Neuloženo/] },
  { path: "rule-editor?rule=dev-fixture-2&plan=pro", expect: [/Cílení a kombinace/, /Česko/, /Slovensko/] },
  { path: "try-cart", expect: [/Mikina Won × 2/, /Kód VIP10/, /Celkem/, /CZK · Česko/, /Ceny a země z trhu Česko/, /Podzimní sleva 10/] },
  { path: "try-cart?state=not-wired", expect: [/Výpočet košíku zatím není zapojený/] },
  { path: "onboarding", expect: [/Co chceš řešit/, /Doprava zdarma nebo dárek/, /na první místo/] },
  { path: "onboarding?step=3&embed=on", expect: [/Zapnuto. Web je připravený/, /Vytvořit první slevu/] },
  { path: "move-dialog", expect: [/Co se stane/, /Co se ztratí/, /Počítadlo použití \(zatím 42×\) se smazáním slevy v Shopify ztratí/, /Na co myslet/, /zbývajících 58/] },
  { path: "move-dialog?all=1", expect: [/Přesunout 2 slevy do Won/, /LETO15/, /Doprava zdarma nad 2 000 Kč/, /Doplň ji pro EUR/] },
  { path: "coming-soon?module=outlet", expect: [/Výprodej/, /Přijde v další verzi/, /Přejít na Přehled/] },
  { path: "plan", expect: [/Tarif/, /Pro · 29 USD/, /nejvýš 20 aktivních s kódem/, /nejvýš 25 slevových funkcí/] },
  { path: "settings", expect: [/Trhy a měny/, /CZK \(Česko\)/] },
  {
    path: "overview?state=live&locale=en",
    expect: [/What&#x27;s running|What's running/, /Discounts outside Won/, /Move all \(2\)/, /Scheduled from 27 Nov 2026/],
  },
  { path: "rule-editor?locale=en", expect: [/Amount in EUR/, /not offered/] },
];

let prevEnv: string | undefined;
before(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
});
after(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});

async function render(path: string): Promise<{ status: number; html: string }> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  if (context instanceof Response) return { status: context.status, html: "" };
  // A thrown 404 is asserted by status; rendering it would only print React
  // Router's default ErrorBoundary into the test log.
  if (context.statusCode !== 200) return { status: context.statusCode, html: "" };
  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(createElement(StaticRouterProvider, { router, context }));
  return { status: context.statusCode, html };
}

for (const screen of SCREENS) {
  test(`harness renders /dev/preview/${screen.path} without auth`, async () => {
    const { status, html } = await render(screen.path);
    assert.equal(status, 200);
    assert.match(html, /<s-page/);
    for (const re of screen.expect) assert.match(html, re, `${screen.path}: expected ${re}`);
    // §4c: nothing machine-shaped leaks into the page text (the serialized
    // loader data in <script> is data, not text, so it is left out).
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(text, /\{(n|name|value|currency|rule|currencies|date|count)\}/, `${screen.path}: leftover placeholder`);
    assert.doesNotMatch(text, />[^<]*\bundefined\b[^<]*</, `${screen.path}: "undefined" in text`);
    assert.doesNotMatch(text, />[^<]*\b(freeShipping|percentage|not_wired|draft_only|not_synced)\b[^<]*</, `${screen.path}: raw enum in text`);
    // Copy must not promise what does not exist: no "unlimited", no segments "after connecting".
    assert.doesNotMatch(text, /neomezeně|unlimited|po napojení/i, `${screen.path}: overclaiming copy`);
  });
}

test("an unknown harness screen is a 404", async () => {
  const { status } = await render("does-not-exist");
  assert.equal(status, 404);
});

test("the harness action (forms posted in a preview) is guarded like the loader", async () => {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  assert.deepEqual(mod.action(), { ok: false, reason: "preview_only" });
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => mod.action(),
      (err: unknown) => err instanceof Response && err.status === 404,
    );
  } finally {
    process.env.NODE_ENV = "test";
  }
});
