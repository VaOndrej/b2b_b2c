import assert from "node:assert/strict";
import { test } from "node:test";

import { createDefaultConfig, type DiscountRule } from "@won/core/discounts/config";

import { detectNativeDiscounts, NativeDetectError } from "../../../app/lib/native/detect.server.ts";
import { DETECT_PAGE_SIZE } from "../../../app/lib/native/documents.ts";
import { basicNode, FakeShopify, freeShippingNode, otherNode } from "./fake-shopify.ts";

// Spec §4.1 / rozhodnutí "Nativní slevy Shopify": detection always shows the
// discounts outside Won, why some cannot move, and conflicts with Won rules.

const noSleep = { sleep: async () => {} };
const ENUM_KEY = /\b[a-z]+_[a-z_]+\b/; // snake_case key leaking into copy (§4c)

function wonRule(partial: Partial<DiscountRule> & Pick<DiscountRule, "id">): DiscountRule {
  return {
    enabled: true,
    name: `Won ${partial.id}`,
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...partial,
  };
}

test("sorts every discount type into movable / not movable / expired with human reasons", async () => {
  const shopify = new FakeShopify();
  const codeBasic = shopify.add(basicNode({ title: "10 % na trička", items: { products: ["gid://shopify/Product/1"] }, codes: ["TRICKA10"] }));
  const autoOrder = shopify.add(basicNode({ method: "automatic", title: "150 Kč z objednávky", amount: "150.00" }));
  const codeShip = shopify.add(freeShippingNode({ title: "Doprava zdarma kódem", codes: ["DOPRAVA"] }));
  const scheduled = shopify.add(basicNode({ method: "automatic", title: "Black Friday", status: "SCHEDULED", startsAt: "2026-11-27T00:00:00Z" }));
  const shipCountries = shopify.add(freeShippingNode({ method: "automatic", title: "Doprava CZ", countries: ["CZ"] }));
  const bxgy = shopify.add(otherNode("DiscountAutomaticBxgy", { title: "2+1" }));
  const otherApp = shopify.add(otherNode("DiscountCodeApp", { title: "Věrnost", appTitle: "Loyalty Pro" }));
  const ownApp = shopify.add(otherNode("DiscountAutomaticApp", { title: "Won Discounts", appKey: "won-key" }));
  const wonNode = shopify.add(otherNode("DiscountCodeApp", { title: "Won kód", appKey: "legacy-key" }));
  const expired = shopify.add(basicNode({ title: "Léto", status: "EXPIRED", endsAt: "2026-08-31T22:00:00Z" }));
  const expiredBxgy = shopify.add(otherNode("DiscountCodeBxgy", { title: "Stará 2+1", status: "EXPIRED" }));
  const vip = shopify.add(
    basicNode({ title: "VIP", context: { __typename: "DiscountCustomerSegments", segments: [{ id: "gid://shopify/Segment/1" }] } }),
  );
  const oncePerOrder = shopify.add(
    basicNode({ title: "100 Kč jednou", amount: "100.00", appliesOnEachItem: false, items: { collections: ["gid://shopify/Collection/1"] } }),
  );

  const result = await detectNativeDiscounts(shopify, { ...noSleep, wonNodeIds: [wonNode], ownAppKey: "won-key" });

  assert.deepEqual(result.shop, { currencyCode: "CZK", ianaTimezone: "Europe/Prague" });
  assert.deepEqual(result.movable.map((n) => n.id).sort(), [codeBasic, autoOrder, codeShip, scheduled].sort());
  assert.deepEqual(result.expired.map((e) => e.id).sort(), [expired, expiredBxgy].sort());
  const reasons = new Map(result.notMovable.map((e) => [e.id, e]));
  assert.deepEqual([...reasons.keys()].sort(), [shipCountries, bxgy, otherApp, vip, oncePerOrder].sort());
  assert.equal(reasons.get(bxgy)?.reason, "Won Discounts nemá Kup X, dostaneš Y. Pokryjí to množstevní slevy.");
  assert.match(reasons.get(otherApp)?.reason ?? "", /Loyalty Pro/);
  assert.equal(reasons.get(vip)?.reasonCode, "specific_buyers");
  assert.equal(reasons.get(oncePerOrder)?.reasonCode, "fixed_once_per_order");
  assert.equal(reasons.get(shipCountries)?.reasonCode, "shipping_countries");
  // Won's own nodes are not "outside Won".
  assert.ok(![...reasons.keys(), ...result.movable.map((n) => n.id)].includes(ownApp));
  for (const entry of result.notMovable) assert.doesNotMatch(entry.reason, ENUM_KEY, entry.reason);

  const tricka = result.movable.find((n) => n.id === codeBasic);
  assert.equal(tricka?.method, "code");
  assert.deepEqual(tricka?.value, { kind: "percentage", percent: 10 });
  assert.deepEqual(tricka?.target, { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] });
  assert.deepEqual(tricka?.codes, ["TRICKA10"]);
});

