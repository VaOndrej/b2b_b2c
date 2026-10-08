// MVP 5 contracts O1–O9 (docs/plans/2026-10-02-won-discounts-mvp5.md): the pure side of Výprodej.
// Prices are minor units of their own currency (1800 = 18 Kč); a price list's fixed price is priced in
// its own currency with the same percent (no exchange rate, MKT-1).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OUTLET_LIMITS,
  outletAfterReturn,
  outletDue,
  outletExhausted,
  outletLeft,
  outletOversold,
  outletPricesFor,
  outletReturnQty,
  outletSalePrice,
  outletStorefrontValue,
  restoreDecision,
  validateOutletDraft,
} from "../../src/discounts/outlet.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const P = (n: number) => `gid://shopify/Product/${n}`;

test("O2: the sale price = original × (100 − %) / 100, rounded half up to the minor unit", () => {
  assert.equal(outletSalePrice(1800, 50), 900);
  assert.equal(outletSalePrice(19900, 50), 9950);
  assert.equal(outletSalePrice(999, 15), 849, "849.15 → 849");
  assert.equal(outletSalePrice(1001, 50), 501, "500.5 → 501 (half up)");
  assert.equal(outletSalePrice(3, 50), 2, "1.5 → 2");
});

test("O2: a sale that would not lower the price, or would reach 0, has no effect (null) — the start is refused", () => {
  assert.equal(outletSalePrice(1, 10), null, "0.9 → 1 = the original");
  assert.equal(outletSalePrice(0, 50), null);
  assert.equal(outletSalePrice(1000, 0), null);
  assert.equal(outletSalePrice(1000, 91), null, "over the 90 % cap");
  assert.equal(outletSalePrice(1000, 12.5), null, "whole percents only");
  assert.equal(outletSalePrice(Number.NaN, 10), null);
});

test("O2: compareAt = the price before the sale, except `silent`, which keeps the variant's own compareAt", () => {
  assert.deepEqual(outletPricesFor({ price: 1800, compareAt: 2500 }, 50, "strike"), { price: 900, compareAt: 1800 });
  assert.deepEqual(outletPricesFor({ price: 1800, compareAt: null }, 50, "strike_badge_left"), { price: 900, compareAt: 1800 });
  assert.deepEqual(outletPricesFor({ price: 1800, compareAt: 2500 }, 50, "silent"), { price: 900, compareAt: 2500 });
  assert.deepEqual(outletPricesFor({ price: 1800, compareAt: null }, 50, "silent"), { price: 900, compareAt: null });
  assert.equal(outletPricesFor({ price: 1, compareAt: null }, 10, "strike"), null);
});

test("O5: restore only a field that still holds our sale value; a field changed outside the app is kept", () => {
  assert.deepEqual(restoreDecision({ current: 900, sale: 900, backup: 1800 }), { action: "restore", value: 1800 });
  assert.deepEqual(restoreDecision({ current: 1800, sale: 1800, backup: null }), { action: "restore", value: null }, "a compareAt we set from nothing goes back to nothing");
  assert.deepEqual(restoreDecision({ current: 1800, sale: 900, backup: 1800 }), { action: "none" }, "already back (a retried end)");
  assert.deepEqual(restoreDecision({ current: 700, sale: 900, backup: 1800 }), { action: "kept" }, "the merchant changed it during the sale");
  assert.deepEqual(restoreDecision({ current: null, sale: 900, backup: 1800 }), { action: "kept" }, "a fixed price removed by hand stays removed");
  assert.deepEqual(restoreDecision({ current: 2500, sale: 2500, backup: 2500 }), { action: "none" }, "silent: compareAt never changed");
});

test("O1/O7: the ledger — net = sold − returned; left never below 0; oversold is the exact number past the quota", () => {
  assert.equal(outletLeft({ quota: 5, sold: 3, returned: 1 }), 3);
  assert.equal(outletLeft({ quota: 5, sold: 7, returned: 0 }), 0);
  assert.equal(outletOversold({ quota: 5, sold: 7, returned: 0 }), 2);
  assert.equal(outletOversold({ quota: 5, sold: 7, returned: 2 }), 0);
  assert.equal(outletExhausted({ quota: 5, sold: 5, returned: 0 }), true);
  assert.equal(outletExhausted({ quota: 5, sold: 6, returned: 2 }), false);
});

test("O7: a cancellation returns what the order line sold and was not returned yet; a restocked refund at most that", () => {
  assert.equal(outletReturnQty("cancel", { sold: 3, returned: 0 }, 3), 3);
  assert.equal(outletReturnQty("cancel", { sold: 3, returned: 1 }, 3), 2, "a refund came first");
  assert.equal(outletReturnQty("refund", { sold: 3, returned: 0 }, 2), 2);
  assert.equal(outletReturnQty("refund", { sold: 3, returned: 2 }, 2), 1, "never more than sold");
  assert.equal(outletReturnQty("refund", { sold: 3, returned: 3 }, 1), 0);
  assert.equal(outletReturnQty("refund", { sold: 3, returned: 0 }, -4), 0);
});

test("O7: a return after the end follows the setting; Free never reopens (A6: nothing new starts on Free)", () => {
  assert.equal(outletAfterReturn("auto", "pro"), "reopen");
  assert.equal(outletAfterReturn("ask", "pro"), "ask");
  assert.equal(outletAfterReturn("never", "pro"), "record");
  assert.equal(outletAfterReturn("auto", "free"), "record");
  assert.equal(outletAfterReturn("ask", "free"), "record");
});

