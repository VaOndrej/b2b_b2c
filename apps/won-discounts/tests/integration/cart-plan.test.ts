import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";

import { buildShopFunctionConfig } from "@won/core/discounts/function-payload";
import { sanitizeConfig } from "@won/core/discounts/config";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import {
  CART_PLAN_CACHE_MAX,
  CART_PLAN_DOCUMENTS,
  CART_PLAN_CACHE_MS,
  CART_PLAN_MAX_LINES,
  CART_PLAN_READS_PER_MINUTE,
  CartPlanRateLimited,
  cartPlanCacheSize,
  cartPlanInput,
  clearCartPlanCache,
  parseCartPlanRequest,
  runCartPlan,
  setCartPlanClock,
  type CartPlanRequest,
} from "../../app/lib/integration/cart-plan.server.ts";

// MVP 4 contract R9: the storefront cart's live plan through the app proxy.
// The SAME planCart on the inputs the function reads (the live shop config,
// the product and variant metafields), the shop from the proxy signature, an
// answer without purchase costs or rule internals, Shopify reads cached.

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  setCartPlanClock(() => clock);
  clearCartPlanCache();
});
afterEach(() => setCartPlanClock(() => Date.now()));

const TIERS = { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }] };

function payload(modules: Record<string, unknown>) {
  const { config } = sanitizeConfig({ modules: { codes: { rules: [] }, ...modules } });
  return buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" }).json;
}

/** An AdminClient answering the two cart-plan reads; counts calls per operation. */
function fakeAdmin(configJson: string | null, variants: Record<number, { product?: unknown; cost?: unknown }>) {
  const calls: string[] = [];
  const client: AdminClient = {
    async graphql(query: string, variables?: Record<string, unknown>) {
      const op = /query (\w+)/.exec(query)![1]!;
      calls.push(op);
      if (op === "WonCartPlanConfig") return { data: { shop: { ianaTimezone: "Europe/Prague", config: configJson === null ? null : { value: configJson } } } };
      const ids = (variables?.ids as string[]) ?? [];
      return {
        data: {
          nodes: ids.map((gid) => {
            const n = Number(gid.split("/").pop());
            const v = variants[n];
            if (!v) return null;
            return {
              id: gid,
              cost: v.cost === undefined ? null : { value: JSON.stringify(v.cost) },
              product: { won: v.product === undefined ? null : { value: JSON.stringify(v.product) } },
            };
          }),
        },
      };
    },
  } as AdminClient;
  return { client, calls };
}

const request = (lines: CartPlanRequest["lines"], extra: Partial<CartPlanRequest> = {}): CartPlanRequest => ({
  currency: "CZK",
  locale: "cs",
  codes: [],
  lines,
  ...extra,
});

test("the request is validated: shape, bounds, at most 100 lines, codes capped; junk is refused", () => {
  const ok = parseCartPlanRequest({
    currency: "CZK",
    country: "CZ",
    rate: 1,
    locale: "en",
    codes: ["SAVE10", 7, ""],
    lines: [{ key: "1:abc", variantId: 11, productId: 1, quantity: 2, unitPrice: 100_00, gift: "gift-1" }],
  });
  assert.deepEqual(ok, {
    currency: "CZK",
    country: "CZ",
    rate: 1,
    locale: "en",
    codes: ["SAVE10"],
    lines: [{ key: "1:abc", variantId: 11, productId: 1, quantity: 2, unitPrice: 100_00, gift: "gift-1" }],
  });
  for (const bad of [
    null,
    { currency: "czk", lines: [] },
    { currency: "CZK", lines: "x" },
    { currency: "CZK", lines: [{ key: "", variantId: 1, productId: 1, quantity: 1, unitPrice: 1 }] },
    { currency: "CZK", lines: [{ key: "a", variantId: -1, productId: 1, quantity: 1, unitPrice: 1 }] },
    { currency: "CZK", lines: [{ key: "a", variantId: 1, productId: 1, quantity: 1.5, unitPrice: 1 }] },
    { currency: "CZK", lines: Array.from({ length: CART_PLAN_MAX_LINES + 1 }, (_, i) => ({ key: `k${i}`, variantId: 1, productId: 1, quantity: 1, unitPrice: 1 })) },
  ]) {
    assert.equal(parseCartPlanRequest(bad), null, JSON.stringify(bad)?.slice(0, 80));
  }
});

