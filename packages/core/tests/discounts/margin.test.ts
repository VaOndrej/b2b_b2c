// Margin protection (MVP 2) building blocks: the config sanitizer, the compact
// function payload (builder + tolerant reader), and the arithmetic the plan and
// the Rust function share (ceilTol, costMinorUnits, marginFloorUnit,
// resolveMargin). Amounts are minor units unless a name says "major".

import assert from "node:assert/strict";
import { test } from "node:test";

import { createDefaultConfig, DEFAULT_CONFIG, sanitizeConfig } from "../../src/discounts/config.ts";
import {
  buildMarginPayload,
  ceilTol,
  costMinorUnits,
  marginCollectionIds,
  marginFloorUnit,
  MARGIN_TOLERANCE,
  readMarginPayload,
  resolveMargin,
} from "../../src/discounts/margin.ts";
import { currencyExponent } from "../../src/discounts/money.ts";

const close = (actual: number | null, expected: number, eps = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= eps, `${actual} ≈ ${expected}`);

// --- sanitizer ------------------------------------------------------------------------------

test("sanitizer: margin protection is OFF by default, and a stored config without the key reads as off", () => {
  assert.equal(DEFAULT_CONFIG.modules.margin.enabled, false);
  assert.equal(createDefaultConfig().modules.margin.enabled, false);
  const legacy = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 30, minMarginPercent: 10 }, perCollection: [] } } });
  assert.equal(legacy.config.modules.margin.enabled, false);
  assert.deepEqual(legacy.issues, []);
  assert.deepEqual(legacy.config.modules.margin, { enabled: false, global: { maxDiscountPercent: 30, minMarginPercent: 10 }, perCollection: [] });
});

test("sanitizer: `enabled` must be a boolean (junk → off, with an issue)", () => {
  assert.equal(sanitizeConfig({ modules: { margin: { enabled: true } } }).config.modules.margin.enabled, true);
  const junk = sanitizeConfig({ modules: { margin: { enabled: "yes" } } });
  assert.equal(junk.config.modules.margin.enabled, false);
  assert.ok(junk.issues.some((i) => i.path === "modules.margin.enabled" && i.code === "invalid_boolean"));
});

test("sanitizer: minMarginPercent is clamped to 0–95 with an issue (a 100 % margin would forbid any price)", () => {
  const high = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 50, minMarginPercent: 99 } } } });
  assert.equal(high.config.modules.margin.global.minMarginPercent, 95);
  assert.ok(high.issues.some((i) => i.path === "modules.margin.global.minMarginPercent" && i.code === "clamped_percent"));
  const low = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 50, minMarginPercent: -5 } } } });
  assert.equal(low.config.modules.margin.global.minMarginPercent, 0);
  assert.ok(low.issues.some((i) => i.path === "modules.margin.global.minMarginPercent"));
  const ok = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 50, minMarginPercent: 95 } } } });
  assert.equal(ok.config.modules.margin.global.minMarginPercent, 95);
  assert.deepEqual(ok.issues, []);
});

test("sanitizer: per-collection values are clamped the same way (min 0–95, max 0–100), with issues", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      margin: {
        enabled: true,
        perCollection: [
          { collectionId: "gid://shopify/Collection/1", minMarginPercent: 120, maxDiscountPercent: 150 },
          { collectionId: "gid://shopify/Collection/2", minMarginPercent: "20", maxDiscountPercent: -1 },
          { collectionId: "gid://shopify/Collection/3", minMarginPercent: 30 },
        ],
      },
    },
  });
  assert.deepEqual(config.modules.margin.perCollection, [
    { collectionId: "gid://shopify/Collection/1", minMarginPercent: 95, maxDiscountPercent: 100 },
    { collectionId: "gid://shopify/Collection/2", maxDiscountPercent: 0 },
    { collectionId: "gid://shopify/Collection/3", minMarginPercent: 30 },
  ]);
  const paths = issues.map((i) => i.path);
  assert.ok(paths.includes("modules.margin.perCollection[0].minMarginPercent"));
  assert.ok(paths.includes("modules.margin.perCollection[0].maxDiscountPercent"));
  assert.ok(paths.includes("modules.margin.perCollection[1].minMarginPercent"));
  assert.ok(paths.includes("modules.margin.perCollection[1].maxDiscountPercent"));
  // Idempotent: the sanitized module sanitizes to itself without issues.
  const again = sanitizeConfig(config);
  assert.deepEqual(again.config.modules.margin, config.modules.margin);
  assert.deepEqual(again.issues, []);
});

