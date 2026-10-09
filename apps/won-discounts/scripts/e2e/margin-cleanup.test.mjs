// Unit tests of the no-backup cleanup's recognition of the stored margin
// settings (scripts/e2e/margin-cleanup.mjs, Task 5b fix round 1).
//
//   node --test apps/won-discounts/scripts/e2e/margin-cleanup.test.mjs
//
// Kept next to the script, not under tests/: tests/e2e is Playwright's testDir
// and its default testMatch would load a *.test file there as a browser spec.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_MAX_DISCOUNT_PERCENT, classifyStoredMargin } from "./margin-cleanup.mjs";
import { marginModule } from "./margin-fixture.mjs";
import { tiersMarginModule } from "./tiers-fixture.mjs";

const COLLECTION = "gid://shopify/Collection/491958272241";
const OTHER_COLLECTION = "gid://shopify/Collection/1";
const onlyFixture = { isFixtureCollection: (id) => id === COLLECTION };
const none = { isFixtureCollection: () => false };
const defaults = () => ({ enabled: false, global: { maxDiscountPercent: DEFAULT_MAX_DISCOUNT_PERCENT }, perCollection: [] });

describe("classifyStoredMargin", () => {
  it("the defaults (and a missing module) need nothing", () => {
    assert.deepEqual(classifyStoredMargin(defaults(), none), { kind: "default" });
    assert.deepEqual(classifyStoredMargin(undefined, none), { kind: "default" });
  });

  it("recognises the phase A seed (margin): on, and switched off with its values kept", () => {
    assert.deepEqual(classifyStoredMargin(marginModule(), none), { kind: "fixture", profile: "margin" });
    assert.deepEqual(classifyStoredMargin({ ...marginModule(), enabled: false }, none), { kind: "fixture", profile: "margin" });
  });

  it("recognises the Pro seed (margin-pro) with the E2E test collection", () => {
    assert.deepEqual(classifyStoredMargin(marginModule(COLLECTION), onlyFixture), { kind: "fixture", profile: "margin-pro", collectionId: COLLECTION });
    assert.deepEqual(classifyStoredMargin(marginModule(COLLECTION, "gid://shopify/Product/1"), onlyFixture), { kind: "fixture", profile: "margin-pro", collectionId: COLLECTION });
    // A config stored before the product settings has no `perProduct` key at all.
    const { perProduct: _none, ...legacy } = marginModule(COLLECTION);
    assert.deepEqual(classifyStoredMargin(legacy, onlyFixture), { kind: "fixture", profile: "margin-pro", collectionId: COLLECTION });
  });

  it("recognises the tiers seed (MVP 3): min margin 30 %, max 30 %, no override, on or off", () => {
    assert.deepEqual(classifyStoredMargin(tiersMarginModule(), none), { kind: "fixture", profile: "tiers" });
    assert.deepEqual(classifyStoredMargin({ ...tiersMarginModule(), enabled: false }, none), { kind: "fixture", profile: "tiers" });
    const withOverride = { ...tiersMarginModule(), perCollection: [{ collectionId: COLLECTION, maxDiscountPercent: 10 }] };
    assert.equal(classifyStoredMargin(withOverride, onlyFixture).kind, "foreign");
  });

  it("does not depend on key order (the sanitizer may rebuild the objects)", () => {
    const reordered = {
      perCollection: [{ maxDiscountPercent: 10, collectionId: COLLECTION }],
      global: { maxDiscountPercent: 30, minMarginPercent: 25 },
      enabled: true,
    };
    assert.equal(classifyStoredMargin(reordered, onlyFixture).kind, "fixture");
  });

  it("refuses the Pro shape on another collection", () => {
    const result = classifyStoredMargin(marginModule(OTHER_COLLECTION), onlyFixture);
    assert.equal(result.kind, "foreign");
    assert.match(result.reason, /not the E2E test collection/u);
  });

  it("refuses foreign shapes and says why", () => {
    const cases = [
      [{ enabled: true, global: { maxDiscountPercent: 40 }, perCollection: [] }, /global settings/u],
      [{ enabled: true, global: { minMarginPercent: 25, maxDiscountPercent: 20 }, perCollection: [] }, /global settings/u],
      [{ ...marginModule(COLLECTION), perCollection: [{ collectionId: COLLECTION, maxDiscountPercent: 15 }] }, /collection override/u],
      [{ ...marginModule(COLLECTION), perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40, maxDiscountPercent: 10 }] }, /collection override/u],
      [{ ...marginModule(COLLECTION), perCollection: [{ collectionId: COLLECTION, maxDiscountPercent: 10 }, { collectionId: OTHER_COLLECTION, maxDiscountPercent: 10 }] }, /2 collection overrides/u],
      [{ ...marginModule(), extra: 1 }, /unexpected fields/u],
      // Products with their own setting (9 Oct 2026): only the Pro fixture's one, and only with its collection.
      [{ ...marginModule(COLLECTION, "gid://shopify/Product/1"), perProduct: [{ productId: "gid://shopify/Product/1", maxDiscountPercent: 5 }] }, /product settings/u],
      [{ ...marginModule(COLLECTION, "gid://shopify/Product/1"), perProduct: [{ productId: "gid://shopify/Product/1", minMarginPercent: 5, maxDiscountPercent: 20 }] }, /product settings/u],
      [marginModule(undefined, "gid://shopify/Product/1"), /product setting without/u],
      [{ enabled: "true", global: { minMarginPercent: 25, maxDiscountPercent: 30 }, perCollection: [] }, /not a boolean/u],
      ["on", /not an object/u],
    ];
    for (const [margin, reason] of cases) {
      const result = classifyStoredMargin(margin, onlyFixture);
      assert.equal(result.kind, "foreign", JSON.stringify(margin));
      assert.match(result.reason, reason, JSON.stringify(margin));
    }
  });
});
