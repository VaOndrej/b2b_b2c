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

test("settings route wires global Shopify product import controls for MVP_4_5 catalog sync", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /loadMarginGuardSettingsView/,
    "Settings route must load an enriched settings view so configured rules can render imported product titles.",
  );
  assert.match(
    source,
    /syncShopifyProductCatalog/,
    "Settings route must support Shopify catalog import from the Global Settings area.",
  );
  assert.match(
    source,
    /intent"\s+value="sync-product-catalog"/,
    "Settings route must expose an explicit sync-product-catalog action.",
  );
  assert.match(
    source,
    /Product catalog foundation/,
    "Global Settings must surface product import as a first-step foundation card.",
  );
  assert.match(
    source,
    /Shopify Catalog/,
    "Global Settings must show the live Shopify catalog source card.",
  );
  assert.match(
    source,
    /CSV \/ JSON Import/,
    "Global Settings must reserve a disabled source card for future CSV and JSON imports.",
  );
  assert.match(
    source,
    /ERP Integration/,
    "Global Settings must reserve a disabled source card for future ERP sync.",
  );
  assert.match(
    source,
    /Collection catalog foundation/,
    "Global Settings must also reserve a collection import foundation panel.",
  );
  assert.match(
    source,
    /Shopify Collections/,
    "Collection catalog foundation must surface Shopify as the prepared source path.",
  );
  assert.match(
    source,
    /intent"\s+value="sync-collection-catalog"/,
    "Global Settings must expose an explicit sync-collection-catalog action.",
  );
  assert.match(
    source,
    /Import collections now/,
    "Collection catalog foundation must expose a manual collection import trigger.",
  );
  assert.match(
    source,
    /name="productCatalogAutoImportEnabled"/,
    "Global Settings must include an auto import toggle for the product catalog.",
  );
  assert.match(
    source,
    /Import products now/,
    "Global Settings must expose a manual product import trigger.",
  );
  assert.match(
    source,
    /type="hidden"\s+name="productCatalogSourceType"/,
    "Global Settings must persist the active product catalog source without exposing the old source select control.",
  );
  assert.doesNotMatch(
    source,
    /<select\s+name="productCatalogSourceType"/,
    "Global Settings must no longer expose the old productCatalogSourceType select once source cards are the primary UI.",
  );
});

test("settings route groups admin forms into MVP_4_5 navigation sections", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /SETTINGS_SECTION_OPTIONS/,
    "Settings route must define explicit navigation sections for the grouped MVP_4_5 admin UI.",
  );
  assert.match(
    source,
    /Global Settings/,
    "Settings route must expose a Global Settings navigation entry.",
  );
  assert.match(
    source,
    /Discount Orchestration/,
    "Settings route must expose a Discount Orchestration navigation entry.",
  );
  assert.match(
    source,
    /Functions/,
    "Settings route must expose a Functions navigation entry.",
  );
  assert.match(
    source,
    /useNavigate/,
    "Settings route must use router navigation for grouped section switching.",
  );
  assert.match(
    source,
    /window\.scrollTo\(\{\s*top:\s*0,\s*behavior:\s*"smooth"/,
    "Settings route must scroll the viewport to the top when switching grouped settings sections.",
  );
  assert.match(
    source,
    /navigate\(`\/app\/settings\?section=\$\{section\}`\)/,
    "Settings route must keep deep-linkable query params when switching grouped settings sections.",
  );
  assert.match(
    source,
    /position:\s*"sticky"/,
    "Settings route must keep the navigation panel sticky for console-style browsing.",
  );
  assert.match(
    source,
    /display:\s*"flex"/,
    "Settings route must use a split layout so the navigation can live in a left sidebar.",
  );
});

test("settings route no longer renders pricing simulator admin preview", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /simulate-pricing/,
    "Settings route must not keep the old simulate-pricing intent once admin preview is removed.",
  );
  assert.doesNotMatch(
    source,
    /Run pricing simulator/,
    "Settings route must not render the removed pricing simulator form.",
  );
  assert.doesNotMatch(
    source,
    /Latest simulator result/,
    "Settings route must not render simulator result output after admin preview removal.",
  );
});

test("settings route renders configured product rules with imported product and variant labels", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function describeProduct/,
    "Settings route must resolve configured product ids to imported catalog names before rendering rule rows.",
  );
  assert.match(
    source,
    /function describeVariant/,
    "Settings route must resolve configured variant ids to imported catalog names before rendering variant rule rows.",
  );
  assert.match(
    source,
    /Products affected in this section/,
    "Each product-related section must surface a summary of affected products at the top of the workspace.",
  );
});