test("sanitizer: a global minimum margin over 100 gives ONE issue (clamped to 95), junk one invalid issue", () => {
  const high = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 50, minMarginPercent: 150 } } } });
  assert.equal(high.config.modules.margin.global.minMarginPercent, 95);
  const highIssues = high.issues.filter((i) => i.path === "modules.margin.global.minMarginPercent");
  assert.equal(highIssues.length, 1, JSON.stringify(highIssues));
  assert.equal(highIssues[0].code, "clamped_percent");
  assert.match(highIssues[0].message, /0-95/);
  const junk = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 50, minMarginPercent: "20" } } } });
  assert.equal(junk.config.modules.margin.global.minMarginPercent, 0);
  assert.deepEqual(junk.issues.map((i) => [i.path, i.code]), [["modules.margin.global.minMarginPercent", "invalid_percent"]]);
});

test("sanitizer: margin percents keep one decimal, rounded to the STRICTER side (min up, max down), with an issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      margin: {
        enabled: true,
        global: { minMarginPercent: 12.34, maxDiscountPercent: 45.67 },
        perCollection: [{ collectionId: "gid://shopify/Collection/1", minMarginPercent: 33.33, maxDiscountPercent: 66.67 }],
      },
    },
  });
  assert.deepEqual(config.modules.margin.global, { minMarginPercent: 12.4, maxDiscountPercent: 45.6 });
  assert.deepEqual(config.modules.margin.perCollection, [{ collectionId: "gid://shopify/Collection/1", minMarginPercent: 33.4, maxDiscountPercent: 66.6 }]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code]),
    [
      ["modules.margin.global.maxDiscountPercent", "rounded_percent"],
      ["modules.margin.global.minMarginPercent", "rounded_percent"],
      ["modules.margin.perCollection[0].minMarginPercent", "rounded_percent"],
      ["modules.margin.perCollection[0].maxDiscountPercent", "rounded_percent"],
    ],
  );
  // One decimal already: untouched, no issue (idempotent, float noise included: 0.1 × 3 = 0.30000000000000004).
  const again = sanitizeConfig(config);
  assert.deepEqual(again.config.modules.margin, config.modules.margin);
  assert.deepEqual(again.issues, []);
  const noisy = sanitizeConfig({ modules: { margin: { global: { maxDiscountPercent: 0.1 * 3, minMarginPercent: 0.1 * 3 } } } });
  assert.deepEqual(noisy.config.modules.margin.global, { maxDiscountPercent: 0.3, minMarginPercent: 0.3 });
  assert.deepEqual(noisy.issues, []);
});

// --- ceilTol / marginFloorUnit ------------------------------------------------------------------

test("ceilTol: ceil with a 1e-6 tolerance, so float noise never adds a minor unit", () => {
  assert.equal(MARGIN_TOLERANCE, 1e-6);
  assert.equal(ceilTol(7), 7);
  assert.equal(ceilTol(7.000001), 7, "x.000001 is float noise → x");
  assert.equal(ceilTol(7.0000011), 8, "just above the tolerance → x + 1");
  assert.equal(ceilTol(7.999999), 8, "x.999999 → x + 1");
  assert.equal(ceilTol(0), 0);
  assert.equal(ceilTol(0.0000005), 0);
});

test("marginFloorUnit with a cost: ceilTol(cost / (1 − m/100)); m = 0 is the cost itself", () => {
  assert.deepEqual(marginFloorUnit({ unitPrice: 1000_00, costMinor: 500_00, minMarginPercent: 0, maxDiscountPercent: 50 }), {
    floorUnit: 500_00,
    basis: "cost",
  });
  // 20 % margin on the price the customer pays: 500 / 0.8 = 625.
  assert.equal(marginFloorUnit({ unitPrice: 1000_00, costMinor: 500_00, minMarginPercent: 20, maxDiscountPercent: 50 }).floorUnit, 625_00);
  // m = 95: 50 000 / 0.050000000000000044 = 999 999.99999999… → the tolerance keeps it at 1 000 000.
  assert.equal(marginFloorUnit({ unitPrice: 1000_00, costMinor: 500_00, minMarginPercent: 95, maxDiscountPercent: 50 }).floorUnit, 1_000_000);
  // Out-of-range m is clamped to 95 (a hand-made payload).
  assert.equal(marginFloorUnit({ unitPrice: 1000_00, costMinor: 500_00, minMarginPercent: 100, maxDiscountPercent: 50 }).floorUnit, 1_000_000);
  // A cost above the price: the floor is above the price (no discount at all), never negative.
  assert.equal(marginFloorUnit({ unitPrice: 100_00, costMinor: 150_00, minMarginPercent: 0, maxDiscountPercent: 50 }).floorUnit, 150_00);
});

