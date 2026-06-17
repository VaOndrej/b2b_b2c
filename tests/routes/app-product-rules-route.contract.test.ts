import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_1 (hybrid menu, readme.txt:126): the cross-cutting per-product view shows
// every rule targeting one product across all modules. It is read-only and reads
// the same MarginGuardConfig the per-module workspaces edit.

const ROUTE_PATH = "app/routes/app.product-rules.tsx";
const PANEL_PATH = "app/components/product-rules-panel.tsx";
const APP_SHELL_PATH = "app/routes/app.tsx";

test("product-rules route is standalone and renders the cross-module panel", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /from\s+"\.\/app\.settings"/,
    "Product Rules must be its own route, not re-export a settings monolith.",
  );
  assert.match(source, /export const loader/, "Product Rules route needs its own loader.");
  assert.match(source, /export default function/, "Product Rules route needs its own component.");
  assert.match(
    source,
    /loadMarginGuardSettingsView/,
    "Product Rules route must load the enriched settings view to resolve catalog labels.",
  );
  assert.match(
    source,
    /<ProductRulesPanel/,
    "Product Rules route must render the reusable cross-module panel.",
  );
  assert.match(
    source,
    /resourceType="product"/,
    "Product Rules route must let the merchant pick a product via AdminCatalogPicker.",
  );
});

test("product-rules route is read-only (no action / no rule writes)", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /export const action/,
    "Product Rules is a read-only cross-cutting view; it must not own rule writes.",
  );
});

test("product rules panel summarizes rules across every module", async () => {
  const source = await readFile(PANEL_PATH, "utf8");

  for (const moduleLabel of [
    "Margin Guard",
    "B2B Pricing",
    "Quantity Rules",
    "Segmented Storefront",
  ]) {
    assert.match(
      source,
      new RegExp(moduleLabel),
      `Cross-module panel must attribute rules to the ${moduleLabel} module.`,
    );
  }

  for (const ruleSource of [
    "productFloors",
    "productTierPrices",
    "productQuantityRules",
    "productCustomerQuantityRules",
    "productVisibilityRules",
    "productVariantVisibilityRules",
    "discountRules",
  ]) {
    assert.match(
      source,
      new RegExp(ruleSource),
      `Cross-module panel must collect ${ruleSource} for the selected product.`,
    );
  }

  assert.match(
    source,
    /matches\(rule\.productId\)/,
    "Cross-module panel must filter rules to the selected product id.",
  );
});

test("app shell exposes the Product Rules cross-cutting nav entry", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8");

  assert.match(
    source,
    /href="\/app\/product-rules"/,
    "The hybrid menu must expose a top-level Product Rules entry alongside the module tabs.",
  );
});
