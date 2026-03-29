import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VISIBILITY_SCRIPT_ROUTE_PATH = "app/routes/margin-guard.visibility-script.tsx";
const LIQUID_EMBED_PATH = "extensions/margin-guard-storefront/blocks/margin_guard_visibility_embed.liquid";
const CONFIG_SERVER_PATH = "app/services/margin-guard-config.server.ts";
const SETTINGS_ACTION_PATH = "app/routes/app.settings.tsx";

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

test("liquid embed does not use defer on the main visibility script tag", async () => {
  const source = await readFile(LIQUID_EMBED_PATH, "utf8");

  const mainScriptMatch = source.match(
    /<script[\s\S]*?src=["'][\s\S]*?visibility-script[\s\S]*?["'][^>]*>/,
  );
  assert.ok(mainScriptMatch, "Liquid embed must include the main visibility script tag.");
  assert.doesNotMatch(
    mainScriptMatch[0],
    /defer/,
    "Main visibility script tag must NOT use defer — it must execute as soon as possible to minimize flash of hidden content.",
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
  assert.match(
    source,
    /visibilityMode === "B2B_ONLY"/,
    "syncVisibilityHandlesMetafield must filter rules for B2B_ONLY mode.",
  );
  assert.match(
    source,
    /visibilityMode === "B2C_ONLY"/,
    "syncVisibilityHandlesMetafield must filter rules for B2C_ONLY mode.",
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

test("settings action calls syncVisibilityHandlesMetafield after visibility rule changes", async () => {
  const source = await readFile(SETTINGS_ACTION_PATH, "utf8");

  assert.match(
    source,
    /syncVisibilityHandlesMetafield/,
    "Settings action must import and call syncVisibilityHandlesMetafield.",
  );

  const saveRuleIndex = source.indexOf('intent === "save-product-visibility-rule"');
  const deleteRuleIndex = source.indexOf('intent === "delete-product-visibility-rule"');
  assert.ok(saveRuleIndex !== -1, "save-product-visibility-rule intent must exist.");
  assert.ok(deleteRuleIndex !== -1, "delete-product-visibility-rule intent must exist.");

  const afterSave = source.indexOf("syncVisibilityHandlesMetafield", saveRuleIndex);
  const afterDelete = source.indexOf("syncVisibilityHandlesMetafield", deleteRuleIndex);
  assert.ok(afterSave !== -1, "syncVisibilityHandlesMetafield must be called after saving a visibility rule.");
  assert.ok(afterDelete !== -1, "syncVisibilityHandlesMetafield must be called after deleting a visibility rule.");

  const saveGlobalIndex = source.indexOf('intent === "save-global"');
  assert.ok(saveGlobalIndex !== -1, "save-global intent must exist.");
  const afterSaveGlobal = source.indexOf("syncVisibilityHandlesMetafield", saveGlobalIndex);
  assert.ok(
    afterSaveGlobal !== -1,
    "syncVisibilityHandlesMetafield must be called after saving global settings so storefront B2B tag changes stay in sync.",
  );
});

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
    /function removeEarlyHideStyle\(\)[\s\S]*?margin-guard-early-hide[\s\S]*?margin-guard-segment-default-hide/,
    "removeEarlyHideStyle must remove both the early-hide and segment-default-hide style elements.",
  );
});
