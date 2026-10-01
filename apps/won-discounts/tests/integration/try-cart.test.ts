import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";
import { Kind, parse, type FieldNode, type SelectionSetNode } from "graphql";

import { planCart } from "@won/core/discounts/plan";

import { saveConfig } from "../../app/lib/config.server.ts";
import {
  overviewAction,
  tryCartAction,
  tryCartPage,
} from "../../app/lib/integration/pages.server.ts";
import {
  clearMarketCountryCache,
  TRY_CART_DOCUMENTS,
  TRY_CART_VARIANTS_BATCH,
} from "../../app/lib/integration/try-cart.server.ts";
import { planTryCart } from "../../app/lib/integration/try-cart-plan.ts";
import { syncIdle } from "../../app/lib/sync/sync.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { TryCartScreen } from "../../app/components/screens/TryCartScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, renderPage, testCtx, text } from "./helpers.ts";

// Vyzkoušet košík (integration step 5): real variant prices for the chosen
// market (contextual pricing by the market's country), the product refs the
// function reads (the product metafield the sync wrote — F2 item 2, never a
// fresh recompute of collection membership), the engine run on the discount
// function's own payload (the same JSON the sync writes) with checkout's own
// output mapping, explainPlan → the screen. Every input is validated on the server.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-try-cart");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `try-cart-${seq}.myshopify.com`;
  clearMarketCountryCache();
  clearSignalCache();
});

const PAGE = {
  scopes: "write_discounts,read_products,read_themes,read_markets",
};
const V_HOODIE = "gid://shopify/ProductVariant/101";
const V_HOODIE_L = "gid://shopify/ProductVariant/102";
const V_CAP = "gid://shopify/ProductVariant/201";

