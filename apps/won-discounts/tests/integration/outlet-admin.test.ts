import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createElement } from "react";

import type { ShopPlan } from "@won/core/discounts/plan-gate";

import { loadConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { loadOutletOverview, loadOutletScreen, outletAction } from "../../app/lib/integration/outlet-admin.server.ts";
import { OUTLET_FIELD as F, OUTLET_INTENT } from "../../app/components/model/outlet.ts";
import { OutletScreen } from "../../app/components/screens/OutletScreen.tsx";
import { devOutletScreen } from "../../app/lib/dev-harness.server.ts";
import { WON_AMBER } from "../../app/components/shell/tokens.ts";
import { FakeShopify } from "../lib/sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { APP_KEY, formOf, quiet, realSync, renderPage, text } from "./helpers.ts";

// MVP 5 contract O10: the Výprodej admin module — the forms parsed on the server (SEC-1), Pro checked there
// (BILL-1, A6), field errors on the form's own fields, the module settings saved like every admin change.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("outlet-admin");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `outlet-admin-${seq}.myshopify.com`;
});

const LIST = "gid://shopify/PriceList/9";

function setup(plan: ShopPlan) {
  const fake = new FakeShopify();
  const product = fake.addProduct(50, 1);
  const variant = product.variantIds[0]!;
  fake.variants.get(variant)!.price = "20.00";
  fake.priceLists.set(LIST, { id: LIST, name: "cesko-list", currency: "CZK", catalogTitle: "Česko", fixed: new Map() });
  const ctx: ShopCtx = {
    shop,
    db: db.prisma,
    client: fake,
    locale: "cs",
    apiKey: APP_KEY,
    logger: quiet,
    now: () => new Date("2026-10-02T10:00:00Z"),
    createSync: ((client, prisma) => ({ ...realSync(client, prisma), plan: async () => plan })) as ShopCtx["createSync"],
  };
  return { fake, ctx, product, variant };
}

const startForm = (variant: string, product: string, extra: [string, string][] = []) =>
  formOf([
    [F.intent, OUTLET_INTENT.start],
    [F.variant, variant],
    [F.product, product],
    [F.quota, "4"],
    [F.percent, "25"],
    [F.endsOn, "2026-10-10"],
    [F.priceList, LIST],
    ...extra,
  ]);

test("start from the form (Pro): the sale runs, the end day is the shop's midnight, a list without a fixed price is reported", async () => {
  const { fake, ctx, product, variant } = setup("pro");
  const r = await outletAction(ctx, startForm(variant, product.id));
  assert.deepEqual(r, { ok: true, kind: "started", skippedLists: 1 });
  assert.equal(fake.variants.get(variant)!.price, "15.00");
  const run = (await db.prisma.outletRun.findFirst({ where: { shop } }))!;
  assert.equal(run.status, "active");
  assert.equal(run.endsAt?.toISOString(), "2026-10-10T00:00:00.000Z", "no shop zone known: UTC midnight");
});

test("field errors land on the form's own fields; Free is refused before anything is read or written", async () => {
  const pro = setup("pro");
  const bad = await outletAction(pro.ctx, formOf([[F.intent, OUTLET_INTENT.start], [F.quota, "0"], [F.percent, "95"], [F.endsOn, "2020-01-01"]]));
  assert.ok(!bad.ok && bad.reason === "invalid");
  assert.deepEqual(
    (bad as { errors: { field: string }[] }).errors.map((e) => e.field).sort(),
    [F.endsOn, F.percent, F.quota, F.variant].sort(),
  );
  const free = setup("free");
  const calls = free.fake.calls.length;
  const refused = await outletAction(free.ctx, startForm(free.variant, free.product.id));
  assert.ok(!refused.ok && refused.reason === "invalid");
  assert.equal((refused as { errors: { key: string }[] }).errors[0]!.key, "outlet.error.pro");
  assert.equal(free.fake.calls.length, calls, "nothing read or written on Free");
  assert.equal(await db.prisma.outletRun.count({ where: { shop } }), 0);
});

test("end by hand, then the screen: ended with its reason, the history worded, the ledger; Přehled card counts", async () => {
  const { fake, ctx, product, variant } = setup("pro");
  await outletAction(ctx, startForm(variant, product.id));
  const run = (await db.prisma.outletRun.findFirst({ where: { shop } }))!;
  const before = await loadOutletScreen(ctx);
  assert.equal(before.running.length, 1);
  assert.equal(before.running[0]!.left, 4);
  assert.deepEqual(before.priceLists, [], "only lists with fixed prices are offered");
  assert.equal((await loadOutletOverview(ctx)).running, 1);

  const ended = await outletAction(ctx, formOf([[F.intent, OUTLET_INTENT.end], [F.run, run.id]]));
  assert.deepEqual(ended, { ok: true, kind: "ended" });
  assert.equal(fake.variants.get(variant)!.price, "20.00");
  const after = await loadOutletScreen(ctx);
  assert.equal(after.running.length, 0);
  assert.equal(after.ended[0]!.endReason, "manual");
  assert.ok(after.ended[0]!.history.some((h) => /Ukončen ručně/.test(h.text)));
  assert.ok(after.ended[0]!.history.some((h) => /Spuštěn: −25 %/.test(h.text)));
});

test("another shop's sale is never ended from this session (SEC-2)", async () => {
  const a = setup("pro");
  await outletAction(a.ctx, startForm(a.variant, a.product.id));
  const run = (await db.prisma.outletRun.findFirst({ where: { shop } }))!;
  seq += 1;
  shop = `outlet-admin-${seq}.myshopify.com`;
  const b = setup("pro");
  const r = await outletAction(b.ctx, formOf([[F.intent, OUTLET_INTENT.end], [F.run, run.id]]));
  assert.ok(!r.ok);
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: run.id } }))!.status, "active");
});

test("module settings: display and return-after-end saved into modules.outlet; an unknown value keeps the stored one", async () => {
  const { ctx } = setup("free");
  const r = await outletAction(ctx, formOf([[F.intent, OUTLET_INTENT.settings], [F.display, "strike_badge_left"], [F.reopen, "nonsense"]]));
  assert.ok(r.ok, JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config.modules.outlet;
  assert.equal(stored.display, "strike_badge_left");
  assert.equal(stored.reopenOnReturnAfterEnd, "ask");
});

test("an unknown intent is a bad request", async () => {
  const { ctx } = setup("pro");
  assert.deepEqual(await outletAction(ctx, formOf([[F.intent, "drop-table"]])), { ok: false, reason: "bad_request" });
});

test("screen: Free shows the form locked in the amber Pro frame (§16b), never red; Pro shows the start button enabled", async () => {
  const free = await renderPage(createElement(OutletScreen, devOutletScreen({ plan: "free", state: null, locale: "cs" })));
  assert.ok(free.includes(WON_AMBER), "amber Pro frame");
  assert.match(text(free), /Výprodej je v tarifu Pro/);
  assert.match(free, /<s-button[^>]*type="submit"[^>]*variant="primary"[^>]*disabled/, "start disabled on Free");
  const pro = text((await renderPage(createElement(OutletScreen, devOutletScreen({ plan: "pro", state: null, locale: "cs" })))).replace(/<[^>]+>/g, " "));
  assert.match(pro, /Spustit výprodej/);
  assert.match(pro, /Prodáno o 1 ks víc než kvóta/);
  assert.match(pro, /Po konci se vrátilo 2 ks/);
  assert.doesNotMatch(pro, /gid:\/\/shopify/, "never an id on screen (§4c)");
});
