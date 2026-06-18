import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogConfigFromCatalogs,
  type CatalogTableInput,
  type CatalogShopScalars,
} from "../../core/config/function-config.ts";
import { mergeCatalogLayer } from "../../core/catalog/catalog.merge.ts";

const SHOP: CatalogShopScalars = {
  b2bTag: "b2b",
  globalMinPricePercent: 70,
  allowZeroFinalPrice: false,
  allowStacking: false,
  maxCombinedPercentOff: null,
};

const CATALOGS: CatalogTableInput[] = [
  {
    id: "default",
    isDefault: true,
    priority: 0,
    floorDefaultPercent: 75,
    perProductFloors: [{ productId: "P1", minPercentOfBasePrice: 80 }],
    discountRules: [{ scope: "GLOBAL", percentOff: 10 }],
  },
  {
    id: "b2b",
    priority: 100,
    matchCompany: true,
    segment: "B2B",
    audienceTags: ["b2b"],
    perProductFloors: [{ productId: "P2", minPercentOfBasePrice: 60 }],
  },
  {
    id: "gold",
    priority: 90,
    audienceTags: ["gold"],
    priceRules: [{ scope: "CATALOG", mode: "PERCENT", value: 80 }],
    coupons: ["VIP20"],
    discountCapPercent: 40,
    discountRules: [{ scope: "GLOBAL", percentOff: 15 }],
  },
];

test("buildCatalogConfigFromCatalogs: base comes from the default catalog + shop scalars", () => {
  const cfg = buildCatalogConfigFromCatalogs(SHOP, CATALOGS);
  assert.equal(cfg.defaultCatalogId, "default");
  assert.equal((cfg.base as any).globalMinPricePercent, 75);
  assert.equal((cfg.base as any).perProductFloorPercents.P1, 80);
});

test("buildCatalogConfigFromCatalogs: b2b/custom inherit default and apply overrides", () => {
  const cfg = buildCatalogConfigFromCatalogs(SHOP, CATALOGS);
  const cats = cfg.catalogs as Record<string, any>;
  const b2b = mergeCatalogLayer(cfg.base as any, cats.b2b);
  assert.equal(b2b.perProductFloorPercents.P1, 80, "inherits default floor");
  assert.equal(b2b.perProductFloorPercents.P2, 60, "own override");
  const gold = mergeCatalogLayer(cfg.base as any, cats.gold);
  assert.equal(gold.pricePercent, 80);
  assert.equal(gold.globalMinPricePercent, 75, "inherits default global floor");
});

test("buildCatalogConfigFromCatalogs: cross-cutting scoping (coupon/cap/discount catalogId)", () => {
  const cfg = buildCatalogConfigFromCatalogs(SHOP, CATALOGS);
  assert.deepEqual((cfg as any).couponCatalogRules.VIP20, ["gold"]);
  assert.equal((cfg as any).discountCatalogCaps.gold, 40);
  const discounts = cfg.discountRules as Array<any>;
  const defaultDiscount = discounts.find((r) => r.percentOff === 10);
  const goldDiscount = discounts.find((r) => r.percentOff === 15);
  assert.equal(defaultDiscount.catalogId, null, "default catalog discount is shop-wide");
  assert.equal(goldDiscount.catalogId, "gold", "custom catalog discount is catalogId-scoped");
});

test("buildCatalogConfigFromCatalogs: resolution metadata + catalogTags", () => {
  const cfg = buildCatalogConfigFromCatalogs(SHOP, CATALOGS);
  const entries = cfg.catalogResolution as Array<any>;
  assert.equal(entries.length, 3);
  assert.equal(entries.find((e) => e.id === "b2b").matchCompany, true);
  assert.equal(entries.find((e) => e.id === "b2b").segment, "B2B");
  assert.equal(entries.find((e) => e.id === "gold").segment, "B2C");
  assert.ok(cfg.catalogTags.includes("b2b"));
  assert.ok(cfg.catalogTags.includes("gold"));
});
