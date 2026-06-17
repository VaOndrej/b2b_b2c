import {
  deleteCollectionMaximumQuantityRule,
  deleteProductCustomerMaximumQuantityRule,
  deleteProductFloorRule,
  deleteProductMaximumQuantityRule,
  deleteProductQuantityRule,
  deleteProductStepQuantityRule,
  deleteProductVisibilityRule,
  deleteProductVariantVisibilityRule,
  deleteProductTierPriceRule,
  upsertCollectionMaximumQuantityRule,
  upsertProductCustomerMaximumQuantityRule,
  upsertProductFloorRule,
  upsertProductMaximumQuantityRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductVisibilityRule,
  upsertProductVariantVisibilityRule,
  upsertProductTierPriceRule,
  syncVisibilityHandlesMetafield,
} from "./margin-guard-config.server.ts";
import {
  deleteCollectionVisibilityRule,
  upsertCollectionVisibilityRule,
} from "./storefront-content.server.ts";
import { getCatalogCollectionMapByIds } from "./product-catalog.server.ts";

// MVP_5_1 (move-not-copy): the catalog-rules action handlers (per-product floor /
// tier / MOQ / step / max / customer-max, collection max, and product / variant /
// collection visibility) extracted from the app.settings.tsx monolith so the
// standalone app.settings.catalog-rules route and the legacy all-in-one workspace
// share ONE implementation. The shared storefront-projection + cart-validation
// activation tail stays in each route action (they run for many intent groups).

type AdminClient = Parameters<typeof syncVisibilityHandlesMetafield>[0];

export const CATALOG_RULES_SETTINGS_INTENTS = [
  "save-product-floor",
  "delete-product-floor",
  "save-product-tier-price",
  "delete-product-tier-price",
  "save-product-quantity-rule",
  "delete-product-quantity-rule",
  "save-product-step-quantity-rule",
  "delete-product-step-quantity-rule",
  "save-product-max-quantity-rule",
  "delete-product-max-quantity-rule",
  "save-collection-max-quantity-rule",
  "delete-collection-max-quantity-rule",
  "save-product-customer-max-quantity-rule",
  "delete-product-customer-max-quantity-rule",
  "save-product-visibility-rule",
  "delete-product-visibility-rule",
  "save-product-variant-visibility-rule",
  "delete-product-variant-visibility-rule",
  "save-collection-visibility-rule",
  "delete-collection-visibility-rule",
] as const;

export type CatalogRulesSettingsIntent =
  (typeof CATALOG_RULES_SETTINGS_INTENTS)[number];

export function isCatalogRulesSettingsIntent(
  intent: string,
): intent is CatalogRulesSettingsIntent {
  return (CATALOG_RULES_SETTINGS_INTENTS as readonly string[]).includes(intent);
}

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Applies a catalog-rules form submission to the database. Returns true when the
 * intent belonged to this module (so callers know whether to run the shared
 * storefront-projection + cart-validation activation tail), false otherwise.
 */
