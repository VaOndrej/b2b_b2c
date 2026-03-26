import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SETTINGS_ROUTE_PATH = "app/routes/app.settings.tsx";

test("settings route uses AdminCatalogPicker for product, collection, customer, and variant forms", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  const pickerUsages = Array.from(source.matchAll(/<AdminCatalogPicker/g));
  assert.equal(
    pickerUsages.length >= 12,
    true,
    "Settings route must reuse AdminCatalogPicker across product, collection, customer, and variant forms.",
  );
  assert.match(
    source,
    /resourceType="product"/,
    "Settings route must wire product picker usage.",
  );
  assert.match(
    source,
    /resourceType="collection"/,
    "Settings route must wire collection picker usage.",
  );
  assert.match(
    source,
    /resourceType="customer"/,
    "Settings route must wire customer picker usage.",
  );
  assert.match(
    source,
    /resourceType="variant"/,
    "Settings route must wire variant picker usage.",
  );
});

test("settings route no longer exposes raw productId/collectionId/variantId text inputs", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /<input\s+name="productId"/,
    "Product ID fields should be replaced by AdminCatalogPicker.",
  );
  assert.doesNotMatch(
    source,
    /<input\s+name="collectionId"/,
    "Collection ID fields should be replaced by AdminCatalogPicker.",
  );
  assert.doesNotMatch(
    source,
    /<input\s+name="variantId"/,
    "Variant ID fields should be replaced by AdminCatalogPicker where picker UX is expected.",
  );
});