test("O8: a running sale is due at its end date (shop clock injected), never without one, never once ended", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.equal(outletDue({ status: "active", endsAt: new Date("2026-10-02T11:59:59Z") }, now), true);
  assert.equal(outletDue({ status: "active", endsAt: new Date("2026-10-02T12:00:00Z") }, now), true);
  assert.equal(outletDue({ status: "active", endsAt: new Date("2026-10-02T12:00:01Z") }, now), false);
  assert.equal(outletDue({ status: "active", endsAt: null }, now), false);
  assert.equal(outletDue({ status: "ended", endsAt: new Date("2026-10-01T00:00:00Z") }, now), false);
});

const ctx = (over: Partial<Parameters<typeof validateOutletDraft>[1]> = {}) => ({
  plan: "pro" as const,
  now: new Date("2026-10-02T12:00:00Z"),
  runningVariantIds: new Set<string>(),
  ...over,
});
const draft = { variantId: V(1), productId: P(1), quota: 5, percent: 30, endsAt: null, priceListIds: [] };

test("O4: a valid draft passes, normalized (ids trimmed, price lists unique)", () => {
  const r = validateOutletDraft({ ...draft, priceListIds: ["gid://shopify/PriceList/2", "gid://shopify/PriceList/2"], endsAt: "2026-10-09T12:00:00Z" }, ctx());
  assert.ok(r.ok);
  assert.deepEqual(r.draft.priceListIds, ["gid://shopify/PriceList/2"]);
  assert.equal(r.draft.endsAt?.toISOString(), "2026-10-09T12:00:00.000Z");
});

test("O4: only Pro starts a sale (BILL-1, A6)", () => {
  const r = validateOutletDraft(draft, ctx({ plan: "free" }));
  assert.ok(!r.ok);
  assert.deepEqual(r.errors.map((e) => e.key), ["outlet.error.pro"]);
});

test("O4: bounds — quota 1..100 000, whole percent 1..90, an end in the future, ids of the right kind", () => {
  const keys = (raw: object) => {
    const r = validateOutletDraft({ ...draft, ...raw }, ctx());
    return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.key}`);
  };
  assert.deepEqual(keys({ quota: 0 }), ["quota:outlet.error.quota"]);
  assert.deepEqual(keys({ quota: OUTLET_LIMITS.quotaMax + 1 }), ["quota:outlet.error.quota"]);
  assert.deepEqual(keys({ quota: 2.5 }), ["quota:outlet.error.quota"]);
  assert.deepEqual(keys({ percent: 0 }), ["percent:outlet.error.percent"]);
  assert.deepEqual(keys({ percent: 91 }), ["percent:outlet.error.percent"]);
  assert.deepEqual(keys({ endsAt: "2026-10-02T11:00:00Z" }), ["endsAt:outlet.error.endsAt"]);
  assert.deepEqual(keys({ endsAt: "zítra" }), ["endsAt:outlet.error.endsAt"]);
  assert.deepEqual(keys({ variantId: "48468679164145" }), ["variantId:outlet.error.variant"]);
  assert.deepEqual(keys({ productId: V(1) }), ["variantId:outlet.error.variant"]);
  assert.deepEqual(keys({ priceListIds: ["x"] }), ["priceListIds:outlet.error.priceLists"]);
  assert.deepEqual(
    keys({ priceListIds: Array.from({ length: OUTLET_LIMITS.priceLists + 1 }, (_, i) => `gid://shopify/PriceList/${i}`) }),
    ["priceListIds:outlet.error.priceLists"],
  );
});

test("O1: one running sale per variant; at most OUTLET_LIMITS.running sales not ended per shop", () => {
  const busy = validateOutletDraft(draft, ctx({ runningVariantIds: new Set([V(1)]) }));
  assert.ok(!busy.ok);
  assert.deepEqual(busy.errors.map((e) => e.key), ["outlet.error.running"]);
  const many = new Set(Array.from({ length: OUTLET_LIMITS.running }, (_, i) => V(1000 + i)));
  const full = validateOutletDraft(draft, ctx({ runningVariantIds: many }));
  assert.ok(!full.ok);
  assert.deepEqual(full.errors.map((e) => e.key), ["outlet.error.limit"]);
  assert.ok(validateOutletDraft(draft, ctx({ runningVariantIds: new Set([...many].slice(1)) })).ok);
});

test("O9: storefront value — display + what is left per variant (numeric id); nothing running → null", () => {
  assert.equal(outletStorefrontValue("strike_badge", []), null);
  assert.deepEqual(
    outletStorefrontValue("strike_badge_left", [
      { variantId: V(48468679000305), left: 3 },
      { variantId: V(7), left: -1 },
    ]),
    { d: "strike_badge_left", v: { "48468679000305": 3, "7": 0 } },
  );
  // A sale with an end date carries it (epoch seconds) for the looks with a countdown; one without does not.
  assert.deepEqual(
    outletStorefrontValue("strike_badge", [
      { variantId: V(1), left: 2, endsAt: new Date("2026-11-30T22:59:59.500Z") },
      { variantId: V(2), left: 2, endsAt: null },
      { variantId: V(3), left: 2, endsAt: new Date("2026-12-01T00:00:00Z"), showBadge: false },
    ]),
    { d: "strike_badge", v: { "1": 2, "2": 2 }, e: { "1": 1796079599 } },
  );
});
