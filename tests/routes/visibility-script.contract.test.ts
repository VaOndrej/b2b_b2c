import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VISIBILITY_SCRIPT_ROUTE_PATH = "app/routes/margin-guard.visibility-script.tsx";
const LIQUID_EMBED_PATH = "extensions/margin-guard-storefront/blocks/margin_guard_visibility_embed.liquid";
const CONFIG_SERVER_PATH = "app/services/margin-guard-config.server.ts";
const STOREFRONT_PROJECTION_SERVER_PATH = "app/services/storefront-projection.server.ts";

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

// ─── Carousel & flash-of-hidden-content regression tests ────────────

test("hideCardForHandle removes cards from DOM instead of hiding via display:none", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function hideCardForHandle\(handle\)[\s\S]*?card\.remove\(\)/,
    "hideCardForHandle must remove the card element from the DOM (not display:none) so carousels recalculate layout.",
  );
  assert.doesNotMatch(
    source,
    /function hideCardForHandle\(handle\)[\s\S]*?card\.style\.display\s*=\s*["']none["']/,
    "hideCardForHandle must NOT use display:none — it leaves empty slots in carousels.",
  );
});

test("hideCardForHandle dispatches resize event after removing cards", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function hideCardForHandle\(handle\)[\s\S]*?window\.dispatchEvent\(new Event\("resize"\)\)/,
    "hideCardForHandle must dispatch a resize event after removing cards to trigger carousel re-layout.",
  );
});

test("hideCollectionCardForHandle removes cards from DOM instead of hiding via display:none", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function hideCollectionCardForHandle\(handle\)[\s\S]*?card\.remove\(\)/,
    "hideCollectionCardForHandle must remove the card element from the DOM.",
  );
  assert.doesNotMatch(
    source,
    /function hideCollectionCardForHandle\(handle\)[\s\S]*?card\.style\.display\s*=\s*["']none["']/,
    "hideCollectionCardForHandle must NOT use display:none.",
  );
});

test("hideCollectionCardForHandle dispatches resize event after removing cards", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function hideCollectionCardForHandle\(handle\)[\s\S]*?window\.dispatchEvent\(new Event\("resize"\)\)/,
    "hideCollectionCardForHandle must dispatch a resize event after removing cards.",
  );
});

test("visibility script removes early-hide style after applying rules", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function removeEarlyHideStyle\(\)/,
    "Script must define removeEarlyHideStyle to clean up the inline early-hide CSS.",
  );
  assert.match(
    source,
    /margin-guard-early-hide/,
    "Script must reference the early-hide style element ID.",
  );
  assert.match(
    source,
    /function hydrateRulesFromCache\(\)[\s\S]*?applyHiddenHandlesWhenDomReady\(hiddenHandles\)/,
    "hydrateRulesFromCache must defer cached hidden-handle application until the DOM is ready.",
  );
  assert.match(
    source,
    /function fetchAndApplyVisibilityPayload\([\s\S]*?removeEarlyHideStyle\(\)/,
    "fetchAndApplyVisibilityPayload must call removeEarlyHideStyle after applying fetched rules.",
  );
  assert.match(
    source,
    /function applyHiddenHandlesWhenDomReady\(hiddenHandles\)[\s\S]*?document\.readyState !== "loading"[\s\S]*?DOMContentLoaded[\s\S]*?applyHiddenHandlesToDom\(normalizedHiddenHandles\)/,
    "Visibility script must wait for DOMContentLoaded before removing early-hide styles from cached rules.",
  );
  assert.match(
    source,
    /function hydrateRulesFromCache\(\)[\s\S]*?applyHiddenHandlesWhenDomReady\(hiddenHandles\)/,
    "hydrateRulesFromCache must defer hidden-handle DOM removal until the DOM is ready.",
  );
  assert.match(
    source,
    /const RULES_CACHE_VERSION = 2;/,
    "Visibility rules cache must bump schema version so stale hidden handles are invalidated after cache shape changes.",
  );
  assert.match(
    source,
    /customerTagsScope/,
    "Visibility rules cache must scope entries by logged-in customer tags to avoid cross-segment reuse.",
  );
  assert.match(
    source,
    /hiddenHandles:\s*normalizedHiddenHandles/,
    "persistRulesCache must overwrite hidden handles with the latest response instead of merging stale values forward.",
  );
});

test("visibility script hydrates projected storefront rules before runtime fetch", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function readStorefrontProjectionBootstrap\(\)/,
    "Visibility script must define a reader for the inline storefront projection bootstrap payload.",
  );
  assert.match(
    source,
    /margin-guard-storefront-bootstrap/,
    "Visibility script must reference the storefront bootstrap element ID.",
  );
  assert.match(
    source,
    /function hydrateRulesFromProjection\(\)/,
    "Visibility script must hydrate projected storefront rules before runtime reconciliation.",
  );
  assert.match(
    source,
    /hydrateRulesFromProjection\(\);\s*hydrateRulesFromCache\(\);/,
    "Projected storefront rules must hydrate before session cache rules during bootstrap.",
  );
  assert.match(
    source,
    /function applyCollectionHidingWhenDomReady\(/,
    "Visibility script must support deferred application of projected collection hiding.",
  );
});

