// Uzavření před první review (12 Oct 2026): one test per finding of docs/won-discounts/matice-pred-review.md, so a
// finding that was repaired cannot come back on another screen. The screens are rendered in the dev harness.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { placementStatus } from "../../app/components/model/module-status.ts";

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
/** One view tile of a module page: its button, up to the next one. */
function tile(html: string, id: string): string {
  const at = html.indexOf(`data-won-view-tile="${id}"`);
  assert.ok(at >= 0, `no tile ${id}`);
  return html.slice(at, html.indexOf("</button>", at));
}
/** The label of a tile: "active" | "attention" | "inactive" | null (no label). */
const stateOf = (html: string) => html.match(/data-won-state="([a-z]+)"/)?.[1] ?? null;

// --- Nálezy 6, 9, 10, 12: a tile about a place on the web tells the truth -------------------------------------

test("placementStatus: nothing to show = no label; a wrong spot is never green; the rows' red places are counted", () => {
  assert.deepEqual(placementStatus("in_theme"), { state: "active", issues: 0 });
  assert.deepEqual(placementStatus("missing"), { state: "attention", issues: 1 });
  assert.equal(placementStatus("unknown"), undefined);
  // Nález 6: a shop with no level / no step has nothing to resolve on the web, whatever the theme holds.
  assert.equal(placementStatus("missing", { runs: false }), undefined);
  assert.equal(placementStatus("in_theme", { runs: false }), undefined);
  assert.deepEqual(placementStatus("missing", { runs: true }), { state: "attention", issues: 1 });
  // Nálezy 10 a 12: in the theme where nobody sees it.
  assert.deepEqual(placementStatus("in_theme", { misplaced: true }), { state: "attention", issues: 1 });
  // Nález 9: the module runs (green stays, §19a) and the red rows under the tile are counted beside it.
  assert.deepEqual(placementStatus("in_theme", { alsoMissing: 2 }), { state: "active", issues: 2 });
  assert.deepEqual(placementStatus("missing", { alsoMissing: 1 }), { state: "attention", issues: 2 });
});

test("nález 6: an empty shop has no red tile on Množstevní slevy and Milníky", async () => {
  const tiers = tile(await render("tiers?state=empty"), "table");
  assert.equal(stateOf(tiers), null, "no level yet: the table's tile has no label");
  assert.ok(!text(tiers).includes("k vyřešení"), text(tiers));
  const rewards = tile(await render("rewards?state=empty"), "web");
  assert.equal(stateOf(rewards), null, "no step yet: the tile of the web has no label");
  assert.ok(!text(rewards).includes("k vyřešení"), text(rewards));
  // With levels the tile is labelled again: green with the table in the template, red without it.
  assert.equal(stateOf(tile(await render("tiers"), "table")), "active");
  assert.equal(stateOf(tile(await render("tiers?state=block-off"), "table")), "attention");
});

test("nález 9: Milníky na webu — the tile counts the place whose row is red", async () => {
  const html = await render("rewards");
  const web = tile(html, "web");
  assert.equal(stateOf(web), "active", "the ladder runs in the cart: the green stays");
  const red = html.slice(html.indexOf('data-won-view-panel="web"')).split('data-won-placement="missing"').length - 1;
  assert.ok(red > 0, "the fixture has a place that is missing");
  assert.ok(text(web).includes(red === 1 ? "1 věc k vyřešení" : `${red} věci k vyřešení`), text(web));
});

test("nález 10: Výprodej — the tile of the badge has the label every other tile has", async () => {
  const web = tile(await render("outlet?plan=pro"), "web");
  assert.equal(stateOf(web), "attention", "a sale runs and its badge is not in the template");
  assert.ok(text(web).includes("1 věc k vyřešení"), text(web));
  assert.equal(stateOf(tile(await render("outlet?plan=pro&state=empty"), "web")), null, "no sale runs: nothing to resolve");
});

test("nález 12: Kampaň na webu — a banner in the wrong spot is not green", async () => {
  const html = await render("campaigns?plan=pro");
  const places = tile(html, "places");
  assert.ok(html.includes('data-won-placement="misplaced"'), "the fixture's only banner is in the wrong spot");
  assert.equal(stateOf(places), "attention");
  assert.ok(text(places).includes("1 místo je na webu · 1 na špatném místě"), text(places));
});