test("marginFloorUnit without a cost: ceilTol(price × (1 − p/100)); p = 0 → no discount, p = 100 → no limit", () => {
  assert.deepEqual(marginFloorUnit({ unitPrice: 999, costMinor: null, minMarginPercent: 20, maxDiscountPercent: 50 }), {
    floorUnit: 500,
    basis: "max_percent",
  });
  assert.equal(marginFloorUnit({ unitPrice: 999, costMinor: null, minMarginPercent: 0, maxDiscountPercent: 0 }).floorUnit, 999);
  assert.equal(marginFloorUnit({ unitPrice: 999, costMinor: null, minMarginPercent: 0, maxDiscountPercent: 100 }).floorUnit, 0);
  // 1 000 × (1 − 0.7) = 300.00000000000006 in floats → 300, not 301.
  assert.equal(1000 * (1 - 70 / 100) > 300, true, "the float noise this guards against");
  assert.equal(marginFloorUnit({ unitPrice: 1000, costMinor: null, minMarginPercent: 0, maxDiscountPercent: 70 }).floorUnit, 300);
  // A cost of 0 or less counts as "no cost".
  assert.equal(marginFloorUnit({ unitPrice: 1000, costMinor: 0, minMarginPercent: 0, maxDiscountPercent: 40 }).basis, "max_percent");
});

test("costMinorUnits: known only with a positive cost in the shop currency; same currency → rate 1", () => {
  close(costMinorUnits(12.34, "CZK", undefined, "CZK", "CZK"), 1234);
  close(costMinorUnits(12.34, "CZK", 0.04, "CZK", "CZK"), 1234, 1e-6); // same currency: the rate is ignored (1)
  assert.equal(costMinorUnits(undefined, "CZK", 1, "CZK", "CZK"), null);
  assert.equal(costMinorUnits(0, "CZK", 1, "CZK", "CZK"), null);
  assert.equal(costMinorUnits(-5, "CZK", 1, "CZK", "CZK"), null);
  assert.equal(costMinorUnits(Number.NaN, "CZK", 1, "CZK", "CZK"), null);
  // The variant's cost is in another currency than the shop (cur ≠ shop currency) → unknown.
  assert.equal(costMinorUnits(10, "EUR", 1, "CZK", "CZK"), null);
  assert.equal(costMinorUnits(10, undefined, 1, "CZK", "CZK"), null);
  // No shop currency in the payload → every cost is unknown.
  assert.equal(costMinorUnits(10, "CZK", 1, "CZK", undefined), null);
});

test("costMinorUnits: another cart currency needs a positive rate (shop → cart), else the cost is unknown", () => {
  close(costMinorUnits(100, "CZK", 0.04, "EUR", "CZK"), 400, 1e-9);
  assert.equal(costMinorUnits(100, "CZK", undefined, "EUR", "CZK"), null);
  assert.equal(costMinorUnits(100, "CZK", 0, "EUR", "CZK"), null);
  assert.equal(costMinorUnits(100, "CZK", -1, "EUR", "CZK"), null);
  assert.equal(costMinorUnits(100, "CZK", Number.POSITIVE_INFINITY, "EUR", "CZK"), null);
});

test("costMinorUnits: minor units follow the CART currency's exponent (JPY 0, KWD 3, HUF as money.ts says)", () => {
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  close(costMinorUnits(1234.5, "JPY", undefined, "JPY", "JPY"), 1234.5);
  assert.equal(marginFloorUnit({ unitPrice: 2000, costMinor: costMinorUnits(1234.5, "JPY", undefined, "JPY", "JPY"), minMarginPercent: 0, maxDiscountPercent: 50 }).floorUnit, 1235);
  close(costMinorUnits(1.2345, "KWD", undefined, "KWD", "KWD"), 1234.5, 1e-6);
  assert.equal(marginFloorUnit({ unitPrice: 2000, costMinor: costMinorUnits(1.2345, "KWD", undefined, "KWD", "KWD"), minMarginPercent: 0, maxDiscountPercent: 50 }).floorUnit, 1235);
  // Shop in CZK, cart in JPY (exponent 0): 100 CZK × 6.5 JPY/CZK = 650 minor units of JPY.
  close(costMinorUnits(100, "CZK", 6.5, "JPY", "CZK"), 650);
  // HUF: the shared currency table (money.ts, mirrored by the function) uses ISO 4217's 2 digits.
  close(costMinorUnits(100, "HUF", undefined, "HUF", "HUF"), 100 * 10 ** currencyExponent("HUF"));
});

