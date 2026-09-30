// The admin preview (MVP 3) imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
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
  // Ochrana marže (MVP 2): the module screen per state, the Přehled card, the editor note, a capped cart line.
  {
    path: "margin",
    expect: [
      /Ochrana marže/,
      /Min\. marže 20\u00a0% · bez nákupní ceny sleva nejvýš 40\u00a0%/,
      /\(cena po slevách − nákupní cena\) \/ cena po slevách, z ceny, kterou platí zákazník — u cen s DPH včetně DPH/,
      /nikdy neblokuje objednávku/,
      /Ochrana hlídá jen slevy, které běží přes Won Discounts\. Slevy mimo Won nevidí\./,
      /href="\/app#native"/,
      /step="0\.1"/,
      /Produkty bez nákupní ceny: sleva nejvýš/,
      /8 produktů nemá nákupní cenu/,
      /Ponožky Won/,
      /shopify:\/\/admin\/products\/3/,
      /Obnovit nákupní ceny/,
      /Jednou denně navíc zkontrolujeme všechny/,
      /Nastavení podle kolekcí/,
      /Pro · odemknout/,
      /Ukázka/,
      /Přehled zásahů/,
      /Zaplatí 750|zaplatí 750\u00a0Kč/,
    ],
  },
  {
    path: "margin?plan=pro",
    expect: [
      /2 kolekce s vlastním nastavením/,
      /Podzimní kolekce/,
      /Doplňky/,
      /Ochrana sníží 5 slev/,
      /Sníží se u 4 variant/,
      /Mikina Won — M \/ černá/,
      /hranice z nákupní ceny/,
      /nastavení kolekce/,
      /Slevy z objednávky/,
      /ne z objednávek/,
      /Sleva ve Won nikdy nesrazí cenu pod hranici, kterou tu nastavíš\./,
    ],
  },
  // Audit P2-1: before the first complete read, unread products have only the ceiling — said, and the impact is still being computed.
  {
    path: "margin?plan=pro&state=running",
    expect: [/Právě načítáme nákupní ceny: 340 z 1\u00a0240/, /Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen strop 40\u00a0%/, /Počítáme, kde ochrana zasáhne/],
  },
  { path: "margin?state=running", expect: [/Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen strop 40\u00a0%/] },
  {
    path: "margin?state=failed-first",
    expect: [/Dokud nenačteme nákupní ceny, platí u nenačtených produktů jen strop 40\u00a0%/, /Nákupní ceny se nepodařilo načíst ze Shopify/, /Technický detail: costs\.read: Throttled/],
  },
  { path: "margin?state=reauth", expect: [/Otevři appku, ať můžeme pokračovat na pozadí/] },
  // P1-1: a Pro collection over the 10 000-product limit says so at its row.
  { path: "margin?plan=pro&state=too-large", expect: [/Kolekce má víc než 10\u00a0000 produktů, tolik Won při jedné synchronizaci nenačte\. Proto platí přísnější hodnota pro celý obchod\./] },
  // P2-2: counted per rule; the rows are only the largest losses.
  { path: "margin?plan=pro&state=many", expect: [/Sníží se u 20 variant/, /Ukazujeme 10 z 20 s největším rozdílem/, /U 20 variant by sleva šla pod hranici/] },
  { path: "margin?plan=pro&state=impact-updating", expect: [/Ochrana sníží 5 slev · přepočítává se/, /Čísla se na pozadí přepočítávají/] },
  { path: "margin?plan=pro&state=impact-computing", expect: [/Počítáme, kde ochrana zasáhne/, /Počítá se na pozadí z nastavení slev a nákupních cen/] },
  { path: "margin?plan=pro&state=zero", expect: [/Nákupní cenu mají všechny produkty/] },
  { path: "margin?state=off", expect: [/Ochrana marže je vypnutá/, /Vypnuto/, /Načteme je ze Shopify, až ochranu zapneš a uložíš/] },
  { path: "margin?state=gate", expect: [/Pro funkce není aktivní/, /Ochrana marže pro jednotlivé kolekce je funkce Pro/, /Min\. marže 30\u00a0% · bez nákupní ceny sleva nejvýš 10\u00a0%/] },
  { path: "margin?state=failed&result=refreshed", expect: [/Načtení selhalo 28\. 9\. 2026 06:10/, /Načítání nákupních cen běží/] },
  { path: "margin?plan=pro&rule=dev-f2-collection", expect: [/Jen sleva „Podzimní kolekce 20 %“/, /Zobrazit všechny zásahy/, /Ochrana sníží 1 slevu/, /Sníží se u 4 variant/] },
  { path: "margin?result=invalid", expect: [/Zadej 0 až 95 %/] },
  // The save's fixes worded like the server words them (issue-copy), never the core's English message.
  { path: "margin?result=fixes", expect: [/Uloženo\. Pár věcí jsme upravili/, /Procenta marže mají jedno desetinné místo\. 12,55\u00a0% se zaokrouhlilo na 12,6\u00a0%/] },
  { path: "margin?result=fixes&locale=en", expect: [/Margin percents have one decimal\. 12\.55% was rounded to 12\.6%/] },
  { path: "overview?state=margin", expect: [/Hlídá jen slevy ve Won\. Slevy mimo Won \(níž\) nevidí\./, /id="native"/, /Ochrana marže/, /8 produktů nemá nákupní cenu\. Sleva na ně je nejvýš 40\u00a0%/, /Naposledy načteno 26\. 9\. 2026 06:10/, /Obnovit nákupní ceny/, /Upravit ochranu/] },
  { path: "overview?state=margin-off", expect: [/Ochrana marže je vypnutá/, /Nastavit ochranu marže/, /Sleva ve Won nikdy nesrazí cenu pod hranici/] },
  { path: "overview?state=margin-running", expect: [/Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\), platí u nenačtených produktů jen strop 40\u00a0%/, /Právě načítáme nákupní ceny: 340 z 1\u00a0240/] },
  { path: "overview?state=margin-reauth", expect: [/Otevři appku, ať můžeme pokračovat na pozadí/] },
  { path: "overview?state=margin-too-large", expect: [/Kolekce „Podzimní kolekce“ s vlastním nastavením marže má víc než 10\u00a0000 produktů/, /Proto platí přísnější hodnota pro celý obchod/] },
  { path: "rule-editor?rule=dev-f2-collection&margin=1&plan=pro", expect: [/Na 4 variantách se sleva sníží na hranici marže/, /\/app\/margin\?rule=dev-f2-collection#impact/] },
  // Free: no number (přehled zásahů is Pro), the link goes to its Pro preview.
  { path: "rule-editor?rule=dev-f2-collection&margin=1", expect: [/Ochrana marže tuhle slevu u některých produktů sníží\./, /Přehled zásahů v Pro/, /href="\/app\/margin#impact"/] },
  { path: "rule-editor?rule=dev-f2-collection&margin=computing&plan=pro", expect: [/Dopad ochrany marže na tuhle slevu se právě počítá\./] },
  {
    path: "try-cart?state=margin",
    expect: [/Hranice marže/, /kurzem odhadnutým z cen v trhu/, /pokladna použije aktuální kurz Shopify/, /1 položka nemá nákupní cenu/, /cena neklesne pod nákupní cenu s minimální marží 30/],
  },
  { path: "margin?plan=pro&locale=en", expect: [/Margin protection/, /tax included for tax-inclusive prices/, /Refresh cost prices/, /Where protection steps in/] },
  { path: "plan", expect: [/Tarif/, /Pro · 29 USD/, /nejvýš 20 aktivních s kódem/, /nejvýš 25 slevových funkcí/] },
  { path: "settings", expect: [/Trhy a měny/, /CZK \(Česko\)/] },
  // MVP 3: Množstevní slevy — the set, the honest sentences, the faithful preview (the storefront's K8 markup + texts +
  // money format), the table on the product page, the storefront config, the Pro sets (K1) and what Free does not run.
  {
    path: "tiers",
    expect: [
      /Sada pro celý obchod/,
      /Od 3 ks −10\u00a0%, od 5 ks −15\u00a0%, od 10 ks −20\u00a0%/,
      /Pro funkce není aktivní/,
      /Produkty v ní ve Free nedostanou žádnou množstevní slevu/,
      /Varianty produktu dohromady/,
      /Ve Free se kusy počítají po produktech/,
      /S jinou slevou na stejný produkt se nesčítá: platí ta, která dá zákazníkovi víc\./,
      /Teď se to týká 1 slevy na produkty\./,
      /href="\/app\/settings#combination"/,
      /Ochrana marže je zapnutá: u produktů s nízkou marží může úroveň vyjít nižší/,
      /Zboží ve výprodeji a dárky úroveň nedostanou/,
      /class="won-tiers won-tiers--highlight"/,
      /data-won-discounts-tiers=""/,
      /data-count-mode="product"/,
      /data-won-discounts-tier-row="" data-min="3" data-active="true"/,
      /data-won-discounts-live-price="" data-unit-cents="71100"/,
      /711,00 Kč\/ks/,
      /3\u00a0ks za 2\.133,00 Kč \(711,00 Kč\/ks\)/,
      /Ještě 2\u00a0ks a zaplatíte 671,50 Kč\/ks\./,
      /Barvy a písmo z tématu Horizon/,
      /Náhled nepočítá s ochranou marže/,
      /Tabulka je na stránce produktu v tématu Horizon/,
      /Web má aktuální nastavení \(propsáno 28\. 9\. 2026 16:20\)/,
      /Zobrazit na mém webu/,
      /Sady pro vybrané produkty a kolekce/,
      /Produkt ve vlastní sadě dostane jen ji, ne sadu pro celý obchod/,
      /Uloženo, ve Free neplatí/,
    ],
  },
  {
    path: "tiers?plan=pro",
    expect: [/Vybrat produkty/, /Vybrat kolekce/, /Mikina Won/, /Podzimní kolekce/, /Celý košík/, /V EUR \(Slovensko\) se úroveň od 6 ks nenabízí/, /Od 2 ks −30\u00a0Kč \/ 1,20\u00a0€ za kus/],
  },
  {
    path: "tiers?state=empty",
    expect: [
      /Bez množstevních slev/,
      /Vypnuto/,
      /Přidej první úroveň/,
      /Ukázka: zatím nemáš žádnou úroveň/,
      /Tabulka zatím na stránce produktu není/,
      /Přidat tabulku na stránku produktu/,
      /addAppBlockId=dev-api-key\/quantity_tiers&amp;target=mainSection/,
      /Na web se zatím nic nepropsalo/,
      /Kolekce Doplňky/,
    ],
  },
  { path: "tiers?state=failed", expect: [/Propsání na web selhalo 28\. 9\. 2026 16:20/, /metafieldsSet: Throttled/] },
  { path: "tiers?state=dawn", expect: [/Barvy a písmo z tématu Dawn/, /--won-tiers-accent:#c0392b/, /--inputs-radius:0px/] },
  { path: "tiers?state=no-scope", expect: [/Bez přístupu k tématu nevidíme/] },
  { path: "tiers?result=invalid", expect: [/Sleva tady musí být aspoň taková jako od 3 ks/, /Úroveň od 5 ks už v sadě je/] },
  {
    path: "tiers?locale=en",
    expect: [/Set for the whole store/, /From 3 items −10%, from 5 items −15%, from 10 items −20%/, /Quantity discount/, /711,00 Kč each/, /Add table to the product page|View on my site/],
  },
  {
    path: "appearance",
    expect: [
      /Vzhled na webu: Zvýrazněná úroveň/,
      /name="preset"/,
      /value="tiles"/,
      /won-tiers--default/,
      /won-tiers--highlight/,
      /won-tiers--chips/,
      /won-tiers--tiles/,
      /Kompaktní štítky v řádku/,
      /Uloženo/,
      /Vlastní vzhled bude v tarifu Pro v další verzi/,
      /Vložení aplikace do tématu/,
    ],
  },
  { path: "appearance?state=empty", expect: [/Ukázka: zatím nemáš žádnou úroveň/, /Přidat tabulku na stránku produktu/, /Zapnout v editoru tématu/] },
  {
    path: "settings",
    expect: [
      /Kombinování slev/,
      /Sčítá se: produkty s objednávkou, produkty s dopravou a objednávka s dopravou/,
      /Dvě slevy na stejný produkt se nesčítají nikdy/,
      /Zboží ve výprodeji další slevy nedostane/,
      /Výprodej přijde v další verzi/,
      /Obě se sčítají\. Sleva z objednávky se počítá z ceny po slevách na produkty/,
      /href="\/app\/try-cart"/,
    ],
  },
  { path: "settings?state=changed", expect: [/Sčítá se: objednávka s dopravou/, /Platí buď slevy na produkty, nebo sleva z objednávky/, /Když má košík slevu na produkt \(i množstevní\), sleva na dopravu se neuplatní/] },
  { path: "settings?locale=en", expect: [/Combining discounts/, /Adds up: products with order, products with shipping and order with shipping/] },
  { path: "overview?state=tiers", expect: [/Množstevní slevy/, /Od 3 ks −10\u00a0%, od 5 ks −15\u00a0%, od 10 ks −20\u00a0%/, /Tabulka zatím na stránce produktu není/, /Přidat tabulku na stránku produktu/, /Upravit úrovně/] },
  { path: "overview?state=tiers-empty", expect: [/Zatím žádná úroveň\. Kup víc, zaplať míň/, /Nastavit množstevní slevy/] },
  {
    path: "try-cart?state=tiers",
    expect: [/Čepice/, /Množstevní sleva \(od 3 ks −10\u00a0%\) ušetří 156\u00a0Kč/, /Přidej 1 ks a dostaneš −15\u00a0%/, />Množstevní sleva</],
  },
  { path: "try-cart?state=tiers&plan=pro", expect: [/Množstevní sleva \(od 2 ks −30\u00a0Kč za kus\) ušetří 60\u00a0Kč/] },
  { path: "rule-editor?rule=dev-f2-collection&tiers=1", expect: [/Na produktech s množstevní slevou platí výhodnější z nich: tahle sleva, nebo úroveň\. Nesčítají se\./, /href="\/app\/tiers"/] },
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
    assert.doesNotMatch(text, />[^<]*\b(freeShipping|percentage|not_wired|draft_only|not_synced|max_percent|rateEstimated|linesWithoutCost)\b[^<]*</, `${screen.path}: raw enum in text`);
    // Copy must not promise what does not exist: no "unlimited", no segments "after connecting".
    assert.doesNotMatch(text, /neomezeně|unlimited|po napojení/i, `${screen.path}: overclaiming copy`);
  });
}

test("an unknown harness screen is a 404; tiers and appearance are built modules now, not 'coming soon'", async () => {
  const { status } = await render("does-not-exist");
  assert.equal(status, 404);
  assert.equal((await render("coming-soon?module=tiers")).status, 404);
  assert.equal((await render("coming-soon?module=appearance")).status, 404);
});

test("the tier note is only for a product rule (an order rule does not compete with a tier)", async () => {
  const { html } = await render("rule-editor?rule=dev-fixture-1&tiers=1");
  assert.doesNotMatch(html, /Na produktech s množstevní slevou/);
});

test("MVP 3 screens: one save for the whole form, last on the page", async () => {
  for (const path of ["tiers", "tiers?plan=pro", "appearance", "settings"]) {
    const { html } = await render(path);
    const submit = html.lastIndexOf('type="submit"');
    assert.ok(submit > 0, `${path}: a submit button`);
    assert.equal(html.indexOf('type="submit"'), submit, `${path}: exactly one submit button`);
    assert.match(html, /data-save-bar/, `${path}: the App Bridge save bar`);
  }
});

test("the preview is the storefront's markup (K8) with the storefront CSS confined to it — never a style for the admin", async () => {
  const { html } = await render("tiers");
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.match(style, /^\.won-tiers-preview \{/, "every storefront rule nested under the preview scope");
  assert.match(style, /\.won-tiers--chips \.won-tiers__row/);
  // The markers the storefront script reads, in the K8 order.
  const block = html.slice(html.indexOf('class="won-tiers won-tiers--'));
  for (const marker of ["won-tiers__heading", "won-tiers__list", "won-tiers__row", "won-tiers__qty", "won-tiers__save", "won-tiers__unit", "won-tiers__live", "won-tiers__next"]) {
    assert.ok(block.includes(marker), marker);
  }
  assert.match(block, /<ol class="won-tiers__list" role="list">/);
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

test("Ochrana marže: one save for the whole form, last on the page — after the read-only Přehled zásahů", async () => {
  for (const path of ["margin", "margin?plan=pro"]) {
    const { html } = await render(path);
    const submit = html.lastIndexOf('type="submit"');
    assert.equal(html.indexOf('type="submit"'), submit, `${path}: exactly one submit button`);
    for (const section of ["Ochrana marže", "Nákupní ceny", "Nastavení podle kolekcí", "Přehled zásahů"]) {
      assert.ok(html.indexOf(section) < submit, `${path}: "${section}" comes before Uložit`);
    }
  }
});