test("lines are mapped like the function's input adapter: refs, outlet (all or listed), margin refs, tierRef, cost + currency, gift", () => {
  const input = cartPlanInput(
    request([
      { key: "a", variantId: 11, productId: 1, quantity: 1, unitPrice: 100_00, gift: "gift-1" },
      { key: "b", variantId: 21, productId: 2, quantity: 1, unitPrice: 50_00 },
      { key: "c", variantId: 31, productId: 3, quantity: 1, unitPrice: 50_00 },
    ]),
    new Map([
      [11, { product: JSON.stringify({ ruleIds: ["r1"], variantRuleIds: { "11": ["r2"] }, outlet: ["gid://shopify/ProductVariant/11"], marginRefs: ["5"], tierRef: "t1" }), cost: JSON.stringify({ cost: 30, cur: "CZK" }) }],
      [21, { product: JSON.stringify({ ruleIds: [], outlet: true, tierRef: null }), cost: JSON.stringify({ cost: 0, cur: "CZK" }) }],
      [31, { product: "{broken", cost: null }],
    ]),
    "2026-10-01",
  );
  assert.deepEqual(input.lines, [
    {
      id: "a",
      variantId: "gid://shopify/ProductVariant/11",
      productId: "gid://shopify/Product/1",
      quantity: 1,
      unitPrice: 100_00,
      ruleIds: ["r1"],
      variantRuleIds: { "11": ["r2"] },
      outlet: true,
      marginRefs: ["5"],
      tierRef: "t1",
      unitCost: 30,
      unitCostCurrency: "CZK",
      giftTierId: "gift-1",
    },
    { id: "b", variantId: "gid://shopify/ProductVariant/21", productId: "gid://shopify/Product/2", quantity: 1, unitPrice: 50_00, ruleIds: [], variantRuleIds: {}, outlet: true, tierRef: null, unitCost: 0 },
    { id: "c", variantId: "gid://shopify/ProductVariant/31", productId: "gid://shopify/Product/3", quantity: 1, unitPrice: 50_00, ruleIds: [] },
  ]);
  assert.equal(input.today, "2026-10-01");
});

test("MVP 5 (O6): the variant's own sale flag (metafield `outlet` = true) makes the line outlet, like the function's `wonOutlet`; anything else does not", () => {
  const input = cartPlanInput(
    request([
      { key: "a", variantId: 11, productId: 1, quantity: 1, unitPrice: 100_00 },
      { key: "b", variantId: 21, productId: 2, quantity: 1, unitPrice: 100_00 },
      { key: "c", variantId: 31, productId: 3, quantity: 1, unitPrice: 100_00 },
    ]),
    new Map([
      [11, { product: null, cost: null, outlet: "true" }],
      [21, { product: null, cost: null, outlet: '"true"' }],
      [31, { product: null, cost: null, outlet: null }],
    ]),
    "2026-10-02",
  );
  assert.deepEqual(input.lines.map((l) => l.outlet === true), [true, false, false]);
  assert.match(CART_PLAN_DOCUMENTS.variants, /outlet: metafield\(namespace: "\$app:won_discounts", key: "outlet"\)/);
});

test("the answer: the tier hint (line key), the rewards' progress — and never a purchase cost or a rule id", async () => {
  const config = payload({
    tiers: TIERS,
    margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 50 } },
    rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [{ id: "gift-1", threshold: { CZK: 1500_00 }, choices: ["gid://shopify/ProductVariant/99"] }] },
  });
  const { client } = fakeAdmin(config, { 11: { product: { ruleIds: [] }, cost: { cost: 12.5, cur: "CZK" } } });
  const answer = await runCartPlan(client, "a.myshopify.com", request([{ key: "line-1", variantId: 11, productId: 1, quantity: 2, unitPrice: 100_00 }]));
  assert.deepEqual(answer, {
    ok: true,
    currency: "CZK",
    saved: 0,
    gifts: [{ tierId: "gift-1", state: "below" }],
    warnings: [],
    hint: { key: "line-1", missing: 1, minQty: 3, percent: 10 },
    freeShipping: { threshold: 1000_00, remaining: 800_00, reached: false },
    giftProgress: [{ tierId: "gift-1", threshold: 1500_00, remaining: 1300_00, reached: false }],
  });
  const text = JSON.stringify(answer);
  assert.ok(!/12\.5|cost|r_|ruleId|marginCapped/.test(text), text);
});

test("no shop config (or one over 10 000 B, null to the function) plans nothing — like checkout", async () => {
  const { client } = fakeAdmin(null, {});
  const answer = await runCartPlan(client, "b.myshopify.com", request([{ key: "x", variantId: 1, productId: 1, quantity: 5, unitPrice: 100_00 }]));
  assert.deepEqual({ saved: answer.saved, hint: answer.hint, gifts: answer.gifts }, { saved: 0, hint: undefined, gifts: [] });
});