test("costMinorUnits: an absurd cost is capped at the money cap (never Infinity)", () => {
  assert.equal(costMinorUnits(1e300, "CZK", 1e300, "EUR", "CZK"), 1e12);
  assert.equal(marginFloorUnit({ unitPrice: 100, costMinor: 1e12, minMarginPercent: 95, maxDiscountPercent: 50 }).floorUnit, 1e12);
});

// --- the compact payload --------------------------------------------------------------------------

test("buildMarginPayload: off → {enabled:false}; on → compact min/max/cur and `col` tuples keyed by numeric id", () => {
  assert.deepEqual(buildMarginPayload(DEFAULT_CONFIG.modules.margin, "CZK"), { enabled: false });
  const margin = sanitizeConfig({
    modules: {
      margin: {
        enabled: true,
        global: { minMarginPercent: 20, maxDiscountPercent: 40 },
        perCollection: [
          { collectionId: "gid://shopify/Collection/111", minMarginPercent: 30 },
          { collectionId: "gid://shopify/Collection/222", maxDiscountPercent: 10 },
          { collectionId: "gid://shopify/Collection/333" }, // nothing set: no entry
        ],
      },
    },
  }).config.modules.margin;
  assert.deepEqual(buildMarginPayload(margin, "CZK"), {
    enabled: true,
    min: 20,
    max: 40,
    cur: "CZK",
    col: { "111": [30, null], "222": [null, 10] },
  });
  // No shop currency: no `cur` (every cost is then unknown and the percent ceiling applies).
  assert.deepEqual(buildMarginPayload({ ...margin, perCollection: [] }, undefined), { enabled: true, min: 20, max: 40 });
  assert.deepEqual(marginCollectionIds(margin), ["gid://shopify/Collection/111", "gid://shopify/Collection/222"]);
  assert.deepEqual(marginCollectionIds({ ...margin, enabled: false }), []);
});

test("readMarginPayload: tolerant — anything but the enabled compact shape is OFF; numbers clamped; junk col ignored", () => {
  assert.deepEqual(readMarginPayload(undefined), { enabled: false });
  assert.deepEqual(readMarginPayload({ enabled: false, max: 10 }), { enabled: false });
  // The MVP 1 shape (the whole MarginModule) is not the compact shape → off.
  assert.deepEqual(readMarginPayload({ global: { maxDiscountPercent: 50 }, perCollection: [] }), { enabled: false });
  assert.deepEqual(readMarginPayload({ enabled: true, global: { maxDiscountPercent: 50 } }), { enabled: false });
  assert.deepEqual(readMarginPayload({ enabled: "true", max: 50 }), { enabled: false });
  assert.deepEqual(
    readMarginPayload({
      enabled: true,
      min: 120,
      max: -3,
      cur: "czk",
      col: { "1": [99, 150], "2": ["x", 1], "3": [null, null], "4": [1], "5": { m: 1 }, "6": [null, 20] },
    }),
    { enabled: true, min: 95, max: 0, col: { "1": [95, 100], "3": [null, null], "6": [null, 20] } },
  );
  assert.deepEqual(readMarginPayload({ enabled: true, max: 50, min: "20", cur: "EUR" }), { enabled: true, max: 50, cur: "EUR" });
});

test("resolveMargin: global values; a product in collections with settings takes the STRICTEST (max m, min p)", () => {
  const payload = readMarginPayload({ enabled: true, min: 10, max: 50, cur: "CZK", col: { "1": [30, null], "2": [null, 20], "3": [5, 80] } });
  assert.equal(resolveMargin({ enabled: false }, ["1"]), null);
  assert.deepEqual(resolveMargin(payload, []), { minMarginPercent: 10, maxDiscountPercent: 50, source: "global" });
  assert.deepEqual(resolveMargin(payload, ["9"]), { minMarginPercent: 10, maxDiscountPercent: 50, source: "global" });
  // A field the collection leaves empty is the global value.
  assert.deepEqual(resolveMargin(payload, ["1"]), { minMarginPercent: 30, maxDiscountPercent: 50, source: "collection" });
  assert.deepEqual(resolveMargin(payload, ["2", "1"]), { minMarginPercent: 30, maxDiscountPercent: 20, source: "collection" });
  // One collection may be LESS strict than the global setting: it replaces it for its products.
  assert.deepEqual(resolveMargin(payload, ["3"]), { minMarginPercent: 5, maxDiscountPercent: 80, source: "collection" });
  assert.deepEqual(resolveMargin(payload, ["3", "2"]), { minMarginPercent: 10, maxDiscountPercent: 20, source: "collection" });
  // No global minimum → 0 (never below the cost).
  assert.deepEqual(resolveMargin(readMarginPayload({ enabled: true, max: 50 }), []), { minMarginPercent: 0, maxDiscountPercent: 50, source: "global" });
});
