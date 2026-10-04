// MVP 7 contract M8 (P6): the product card's tier line never promises more than checkout gives. Property test:
// random tier sets, margin settings, products and currencies → whenever cardTier shows a line, a cart of exactly
// that many items of the product's cheapest variant gets at least that discount per item from planCart.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardTier, type CardTierInput } from "../../src/discounts/card-tier.ts";
import { sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const chance = (p: number) => next() < p;
  return { int, pick, chance };
}

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const base = (over: Partial<CardTierInput> = {}): CardTierInput => ({
  cfg: { cards: 1, tiers: { global: "g", sets: { g: { count: "line", breaks: [{ min: 3, pct: 10 }, { min: 5, pct: 15 }] } } }, margin: { on: false } },
  currency: "CZK",
  product: { ruleIds: [] } as CardTierInput["product"],
  costed: false,
  onSale: false,
  priceMin: 10000,
  ...over,
});

test("the card shows the FIRST break of the product's set; nothing when cards are off, there is no set, or the ref is unusable", () => {
  assert.deepEqual(cardTier(base()), { min: 3, pct: 10 });
  assert.equal(cardTier(base({ cfg: { ...base().cfg, cards: undefined } })), null);
  assert.equal(cardTier(base({ product: { tierRef: "gone" } })), null, "a ref to a set the config lacks: no line, never the global set");
  assert.equal(cardTier(base({ product: { tierRef: 7 } })), null);
  assert.deepEqual(cardTier(base({ product: null })), { min: 3, pct: 10 }, "no metafield: the global set");
  assert.equal(cardTier(base({ cfg: { ...base().cfg, tiers: { global: null, sets: {} } } })), null);
  assert.equal(cardTier(base({ cfg: { ...base().cfg, tiers: { global: "g", sets: { g: { count: "line", breaks: [] } } } } })), null, "an inert set (Free)");
});

test("a sale variant, a purchase cost under margin protection, a percent over the ceiling: nothing", () => {
  assert.equal(cardTier(base({ onSale: true })), null);
  assert.deepEqual(cardTier(base({ onSale: true, cfg: { ...base().cfg, ow: 1 } })), { min: 3, pct: 10 });
  const margin = { on: true as const, max: 20, col: { "5": 8 } };
  assert.deepEqual(cardTier(base({ cfg: { ...base().cfg, margin } })), { min: 3, pct: 10 });
  assert.equal(cardTier(base({ cfg: { ...base().cfg, margin }, costed: true })), null);
  assert.equal(cardTier(base({ cfg: { ...base().cfg, margin }, product: { marginRefs: ["5"] } })), null, "the collection's ceiling 8 % < 10 %");
  assert.equal(cardTier(base({ cfg: { ...base().cfg, margin: { on: true, max: 9 } } })), null);
  assert.deepEqual(cardTier(base({ costed: true })), { min: 3, pct: 10 }, "protection off: a cost does not matter");
});

test("an amount break: only in the page's currency, at most the cheapest variant's price, never under margin protection", () => {
  const cfg = { cards: 1 as const, tiers: { global: "g", sets: { g: { count: "line" as const, breaks: [{ min: 2, off: { CZK: 500, EUR: 20 } }] } } }, margin: { on: false as const } };
  assert.deepEqual(cardTier(base({ cfg })), { min: 2, off: 500 });
  assert.deepEqual(cardTier(base({ cfg, currency: "EUR" })), { min: 2, off: 20 });
  assert.equal(cardTier(base({ cfg, currency: "USD" })), null);
  assert.equal(cardTier(base({ cfg, priceMin: 400 })), null, "the engine would cap the amount at the price");
  assert.equal(cardTier(base({ cfg: { ...cfg, margin: { on: true, max: 100 } } })), null);
});