test("visibility script renders a persistent cart discount-conflict banner from the loader payload", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function renderCartDiscountConflictBanner\(\)/,
    "Script must define renderCartDiscountConflictBanner to surface automatic-discount/floor conflicts in the cart.",
  );
  assert.match(
    source,
    /margin-guard-cart-discount-conflict-notice/,
    "Cart conflict banner must use a stable element id.",
  );
  assert.match(
    source,
    /state\.discountConflictsByHandle/,
    "Script must track discount conflicts keyed by handle from the visibility payload.",
  );
  assert.match(
    source,
    /payload\.discountConflictsByHandle/,
    "Script must read discountConflictsByHandle from the visibility loader response.",
  );
});

// ─── Liquid embed regression tests ──────────────────────────────────

test("liquid embed includes inline early-hide script reading sessionStorage cache", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  assert.match(
    source,
    /sessionStorage\.getItem\(["']marginGuardRulesCache_v1["']\)/,
    "Early-hide script must read the same sessionStorage cache key as the main visibility script.",
  );
  assert.match(
    source,
    /margin-guard-early-hide/,
    "Early-hide script must create a style element with the known ID for later cleanup.",
  );
  assert.match(
    source,
    /hiddenHandles/,
    "Early-hide script must read hiddenHandles from the cached payload.",
  );
  assert.match(
    source,
    /\/products\//,
    "Early-hide script must generate CSS selectors targeting product links.",
  );
});

test("liquid embed defers the main visibility script (anti-flash is the inline style/script)", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  const mainScriptMatch = source.match(
    /<script[\s\S]*?src=["'][\s\S]*?visibility-script[\s\S]*?["'][^>]*>/,
  );
  assert.ok(mainScriptMatch, "Liquid embed must include the main visibility script tag.");
  // First-paint anti-flash is the inline <style> (from metafields) + the inline
  // early-hide <script>; the remote app-proxy script only does live refinement,
  // so it must be deferred (theme-check ParserBlockingScript) and not block parse.
  assert.match(
    mainScriptMatch[0],
    /defer/,
    "Main visibility script tag must use defer — it must not block the parser; anti-flash is handled inline above it.",
  );
});

test("liquid embed forwards logged-in customer id to the main visibility script", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  assert.match(
    source,
    /logged_in_customer_id=\{\{\s*customer\.id\s*\}\}/,
    "Liquid embed must pass customer.id to the visibility script so app proxy loaders can resolve the B2B tag for logged-in customers.",
  );
  assert.match(
    source,
    /logged_in_customer_tags=\{\{\s*customer\.tags\s*\|\s*json\s*\|\s*url_encode\s*\}\}/,
    "Liquid embed must pass the logged-in customer tags to the visibility script so storefront B2B detection does not depend on a later admin lookup.",
  );
});

test("liquid embed early-hide script appears before the main script tag", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  const earlyHideIndex = source.indexOf("margin-guard-early-hide");
  const mainScriptIndex = source.indexOf("visibility-script");
  assert.ok(earlyHideIndex !== -1, "Early-hide script must exist.");
  assert.ok(mainScriptIndex !== -1, "Main visibility script must exist.");
  assert.ok(
    earlyHideIndex < mainScriptIndex,
    "Early-hide inline script must appear before the main visibility script to prevent flash.",
  );
});

// ─── B2B/B2C segment-default hiding via metafield regression tests ──

