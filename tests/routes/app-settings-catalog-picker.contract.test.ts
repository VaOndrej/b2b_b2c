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
    /preventScrollReset:\s*true/,
    "Settings route must preserve scroll position when switching grouped settings sections.",
  );
  assert.match(
    source,
    /navigate\(`\/app\/settings\?section=\$\{section\}`,\s*\{\s*preventScrollReset:\s*true/,
    "Settings route must keep deep-linkable query params while preventing scroll reset.",
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
