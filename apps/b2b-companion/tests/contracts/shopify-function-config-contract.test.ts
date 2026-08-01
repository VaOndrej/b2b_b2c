import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCatalogConfigFromCatalogs,
  type CatalogTableInput,
} from "@won/core/config/function-config";

// MVP_5_3 #2.3 — the legacy *B2C/*B2B builders were deleted; per-facet mapping is
// now covered by catalog-from-tables + catalog-custom-runtime. This file keeps
// the contract between the Shopify Function input queries / extension toml and
// the catalog-native config payload.

const CART_VALIDATION_QUERY_PATH =
  "extensions/margin-guard-cart-validation/src/cart_validations_generate_run.graphql";
const DISCOUNT_QUERY_PATH =
  "extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.graphql";
const CART_VALIDATION_TOML_PATH =
  "extensions/margin-guard-cart-validation/shopify.extension.toml";

test("both function queries declare b2bTags + catalogTags + collectionIds with fallbacks", async () => {
  const [cartQuery, discountQuery] = await Promise.all([
    readFile(CART_VALIDATION_QUERY_PATH, "utf8"),
    readFile(DISCOUNT_QUERY_PATH, "utf8"),
  ]);
  for (const [name, query] of [
    ["cart validation", cartQuery],
    ["discount", discountQuery],
  ] as const) {
    assert.match(query, /\$b2bTags:\s*\[String!\]!\s*=\s*\["b2b"\]/, `[${name}] $b2bTags fallback`);
    assert.match(query, /hasAnyTag\(tags:\s*\$b2bTags\)/, `[${name}] hasAnyTag($b2bTags)`);
    assert.match(query, /\$catalogTags:\s*\[String!\]!\s*=\s*\[\]/, `[${name}] $catalogTags`);
    assert.match(query, /hasTags\(tags:\s*\$catalogTags\)/, `[${name}] hasTags($catalogTags)`);
    assert.match(query, /\$collectionIds:\s*\[ID!\]/, `[${name}] $collectionIds`);
    assert.match(query, /inCollections\(ids:\s*\$collectionIds\)/, `[${name}] inCollections`);
    assert.match(
      query,
      /purchasingCompany\s*\{[\s\S]*company\s*\{[\s\S]*id/,
      `[${name}] purchasingCompany for B2B role precedence`,
    );
    assert.match(
      query,
      /\.\.\.\s*on ProductVariant\s*\{[\s\S]*id/,
      `[${name}] merchandise variant id for variant-level rules`,
    );
    assert.match(
      query,
      /localization\s*\{[\s\S]*language\s*\{[\s\S]*isoCode/,
      `[${name}] localization.language.isoCode`,
    );
    assert.match(
      query,
      /country\s*\{[\s\S]*isoCode/,
      `[${name}] localization.country.isoCode for market-scoped catalogs`,
    );
  }
});

test("discount query reads entered codes + cart cost (incl. tax) for combined-cap detection", async () => {
  const query = await readFile(DISCOUNT_QUERY_PATH, "utf8");
  assert.match(query, /enteredDiscountCodes\s*\{[\s\S]*code[\s\S]*rejectable/);
  assert.match(
    query,
    /cart\s*\{[\s\S]*cost\s*\{[\s\S]*subtotalAmount[\s\S]*totalAmount[\s\S]*totalTaxAmount/,
  );
});

test("cart validation extension maps input variables from the metafield config", async () => {
  const toml = await readFile(CART_VALIDATION_TOML_PATH, "utf8");
  assert.match(
    toml,
    /\[extensions\.input\.variables\][\s\S]*namespace\s*=\s*"\$app:margin_guard"[\s\S]*key\s*=\s*"config"/,
  );
});

test("catalog config exports b2bTags + catalogTags (b2b + custom audience tags)", () => {
  const catalogs: CatalogTableInput[] = [
    { id: "default", isDefault: true, priority: 0 },
    { id: "gold", priority: 90, audienceTags: ["gold"], discountRules: [{ scope: "GLOBAL", percentOff: 10 }] },
  ];
  const config = buildCatalogConfigFromCatalogs(
    { b2bTag: " wholesale ", globalMinPricePercent: 70, allowZeroFinalPrice: false },
    catalogs,
  );
  assert.deepEqual(config.b2bTags, ["wholesale"]);
  assert.deepEqual(config.catalogTags.sort(), ["gold", "wholesale"]);
});
