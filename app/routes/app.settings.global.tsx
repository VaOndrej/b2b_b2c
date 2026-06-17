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
import { GlobalSettingsView } from "../components/global-settings-view";

// MVP_5_1 Part B: Global Settings is the first module pulled out of the
// app.settings.tsx monolith into a truly standalone route (own loader, action,
// and component). It now shares the configuration UI (GlobalSettingsView) with
// the legacy `?area=all` workspace, so there is a single implementation.

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
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

      <GlobalSettingsView
        config={config}
        catalogProductCount={catalogProductCount}
        catalogCollectionCount={catalogCollectionCount}
        isSubmitting={isSubmitting}
      />
    </s-page>
  );
}
