import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VISIBILITY_SCRIPT_ROUTE_PATH = "app/routes/margin-guard.visibility-script.tsx";

test("visibility script falls back to product.js productId for variant visibility payload bootstrap", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /async function collectCurrentProductIdsForVisibility\(/,
    "Visibility script must support async current productId discovery for storefront bootstrap.",
  );
  assert.match(
    source,
    /const initialProductIds = await collectCurrentProductIdsForVisibility\(\);/,
    "Initial visibility payload must await the productId fallback before requesting storefront rules.",
  );
});

test("visibility script monitors URL variant parameter for hidden variant enforcement", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function getVariantIdFromUrl\(\)/,
    "Script must extract variant ID from URL query parameter.",
  );
  assert.match(
    source,
    /function enforceVariantVisibilityByUrl\(\)/,
    "Script must enforce variant visibility based on URL variant parameter.",
  );
  assert.match(
    source,
    /function bindVariantUrlMonitoring\(\)/,
    "Script must bind history.pushState/replaceState interception for variant URL changes.",
  );
  assert.match(
    source,
    /history\.pushState/,
    "Script must intercept history.pushState for variant URL monitoring.",
  );
  assert.match(
    source,
    /history\.replaceState/,
    "Script must intercept history.replaceState for variant URL monitoring.",
  );
});

test("visibility script hides variant option elements using computed hidden option values", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function computeHiddenOptionValues\(/,
    "Script must compute which option values to hide based on hidden variant IDs.",
  );
  assert.match(
    source,
    /function hideHiddenVariantOptionElements\(/,
    "Script must have a function to hide variant option elements in the DOM.",
  );
  assert.match(
    source,
    /function hideVariantOptionElement\(/,
    "Script must have a function to apply hiding to individual variant option elements.",
  );
  assert.match(
    source,
    /pointer-events/,
    "Hidden variant elements must have pointer-events disabled to prevent clicks.",
  );
});

test("visibility script resolves current variant visibility rule after fetching product.js payload", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /const currentProductData = normalizeCurrentProductVariantPayload\(\s*await fetchCurrentProductJson\(\),\s*\);[\s\S]*?if \(currentProductData && currentProductData\.productId\) \{\s*state\.currentProductId = currentProductData\.productId;[\s\S]*?\}[\s\S]*?const variantRule = resolveCurrentProductVariantVisibilityRule\(\);/,
    "Variant visibility sync must derive productId from product.js before resolving the product-scoped variant rule map.",
  );
});
