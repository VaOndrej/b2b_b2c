import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_3 Phase 2 — the catalog editor route (per-facet tabs) is standalone,
// renders the shared CatalogEditorView, and delegates every facet write to
// handleCatalogsSettingsAction (move-not-copy).

const ROUTE_PATH = "app/routes/app.catalogs_.$catalogId.tsx";
const VIEW_PATH = "app/components/catalog-editor-view.tsx";
const SERVER_PATH = "app/services/catalogs-settings.server.ts";

test("catalog editor route is standalone and detail-loaded", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /export const loader/);
  assert.match(source, /export const action/);
  assert.match(source, /export default function/);
  assert.match(source, /<CatalogEditorView/);
  assert.match(source, /getPriceCatalogDetail\(/);
  assert.match(source, /handleCatalogsSettingsAction\(\{\s*formData\s*\}\)/);
});

test("catalog editor view exposes all per-facet rule forms", async () => {
  const source = await readFile(VIEW_PATH, "utf8");
  for (const intent of [
    "save-catalog-price-rule",
    "delete-catalog-price-rule",
    "save-catalog-floor-rule",
    "delete-catalog-floor-rule",
    "save-catalog-discount-rule",
    "delete-catalog-discount-rule",
    "save-catalog-quantity-rule",
    "delete-catalog-quantity-rule",
    "add-catalog-membership",
    "remove-catalog-membership",
    "save-catalog-variant-visibility",
    "delete-catalog-variant-visibility",
    "save-catalog-visibility",
    "delete-catalog-visibility",
    "save-catalog-coupon",
    "delete-catalog-coupon",
    "save-catalog-cap",
    "delete-catalog-cap",
    "save-catalog-blacklist",
    "delete-catalog-blacklist",
    "save-catalog-customer-quantity",
    "delete-catalog-customer-quantity",
  ]) {
    assert.match(
      source,
      new RegExp(`(?:value|intent)="${intent}"`),
      `editor view must expose the ${intent} form`,
    );
  }
  // All facet tabs present.
  for (const tab of ["settings", "membership", "price-list", "floor", "discounts", "quantity", "visibility"]) {
    assert.match(source, new RegExp(`"${tab}"`), `editor must define the ${tab} tab`);
  }
});

test("catalog editor uses AdminCatalogPicker (search) for product/collection/variant targets", async () => {
  const source = await readFile(VIEW_PATH, "utf8");
  assert.match(source, /<AdminCatalogPicker/, "editor must use the shared AdminCatalogPicker");
  assert.match(source, /resourceType="product"/);
  assert.match(source, /resourceType="collection"/);
  assert.match(source, /resourceType="variant"/);
});

test("catalogs settings server handles every per-facet rule intent", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  for (const intent of [
    "save-catalog-price-rule",
    "delete-catalog-price-rule",
    "save-catalog-floor-rule",
    "delete-catalog-floor-rule",
    "save-catalog-discount-rule",
    "delete-catalog-discount-rule",
    "save-catalog-quantity-rule",
    "delete-catalog-quantity-rule",
    "add-catalog-membership",
    "remove-catalog-membership",
    "save-catalog-variant-visibility",
    "delete-catalog-variant-visibility",
    "save-catalog-visibility",
    "delete-catalog-visibility",
    "save-catalog-coupon",
    "delete-catalog-coupon",
    "save-catalog-cap",
    "delete-catalog-cap",
    "save-catalog-blacklist",
    "delete-catalog-blacklist",
    "save-catalog-customer-quantity",
    "delete-catalog-customer-quantity",
  ]) {
    assert.match(source, new RegExp(`"${intent}"`), `server must dispatch ${intent}`);
  }
});
