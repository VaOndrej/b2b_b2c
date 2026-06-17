import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  updateGlobalMarginGuardConfig,
  syncVisibilityHandlesMetafield,
} from "../services/margin-guard-config.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  countActiveCatalogCollections,
  countActiveCatalogProducts,
  recordProductCatalogSyncError,
  shouldAutoSyncProductCatalog,
  syncShopifyCollectionCatalog,
  syncShopifyProductCatalog,
} from "../services/product-catalog.server";
import { syncStorefrontProjectionMetafields } from "../services/storefront-projection.server";

// MVP_5_1 Part B: Global Settings is the first module pulled out of the
// app.settings.tsx monolith into a truly standalone route (own loader, action,
// and component). The monolith still renders an equivalent block for the legacy
// `?area=all` workspace; that duplicate is removed in a later iteration once the
// remaining modules (catalog rules, discounts) are extracted the same way.

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function formatTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatCatalogSourceLabel(sourceType: string | null | undefined): string {
  if (String(sourceType ?? "").trim() === "ERP") {
    return "ERP";
  }
  if (String(sourceType ?? "").trim() === "CSV") {
    return "CSV";
  }
  return "Shopify";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  await ensureCartValidationActive(admin);

  let config = await getOrCreateMarginGuardConfig();
  let productCatalogSyncMessage: string | null = null;
  if (await shouldAutoSyncProductCatalog(config)) {
    try {
      const syncResult = await syncShopifyProductCatalog(admin);
      config = await getOrCreateMarginGuardConfig();
      productCatalogSyncMessage = `Imported ${syncResult.productCount} products and ${syncResult.variantCount} variants from Shopify.`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Product catalog import failed.";
      await recordProductCatalogSyncError(message);
      config = await getOrCreateMarginGuardConfig();
      productCatalogSyncMessage = `Product catalog import failed: ${message}`;
    }
  }

  const url = new URL(request.url);
  const catalogMessage = url.searchParams.get("catalogMessage");
  const collectionCatalogMessage = url.searchParams.get("collectionCatalogMessage");
  const [catalogProductCount, catalogCollectionCount] = await Promise.all([
    countActiveCatalogProducts(),
    countActiveCatalogCollections(),
  ]);

  return {
    config,
    catalogProductCount,
    catalogCollectionCount,
    productCatalogSyncMessage,
    catalogMessage,
    collectionCatalogMessage,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "sync-product-catalog") {
    const url = new URL(request.url);
    try {
      const result = await syncShopifyProductCatalog(admin);
      await Promise.all([
        syncVisibilityHandlesMetafield(admin),
        syncStorefrontProjectionMetafields(admin),
      ]).catch((err) => {
        console.error("[global settings] product catalog follow-up failed:", err);
      });
      url.searchParams.set(
        "catalogMessage",
        `Imported ${result.productCount} products and ${result.variantCount} variants from Shopify.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Product catalog import failed.";
      await recordProductCatalogSyncError(message);
      url.searchParams.set("catalogMessage", `Product catalog import failed: ${message}`);
    }
    return Response.redirect(url.toString(), 302);
  }

  if (intent === "sync-collection-catalog") {
    const url = new URL(request.url);
    try {
      const result = await syncShopifyCollectionCatalog(admin);
      await syncStorefrontProjectionMetafields(admin).catch((err) => {
        console.error("[global settings] collection catalog follow-up failed:", err);
      });
      url.searchParams.set(
        "collectionCatalogMessage",
        `Imported ${result.collectionCount} collections from Shopify.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Collection catalog import failed.";
      url.searchParams.set(
        "collectionCatalogMessage",
        `Collection catalog import failed: ${message}`,
      );
    }
    return Response.redirect(url.toString(), 302);
  }

  if (intent === "save-global") {
    const b2bTag = String(formData.get("b2bTag") ?? "b2b").trim() || "b2b";
    const globalMinPricePercent = parseNumber(
      formData.get("globalMinPricePercent"),
      70,
    );
    const b2bGlobalMinPricePercent = parseNumber(
      formData.get("b2bGlobalMinPricePercent"),
      globalMinPricePercent,
    );
    const allowZeroFinalPrice = formData.get("allowZeroFinalPrice") === "on";
    const allowRemoveAtMinimumOrderQuantity =
      formData.get("allowRemoveAtMinimumOrderQuantity") === "on";
    const productCatalogSourceType =
      String(formData.get("productCatalogSourceType") ?? "SHOPIFY").trim() || "SHOPIFY";
    const productCatalogAutoImportEnabled =
      formData.get("productCatalogAutoImportEnabled") === "on";
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;
    const marginGuardEnabled = formData.get("marginGuardEnabled") === "on";

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
      b2bGlobalMinPricePercent,
      productCatalogSourceType,
      productCatalogAutoImportEnabled,
      allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity,
      allowStacking,
      marginGuardEnabled,
      maxCombinedPercentOff:
        maxCombinedPercentOff != null && Number.isFinite(maxCombinedPercentOff)
          ? maxCombinedPercentOff
          : null,
    });
    await syncVisibilityHandlesMetafield(admin).catch((err) => {
      console.error("[syncVisibilityHandlesMetafield] global sync failed:", err);
    });
    await syncStorefrontProjectionMetafields(admin).catch((err) => {
      console.error("[syncStorefrontProjectionMetafields] global sync failed:", err);
    });
    await ensureCartValidationActive(admin);
    return null;
  }

  return null;
};

