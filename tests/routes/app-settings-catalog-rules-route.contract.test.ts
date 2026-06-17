import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_1 (move-not-copy): Catalog Rules extracted into a standalone route that
// shares the action handler (catalog-rules-settings.server) and the UI
// (CatalogRulesView) with the legacy monolith workspace.

const CATALOG_RULES_ROUTE_PATH = "app/routes/app.settings.catalog-rules.tsx";
const CATALOG_RULES_VIEW_PATH = "app/components/catalog-rules-view.tsx";
const CATALOG_RULES_SERVER_PATH = "app/services/catalog-rules-settings.server.ts";

test("catalog-rules route is standalone, not a re-export of the settings monolith", async () => {
  const source = await readFile(CATALOG_RULES_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /from\s+"\.\/app\.settings"/,
    "Catalog Rules must be its own route, not re-export the app.settings monolith.",
  );
  assert.match(source, /export const loader/, "Catalog Rules route needs its own loader.");
  assert.match(source, /export const action/, "Catalog Rules route needs its own action.");
  assert.match(
    source,
    /export default function/,
    "Catalog Rules route needs its own component.",
  );
});

test("catalog-rules route renders the shared CatalogRulesView and delegates writes", async () => {
  const source = await readFile(CATALOG_RULES_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /<CatalogRulesView/,
    "Catalog Rules route must render the shared catalog rules view.",
  );
  assert.match(
    source,
    /handleCatalogRulesSettingsAction\(\{\s*admin,\s*formData\s*\}\)/,
    "Catalog Rules route action must delegate writes to the shared catalog-rules module.",
  );
  assert.match(
    source,
    /loadMarginGuardSettingsView/,
    "Catalog Rules route must load the enriched settings view so configured rules render imported catalog labels.",
  );
});

test("catalog-rules route preserves the storefront-projection + cart-validation tails", async () => {
  const source = await readFile(CATALOG_RULES_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /syncStorefrontProjectionMetafields/,
    "Catalog Rules route must run the storefront-projection sync tail for projected rule changes.",
  );
  assert.match(
    source,
    /intent === "save-product-visibility-rule"[\s\S]*?syncStorefrontProjectionMetafields/,
    "Projected product visibility changes must trigger storefront projection sync.",
  );
  assert.match(
    source,
    /ensureCartValidationActive\(admin\)/,
    "Catalog Rules route must re-activate cart validation after catalog rule writes.",
  );
});

test("shared catalog-rules view + server cover product, collection, and visibility rules", async () => {
  const [viewSource, serverSource] = await Promise.all([
    readFile(CATALOG_RULES_VIEW_PATH, "utf8"),
    readFile(CATALOG_RULES_SERVER_PATH, "utf8"),
  ]);

  for (const intent of [
    "save-product-floor",
    "save-product-tier-price",
    "save-product-quantity-rule",
    "save-product-step-quantity-rule",
    "save-product-max-quantity-rule",
    "save-product-customer-max-quantity-rule",
    "save-product-visibility-rule",
    "save-product-variant-visibility-rule",
    "save-collection-visibility-rule",
    "save-collection-max-quantity-rule",
  ]) {
    assert.match(
      viewSource,
      new RegExp(`saveIntent="${intent}"`),
      `Catalog rules view must expose the ${intent} form.`,
    );
    assert.match(
      serverSource,
      new RegExp(`"${intent}"`),
      `Catalog rules server must handle the ${intent} write.`,
    );
  }
});

test("catalog-rules module reuses AdminCatalogPicker and CompactRulePanel", async () => {
  const viewSource = await readFile(CATALOG_RULES_VIEW_PATH, "utf8");

  const pickerUsages = Array.from(viewSource.matchAll(/<AdminCatalogPicker/g));
  assert.equal(
    pickerUsages.length >= 12,
    true,
    "Catalog rules view must reuse AdminCatalogPicker across product, collection, customer, and variant forms.",
  );
  assert.match(viewSource, /resourceType="product"/);
  assert.match(viewSource, /resourceType="collection"/);
  assert.match(viewSource, /resourceType="customer"/);
  assert.match(viewSource, /resourceType="variant"/);
  assert.match(
    viewSource,
    /CompactRulePanel/,
    "Catalog rules view must share the global compact rule panel component.",
  );
  assert.match(
    viewSource,
    /Products affected in this section/,
    "Catalog rules view must surface the affected-products summary.",
  );
});

test("catalog-rules module stays isolated to catalog-rules intents only", async () => {
  const serverSource = await readFile(CATALOG_RULES_SERVER_PATH, "utf8");

  for (const foreignIntent of [
    "save-global",
    "save-coupon-segment-rule",
    "save-discount-rule",
    "save-discount-blacklist-rule",
    "sync-product-catalog",
  ]) {
    assert.doesNotMatch(
      serverSource,
      new RegExp(`"${foreignIntent}"`),
      `Catalog rules module must not handle the non-catalog intent ${foreignIntent}.`,
    );
  }
});
