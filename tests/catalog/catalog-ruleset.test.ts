import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogConfigFromCatalogs,
  type CatalogTableInput,
} from "@won/core/config/function-config";
import {
  buildCatalogRulesets,
  findCatalogRuleset,
  type CatalogRulesetConfig,
} from "@won/core/catalog/catalog.ruleset";

// MVP_5_3 #2.3c — the per-catalog ruleset adapter feeds the (segment-shaped)
// conflict detector / webhook / preview from catalog tables. One ruleset per
// catalog; each carries the merged effective floor + the catalog's discount
// rules, so the cores run once per catalog instead of per B2B/B2C segment.

const SHOP = {
  b2bTag: "b2b",
  globalMinPricePercent: 70,
  allowZeroFinalPrice: false,
  maxCombinedPercentOff: 40,
};

function rulesetsFor(catalogs: CatalogTableInput[]) {
  const config = buildCatalogConfigFromCatalogs(SHOP, catalogs);
  return buildCatalogRulesets(config as unknown as CatalogRulesetConfig);
}

test("one ruleset per catalog, default + custom, with mapped audience", () => {
  const rulesets = rulesetsFor([
    { id: "default", isDefault: true, priority: 0 },
    { id: "gold", priority: 90, segment: "B2C", audienceTags: ["gold"] },
    { id: "b2b", priority: 80, segment: "B2B", matchCompany: true },
  ]);
  assert.deepEqual(
    rulesets.map((r) => r.catalogId).sort(),
    ["b2b", "default", "gold"],
  );
  assert.equal(findCatalogRuleset(rulesets, "default")?.isDefault, true);
  assert.equal(findCatalogRuleset(rulesets, "b2b")?.segment, "B2B");
  assert.deepEqual(findCatalogRuleset(rulesets, "gold")?.audienceTags, ["gold"]);
});

test("floor ruleset: catalog floor default inherits base, custom overrides", () => {
  const rulesets = rulesetsFor([
    { id: "default", isDefault: true, priority: 0 },
    { id: "gold", priority: 90, audienceTags: ["gold"], floorDefaultPercent: 50 },
    { id: "silver", priority: 80, audienceTags: ["silver"] },
  ]);
  // default = shop floor 70
  assert.equal(
    findCatalogRuleset(rulesets, "default")?.floorRuleset.global.minPercentOfBasePrice,
    70,
  );
  // gold overrides → 50
  assert.equal(
    findCatalogRuleset(rulesets, "gold")?.floorRuleset.global.minPercentOfBasePrice,
    50,
  );
  // silver has no floor of its own → inherits base (default) 70
  assert.equal(
    findCatalogRuleset(rulesets, "silver")?.floorRuleset.global.minPercentOfBasePrice,
    70,
  );
});

test("discount ruleset is scoped to the catalog (default = shop-wide, custom = own)", () => {
  const rulesets = rulesetsFor([
    { id: "default", isDefault: true, priority: 0, discountRules: [{ scope: "GLOBAL", percentOff: 5 }] },
    { id: "gold", priority: 90, audienceTags: ["gold"], discountRules: [{ scope: "GLOBAL", percentOff: 15 }] },
  ]);
  const def = findCatalogRuleset(rulesets, "default")!;
  const gold = findCatalogRuleset(rulesets, "gold")!;
  assert.equal(def.discountRuleset.rules?.length, 1);
  assert.equal(def.discountRuleset.rules?.[0].percentOff, 5);
  assert.equal(gold.discountRuleset.rules?.length, 1);
  assert.equal(gold.discountRuleset.rules?.[0].percentOff, 15);
  // shop-wide cap flows to every catalog unless overridden
  assert.equal(def.discountRuleset.maxCombinedPercentOff, 40);
  assert.equal(gold.discountRuleset.maxCombinedPercentOff, 40);
});

test("per-product floor + tier + override flatten into the catalog's arrays", () => {
  const PRODUCT = "gid://shopify/Product/1";
  const rulesets = rulesetsFor([
    { id: "default", isDefault: true, priority: 0 },
    {
      id: "gold",
      priority: 90,
      audienceTags: ["gold"],
      perProductFloors: [{ productId: PRODUCT, minPercentOfBasePrice: 55 }],
      priceRules: [{ scope: "PRODUCT", targetId: PRODUCT, mode: "FIXED", value: 42 }],
      tierPrices: [{ productId: PRODUCT, minQuantity: 10, unitPrice: 30 }],
    },
  ]);
  const gold = findCatalogRuleset(rulesets, "gold")!;
  const floor = gold.productFloors.find((f) => f.productId === PRODUCT);
  assert.equal(floor?.minPercentOfBasePrice, 55);
  assert.equal(floor?.b2bOverridePrice, 42);
  const tier = gold.productTierPrices.find((t) => t.productId === PRODUCT);
  assert.deepEqual({ min: tier?.minQuantity, unit: tier?.unitPrice }, { min: 10, unit: 30 });
});
