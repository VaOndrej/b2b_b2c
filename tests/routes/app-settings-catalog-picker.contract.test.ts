import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SETTINGS_ROUTE_PATH = "app/routes/app.settings.tsx";
const COMPACT_RULE_PANEL_PATH = "app/components/compact-rule-panel.tsx";
const ADMIN_CATALOG_PICKER_PATH = "app/components/admin-catalog-picker.tsx";
const STOREFRONT_UX_ROUTE_PATH = "app/routes/app.storefront-ux.tsx";
const DISCOUNT_SETTINGS_VIEW_PATH = "app/components/discount-settings-view.tsx";
// MVP_5_1 (move-not-copy): the catalog-rules forms (and their AdminCatalogPicker /
// CompactRulePanel usage + describer-driven labels + "Products affected" summary)
// now live in the shared CatalogRulesView, rendered identically by the monolith
// and the standalone app.settings.catalog-rules route.
const CATALOG_RULES_VIEW_PATH = "app/components/catalog-rules-view.tsx";
// MVP_5_1 (move-not-copy): the Global Settings configuration UI (catalog import
// foundations + save-global form) now lives in the shared GlobalSettingsView,
// rendered identically by the monolith and the standalone app.settings.global route.
const GLOBAL_SETTINGS_VIEW_PATH = "app/components/global-settings-view.tsx";

test("catalog rules view uses AdminCatalogPicker for product, collection, customer, and variant forms", async () => {
  const source = await readFile(CATALOG_RULES_VIEW_PATH, "utf8");

  const pickerUsages = Array.from(source.matchAll(/<AdminCatalogPicker/g));
  assert.equal(
    pickerUsages.length >= 12,
    true,
    "Catalog rules view must reuse AdminCatalogPicker across product, collection, customer, and variant forms.",
  );
  assert.match(
    source,
    /resourceType="product"/,
    "Catalog rules view must wire product picker usage.",
  );
  assert.match(
    source,
    /resourceType="collection"/,
    "Catalog rules view must wire collection picker usage.",
  );
  assert.match(
    source,
    /resourceType="customer"/,
    "Catalog rules view must wire customer picker usage.",
  );
  assert.match(
    source,
    /resourceType="variant"/,
    "Catalog rules view must wire variant picker usage.",
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
  const globalViewSource = await readFile(GLOBAL_SETTINGS_VIEW_PATH, "utf8");

  // Loader/action wiring stays in the route; the foundation UI lives in the shared view.
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
    globalViewSource,
    /intent"\s+value="sync-product-catalog"/,
    "Global Settings view must expose an explicit sync-product-catalog action.",
  );
  assert.match(
    globalViewSource,
    /Product catalog foundation/,
    "Global Settings must surface product import as a first-step foundation card.",
  );
  assert.match(
    globalViewSource,
    /Shopify Catalog/,
    "Global Settings must show the live Shopify catalog source card.",
  );
  assert.match(
    globalViewSource,
    /CSV \/ JSON Import/,
    "Global Settings must reserve a disabled source card for future CSV and JSON imports.",
  );
  assert.match(
    globalViewSource,
    /ERP Integration/,
    "Global Settings must reserve a disabled source card for future ERP sync.",
  );
  assert.match(
    globalViewSource,
    /Collection catalog foundation/,
    "Global Settings must also reserve a collection import foundation panel.",
  );
  assert.match(
    globalViewSource,
    /Shopify Collections/,
    "Collection catalog foundation must surface Shopify as the prepared source path.",
  );
  assert.match(
    globalViewSource,
    /intent"\s+value="sync-collection-catalog"/,
    "Global Settings must expose an explicit sync-collection-catalog action.",
  );
  assert.match(
    globalViewSource,
    /Import collections now/,
    "Collection catalog foundation must expose a manual collection import trigger.",
  );
  assert.match(
    globalViewSource,
    /name="productCatalogAutoImportEnabled"/,
    "Global Settings must include an auto import toggle for the product catalog.",
  );
  assert.match(
    globalViewSource,
    /Import products now/,
    "Global Settings must expose a manual product import trigger.",
  );
  assert.match(
    globalViewSource,
    /type="hidden"\s+name="productCatalogSourceType"/,
    "Global Settings must persist the active product catalog source without exposing the old source select control.",
  );
  assert.doesNotMatch(
    globalViewSource,
    /<select\s+name="productCatalogSourceType"/,
    "Global Settings must no longer expose the old productCatalogSourceType select once source cards are the primary UI.",
  );
});