test("property: whenever a card shows a line, checkout gives at least that per item (2 000 products)", () => {
  const r = rng(20261004);
  let shown = 0;
  let pct = 0;
  let off = 0;
  for (let i = 0; i < 2000; i += 1) {
    const percentSet = r.chance(0.6);
    const breaks = Array.from({ length: r.int(1, 3) }, (_, k) =>
      percentSet ? { minQty: 2 + k * r.int(1, 3), percent: r.pick([5, 10, 12.5, 20, 30, 50]) + k * 5 } : { minQty: 2 + k * r.int(1, 3), amountOff: { CZK: (r.int(1, 40) + k * 40) * 100, ...(r.chance(0.5) ? { EUR: (r.int(1, 4) + k * 4) * 100 } : {}) } },
    );
    const scoped = r.chance(0.4);
    const marginOn = r.chance(0.5);
    const plan = r.pick(["free", "pro"] as const);
    const { config } = sanitizeConfig({
      modules: {
        codes: { rules: [] },
        tiers: { sets: [{ id: "g", scope: "global", countAcross: r.pick(["line", "product", "cart"]), breaks }, ...(scoped ? [{ id: "s", scope: { productIds: [P(1)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 40 }] }] : [])] },
        margin: marginOn ? { enabled: true, global: { maxDiscountPercent: r.pick([5, 10, 15, 25, 100]) }, perCollection: r.chance(0.4) ? [{ collectionId: C(5), maxDiscountPercent: r.pick([5, 10, 50]) }] : [] } : { enabled: false },
      },
      engine: { combination: { outletWithAnything: r.chance(0.2) } },
      storefront: { cardPricesEnabled: true },
    });
    const gated = gateConfigForPlan(config, plan).config;
    const cfg = buildStorefrontConfig(gated, { configVersion: "v", shopCurrency: "CZK" });
    const currency = r.pick(["CZK", "CZK", "EUR", "USD"]);
    const price = r.int(1, 300) * 100;
    const unitCost = marginOn && r.chance(0.3) ? Math.max(1, Math.floor(price / 100 / 2)) : undefined;
    const onSale = r.chance(0.1);
    const product = { ruleIds: [], ...(scoped ? { tierRef: "s" } : {}), ...(r.chance(0.3) ? { marginRefs: ["5"] } : {}) };
    const line = cardTier({ cfg: cfg as CardTierInput["cfg"], currency, product, costed: unitCost !== undefined, onSale, priceMin: price });
    assert.equal((cfg as { cards?: number }).cards, 1, "the storefront config says cards are on");
    if (!line) continue;
    shown += 1;
    const payload = buildShopFunctionConfig(gated, { now: "2026-10-04T10:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" }).payload;
    const cart = planCart(
      {
        currency,
        enteredCodes: [],
        today: "2026-10-04",
        lines: [
          {
            id: "L1",
            variantId: "gid://shopify/ProductVariant/1",
            productId: P(1),
            quantity: line.min,
            unitPrice: price,
            ruleIds: [],
            ...(scoped ? { tierRef: "s" } : {}),
            ...(product.marginRefs ? { marginRefs: product.marginRefs } : {}),
            ...(unitCost !== undefined ? { unitCost, unitCostCurrency: "CZK" } : {}),
            ...(onSale ? { outlet: true } : {}),
          },
        ],
      },
      payload,
    );
    const given = cart.lines[0]!.product?.amount ?? 0;
    const promised = "pct" in line ? Math.floor((price * line.min * line.pct) / 100) : line.off * line.min;
    assert.ok(given >= promised, `#${i}: the card says ${JSON.stringify(line)} but ${line.min} × ${price} ${currency} get ${given} < ${promised} (margin ${marginOn}, plan ${plan}, sale ${onSale})`);
    if ("pct" in line) pct += 1;
    else off += 1;
  }
  assert.ok(shown > 300 && pct > 100 && off > 30, `the property was exercised: ${shown} lines shown (${pct} percent, ${off} amount)`);
});
