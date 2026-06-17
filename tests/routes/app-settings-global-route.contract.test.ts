import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_1 Part B: Global Settings is extracted from the app.settings.tsx monolith
// into a standalone route. These contract tests lock in that the route is truly
// self-contained (own loader/action/component, only global intents) and keeps the
// MVP_4_5 catalog-foundation UI + save-global behavior the monolith guaranteed.

const GLOBAL_ROUTE_PATH = "app/routes/app.settings.global.tsx";

test("global settings route is standalone, not a re-export of the settings monolith", async () => {
  const source = await readFile(GLOBAL_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /from\s+"\.\/app\.settings"/,
    "Global Settings must be its own route, not re-export the app.settings monolith.",
  );
  assert.match(
    source,
    /export const loader/,
    "Global Settings route must declare its own loader.",
  );
  assert.match(
    source,
    /export const action/,
    "Global Settings route must declare its own action.",
  );
  assert.match(
    source,
    /export default function/,
    "Global Settings route must declare its own component.",
  );
});

test("global settings route exposes the catalog import foundation controls", async () => {
  const source = await readFile(GLOBAL_ROUTE_PATH, "utf8");

  assert.match(source, /Product catalog foundation/);
  assert.match(source, /Collection catalog foundation/);
  assert.match(source, /Shopify Catalog/);
  assert.match(source, /Shopify Collections/);
  assert.match(source, /CSV \/ JSON Import/);
  assert.match(source, /ERP Integration/);
  assert.match(
    source,
    /intent"\s+value="sync-product-catalog"/,
    "Global Settings must expose the product import action.",
  );
  assert.match(
    source,
    /intent"\s+value="sync-collection-catalog"/,
    "Global Settings must expose the collection import action.",
  );
  assert.match(source, /Import products now/);
  assert.match(source, /Import collections now/);
  assert.match(
    source,
    /name="productCatalogAutoImportEnabled"/,
    "Global Settings must keep the product catalog auto-import toggle.",
  );
  assert.match(
    source,
    /type="hidden"\s+name="productCatalogSourceType"/,
    "Global Settings must persist the catalog source without the legacy select.",
  );
  assert.doesNotMatch(
    source,
    /<select\s+name="productCatalogSourceType"/,
    "Global Settings must not expose the legacy productCatalogSourceType select.",
  );
});

test("global settings route persists save-global with the marginGuardEnabled toggle", async () => {
  const source = await readFile(GLOBAL_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /intent\s*===\s*"save-global"/,
    "Global Settings action must handle the save-global intent.",
  );
  assert.match(
    source,
    /formData\.get\("marginGuardEnabled"\)\s*===\s*"on"/,
    "save-global must parse marginGuardEnabled as a checkbox 'on'.",
  );
  assert.match(
    source,
    /updateGlobalMarginGuardConfig\(\{[\s\S]*marginGuardEnabled[\s\S]*\}\)/,
    "save-global must persist marginGuardEnabled via updateGlobalMarginGuardConfig.",
  );
  assert.match(
    source,
    /name="marginGuardEnabled"/,
    "Global Settings UI must render the marginGuardEnabled checkbox.",
  );
});

test("global settings route stays isolated to global intents only", async () => {
  const source = await readFile(GLOBAL_ROUTE_PATH, "utf8");

  for (const foreignIntent of [
    "save-product-floor",
    "save-product-quantity-rule",
    "save-product-visibility-rule",
    "save-coupon-segment-rule",
    "save-discount-rule",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`"${foreignIntent}"`),
      `Global Settings route must not handle the non-global intent ${foreignIntent}.`,
    );
  }
});