// --- Nález 14: a collection's or a product's own limits say that they run -------------------------------------

test("nález 14: Ochrana marže — the tile of stored own limits is labelled, the one with none is not", async () => {
  const html = await render("margin?plan=pro");
  assert.equal(stateOf(tile(html, "collections")), "active", "two collections have their own limits and the guard runs");
  assert.equal(stateOf(tile(html, "products")), null, "no product has its own limits");
  // The guard is off, or the plan does not run them: no green.
  assert.equal(stateOf(tile(await render("margin?state=off&plan=pro"), "collections")), null);
  assert.equal(stateOf(tile(await render("margin"), "collections")), null);
});

// --- Nález 1: the setup guide never says "Vypnuto" about a step that is merely not done ------------------------

test("nález 1: the guide's steps 4 and 5 have no label until they are done; the switch of step 3 keeps its own", async () => {
  const sections = (html: string) => html.split(/(?=<section\b)/).filter((s) => /^<section\b/.test(s));
  const open = sections(await render("onboarding?step=4&embed=on"));
  const first = open.find((s) => text(s).includes("4. První sleva"))!;
  const done = open.find((s) => text(s).includes("5. Hotovo"))!;
  assert.ok(!text(first).includes("Vypnuto") && !text(done).includes("Vypnuto"), "a step that is not done is not 'off'");
  const finished = sections(await render("onboarding?step=5&embed=on&rules=1"));
  assert.ok(text(finished.find((s) => text(s).includes("5. Hotovo"))!).includes("Aktivní"));
  const embedOff = sections(await render("onboarding?step=3")).find((s) => text(s).includes("3. Zapnout na webu"))!;
  assert.ok(text(embedOff).includes("Vypnuto"), "the storefront switch really is off");
});

// --- A broken letter in the middle of a word ("vět�ší"): a NUL byte in the streamed page ---------------------

test("the document stream never carries a NUL byte: a chunk with one comes out without it, the letters intact", async () => {
  const { withoutNulBytes } = await import("@won/app-kit/entry.server");
  const out: Buffer[] = [];
  const stream = withoutNulBytes();
  stream.on("data", (chunk: Buffer) => out.push(chunk));
  const done = new Promise((resolve) => stream.on("end", resolve));
  stream.write(Buffer.from("nepustí vět", "utf8"));
  stream.write(Buffer.concat([Buffer.from([0]), Buffer.from("ší slevu, vr", "utf8"), Buffer.from([0]), Buffer.from("áceno", "utf8")]));
  stream.end(Buffer.from(" 0 ks", "utf8"));
  await done;
  assert.equal(Buffer.concat(out).toString("utf8"), "nepustí větší slevu, vráceno 0 ks");
});

// --- Nález 8: on Free the custom look is one sentence, not a locked form --------------------------------------

test("nález 8: Free sees what Pro gives in one sentence — no locked fields, no brief for an AI; Pro has the form", async () => {
  for (const path of ["tiers", "rewards", "tiers?state=empty"]) {
    const free = await render(path);
    assert.ok(free.includes("data-won-look-custom"), `${path}: the custom look is still offered`);
    assert.ok(!free.includes('name="look.css"') && !text(free).includes("Zadání pro AI"), `${path}: the locked form is not drawn`);
    assert.ok(text(free).includes("Zobrazit tarif Pro"), `${path}: the link to the plan`);
  }
  const pro = await render("tiers?plan=pro");
  assert.ok(pro.includes('name="look.css"') && text(pro).includes("Zadání pro AI"));
});

// --- Nález 7: the page's Save is one shared piece, shown only where the page's form has something to save ------

test("nález 7: PageSave is hidden, never unmounted, and every page with views uses it", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { PageSave } = await import("../../app/components/shell/PageSave.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const draw = (shown: boolean) => renderToString(createElement(LocaleProvider, { locale: "cs", children: createElement(PageSave, { shown }) }));
  assert.match(draw(true), /data-won-page-save="shown" style="display:block"><s-button type="submit"/);
  assert.match(draw(false), /data-won-page-save="hidden" style="display:none"><s-button type="submit"/);
  // The pages whose form spans several views draw their Save through it (the view is picked in the browser:
  // tests/e2e-preview/admin.pred-review.spec.ts clicks through them).
  for (const path of ["tiers", "rewards", "margin"]) assert.equal((await render(path)).split("data-won-page-save=").length - 1, 1, path);
});

