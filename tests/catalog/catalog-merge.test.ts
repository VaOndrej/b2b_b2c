import test from "node:test";
import assert from "node:assert/strict";
import { mergeCatalogLayer } from "@won/core/catalog/catalog.merge";
import type { CatalogPricingLayer } from "@won/core/catalog/catalog.types";

/**
 * Direct coverage for mergeCatalogLayer (delta-over-base). Previously only exercised
 * transitively via buildCatalogConfigFromCatalogs — these pin the merge contract
 * itself: scalar resolution, documented defaults, per-key record merge, and the fact
 * that a delta value of 0/false is honored (not treated as absent).
 */

test("empty base + empty delta resolves to documented defaults", () => {
  const merged = mergeCatalogLayer({});
  assert.equal(merged.globalMinPricePercent, 70);
  assert.equal(merged.allowZeroFinalPrice, false);
  assert.equal(merged.pricePercent, null);
  // Every record map is materialized (present, empty) so the runtime can index safely.
  assert.deepEqual(merged.perProductFloorPercents, {});
  assert.deepEqual(merged.perProductPricePercents, {});
});

test("scalar resolution: delta ?? base ?? default", () => {
  const base: CatalogPricingLayer = {
    globalMinPricePercent: 75,
    allowZeroFinalPrice: true,
    pricePercent: 90,
  };
  // delta absent → base wins
  const fromBase = mergeCatalogLayer(base);
  assert.equal(fromBase.globalMinPricePercent, 75);
  assert.equal(fromBase.allowZeroFinalPrice, true);
  assert.equal(fromBase.pricePercent, 90);

  // delta present → delta wins
  const fromDelta = mergeCatalogLayer(base, {
    globalMinPricePercent: 60,
    pricePercent: 80,
  });
  assert.equal(fromDelta.globalMinPricePercent, 60);
  assert.equal(fromDelta.pricePercent, 80);
  assert.equal(fromDelta.allowZeroFinalPrice, true, "unset delta scalar inherits base");
});

test("delta value of 0 / false is honored, not treated as absent", () => {
  const base: CatalogPricingLayer = {
    globalMinPricePercent: 70,
    allowZeroFinalPrice: true,
  };
  const merged = mergeCatalogLayer(base, {
    globalMinPricePercent: 0,
    allowZeroFinalPrice: false,
  });
  assert.equal(merged.globalMinPricePercent, 0, "0 must override, not fall through to base");
  assert.equal(merged.allowZeroFinalPrice, false, "false must override, not fall through");
});

test("record maps merge per key: delta overrides, unmatched base survives", () => {
  const base: CatalogPricingLayer = {
    perProductFloorPercents: { P1: 80, P2: 60 },
  };
  const delta: CatalogPricingLayer = {
    perProductFloorPercents: { P2: 65, P3: 50 },
  };
  const merged = mergeCatalogLayer(base, delta);
  assert.equal(merged.perProductFloorPercents.P1, 80, "base-only key survives");
  assert.equal(merged.perProductFloorPercents.P2, 65, "delta overrides base");
  assert.equal(merged.perProductFloorPercents.P3, 50, "delta-only key added");
});

test("tier-array map entries are replaced wholesale by the delta, not concatenated", () => {
  const base: CatalogPricingLayer = {
    perProductTierPrices: {
      P1: [{ minQuantity: 5, unitPrice: 90 }],
    },
  };
  const delta: CatalogPricingLayer = {
    perProductTierPrices: {
      P1: [{ minQuantity: 10, unitPrice: 80 }],
    },
  };
  const merged = mergeCatalogLayer(base, delta);
  assert.deepEqual(
    merged.perProductTierPrices.P1,
    [{ minQuantity: 10, unitPrice: 80 }],
    "delta array replaces the base array for that key",
  );
});
