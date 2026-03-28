import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveContentRules,
  resolveHiddenCollections,
  resolveCollectionRedirectMessage,
  resolveStorefrontContent,
} from "../../core/storefront/storefront-content.engine.ts";
import type {
  StorefrontContentRule,
  CollectionVisibilityRule,
} from "../../core/storefront/storefront-content.types.ts";

function makeRule(overrides: Partial<StorefrontContentRule> = {}): StorefrontContentRule {
  return {
    id: "rule-1",
    name: "Test rule",
    active: true,
    priority: 100,
    segment: "B2B",
    pageType: "ALL",
    productId: null,
    collectionId: null,
    targetType: "CSS_SELECTOR",
    targetSelector: ".hero-banner img",
    targetPosition: null,
    action: "SWAP_IMAGE",
    value: "https://cdn.example.com/b2b-banner.jpg",
    valueCsLocale: null,
    ...overrides,
  };
}

function makeCollectionRule(
  overrides: Partial<CollectionVisibilityRule> = {},
): CollectionVisibilityRule {
  return {
    id: "col-1",
    collectionId: "gid://shopify/Collection/1",
    collectionHandle: "velkoobchod",
    collectionTitle: "Velkoobchod",
    visibilityMode: "B2B_ONLY",
    ...overrides,
  };
}

// ─── resolveContentRules ─────────────────────────────────────

test("returns matching rules for B2B segment", () => {
  const rules = [
    makeRule({ segment: "B2B", name: "B2B banner" }),
    makeRule({ segment: "B2C", name: "B2C banner", id: "rule-2" }),
  ];

  const result = resolveContentRules({
    segment: "B2B",
    pageType: "HOME",
    rules,
    collectionVisibilityRules: [],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].targetSelector, ".hero-banner img");
  assert.equal(result[0].action, "SWAP_IMAGE");
});

test("filters inactive rules", () => {
  const rules = [makeRule({ active: false })];

  const result = resolveContentRules({
    segment: "B2B",
    pageType: "ALL",
    rules,
    collectionVisibilityRules: [],
  });

  assert.equal(result.length, 0);
});

test("ALL page type matches any page", () => {
  const rules = [makeRule({ pageType: "ALL" })];

  for (const pageType of ["HOME", "PRODUCT", "COLLECTION", "CART", "PAGE"] as const) {
    const result = resolveContentRules({
      segment: "B2B",
      pageType,
      rules,
      collectionVisibilityRules: [],
    });
    assert.equal(result.length, 1, `Expected match for page type ${pageType}`);
  }
});