// --- Nálezy 2, 16, 17: one card for every warning — what happened, what to do, the button ----------------------

/** The pieces of a page marked with `marker`, one piece of HTML each (up to the next one). */
const pieces = (html: string, marker: string) => html.split(new RegExp(`(?=<div data-won-finding="" ${marker}=)`)).slice(1);

test("nález 2: Přehled — every thing to resolve says what happened, what to do, and has the primary button to the field", async () => {
  const html = await render("overview?state=modules&plan=pro");
  const findings = pieces(html, "data-won-overview-finding");
  // Two at most are drawn as cards (decided 12 Oct 2026, the test "C14" below); the fixture has five.
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    const words = text(finding);
    assert.ok(words.includes("Co se stalo") && words.includes("Co s tím"), words.slice(0, 200));
    assert.match(finding, /<s-button href="\/app\/[^"]+" variant="primary">/);
  }
  assert.ok(!text(html).includes("Pozor ·"), "the old one-line rows are gone");
});

test("nález 17: the cart's result — each difference from checkout is a finding with its 'Co s tím'; a retry where it helps", async () => {
  const html = await render("try-cart?state=warnings&plan=pro");
  const findings = pieces(html, "data-won-try-cart-warning");
  assert.deepEqual(findings.map((f) => f.match(/data-won-try-cart-warning="([^"]+)"/)![1]), ["tryCart.warning.tie", "tryCart.warning.targeting", "tryCart.warning.notApplied"]);
  for (const finding of findings) assert.ok(text(finding).includes("Co se stalo") && text(finding).includes("Co s tím"));
  assert.ok(text(findings[0]!).includes("Nemusíte dělat nic"), "a rounding difference needs no action, and says so");
  assert.ok(!findings[0]!.includes("<s-button") && findings[2]!.includes("<s-button"), "only the write that did not go through has the retry");
  assert.ok(!html.includes("<s-banner tone=\"warning\" heading=\"Pokladna se může lišit\""), "not a banner with a list any more");
});

test("nález 16: Časté kombinace — a finding shared by several combinations is shown once, with their names", async () => {
  const { distinctFindings } = await import("../../app/components/try-cart/CombinationsSection.tsx");
  const finding = (kind: string, href: string, textOf: string) => ({ kind, href, text: textOf, label: "Otevřít" });
  const scenario = (title: string, findings: ReturnType<typeof finding>[], market?: string) => ({ title, market, findings }) as never;
  const margin = finding("margin", "/app/tiers#global", "Ochrana marže slevu snížila.");
  const out = distinctFindings([scenario("A", [margin]), scenario("B", [margin, finding("max", "/app/settings", "Překročeno.")]), scenario("C", [finding("margin", "/app/discounts/x", "Ochrana marže slevu snížila.")], "Slovensko")]);
  assert.deepEqual(out.map((o) => [o.finding.kind, o.finding.href, o.titles]), [
    ["margin", "/app/tiers#global", ["A", "B"]],
    ["max", "/app/settings", ["B"]],
    ["margin", "/app/discounts/x", ["C · Slovensko"]],
  ]);
  const html = await render("try-cart?combos=on&plan=pro");
  const warnings = html.split('data-won-combo-status="warning"').length - 1;
  const cards = html.split("data-won-combo-finding=").length - 1;
  assert.ok(warnings > 1 && cards > 0 && cards < warnings * 2, `${cards} cards for ${warnings} combinations with a warning`);
  assert.ok(text(html).includes("Košíky, ve kterých se to ukázalo:"), "each with its cart (12 Oct 2026, bod 4)");
});

// --- Nálezy 3, 4, 11, 13: cards and steps ---------------------------------------------------------------------

test("nález 3: Slevy a kódy — 'Upravit' is a button and the ready-made discounts are not behind a disclosure", async () => {
  const html = await render("discounts?sync=ok");
  assert.ok((html.match(/<s-button variant="secondary" href="\/app\/discounts\/[^"]+">Upravit/g) ?? []).length >= 6, "every row has its button");
  assert.ok(!/<s-button variant="tertiary" href="\/app\/discounts\//.test(html));
  const recipes = html.slice(html.indexOf('id="recipes"'));
  assert.ok(html.includes('id="recipes"') && !/^[^>]*>[\s\S]{0,400}aria-expanded/.test(recipes), "the section of ready-made discounts has no collapse button");
  assert.ok(text(recipes).includes("Uvítací kód"), "its content is drawn");
});

test("nález 4: the rule editor's four sections are numbered steps; the optional Pro section is not", async () => {
  for (const path of ["rule-editor", "rule-editor?rule=new&recipe=code", "rule-editor?plan=pro"]) {
    const html = await render(path);
    assert.deepEqual([...html.matchAll(/data-won-section-step="(\d)"[^>]*>([^<]+)</g)].map((m) => m[2]), ["Krok 1 / 4", "Krok 2 / 4", "Krok 3 / 4", "Krok 4 / 4"], path);
  }
});

test("nález 11: a campaign is a card like a running sale — the name, its state and its buttons in the header strip", async () => {
  const html = await render("campaigns?plan=pro");
  const cards = html.split(/(?=<div data-won-campaign=")/).slice(1);
  assert.deepEqual(cards.map((c) => c.match(/data-won-campaign="([a-z]+)"/)![1]), ["running", "scheduled", "ended", "killed"]);
  for (const card of cards) assert.ok(card.includes('data-won-subcard=""'), "drawn by the shared SubCard");
  const header = (card: string) => text(card.slice(0, card.indexOf("</div></div>") + 1));
  assert.match(text(cards[0]!), /^\s*Víkend −20.% Aktivní/);
  assert.ok(text(cards[0]!).indexOf("Ukončit hned") < text(cards[0]!).indexOf("26. 9. 2026"), "the buttons are in the header, above the body");
  assert.ok(header(cards[1]!).includes("Naplánovaná"));
  // Free: the same cards, without editing.
  assert.equal((await render("campaigns")).split('data-won-campaign="').length - 1, 4);
});

test("nález 13: the last step of a new campaign says where the customer sees it, with the way there; the intro is said once", async () => {
  const html = await render("campaigns?plan=pro&state=empty");
  const web = html.slice(html.indexOf("data-won-campaign-web="));
  assert.match(web, /^data-won-campaign-web="(seen|missing)"/);
  assert.ok(text(web.slice(0, 1500)).includes("Otevřít Kampaň na webu"));
  assert.ok(html.indexOf("data-won-campaign-web=") > html.indexOf('data-won-step="3"'), "it stands in the last step, above the button");
  assert.ok(!text(html).includes("Kampaň na čas změní slevy"), "the second copy of the intro is gone");
  assert.ok(text(html).includes("Co je kampaň."));
});

// --- Nálezy 5, 15, 18, 19: single places ----------------------------------------------------------------------

test("nález 5: a batch of codes says how it is made — no grey number posing as a value, the codes come with Save", async () => {
  const html = await render("rule-editor?rule=dev-fixture-2&batch=20");
  const count = html.match(/<s-number-field name="[^"]*"[^>]*label="Kolik kódů"[^>]*>/)?.[0] ?? "";
  assert.ok(count && !count.includes("placeholder="), count);
  assert.ok(text(html).includes("Napište, kolik kódů chcete, a slevu uložte tlačítkem Uložit dole."));
});

test("nález 15: Nákupní ceny — the panel says it is an overview, and its list is not a disclosure", async () => {
  const html = await render("margin?plan=pro");
  const costs = html.slice(html.indexOf('id="costs"'), html.indexOf('data-won-view-panel="collections"'));
  assert.ok(text(costs).includes("Jen přehled") && text(costs).includes("Tady nic nezapínáte ani neukládáte."), text(costs).slice(0, 300));
  assert.ok(text(costs).includes("Produkty bez nákupní ceny") && !costs.includes("aria-expanded"), "the list is always open");
});

test("nález 18: Přehledy on Free — what Pro shows in one sentence, no invented rows", async () => {
  const words = text(await render("analytics"));
  assert.ok(words.includes("Zobrazit tarif Pro") && !words.includes("Ukázka, ne vaše čísla") && !words.includes("113 400"), "no sample table");
  assert.ok(text(await render("analytics?plan=pro")).includes("Slevy jednotlivě"));
});

test("nález 19: a block that is on the cart page is opened, never added a second time", async () => {
  const html = await render("rewards");
  const cart = html.slice(html.indexOf('data-won-ms-place="cart"'));
  const row = cart.slice(0, cart.indexOf("data-won-ms-place=", 30) > 0 ? cart.indexOf("data-won-ms-place=", 30) : 3000);
  assert.ok(row.includes('data-won-placement="in_theme"'), "the fixture's cart block is in the template");
  const href = row.match(/<s-button[^>]*href="([^"]+)"/)?.[1] ?? "";
  assert.ok(href.includes("template=cart") || href.includes("/editor"), href);
  assert.ok(!href.includes("addAppBlockId"), `the link only opens the editor: ${href}`);
});

// --- Decided after the walkthrough (12 Oct 2026): C1, C3, C8, C9, C13, C14 ------------------------------------

test("C14: Přehled draws at most two things to resolve as cards; the rest is one line with how many wait at which module", async () => {
  const html = await render("overview?state=modules&plan=pro");
  assert.equal(pieces(html, "data-won-overview-finding").length, 2);
  const more = text(html.slice(html.indexOf("data-won-overview-more"), html.indexOf("data-won-overview-more") + 1500));
  assert.match(more, /A ještě 3 věci k vyřešení:/);
  assert.match(more, /Slevy a kódy\s*\(\s*1\s*\)[\s\S]*Milníky\s*\(\s*1\s*\)[\s\S]*Množstevní slevy\s*\(\s*1\s*\)/);
  assert.match(html.slice(html.indexOf("data-won-overview-more")), /<s-link href="\/app\/discounts">/);
  // Two or fewer: no line at all.
  assert.ok(!(await render("overview?state=empty")).includes("data-won-overview-more"));
});

test("C1: Přehled promises nothing that is not collected — no 'Připravujeme', and the block is not drawn without a row", async () => {
  for (const path of ["overview?state=modules&plan=pro", "overview?state=margin&watch=1&plan=pro", "overview?state=conflict", "overview?state=empty"]) {
    const html = await render(path);
    assert.ok(!text(html).includes("Připravujeme"), path);
    if (html.includes('data-won-watch=""')) assert.ok(html.includes("data-won-watch-margin") || html.includes("data-won-watch-orders"), `${path}: the block has a row`);
  }
  assert.ok(!(await render("overview?state=conflict")).includes('data-won-watch=""'), "nothing to show: no block");
});

test("C3: the guide's step 2 — going on without the move is a visible button that says so", async () => {
  const html = await render("onboarding?step=2");
  assert.match(html, /<s-button type="submit" variant="secondary"[^>]*>Pokračovat bez přesunu/);
});

test("C8: the rule editor's Pro section is open for a Pro shop; C13: the sale's returns are saved by a primary button", async () => {
  const pro = await render("rule-editor?plan=pro");
  const section = pro.slice(pro.indexOf('id="pro"'));
  assert.match(section.slice(0, 3000), /aria-expanded="true"/);
  const outlet = await render("outlet?plan=pro");
  assert.match(outlet, /<s-button type="submit" variant="primary">Uložit<\/s-button>/);
});

test("C9: a page with one place to jump to has no side list; with more it has one", async () => {
  assert.ok(!(await render("try-cart")).includes("data-won-section-nav"), "Free: only the cart");
  assert.ok(!(await render("try-cart?state=empty&plan=pro")).includes("data-won-section-nav"), "an empty cart, no combinations");
  // 13 Oct 2026: Vyzkoušet košík has two tiles instead of the side list (the automatic check, your own cart).
  const both = await render("try-cart?state=warnings&plan=pro&combos=on");
  assert.ok(!both.includes("data-won-section-nav") && both.includes('data-won-view-tile="auto"') && both.includes('data-won-view-tile="manual"'));
});