test("syncVisibilityHandlesMetafield is exported from config server", async () => {
  const source = await readFile(CONFIG_SERVER_PATH, "utf8");

  assert.match(
    source,
    /export async function syncVisibilityHandlesMetafield\(/,
    "Config server must export syncVisibilityHandlesMetafield for metafield sync.",
  );
  // MVP_5_3 #2.3c — hidden handles are now sourced from catalog product
  // visibility (default catalog → b2c, B2B catalog → b2b), not the legacy
  // segment-keyed ProductVisibilityRule children.
  assert.match(
    source,
    /loadCatalogProductVisibility/,
    "syncVisibilityHandlesMetafield must source hidden products from catalog tables.",
  );
  assert.match(
    source,
    /b2b:\s*\[\.\.\.new Set\(b2bHandles\)\]/,
    "syncVisibilityHandlesMetafield must still emit the b2b hidden-handle list.",
  );
  assert.match(
    source,
    /b2c:\s*\[\.\.\.new Set\(b2cHandles\)\]/,
    "syncVisibilityHandlesMetafield must still emit the b2c hidden-handle list.",
  );
  assert.match(
    source,
    /metafieldsSet/,
    "syncVisibilityHandlesMetafield must use metafieldsSet mutation to write to shop metafield.",
  );
  assert.match(
    source,
    /namespace:\s*"margin_guard"/,
    "Metafield must use the margin_guard namespace.",
  );
  assert.match(
    source,
    /hidden_handles/,
    "Metafield must use key hidden_handles.",
  );
  assert.match(
    source,
    /b2bTag:\s*String\(config\?\.b2bTag \?\? "b2b"\)\.trim\(\)\.toLowerCase\(\) \|\| "b2b"/,
    "Metafield payload must include the normalized b2bTag so Liquid can resolve custom B2B tags on first paint.",
  );
});

test("storefront projection sync service writes a public shop metafield snapshot", async () => {
  const source = await readFile(STOREFRONT_PROJECTION_SERVER_PATH, "utf8");

  assert.match(
    source,
    /export async function syncStorefrontProjectionMetafields\(/,
    "Storefront projection service must export syncStorefrontProjectionMetafields.",
  );
  assert.match(
    source,
    /storefront_projection/,
    "Storefront projection service must use the storefront_projection metafield key.",
  );
  assert.match(
    source,
    /PUBLIC_READ/,
    "Storefront projection metafield definition must be storefront-readable.",
  );
  assert.match(
    source,
    /pricingPreview:\s*\{\s*mode:\s*"RESERVED"/,
    "Projection payload must reserve a pricingPreview section for future loyalty pricing.",
  );
  assert.match(
    source,
    /collectionQuantityRules:\s*"RUNTIME_ONLY"/,
    "Projection payload must explicitly mark collection quantity rules as runtime-only coverage to keep the snapshot lean.",
  );
});

// MVP_5_3 #2.3 — the legacy settings/catalog-rules action republish wiring was
// deleted; catalog edits now republish via republishCatalogRuntime (covered by
// the catalog route contract tests).

test("liquid embed reads app metafield for segment-default-hide CSS", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  assert.match(
    source,
    /shop\.metafields.*margin_guard.*hidden_handles/,
    "Embed must read the shop metafield margin_guard.hidden_handles.",
  );
  assert.match(
    source,
    /<style[^>]*id=["']margin-guard-segment-default-hide["'][^>]*>/,
    "Embed must render an inline style tag with ID margin-guard-segment-default-hide.",
  );
  assert.match(
    source,
    /hidden_handles_for_context/,
    "Embed must derive hidden handles for the current storefront context.",
  );
  assert.match(
    source,
    /customer_is_custom_b2b/,
    "Embed must derive a helper flag for custom-tagged B2B customers.",
  );
  assert.match(
    source,
    /customer and customer\.tags contains current_b2b_tag/,
    "Embed must detect custom-tagged B2B customers from customer tags.",
  );
  assert.match(
    source,
    /customer and customer\.b2b\? or customer_is_custom_b2b/,
    "Embed must switch hidden handles for both native Shopify B2B customers and custom-tagged B2B customers.",
  );
  assert.match(
    source,
    /hidden_handles_meta\.b2c/,
    "Embed must support the B2B customer path by hiding B2C-only handles on first render.",
  );
  assert.match(
    source,
    /hidden_handles_meta\.b2bTag/,
    "Embed must read the synced b2bTag from the metafield payload.",
  );
  assert.doesNotMatch(
    source,
    /createElement\(["']style["']\)[\s\S]*margin-guard-segment-default-hide/,
    "Embed must not create the segment-default-hide style via JavaScript because that causes first-paint flicker.",
  );
  assert.match(
    source,
    /shop\.metafields.*margin_guard.*storefront_projection/,
    "Embed must read the shop metafield margin_guard.storefront_projection for projected storefront bootstrap data.",
  );
  assert.match(
    source,
    /margin-guard-storefront-bootstrap/,
    "Embed must render an inline bootstrap script for the projected storefront snapshot.",
  );
  assert.match(
    source,
    /margin-guard-collection-default-hide/,
    "Embed must render an inline collection default-hide style for projected hidden collections.",
  );
});

test("liquid embed targets head for zero-flash rendering", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  assert.match(
    source,
    /"target":\s*"head"/,
    "Embed schema must target head so CSS is injected before body renders.",
  );
});

test("liquid embed has metafield CSS before any script tags", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  const styleIndex = source.indexOf("margin-guard-segment-default-hide");
  const firstScriptIndex = source.indexOf("<script");
  assert.ok(styleIndex !== -1, "Segment default hide style must exist.");
  assert.ok(firstScriptIndex !== -1, "Script tags must exist.");
  assert.ok(
    styleIndex < firstScriptIndex,
    "Metafield CSS must appear before any script tags.",
  );
});

test("removeEarlyHideStyle cleans up both early-hide and segment-default-hide styles", async () => {
  const source = await readFile(VISIBILITY_SCRIPT_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /function removeEarlyHideStyle\(\)[\s\S]*?margin-guard-early-hide[\s\S]*?margin-guard-segment-default-hide[\s\S]*?margin-guard-collection-default-hide/,
    "removeEarlyHideStyle must remove the early-hide, segment-default-hide, and collection-default-hide style elements.",
  );
});