test("PRODUCT page type only matches product pages", () => {
  const rules = [makeRule({ pageType: "PRODUCT" })];

  const matchResult = resolveContentRules({
    segment: "B2B",
    pageType: "PRODUCT",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(matchResult.length, 1);

  const noMatchResult = resolveContentRules({
    segment: "B2B",
    pageType: "HOME",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(noMatchResult.length, 0);
});

test("filters by productId when specified on rule and input", () => {
  const rules = [
    makeRule({
      pageType: "PRODUCT",
      productId: "gid://shopify/Product/123",
      name: "Specific product rule",
    }),
  ];

  const matchResult = resolveContentRules({
    segment: "B2B",
    pageType: "PRODUCT",
    productId: "gid://shopify/Product/123",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(matchResult.length, 1);

  const noMatchResult = resolveContentRules({
    segment: "B2B",
    pageType: "PRODUCT",
    productId: "gid://shopify/Product/999",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(noMatchResult.length, 0);
});

test("sorts rules by priority ascending", () => {
  const rules = [
    makeRule({ priority: 200, name: "Low priority", id: "r1", value: "second" }),
    makeRule({ priority: 50, name: "High priority", id: "r2", value: "first" }),
  ];

  const result = resolveContentRules({
    segment: "B2B",
    pageType: "ALL",
    rules,
    collectionVisibilityRules: [],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].value, "first");
  assert.equal(result[1].value, "second");
});

test("resolves Czech locale value when available", () => {
  const rules = [
    makeRule({
      value: "Wholesale prices active",
      valueCsLocale: "Velkoobchodní ceny aktivní",
    }),
  ];

  const enResult = resolveContentRules({
    segment: "B2B",
    pageType: "ALL",
    locale: "en",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(enResult[0].value, "Wholesale prices active");

  const csResult = resolveContentRules({
    segment: "B2B",
    pageType: "ALL",
    locale: "cs",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(csResult[0].value, "Velkoobchodní ceny aktivní");
});

test("falls back to EN value when CS locale not provided", () => {
  const rules = [makeRule({ value: "EN only", valueCsLocale: null })];

  const result = resolveContentRules({
    segment: "B2B",
    pageType: "ALL",
    locale: "cs",
    rules,
    collectionVisibilityRules: [],
  });
  assert.equal(result[0].value, "EN only");
});

// ─── resolveHiddenCollections ────────────────────────────────

test("hides B2B_ONLY collections from B2C customers", () => {
  const rules = [makeCollectionRule({ visibilityMode: "B2B_ONLY" })];
  const result = resolveHiddenCollections("B2C", rules);
  assert.deepEqual(result, ["velkoobchod"]);
});

test("does not hide B2B_ONLY collections from B2B customers", () => {
  const rules = [makeCollectionRule({ visibilityMode: "B2B_ONLY" })];
  const result = resolveHiddenCollections("B2B", rules);
  assert.deepEqual(result, []);
});

test("hides B2C_ONLY collections from B2B customers", () => {
  const rules = [
    makeCollectionRule({
      visibilityMode: "B2C_ONLY",
      collectionHandle: "retail-only",
    }),
  ];
  const result = resolveHiddenCollections("B2B", rules);
  assert.deepEqual(result, ["retail-only"]);
});

test("does not hide B2C_ONLY collections from B2C customers", () => {
  const rules = [
    makeCollectionRule({ visibilityMode: "B2C_ONLY" }),
  ];
  const result = resolveHiddenCollections("B2C", rules);
  assert.deepEqual(result, []);
});

test("handles multiple collection rules", () => {
  const rules = [
    makeCollectionRule({
      id: "c1",
      collectionHandle: "wholesale",
      visibilityMode: "B2B_ONLY",
    }),
    makeCollectionRule({
      id: "c2",
      collectionId: "gid://shopify/Collection/2",
      collectionHandle: "b2b-catalog",
      visibilityMode: "B2B_ONLY",
    }),
    makeCollectionRule({
      id: "c3",
      collectionId: "gid://shopify/Collection/3",
      collectionHandle: "retail-special",
      visibilityMode: "B2C_ONLY",
    }),
  ];

  const b2cResult = resolveHiddenCollections("B2C", rules);
  assert.deepEqual(b2cResult.sort(), ["b2b-catalog", "wholesale"]);

  const b2bResult = resolveHiddenCollections("B2B", rules);
  assert.deepEqual(b2bResult, ["retail-special"]);
});

// ─── resolveCollectionRedirectMessage ────────────────────────

test("returns English redirect message by default", () => {
  const msg = resolveCollectionRedirectMessage("en");
  assert.ok(msg.includes("not available"));
});

test("returns Czech redirect message for CS locale", () => {
  const msg = resolveCollectionRedirectMessage("cs-CZ");
  assert.ok(msg.includes("dostupna"));
});

// ─── resolveStorefrontContent (integration) ──────────────────

test("resolveStorefrontContent returns complete output", () => {
  const contentRules = [
    makeRule({ segment: "B2B" }),
    makeRule({ segment: "B2C", id: "r2", name: "B2C rule" }),
  ];
  const collectionRules = [
    makeCollectionRule({ visibilityMode: "B2B_ONLY" }),
  ];

  const result = resolveStorefrontContent({
    segment: "B2B",
    pageType: "HOME",
    rules: contentRules,
    collectionVisibilityRules: collectionRules,
  });

  assert.equal(result.segment, "B2B");
  assert.equal(result.contentRules.length, 1);
  assert.deepEqual(result.hiddenCollections, []);
  assert.ok(result.collectionRedirectMessage.length > 0);
});

test("resolveStorefrontContent hides collections for B2C", () => {
  const result = resolveStorefrontContent({
    segment: "B2C",
    pageType: "HOME",
    rules: [],
    collectionVisibilityRules: [
      makeCollectionRule({ visibilityMode: "B2B_ONLY" }),
    ],
  });

  assert.deepEqual(result.hiddenCollections, ["velkoobchod"]);
});