test("Shopify reads are cached per shop for 60 s (injected clock), per variant", async () => {
  const config = payload({ tiers: TIERS });
  const { client, calls } = fakeAdmin(config, { 11: { product: { ruleIds: [] } }, 12: { product: { ruleIds: [] } } });
  const line = (variantId: number) => ({ key: `k${variantId}`, variantId, productId: 1, quantity: 1, unitPrice: 100_00 });
  await runCartPlan(client, "c.myshopify.com", request([line(11)]));
  await runCartPlan(client, "c.myshopify.com", request([line(11), line(12)]));
  assert.deepEqual(calls, ["WonCartPlanConfig", "WonCartPlanVariants", "WonCartPlanVariants"]);
  clock += CART_PLAN_CACHE_MS;
  await runCartPlan(client, "c.myshopify.com", request([line(11)]));
  assert.deepEqual(calls.slice(3), ["WonCartPlanConfig", "WonCartPlanVariants"]);
  await runCartPlan(client, "other.myshopify.com", request([line(11)]));
  assert.deepEqual(calls.slice(5), ["WonCartPlanConfig", "WonCartPlanVariants"], "another shop never reads this shop's cache (SEC-2)");
});

test("audit P1: the cache never grows past its cap — random variant ids from a public endpoint cannot exhaust memory", async () => {
  const config = payload({ tiers: TIERS });
  const { client } = fakeAdmin(config, {});
  const lines = (from: number) => Array.from({ length: CART_PLAN_MAX_LINES }, (_, i) => ({ key: `k${i}`, variantId: from + i, productId: 1, quantity: 1, unitPrice: 100_00 }));
  // Spread over many shops so the per-shop read limit does not stop it first.
  for (let n = 0; n * CART_PLAN_MAX_LINES < CART_PLAN_CACHE_MAX * 2; n++) await runCartPlan(client, `s${n}.myshopify.com`, request(lines(n * CART_PLAN_MAX_LINES + 1)));
  assert.ok(cartPlanCacheSize() <= CART_PLAN_CACHE_MAX, `${cartPlanCacheSize()} entries`);
});

test("audit P2: Shopify reads per shop are limited per minute; over the limit no read and no answer (the panel shows no hint, fail closed)", async () => {
  const config = payload({ tiers: TIERS });
  const { client, calls } = fakeAdmin(config, {});
  const line = (variantId: number) => ({ key: `k${variantId}`, variantId, productId: 1, quantity: 1, unitPrice: 100_00 });
  for (let i = 0; i < CART_PLAN_READS_PER_MINUTE; i++) await runCartPlan(client, "busy.myshopify.com", request([line(1000 + i)]));
  const before = calls.length;
  await assert.rejects(runCartPlan(client, "busy.myshopify.com", request([line(5000)])), CartPlanRateLimited);
  assert.equal(calls.length, before, "nothing read from Shopify over the limit");
  // Cached answers still work over the limit, and another shop is not affected.
  await runCartPlan(client, "busy.myshopify.com", request([line(1000)]));
  await runCartPlan(client, "quiet.myshopify.com", request([line(5000)]));
  clock += 60_000;
  await runCartPlan(client, "busy.myshopify.com", request([line(5000)]));
});

test("the route authenticates the app proxy request first, takes the shop from it, answers no-store", async () => {
  const source = await readFile(new URL("../../app/routes/won-discounts.cart-plan.tsx", import.meta.url), "utf8");
  assert.match(source, /await authenticate\.public\.appProxy\(request\)/);
  assert.match(source, /runCartPlan\(adminClientFromApp\(admin\), session\.shop, parsed\)/);
  assert.ok(source.indexOf("authenticate.public.appProxy") < source.indexOf("request.json()"), "the signature is checked before the body is read");
  assert.match(source, /"Cache-Control": "no-store"/);
});

test("MVP 6 K6: the cart plan applies the live config's campaign exactly inside its window (shop time), like the function", async () => {
  const { config } = sanitizeConfig({
    modules: { codes: { rules: [{ id: "a", name: "Auto", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }] } },
    campaigns: [{ id: "k", name: "Kampaň", window: { start: "2026-10-05T10:00:00", end: "2026-10-05T12:00:00" }, overrides: [{ ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } }] }],
  });
  const json = buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" }).json;
  const saved = async (iso: string) => {
    setCartPlanClock(() => new Date(iso).getTime());
    const { client } = fakeAdmin(json, { 11: { product: { ruleIds: ["a"] } } });
    return (await runCartPlan(client, `k6-${iso}.myshopify.com`, request([{ key: "l", variantId: 11, productId: 1, quantity: 1, unitPrice: 100_00 }]))).saved;
  };
  assert.equal(await saved("2026-10-05T07:59:59Z"), 10_00, "09:59:59 Prague: before");
  assert.equal(await saved("2026-10-05T08:00:00Z"), 30_00, "10:00 Prague: the start is inside");
  assert.equal(await saved("2026-10-05T09:59:00Z"), 30_00);
  assert.equal(await saved("2026-10-05T10:00:00Z"), 10_00, "12:00 Prague: the end is outside");
});
