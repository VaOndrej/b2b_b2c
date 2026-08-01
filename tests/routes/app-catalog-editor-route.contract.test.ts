import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_3 Phase 2 — the catalog editor route (per-facet tabs) renders the shared
// CatalogEditorView and delegates every facet write to handleCatalogsSettingsAction
// (move-not-copy).
// MVP_5_5 — it nests under the app.catalogs layout (hence no `catalogs_` opt-out),
// which supplies the page shell and the rail. Deleting a catalog happens here now.

const ROUTE_PATH = "app/routes/app.catalogs.$catalogId.tsx";
const VIEW_PATH = "app/components/catalog-editor-view.tsx";
const SERVER_PATH = "app/services/catalogs-settings.server.ts";

test("catalog editor route is detail-loaded and nests under the catalogs layout", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /export const loader/);
  assert.match(source, /export const action/);
  assert.match(source, /export default function/);
  assert.match(source, /<CatalogEditorView/);
  assert.match(source, /getPriceCatalogDetail\(/);
  assert.match(source, /handleCatalogsSettingsAction\(\{\s*formData\s*\}\)/);
  assert.doesNotMatch(source, /<s-page/, "the page shell comes from the app.catalogs layout");
});

test("catalog editor deletes the catalog and returns to the create pane", async () => {
  const view = await readFile(VIEW_PATH, "utf8");
  assert.match(view, /value="delete-catalog"/, "editor must expose the delete-catalog form");
  assert.match(view, /!catalog\.isSystem/, "system catalogs must not be deletable");

  const route = await readFile(ROUTE_PATH, "utf8");
  assert.match(route, /intent === "delete-catalog"/);
  assert.match(route, /redirect\("\/app\/catalogs"\)/, "delete must redirect off the dead editor URL");
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