test("English reasons follow the admin language (A10)", async () => {
  const shopify = new FakeShopify();
  const bxgy = shopify.add(otherNode("DiscountCodeBxgy", { title: "BOGO" }));
  const result = await detectNativeDiscounts(shopify, { ...noSleep, locale: "en" });
  assert.equal(result.notMovable.find((e) => e.id === bxgy)?.reason, "Won Discounts has no Buy X, get Y. Quantity discounts cover it.");
});

test("API-2: pages through every discount node; a malformed node is skipped, not fatal", async () => {
  const shopify = new FakeShopify();
  const ids: string[] = [];
  for (let i = 0; i < DETECT_PAGE_SIZE * 2 + 3; i++) ids.push(shopify.add(basicNode({ title: `Sleva ${i}`, codes: [`KOD${i}`] })));
  shopify.add({ id: "gid://shopify/DiscountCodeNode/777", discount: null });

  const result = await detectNativeDiscounts(shopify, noSleep);
  assert.equal(result.movable.length, ids.length);
  const pages = shopify.callsTo("WonNativeDiscounts");
  assert.equal(pages.length, 3);
  assert.equal(pages[0].variables?.after, null);
  assert.equal(pages[1].variables?.after, String(DETECT_PAGE_SIZE));
});

test("API-3: THROTTLED is retried with backoff, then succeeds", async () => {
  const shopify = new FakeShopify();
  shopify.add(basicNode());
  shopify.inject("WonNativeDiscounts", { throttled: true }, { throttled: true });
  const waits: number[] = [];
  const result = await detectNativeDiscounts(shopify, { sleep: async (ms) => void waits.push(ms), backoffMs: 100 });
  assert.equal(result.movable.length, 1);
  assert.deepEqual(waits, [100, 200]);
  assert.equal(shopify.callsTo("WonNativeDiscounts").length, 3);
});

test("REL-1: a persistent failure ends in a human error, never a hang", async () => {
  const shopify = new FakeShopify();
  shopify.inject("WonNativeDiscounts", { graphqlError: "Internal error" });
  await assert.rejects(detectNativeDiscounts(shopify, noSleep), (error: unknown) => {
    assert.ok(error instanceof NativeDetectError);
    assert.match(error.message, /^Slevy se nepodařilo načíst ze Shopify \(Internal error\)/);
    return true;
  });

  const hanging = new FakeShopify();
  hanging.graphql = () => new Promise(() => {});
  await assert.rejects(detectNativeDiscounts(hanging, { ...noSleep, timeoutMs: 20, maxAttempts: 2 }), /no answer from Shopify/);
});

test("conflicts: same code, same products, two order discounts — each with a human sentence", async () => {
  const shopify = new FakeShopify();
  const summer = shopify.add(basicNode({ title: "Léto kód", codes: ["summer"], items: { products: ["gid://shopify/Product/9"] } }));
  const autoProducts = shopify.add(basicNode({ method: "automatic", title: "Trička auto", items: { products: ["gid://shopify/Product/1"] } }));
  const autoOrder = shopify.add(basicNode({ method: "automatic", title: "Objednávka auto" }));
  shopify.add(basicNode({ method: "automatic", title: "Stará", status: "EXPIRED", items: { products: ["gid://shopify/Product/1"] } }));

  const config = createDefaultConfig();
  config.modules.codes.rules.push(
    // Code vs code on the same products only meets when both codes are entered: not reported.
    wonRule({
      id: "summer",
      name: "Léto Won",
      method: "code",
      codes: ["SUMMER"],
      target: { kind: "products", productIds: ["gid://shopify/Product/9"], variantIds: [] },
    }),
    wonRule({ id: "tricka", name: "Trička Won", target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }),
    wonRule({ id: "order", name: "Objednávka Won" }),
    wonRule({ id: "off", name: "Vypnuté", enabled: false }),
  );

  const { conflicts } = await detectNativeDiscounts(shopify, { ...noSleep, config });
  const summary = conflicts.map((c) => `${c.kind}:${c.nativeId}:${c.ruleId}`).sort();
  assert.deepEqual(
    summary,
    [`same_code:${summer}:summer`, `same_products:${autoProducts}:tricka`, `both_order:${autoOrder}:order`].sort(),
  );
  const sameCode = conflicts.find((c) => c.kind === "same_code");
  assert.deepEqual(sameCode?.codes, ["SUMMER"]);
  assert.match(sameCode?.message ?? "", /^Kód SUMMER má Shopify sleva „Léto kód“ i Won pravidlo „Léto Won“\./);
  for (const c of conflicts) assert.doesNotMatch(c.message, ENUM_KEY, c.message);
});