test("settings route supports area-filtered workspaces for global settings, catalog rules, and discounts", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /SETTINGS_SECTION_OPTIONS/,
    "Settings route must define explicit navigation sections for the grouped MVP_4_5 admin UI.",
  );
  assert.match(
    source,
    /SETTINGS_AREAS/,
    "Settings route must define top-level workspace areas for the new admin split.",
  );
  assert.match(
    source,
    /catalog-rules/,
    "Settings route must expose a Catalog Rules workspace area.",
  );
  assert.match(
    source,
    /discounts/,
    "Settings route must expose a Discounts workspace area.",
  );
  assert.match(
    source,
    /buildSettingsWorkspaceUrl/,
    "Settings route must centralize deep-link generation so area-filtered workspaces stay linkable.",
  );
  assert.match(
    source,
    /inferSettingsAreaFromPathname/,
    "Settings route must infer top-level workspaces from unique Shopify nav paths.",
  );
  assert.match(
    source,
    /view\?: ProductRuleView \| null/,
    "Settings route must support a nested product-rule deep link parameter for compact sub-navigation.",
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
    /navigate\(\s*buildSettingsWorkspaceUrl\(\{\s*area:\s*nextArea,\s*section,\s*view:/,
    "Settings route must keep area-aware deep links when switching grouped settings sections.",
  );
  assert.match(
    source,
    /section:\s*"products",\s*view,/,
    "Settings route must keep area-aware deep links when switching nested product rule views.",
  );
  assert.match(
    source,
    /PRODUCT_RULE_VIEWS/,
    "Catalog Rules -> Products must define a dedicated nested menu model for floor, MOQ, visibility, and related product rule views.",
  );
  assert.match(
    source,
    /activeProductRuleView/,
    "Settings route must resolve the active nested product workspace from the URL.",
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

test("settings route moves collection visibility into catalog rules visibility workspace", async () => {
  const settingsSource = await readFile(SETTINGS_ROUTE_PATH, "utf8");
  const catalogRulesViewSource = await readFile(CATALOG_RULES_VIEW_PATH, "utf8");
  const storefrontSource = await readFile(STOREFRONT_UX_ROUTE_PATH, "utf8");

  assert.match(
    settingsSource,
    /save-collection-visibility-rule/,
    "Settings route must own collection visibility saves under Catalog Rules.",
  );
  assert.match(
    settingsSource,
    /delete-collection-visibility-rule/,
    "Settings route must own collection visibility deletes under Catalog Rules.",
  );
  assert.match(
    catalogRulesViewSource,
    /activeProductRuleView === "collection-visibility"/,
    "Catalog Rules product workspace must expose collection visibility as a nested subview.",
  );
  assert.match(
    storefrontSource,
    /Collection visibility moved into/,
    "Storefront UX must point legacy collection-visibility deep links toward Catalog Rules.",
  );
  assert.match(
    storefrontSource,
    /section=products&view=collection-visibility/,
    "Storefront UX must deep-link directly into the compact product sub-navigation for collection visibility.",
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

test("catalog rules view renders configured product rules with imported product and variant labels", async () => {
  const source = await readFile(CATALOG_RULES_VIEW_PATH, "utf8");

  assert.match(
    source,
    /makeCatalogDescribers/,
    "Catalog rules view must build catalog describers (shared module) to resolve configured ids to imported catalog names.",
  );
  assert.match(
    source,
    /describeProduct/,
    "Catalog rules view must resolve configured product ids to imported catalog names before rendering rule rows.",
  );
  assert.match(
    source,
    /describeVariant/,
    "Catalog rules view must resolve configured variant ids to imported catalog names before rendering variant rule rows.",
  );
  assert.match(
    source,
    /describeCollection/,
    "Catalog rules view must resolve configured collection ids to imported catalog names before rendering collection rule rows.",
  );
  assert.match(
    source,
    /Products affected in this section/,
    "Each product-related section must surface a summary of affected products at the top of the workspace.",
  );
  assert.match(
    source,
    /CompactRulePanel/,
    "Product governance forms must share a global compact rule panel component instead of duplicating the layout per rule type.",
  );
});

test("configured rule lists expose modify and red delete actions", async () => {
  const [panelSource, pickerSource, discountViewSource] = await Promise.all([
    readFile(COMPACT_RULE_PANEL_PATH, "utf8"),
    readFile(ADMIN_CATALOG_PICKER_PATH, "utf8"),
    readFile(DISCOUNT_SETTINGS_VIEW_PATH, "utf8"),
  ]);

  assert.match(
    panelSource,
    /Modify/,
    "Compact catalog rule lists must expose a Modify action beside saved rules.",
  );
  assert.match(
    panelSource,
    /openAddForm/,
    "Compact catalog rule forms must stay hidden until the Add action opens them.",
  );
  assert.match(
    panelSource,
    /editingItemId === item\.id/,
    "Compact catalog rule modification must expand an inline edit panel below the selected saved rule.",
  );
  assert.match(
    panelSource,
    /#b42318/,
    "Compact catalog rule delete buttons must use the red destructive style.",
  );
  // MVP_5_1: the manual discount rule forms now live in the extracted
  // DiscountSettingsView component (shared by the standalone route + monolith).
  assert.match(
    discountViewSource,
    /openManualAddForm/,
    "Manual discount rule forms must stay hidden until an Add action opens them.",
  );
  assert.match(
    discountViewSource,
    /openManualModifyForm/,
    "Manual discount rule lists must be able to open and populate their forms for modification.",
  );
  assert.match(
    discountViewSource,
    /style=\{deleteRuleButtonStyle\}/,
    "Manual discount rule delete buttons must use the red destructive style.",
  );
  assert.match(
    pickerSource,
    /selectedDescription \?\? query/,
    "Catalog pickers must show the selected resource name in the closed input when modifying a saved rule.",
  );
});

test("settings route save-global action parses and persists marginGuardEnabled toggle", async () => {
  const source = await readFile(SETTINGS_ROUTE_PATH, "utf8");
  const globalViewSource = await readFile(GLOBAL_SETTINGS_VIEW_PATH, "utf8");

  assert.match(
    source,
    /formData\.get\("marginGuardEnabled"\)\s*===\s*"on"/,
    "[CONTRACT FAIL] save-global action musi parsovat marginGuardEnabled z formu jako checkbox 'on'.",
  );
  assert.match(
    source,
    /marginGuardEnabled/,
    "[CONTRACT FAIL] save-global action musi predat marginGuardEnabled do updateGlobalMarginGuardConfig.",
  );
  assert.match(
    globalViewSource,
    /name="marginGuardEnabled"/,
    "[CONTRACT FAIL] Global Settings UI musi renderovat checkbox s name='marginGuardEnabled'.",
  );
});

test("storefront content rules keep add hidden and modify inline", async () => {
  const source = await readFile(STOREFRONT_UX_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /showContentForm &&/,
    "Storefront content rule creation must stay hidden behind the Add rule action.",
  );
  assert.match(
    source,
    /Modify \{rule\.name\}/,
    "Storefront content rule modification must expand an inline form below the selected saved rule.",
  );
  assert.doesNotMatch(
    source,
    />\s*Edit\s*</,
    "Storefront content rules should use Modify terminology instead of Edit.",
  );
});
