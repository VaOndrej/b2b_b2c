import test from "node:test";
import assert from "node:assert/strict";
import { resolveCatalog } from "@won/core/catalog/catalog.resolver";
import type { CatalogResolutionEntry } from "@won/core/catalog/catalog.types";

/**
 * Market-filter resolution gaps (the base resolver test covers tags/priority/default).
 * Rules under test: an unset filter field means "any"; a set field must match exactly
 * (case-insensitive); a missing context for a set field never matches (never guesses);
 * market and audience are ANDed (matching a tag does not rescue a wrong market); and a
 * catalog carrying multiple filters matches when ANY one matches.
 */

const DEFAULT: CatalogResolutionEntry = {
  id: "default",
  priority: 0,
  isDefault: true,
  audienceTags: [],
  matchCompany: false,
};

function withCatalog(entry: Partial<CatalogResolutionEntry>): CatalogResolutionEntry {
  return {
    id: "market-cat",
    priority: 100,
    isDefault: false,
    audienceTags: ["market-tag"],
    matchCompany: false,
    ...entry,
  };
}

test("unset market field means 'any' — matches regardless of context", () => {
  const catalogs = [
    DEFAULT,
    withCatalog({ marketFilter: { countryCode: "CZ" } }),
  ];
  const id = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "CZ", currencyCode: "CZK", languageCode: "cs" },
    catalogs,
  });
  assert.equal(id, "market-cat", "currency/language unset on the filter → any");
});

test("set market field must match exactly (case-insensitive)", () => {
  const catalogs = [DEFAULT, withCatalog({ marketFilter: { countryCode: "cz" } })];
  const match = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "CZ" },
    catalogs,
  });
  assert.equal(match, "market-cat", "case-insensitive country match");

  const wrong = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "SK" },
    catalogs,
  });
  assert.equal(wrong, "default", "wrong country → falls back to default");
});

test("missing context for a set filter field never matches (no guessing)", () => {
  const catalogs = [DEFAULT, withCatalog({ marketFilter: { countryCode: "CZ" } })];
  const id = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { currencyCode: "CZK" }, // countryCode absent
    catalogs,
  });
  assert.equal(id, "default", "constrained on country but none given → no match");
});

test("market and audience are ANDed: right tag + wrong market does not match", () => {
  const catalogs = [DEFAULT, withCatalog({ marketFilter: { countryCode: "CZ" } })];
  const id = resolveCatalog({
    matchedTags: ["market-tag"], // audience matches
    marketContext: { countryCode: "DE" }, // market does not
    catalogs,
  });
  assert.equal(id, "default", "matching the tag must not rescue a wrong market");
});

test("a catalog with multiple filters matches when ANY one matches", () => {
  const catalogs = [
    DEFAULT,
    withCatalog({
      marketFilters: [{ countryCode: "CZ" }, { countryCode: "SK" }],
    }),
  ];
  const cz = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "CZ" },
    catalogs,
  });
  const sk = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "SK" },
    catalogs,
  });
  const de = resolveCatalog({
    matchedTags: ["market-tag"],
    marketContext: { countryCode: "DE" },
    catalogs,
  });
  assert.equal(cz, "market-cat", "matches first filter");
  assert.equal(sk, "market-cat", "matches second filter");
  assert.equal(de, "default", "matches neither → default");
});