export default function GlobalSettingsRoute() {
  const {
    config,
    catalogProductCount,
    catalogCollectionCount,
    productCatalogSyncMessage,
    catalogMessage,
    collectionCatalogMessage,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const productCatalogLastSyncLabel = formatTimestamp(
    (config as any).productCatalogLastSyncAt,
  );
  const productCatalogSourceLabel = formatCatalogSourceLabel(
    (config as any).productCatalogSourceType,
  );
  const productCatalogImportRequired = catalogProductCount === 0;
  const collectionCatalogImportRequired = catalogCollectionCount === 0;
  const catalogImportRequired =
    productCatalogImportRequired || collectionCatalogImportRequired;
  const statusMessages = [
    productCatalogSyncMessage,
    catalogMessage,
    collectionCatalogMessage,
  ].filter((value): value is string => Boolean(value));

  return (
    <s-page heading="Global Settings">
      <style>{`
        .catalog-source-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .catalog-source-card {
          border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 16px;
          padding: 16px;
          background: #ffffff;
        }
        .catalog-source-card.is-active {
          border-color: rgba(7, 33, 58, 0.22);
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.06);
          background: linear-gradient(180deg, #ffffff 0%, #f8fbfd 100%);
        }
        .catalog-source-card.is-disabled {
          background: #f8fafc;
          color: #98a2b3;
        }
        .catalog-source-kicker {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 8px;
          color: #667085;
        }
        .catalog-source-title {
          font-size: 16px;
          font-weight: 700;
          color: #07213a;
          margin-bottom: 8px;
        }
        .catalog-source-card.is-disabled .catalog-source-title {
          color: #98a2b3;
        }
        .catalog-source-meta {
          font-size: 13px;
          line-height: 1.5;
          color: #51606f;
        }
        .catalog-source-card.is-disabled .catalog-source-meta {
          color: #98a2b3;
        }
      `}</style>

      {statusMessages.length > 0 && (
        <s-section>
          <s-stack direction="block" gap="small">
            {statusMessages.map((status) => (
              <s-paragraph key={status}>{status}</s-paragraph>
            ))}
          </s-stack>
        </s-section>
      )}

      {catalogImportRequired && (
        <s-section>
          <div
            role="status"
            style={{
              padding: "14px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(183, 121, 0, 0.25)",
              background: "rgba(255, 236, 213, 0.5)",
              color: "#7a4f01",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            <strong>Catalog import required.</strong> Run the imports below first —
            rule search and product/collection pickers across the app stay empty
            until{" "}
            {productCatalogImportRequired && collectionCatalogImportRequired
              ? "products and collections are"
              : productCatalogImportRequired
                ? "products are"
                : "collections are"}{" "}
            imported.
          </div>
        </s-section>
      )}

      <s-section heading="Global configuration">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Product catalog foundation</s-heading>
          <div
            style={{
              marginBottom: "14px",
              fontSize: "14px",
              color: "#51606f",
              lineHeight: 1.5,
            }}
          >
            Importing products is the first admin setup step. Product, variant, and
            rule pickers use this catalog as the source of truth across the entire
            settings workspace.
          </div>
          <div className="catalog-source-grid">
            <div className="catalog-source-card is-active">
              <div className="catalog-source-kicker">Available now</div>
              <div className="catalog-source-title">Shopify Catalog</div>
              <div className="catalog-source-meta">
                Active products: {catalogProductCount}
                <br />
                Last sync: {productCatalogLastSyncLabel ?? "never"}
                <br />
                Auto import:{" "}
                {(config as any).productCatalogAutoImportEnabled !== false
                  ? "enabled"
                  : "disabled"}
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">CSV / JSON Import</div>
              <div className="catalog-source-meta">
                Reserved for MVP_6 data import flows. This source will later support
                price, MOQ, and catalog feeds from flat files.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">ERP Integration</div>
              <div className="catalog-source-meta">
                Reserved for future ERP sync. The admin UI is prepared for this path,
                but activation will come in a later delivery.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <s-text>
              Current source: {productCatalogSourceLabel}
              {(config as any).productCatalogLastSyncError
                ? ` | last error: ${(config as any).productCatalogLastSyncError}`
                : ""}
            </s-text>
            <form method="post">
              <input type="hidden" name="intent" value="sync-product-catalog" />
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  String((config as any).productCatalogSourceType ?? "SHOPIFY") !== "SHOPIFY"
                }
              >
                Import products now
              </button>
            </form>
          </div>
        </s-box>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Collection catalog foundation</s-heading>
          <div
            style={{
              marginBottom: "14px",
              fontSize: "14px",
              color: "#51606f",
              lineHeight: 1.5,
            }}
          >
            Collection imports will become the source layer for collection rules,
            collection-driven discount orchestration, and future non-Shopify feeds.
            The UI is prepared now so this foundation matches the product catalog
            model.
          </div>
          <div className="catalog-source-grid">
            <div className="catalog-source-card is-active">
              <div className="catalog-source-kicker">Available now</div>
              <div className="catalog-source-title">Shopify Collections</div>
              <div className="catalog-source-meta">
                Active collections: {catalogCollectionCount}
                <br />
                Stored locally for collection rules and collection-based governance.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">CSV / JSON Import</div>
              <div className="catalog-source-meta">
                Reserved for MVP_6 collection imports from flat-file feeds and
                external data export pipelines.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">ERP Integration</div>
              <div className="catalog-source-meta">
                Reserved for future ERP-backed collection synchronization and mapping
                into admin governance rules.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <s-text>Collection source: Shopify</s-text>
            <form method="post">
              <input type="hidden" name="intent" value="sync-collection-catalog" />
              <button type="submit" disabled={isSubmitting}>
                Import collections now
              </button>
            </form>
          </div>
        </s-box>
        <form method="post">
          <input type="hidden" name="intent" value="save-global" />
          <s-stack direction="block" gap="base">
            <label>
              <input
                name="marginGuardEnabled"
                type="checkbox"
                defaultChecked={(config as any).marginGuardEnabled !== false}
              />
              Margin Guard enforcement active
            </label>
            <s-paragraph>
              When enabled, Margin Guard enforces the margin floor on all discounts.
              When disabled, all discounts pass through without floor enforcement.
              Note: only product-level discount codes (Amount off products) are intercepted. Order-level codes (Amount off order) bypass per-line floor checks.
            </s-paragraph>
            <label>
              Customer segment tag treated as B2B pricing
              <input name="b2bTag" defaultValue={config.b2bTag} placeholder="wholesale" />
            </label>
            <s-paragraph>
              Any customer with this exact tag is evaluated as the protected segment in
              discount controls.
            </s-paragraph>
            <label>
              Global minimum price percent
              <input
                name="globalMinPricePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.globalMinPricePercent}
              />
            </label>
            <label>
              B2B global minimum price percent
              <input
                name="b2bGlobalMinPricePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={
                  (config as any).b2bGlobalMinPricePercent ?? config.globalMinPricePercent
                }
              />
            </label>
            <input
              type="hidden"
              name="productCatalogSourceType"
              value={(config as any).productCatalogSourceType ?? "SHOPIFY"}
            />
            <label>
              <input
                name="productCatalogAutoImportEnabled"
                type="checkbox"
                defaultChecked={(config as any).productCatalogAutoImportEnabled !== false}
              />
              Automatically sync product catalog from the selected source
            </label>
            <label>
              <input
                name="allowZeroFinalPrice"
                type="checkbox"
                defaultChecked={config.allowZeroFinalPrice}
              />
              Allow zero final price globally
            </label>
            <label>
              <input
                name="allowRemoveAtMinimumOrderQuantity"
                type="checkbox"
                defaultChecked={
                  (config as any).allowRemoveAtMinimumOrderQuantity !== false
                }
              />
              Allow removing a cart line when customer decreases from MOQ
            </label>
            <label>
              <input name="allowStacking" type="checkbox" defaultChecked={config.allowStacking} />
              Allow discount stacking
            </label>
            <label>
              Max combined discount percent (optional)
              <input
                name="maxCombinedPercentOff"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.maxCombinedPercentOff ?? ""}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save global settings
            </button>
          </s-stack>
        </form>
      </s-section>
    </s-page>
  );
}
