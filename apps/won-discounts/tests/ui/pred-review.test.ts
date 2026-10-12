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
  // With levels the tile is labelled again (the fixture's table is in the template).
  assert.equal(stateOf(tile(await render("tiers"), "table")), "active");
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