async function setup(): Promise<{ store: FakeStore; collection: string }> {
  const store = new FakeStore();
  store.sync.markets = [
    {
      handle: "cz",
      name: "Česko",
      status: "ACTIVE",
      currency: "CZK",
      countries: ["CZ"],
    },
    {
      handle: "sk",
      name: "Slovensko",
      status: "ACTIVE",
      currency: "EUR",
      countries: ["SK"],
    },
  ];
  const hoodie = store.sync.addProduct(1, 2);
  const cap = store.sync.addProduct(2, 1);
  const collection = store.sync.addCollection(7, [hoodie.id]);
  store.prices.set(V_HOODIE, { CZK: "1290.00", EUR: "52.00" });
  store.prices.set(V_HOODIE_L, { CZK: "1290.00", EUR: "52.00" });
  store.prices.set(V_CAP, { CZK: "390.00" });
  store.titles.set(V_HOODIE, { product: "Mikina Won", variant: "M / černá" });
  store.titles.set(V_HOODIE_L, { product: "Mikina Won", variant: "L / černá" });
  store.titles.set(V_CAP, { product: "Čepice", variant: "Default Title" });
  void cap;
  const saved = await saveConfig(db.prisma, shop, {
    markets: [
      { handle: "cz", currency: "CZK", enabled: true },
      { handle: "sk", currency: "EUR", enabled: true },
    ],
    modules: {
      codes: {
        rules: [
          {
            id: "podzim",
            enabled: true,
            name: "Podzim 10 %",
            method: "automatic",
            value: { kind: "percentage", percent: 10 },
            target: { kind: "order" },
          },
          {
            id: "vip",
            enabled: true,
            name: "VIP mikiny",
            method: "code",
            codes: ["VIP20"],
            value: { kind: "percentage", percent: 20 },
            target: { kind: "collections", ids: [collection] },
          },
          {
            id: "bf",
            enabled: true,
            name: "Černý pátek",
            method: "automatic",
            value: { kind: "fixed", amount: { CZK: 500_00, EUR: 20_00 } },
            target: { kind: "order" },
            schedule: {
              startsAt: "2026-11-27T00:00:00+01:00",
              endsAt: "2026-12-01T00:00:00+01:00",
            },
          },
        ],
      },
    },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return { store, collection };
}

const cart = (entries: [string, string][]): FormData =>
  formOf([
    ["intent", "run"],
    ["locale", "cs"],
    ["variantId", V_HOODIE],
    ["productId", "gid://shopify/Product/1"],
    ["quantity", "2"],
    ["variantId", V_CAP],
    ["productId", "gid://shopify/Product/2"],
    ["quantity", "1"],
    ...entries,
  ]);

test("CZK · Česko + VIP20: prices from Shopify for CZ, collection targeting from the product's refs, the engine's plan and sentences", async () => {
  const { store } = await setup();
  const ctx = testCtx(db.prisma, shop, store);
  assert.equal(
    (await overviewAction(ctx, formOf([["intent", "resync"]]))).ok,
    true,
    "the config (and the refs) are in Shopify",
  );
  await syncIdle(shop);
  const run = await tryCartAction(
    ctx,
    cart([
      ["currency", "CZK:cz"],
      ["codes", "vip20"],
      ["date", "2026-09-28"],
    ]),
    PAGE,
  );
  assert.equal(run.result, null, JSON.stringify(run.result));
  const plan = run.plan!;
  assert.equal(plan.currency, "CZK");
  assert.equal(plan.market, "Česko");
  const pricing = store.calls.find((c) => c.op === "WonTryCartVariants")!;
  assert.equal(pricing.variables.country, "CZ");
  assert.equal(pricing.variables.priced, true);
  assert.equal(
    pricing.variables.withCollections,
    false,
    "targeting is fresh: collections are not re-read, the refs come from the product metafield",
  );
  assert.equal(plan.warnings, undefined, "in sync, nothing to warn about");

  const hoodie = plan.lines.find((l) => l.title === "Mikina Won (M / černá)")!;
  const capLine = plan.lines.find((l) => l.title === "Čepice")!;
  assert.equal(hoodie.subtotal, 2 * 1290_00);
  assert.equal(
    hoodie.discount,
    Math.round(2 * 1290_00 * 0.2),
    "VIP20 on the collection's product",
  );
  assert.equal(capLine.discount, 0, "the cap is not in the collection");
  const t = plan.totals;
  assert.equal(t.subtotal, 2 * 1290_00 + 390_00);
  assert.equal(t.total, t.subtotal - t.productDiscount - t.orderDiscount);
  assert.ok(
    plan.explain.some((e) => e.tone === "success" && /VIP20/.test(e.text)),
    JSON.stringify(plan.explain),
  );
  assert.ok(
    plan.explain.some(
      (e) => /Černý pátek/.test(e.text) && /27\. 11\. 2026/.test(e.text),
    ),
    "the scheduled rule says when it starts",
  );

  // The screen: Shopify's titles and prices, the plan, the market.
  assert.deepEqual(
    run.lines?.map((l) => [l.title, l.variantTitle, l.unitPrice]),
    [
      ["Mikina Won", "M / černá", { CZK: 1290_00 }],
      ["Čepice", undefined, { CZK: 390_00 }],
    ],
  );
  const page = await tryCartPage(ctx, PAGE);
  const html = text(
    await renderPage(
      createElement(TryCartScreen, {
        ...page,
        lines: run.lines!,
        plan,
        result: run.result,
        currency: "CZK:cz",
        codes: "VIP20",
      }),
    ),
  );
  assert.match(html, /Ceny a země z trhu Česko/);
  assert.match(html, /Mikina Won \(M \/ černá\) × 2/);
  assert.match(html, /CZK · Česko/);
  assert.match(html, /Celkem/);
});

test("the plan is computed on the SAME payload the function reads: planCart on the synced shop metafield gives the same result", async () => {
  const { store } = await setup();
  const ctx = testCtx(db.prisma, shop, store);
  assert.equal(
    (await overviewAction(ctx, formOf([["intent", "resync"]]))).ok,
    true,
    "the config is in Shopify",
  );
  await syncIdle(shop);
  const shopConfig = JSON.parse(
    store.sync.shopMetafieldValue("function_config")!,
  );
  const hoodieRefs = store.sync.productMetafield("gid://shopify/Product/1") as {
    ruleIds: string[];
  };

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const run = await tryCartAction(
    ctx,
    cart([
      ["currency", "CZK:cz"],
      ["codes", "VIP20"],
      ["date", today],
    ]),
    PAGE,
  );
  const checkout = planCart(
    {
      currency: "CZK",
      countryCode: "CZ",
      lines: [
        {
          id: "L1",
          variantId: V_HOODIE,
          productId: "gid://shopify/Product/1",
          quantity: 2,
          unitPrice: 1290_00,
          ruleIds: hoodieRefs.ruleIds,
        },
        {
          id: "L2",
          variantId: V_CAP,
          productId: "gid://shopify/Product/2",
          quantity: 1,
          unitPrice: 390_00,
          ruleIds: [],
        },
      ],
      enteredCodes: ["VIP20"],
      campaign: { id: null, active: false, varsVersion: null },
      today,
    },
    shopConfig,
  );
  assert.deepEqual(run.plan?.totals, checkout.totals);
  assert.deepEqual(
    run.plan?.lines.map((l) => [l.lineId, l.discount]),
    checkout.lines.map((l) => [l.lineId, l.product?.amount ?? 0]),
  );
});

test("the chosen day decides the schedule (shop days): Černý pátek applies on 28. 11. 2026", async () => {
  const { store } = await setup();
  const run = await tryCartAction(
    testCtx(db.prisma, shop, store),
    cart([
      ["currency", "CZK:cz"],
      ["date", "2026-11-28"],
    ]),
    PAGE,
  );
  assert.equal(run.result, null);
  assert.ok(
    run.plan!.explain.some(
      (e) => e.tone === "success" && /Černý pátek/.test(e.text),
    ),
    JSON.stringify(run.plan!.explain),
  );
  assert.equal(run.plan!.date, "2026-11-28");
});

test("EUR · Slovensko: contextual prices for SK in EUR; a product without an EUR price is 'unknown', never 0", async () => {
  const { store } = await setup();
  const ctx = testCtx(db.prisma, shop, store);
  const missing = await tryCartAction(
    ctx,
    cart([["currency", "EUR:sk"]]),
    PAGE,
  );
  assert.deepEqual(missing.result, {
    ok: false,
    reason: "prices_unavailable",
    currency: "EUR",
    products: ["Čepice"],
  });
  assert.equal(missing.plan, null);
  const html = text(
    await renderPage(
      createElement(TryCartScreen, {
        ...(await tryCartPage(ctx, PAGE)),
        lines: missing.lines!,
        plan: null,
        result: missing.result,
      }),
    ),
  );
  assert.match(html, /Shopify nemá cenu v EUR pro Čepice/);

  const onlyHoodie = formOf([
    ["intent", "run"],
    ["variantId", V_HOODIE],
    ["productId", "gid://shopify/Product/1"],
    ["quantity", "1"],
    ["currency", "EUR:sk"],
  ]);
  const ok = await tryCartAction(ctx, onlyHoodie, PAGE);
  assert.equal(ok.result, null);
  assert.equal(ok.plan?.totals.subtotal, 52_00);
  assert.equal(
    store.calls.filter((c) => c.op === "WonTryCartVariants").at(-1)?.variables
      .country,
    "SK",
  );
});

test("server-side validation: unknown variants, a foreign currency or market, tampered product ids, a wrong intent", async () => {
  const { store } = await setup();
  const ctx = testCtx(db.prisma, shop, store);
  const unknown = await tryCartAction(
    ctx,
    formOf([
      ["intent", "run"],
      ["variantId", "gid://shopify/ProductVariant/999"],
      ["productId", "gid://shopify/Product/9"],
      ["quantity", "1"],
      ["currency", "CZK"],
    ]),
    PAGE,
  );
  assert.deepEqual(unknown.result, {
    ok: false,
    reason: "invalid",
    errors: [{ field: "lines", key: "tryCart.error.unknownProduct" }],
  });

  for (const currency of ["HUF", "CZK:sk", "USD"]) {
    const res = await tryCartAction(ctx, cart([["currency", currency]]), PAGE);
    assert.ok(
      res.result && !res.result.ok && res.result.reason === "invalid",
      currency,
    );
  }
  const calls = store.calls.length;
  assert.deepEqual(
    await tryCartAction(ctx, formOf([["intent", "save"]]), PAGE),
    { result: { ok: false, reason: "bad_request" }, plan: null },
  );
  assert.equal(store.calls.length, calls, "a bad intent reads nothing");

  // The product id comes from Shopify, not from the form.
  const tampered = await tryCartAction(
    ctx,
    formOf([
      ["intent", "run"],
      ["variantId", V_CAP],
      ["productId", "gid://shopify/Product/1"],
      ["quantity", "1"],
      ["currency", "CZK"],
      ["codes", "VIP20"],
    ]),
    PAGE,
  );
  assert.equal(tampered.lines?.[0].productId, "gid://shopify/Product/2");
  assert.equal(
    tampered.plan?.lines[0].discount,
    0,
    "the cap does not get the collection's discount through a forged product id",
  );
});

test("Shopify unavailable: said with the detail, nothing planned", async () => {
  const { store } = await setup();
  store.overrides.set("WonTryCartVariants", () => ({
    errors: [{ message: "Internal error" }],
  }));
  const run = await tryCartAction(
    testCtx(db.prisma, shop, store),
    cart([["currency", "CZK:cz"]]),
    PAGE,
  );
  assert.deepEqual(run, {
    result: {
      ok: false,
      reason: "shopify_unavailable",
      detail: "Internal error",
    },
    plan: null,
  });
});

test("planTryCart is pure and deterministic (the harness renders it from fixture prices)", async () => {
  const { store } = await setup();
  void store;
  const { config } = await import("../../app/lib/config.server.ts").then((m) =>
    m.loadConfig(db.prisma, shop),
  );
  const input = {
    lines: [
      {
        variantId: V_CAP,
        productId: "gid://shopify/Product/2",
        title: "Čepice",
        quantity: 3,
        unitPrice: 390_00,
        collectionIds: [],
      },
    ],
    currency: "CZK",
    countryCode: "CZ",
    codes: [],
    date: "2026-09-28",
    time: "14:00:00",
    shopTimezone: "Europe/Prague",
    locale: "en" as const,
  };
  const a = planTryCart(config, input);
  assert.deepEqual(a, planTryCart(config, input));
  assert.equal(a.totals.orderDiscount, Math.round(3 * 390_00 * 0.1));
  assert.ok(
    a.explain.every(
      (e) => !/[ěščřžýáíé]/.test(e.text) || /Podzim|Černý/.test(e.text),
    ),
    "English sentences",
  );
});

// --- Requested query cost (Shopify refuses > 1 000 before executing) -----------------------

function intArg(field: FieldNode, name: string): number | null {
  const arg = field.arguments?.find((a) => a.name.value === name);
  return arg && arg.value.kind === Kind.INT ? Number(arg.value.value) : null;
}
function selectionCost(
  set: SelectionSetNode | undefined,
  batch: number,
): number {
  if (!set) return 0;
  let fields = 0;
  let fragments = 0;
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) fields += fieldCost(s, batch);
    else if (s.kind === Kind.INLINE_FRAGMENT)
      fragments = Math.max(fragments, selectionCost(s.selectionSet, batch));
  }
  return fields + fragments;
}
function fieldCost(field: FieldNode, batch: number): number {
  if (!field.selectionSet) return 0;
  const size = intArg(field, "first") ?? intArg(field, "last");
  if (size !== null) {
    let perNode = 0;
    let once = 0;
    for (const s of field.selectionSet.selections) {
      if (s.kind !== Kind.FIELD) continue;
      if (s.name.value === "pageInfo") once += 1;
      else if (s.name.value === "nodes")
        perNode += 1 + selectionCost(s.selectionSet, batch);
      else perNode += fieldCost(s, batch);
    }
    return 2 + size * perNode + once;
  }
  const list = field.arguments?.some((a) => a.name.value === "ids") ? batch : 1;
  return list * (1 + selectionCost(field.selectionSet, batch));
}
function requestedCost(document: string, batch: number): number {
  let total = 0;
  for (const def of parse(document).definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    for (const s of def.selectionSet.selections)
      if (s.kind === Kind.FIELD) total += fieldCost(s, batch);
  }
  return total;
}

