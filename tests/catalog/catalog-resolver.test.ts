import test from "node:test";
import assert from "node:assert/strict";
import { resolveCatalog } from "#core/catalog/catalog.resolver";
import type { CatalogResolutionEntry } from "#core/catalog/catalog.types";

// Phase 1 seed: default (anonymous/B2C fallback) + b2b (company or b2b tag).
const PHASE1_CATALOGS: CatalogResolutionEntry[] = [
  { id: "default", priority: 0, isDefault: true, audienceTags: [], matchCompany: false },
  { id: "b2b", priority: 100, isDefault: false, audienceTags: ["b2b"], matchCompany: true },
];

test("resolveCatalog: anonymous / untagged customer falls back to default", () => {
  assert.equal(
    resolveCatalog({ matchedTags: [], hasPurchasingCompany: false, catalogs: PHASE1_CATALOGS }),
    "default",
  );
});

test("resolveCatalog: purchasing company routes to b2b even without tag", () => {
  assert.equal(
    resolveCatalog({ matchedTags: [], hasPurchasingCompany: true, catalogs: PHASE1_CATALOGS }),
    "b2b",
  );
});

test("resolveCatalog: b2b tag routes to b2b (case-insensitive)", () => {
  assert.equal(
    resolveCatalog({ matchedTags: ["B2B"], hasPurchasingCompany: false, catalogs: PHASE1_CATALOGS }),
    "b2b",
  );
});

test("resolveCatalog: non-matching tag falls back to default", () => {
  assert.equal(
    resolveCatalog({ matchedTags: ["vip"], hasPurchasingCompany: false, catalogs: PHASE1_CATALOGS }),
    "default",
  );
});

test("resolveCatalog: highest priority wins among multiple audience matches", () => {
  const catalogs: CatalogResolutionEntry[] = [
    { id: "default", priority: 0, isDefault: true, audienceTags: [], matchCompany: false },
    { id: "loyalty-silver", priority: 50, isDefault: false, audienceTags: ["loyal"], matchCompany: false },
    { id: "loyalty-gold", priority: 90, isDefault: false, audienceTags: ["gold"], matchCompany: false },
  ];
  // Carries both tags → highest-priority (gold) wins.
  assert.equal(
    resolveCatalog({ matchedTags: ["loyal", "gold"], catalogs }),
    "loyalty-gold",
  );
  // Carries only the silver tag → silver.
  assert.equal(
    resolveCatalog({ matchedTags: ["loyal"], catalogs }),
    "loyalty-silver",
  );
});

test("resolveCatalog: equal priority resolves deterministically by id", () => {
  const catalogs: CatalogResolutionEntry[] = [
    { id: "default", priority: 0, isDefault: true, audienceTags: [], matchCompany: false },
    { id: "zeta", priority: 50, isDefault: false, audienceTags: ["x"], matchCompany: false },
    { id: "alpha", priority: 50, isDefault: false, audienceTags: ["x"], matchCompany: false },
  ];
  assert.equal(resolveCatalog({ matchedTags: ["x"], catalogs }), "alpha");
});

test("resolveCatalog: market filter must match when set (Q2 second axis)", () => {
  const catalogs: CatalogResolutionEntry[] = [
    { id: "default", priority: 0, isDefault: true, audienceTags: [], matchCompany: false },
    {
      id: "cz-wholesale",
      priority: 100,
      isDefault: false,
      audienceTags: ["b2b"],
      matchCompany: false,
      marketFilter: { countryCode: "CZ", currencyCode: "CZK" },
    },
  ];
  // Audience matches AND market matches → catalog selected.
  assert.equal(
    resolveCatalog({
      matchedTags: ["b2b"],
      marketContext: { countryCode: "cz", currencyCode: "czk", languageCode: "cs" },
      catalogs,
    }),
    "cz-wholesale",
  );
  // Audience matches but market does not → fall back to default.
  assert.equal(
    resolveCatalog({
      matchedTags: ["b2b"],
      marketContext: { countryCode: "DE", currencyCode: "EUR" },
      catalogs,
    }),
    "default",
  );
  // Market context entirely missing a constrained field → no match.
  assert.equal(
    resolveCatalog({ matchedTags: ["b2b"], catalogs }),
    "default",
  );
});

test("resolveCatalog: returns null when no default exists", () => {
  const catalogs: CatalogResolutionEntry[] = [
    { id: "b2b", priority: 100, isDefault: false, audienceTags: ["b2b"], matchCompany: true },
  ];
  assert.equal(resolveCatalog({ matchedTags: [], catalogs }), null);
});