export async function handleCatalogRulesSettingsAction(input: {
  admin: AdminClient;
  formData: FormData;
}): Promise<boolean> {
  const { admin, formData } = input;
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-product-floor") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const allowZeroOverrideRaw = String(
      formData.get("allowZeroFinalPriceOverride") ?? "inherit",
    ).trim();
    const b2bOverrideRaw = String(formData.get("b2bOverridePrice") ?? "").trim();
    const minPercentOfBasePrice = parseNumber(
      formData.get("minPercentOfBasePrice"),
      70,
    );
    const b2bOverridePrice = b2bOverrideRaw ? Number(b2bOverrideRaw) : null;

    if (productId) {
      await upsertProductFloorRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minPercentOfBasePrice,
        allowZeroFinalPrice:
          allowZeroOverrideRaw === "allow"
            ? true
            : allowZeroOverrideRaw === "deny"
              ? false
              : null,
        b2bOverridePrice:
          b2bOverridePrice != null &&
          Number.isFinite(b2bOverridePrice) &&
          b2bOverridePrice >= 0
            ? b2bOverridePrice
            : null,
      });
    }
    return true;
  }

  if (intent === "delete-product-floor") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductFloorRule(id);
    }
    return true;
  }

  if (intent === "save-product-tier-price") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minQuantity = Math.max(1, Math.floor(parseNumber(formData.get("minQuantity"), 1)));
    const unitPrice = parseNumber(formData.get("unitPrice"), NaN);

    if (productId && Number.isFinite(unitPrice) && unitPrice >= 0) {
      await upsertProductTierPriceRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minQuantity,
        unitPrice,
      });
    }
    return true;
  }

  if (intent === "delete-product-tier-price") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductTierPriceRule(id);
    }
    return true;
  }

  if (intent === "save-product-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minimumOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("minimumOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minimumOrderQuantity,
      });
    }
    return true;
  }

  if (intent === "delete-product-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductQuantityRule(id);
    }
    return true;
  }

  if (intent === "save-product-step-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const stepQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("stepQuantity"), 1)),
    );

    if (productId) {
      await upsertProductStepQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        stepQuantity,
      });
    }
    return true;
  }

  if (intent === "delete-product-step-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductStepQuantityRule(id);
    }
    return true;
  }

  if (intent === "save-product-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductMaximumQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        maxOrderQuantity,
      });
    }
    return true;
  }

  if (intent === "delete-product-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductMaximumQuantityRule(id);
    }
    return true;
  }

  if (intent === "save-collection-max-quantity-rule") {
    const collectionId = String(formData.get("collectionId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );

    if (collectionId) {
      await upsertCollectionMaximumQuantityRule({
        collectionId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        maxOrderQuantity,
      });
    }
    return true;
  }

  if (intent === "delete-collection-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteCollectionMaximumQuantityRule(id);
    }
    return true;
  }

  if (intent === "save-product-customer-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );
    if (productId && customerId) {
      await upsertProductCustomerMaximumQuantityRule({
        productId,
        customerId,
        maxOrderQuantity,
      });
    }
    return true;
  }

  if (intent === "delete-product-customer-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductCustomerMaximumQuantityRule(id);
    }
    return true;
  }

  if (intent === "save-product-visibility-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "ALL").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();

    if (productId) {
      await upsertProductVisibilityRule({
        productId,
        visibilityMode:
          visibilityModeRaw === "B2B_ONLY" ||
          visibilityModeRaw === "B2C_ONLY" ||
          visibilityModeRaw === "CUSTOMER_ONLY"
            ? visibilityModeRaw
            : "ALL",
        customerId,
      });
      await syncVisibilityHandlesMetafield(admin).catch((err) => {
        console.error("[syncVisibilityHandlesMetafield] action sync failed:", err);
      });
    }
    return true;
  }

  if (intent === "delete-product-visibility-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductVisibilityRule(id);
      await syncVisibilityHandlesMetafield(admin).catch((err) => {
        console.error("[syncVisibilityHandlesMetafield] action sync failed:", err);
      });
    }
    return true;
  }

  if (intent === "save-product-variant-visibility-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const variantId = String(formData.get("variantId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "ALL").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();

    if (productId && variantId) {
      await upsertProductVariantVisibilityRule({
        productId,
        variantId,
        visibilityMode:
          visibilityModeRaw === "B2B_ONLY" ||
          visibilityModeRaw === "B2C_ONLY" ||
          visibilityModeRaw === "CUSTOMER_ONLY"
            ? visibilityModeRaw
            : "ALL",
        customerId,
      });
    }
    return true;
  }

  if (intent === "delete-product-variant-visibility-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductVariantVisibilityRule(id);
    }
    return true;
  }

  if (intent === "save-collection-visibility-rule") {
    const collectionId = String(formData.get("collectionId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "B2B_ONLY").trim();

    if (collectionId) {
      const collectionMap = await getCatalogCollectionMapByIds([collectionId]);
      const collection = collectionMap[collectionId];
      await upsertCollectionVisibilityRule({
        id: String(formData.get("ruleId") ?? "").trim() || undefined,
        collectionId,
        collectionHandle: collection?.handle ?? "",
        collectionTitle: collection?.title ?? null,
        visibilityMode: visibilityModeRaw === "B2C_ONLY" ? "B2C_ONLY" : "B2B_ONLY",
      });
    }
    return true;
  }

  if (intent === "delete-collection-visibility-rule") {
    const id = String(formData.get("ruleId") ?? formData.get("id") ?? "").trim();
    if (id) {
      await deleteCollectionVisibilityRule(id);
    }
    return true;
  }

  return false;
}