test("every Vyzkoušet košík document requests ≤ 1 000 points (variants sized by the batch it is sent with)", () => {
  const costs = Object.fromEntries(
    Object.entries(TRY_CART_DOCUMENTS).map(([name, doc]) => [
      name,
      requestedCost(doc, TRY_CART_VARIANTS_BATCH),
    ]),
  );
  for (const [name, cost] of Object.entries(costs))
    assert.ok(cost <= 1000, `${name}: ${cost}`);
  assert.ok(
    costs.variants! >= TRY_CART_VARIANTS_BATCH * 2,
    `the estimate counts the batch (${costs.variants})`,
  );
});

test("Odměny (MVP 4): a reached gift tier — the gift variant read with the cart (same market price), its line added free and tagged on the screen", async () => {
  const store = new FakeStore();
  store.sync.markets = [
    {
      handle: "cz",
      name: "Česko",
      status: "ACTIVE",
      currency: "CZK",
      countries: ["CZ"],
    },
  ];
  store.sync.addProduct(1, 2);
  store.sync.addProduct(2, 1);
  const V_GIFT = store.sync.addProduct(3, 1).variantIds[0]!;
  store.prices.set(V_HOODIE, { CZK: "1290.00" });
  store.prices.set(V_CAP, { CZK: "390.00" });
  store.prices.set(V_GIFT, { CZK: "99.00" });
  store.titles.set(V_HOODIE, { product: "Mikina Won", variant: "M / černá" });
  store.titles.set(V_CAP, { product: "Čepice", variant: "Default Title" });
  store.titles.set(V_GIFT, {
    product: "Ponožky Won",
    variant: "Default Title",
  });
  const saved = await saveConfig(db.prisma, shop, {
    markets: [{ handle: "cz", currency: "CZK", enabled: true }],
    modules: {
      rewards: {
        gifts: [{ id: "g1", threshold: { CZK: 2000_00 }, choices: [V_GIFT] }],
        countOtherDiscounts: false,
        giftDeclinable: true,
      },
    },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const ctx = testCtx(db.prisma, shop, store);
  const run = await tryCartAction(
    ctx,
    cart([
      ["currency", "CZK:cz"],
      ["date", "2026-10-01"],
    ]),
    PAGE,
  );
  assert.equal(run.result, null, JSON.stringify(run.result));
  const pricing = store.calls.filter((c) => c.op === "WonTryCartVariants");
  assert.equal(
    pricing.length,
    1,
    "one read: the gift variant goes with the cart's variants",
  );
  assert.ok((pricing[0]!.variables.ids as string[]).includes(V_GIFT));
  const plan = run.plan!;
  const gift = plan.lines.find((l) => l.gift)!;
  assert.deepEqual(
    [gift.title, gift.quantity, gift.subtotal, gift.total],
    ["Ponožky Won", 1, 99_00, 0],
  );
  assert.equal(
    plan.totals.total,
    2 * 1290_00 + 390_00,
    "the gift costs nothing",
  );
  assert.deepEqual(
    run.lines?.map((l) => l.title),
    ["Mikina Won", "Čepice"],
    "the merchant's cart stays as built (the gift is the website cart's)",
  );
  const page = await tryCartPage(ctx, PAGE);
  const html = text(
    await renderPage(
      createElement(TryCartScreen, {
        ...page,
        lines: run.lines!,
        plan,
        result: run.result,
        currency: "CZK:cz",
      }),
    ),
  );
  assert.match(html, /Ponožky Won × 1/);
  assert.match(html, /Dárek přidá košík na webu/);
  assert.match(html, /Dárek zdarma: nákup od 2/);
});
