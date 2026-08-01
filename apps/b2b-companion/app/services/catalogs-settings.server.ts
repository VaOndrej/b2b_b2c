import {
  createPriceCatalog,
  deletePriceCatalog,
  updatePriceCatalog,
  upsertCatalogPriceRule,
  deleteCatalogPriceRule,
  upsertCatalogFloorRule,
  deleteCatalogFloorRule,
  upsertCatalogDiscountRule,
  deleteCatalogDiscountRule,
  upsertCatalogQuantityRule,
  deleteCatalogQuantityRule,
  addCatalogMembership,
  removeCatalogMembership,
  upsertCatalogVariantVisibilityRule,
  deleteCatalogVariantVisibilityRule,
  upsertCatalogVisibilityRule,
  deleteCatalogVisibilityRule,
  upsertCatalogCouponRule,
  deleteCatalogCouponRule,
  setCatalogDiscountCap,
  clearCatalogDiscountCap,
  upsertCatalogBlacklistRule,
  deleteCatalogBlacklistRule,
  upsertCatalogCustomerQuantityRule,
  deleteCatalogCustomerQuantityRule,
  type PriceCatalogWriteInput,
} from "./price-catalog.server.ts";

// MVP_5_3 Phase 2 — action handler for the Catalogs admin route + catalog editor.
// Mirrors the catalog-rules-settings.server pattern: one handler, intent-
// dispatched, with an injectable deps seam so the route stays thin and the logic
// stays unit-testable.

export interface CatalogsSettingsDeps {
  createPriceCatalog?: typeof createPriceCatalog;
  updatePriceCatalog?: typeof updatePriceCatalog;
  deletePriceCatalog?: typeof deletePriceCatalog;
  upsertCatalogPriceRule?: typeof upsertCatalogPriceRule;
  deleteCatalogPriceRule?: typeof deleteCatalogPriceRule;
  upsertCatalogFloorRule?: typeof upsertCatalogFloorRule;
  deleteCatalogFloorRule?: typeof deleteCatalogFloorRule;
  upsertCatalogDiscountRule?: typeof upsertCatalogDiscountRule;
  deleteCatalogDiscountRule?: typeof deleteCatalogDiscountRule;
  upsertCatalogQuantityRule?: typeof upsertCatalogQuantityRule;
  deleteCatalogQuantityRule?: typeof deleteCatalogQuantityRule;
  addCatalogMembership?: typeof addCatalogMembership;
  removeCatalogMembership?: typeof removeCatalogMembership;
  upsertCatalogVariantVisibilityRule?: typeof upsertCatalogVariantVisibilityRule;
  deleteCatalogVariantVisibilityRule?: typeof deleteCatalogVariantVisibilityRule;
  upsertCatalogVisibilityRule?: typeof upsertCatalogVisibilityRule;
  deleteCatalogVisibilityRule?: typeof deleteCatalogVisibilityRule;
  upsertCatalogCouponRule?: typeof upsertCatalogCouponRule;
  deleteCatalogCouponRule?: typeof deleteCatalogCouponRule;
  setCatalogDiscountCap?: typeof setCatalogDiscountCap;
  clearCatalogDiscountCap?: typeof clearCatalogDiscountCap;
  upsertCatalogBlacklistRule?: typeof upsertCatalogBlacklistRule;
  deleteCatalogBlacklistRule?: typeof deleteCatalogBlacklistRule;
  upsertCatalogCustomerQuantityRule?: typeof upsertCatalogCustomerQuantityRule;
  deleteCatalogCustomerQuantityRule?: typeof deleteCatalogCustomerQuantityRule;
}

function parseAudienceTags(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolean(value: FormDataEntryValue | null): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "on" || normalized === "true" || normalized === "1";
}

function parseWriteInput(formData: FormData): PriceCatalogWriteInput {
  return {
    name: String(formData.get("name") ?? ""),
    priority: Number(formData.get("priority") ?? 0),
    status: String(formData.get("status") ?? "DRAFT") as PriceCatalogWriteInput["status"],
    matchCompany: parseBoolean(formData.get("matchCompany")),
    membershipMode: String(
      formData.get("membershipMode") ?? "OPT_IN",
    ) as PriceCatalogWriteInput["membershipMode"],
    audienceTags: parseAudienceTags(formData.get("audienceTags")),
    marketFilters: [
      {
        countryCode: String(formData.get("marketCountry") ?? "") || null,
        currencyCode: String(formData.get("marketCurrency") ?? "") || null,
        languageCode: String(formData.get("marketLanguage") ?? "") || null,
      },
    ],
  };
}

export async function handleCatalogsSettingsAction(
  { formData }: { formData: FormData },
  deps: CatalogsSettingsDeps = {},
) {
  const create = deps.createPriceCatalog ?? createPriceCatalog;
  const update = deps.updatePriceCatalog ?? updatePriceCatalog;
  const remove = deps.deletePriceCatalog ?? deletePriceCatalog;
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-catalog") {
    const catalogId = String(formData.get("catalogId") ?? "").trim();
    const input = parseWriteInput(formData);
    if (catalogId) {
      await update(catalogId, input);
      return { ok: true, intent, catalogId };
    }
    // Returned so the create pane can redirect into the new catalog's editor.
    // Stubbed deps in tests may resolve to nothing — hence the guard.
    const created = (await create(input)) as { id?: string } | undefined;
    return { ok: true, intent, catalogId: created?.id };
  }

  if (intent === "delete-catalog") {
    const catalogId = String(formData.get("catalogId") ?? "").trim();
    if (catalogId) {
      await remove(catalogId);
    }
    return { ok: true, intent };
  }

  const catalogId = String(formData.get("catalogId") ?? "").trim();
  const ruleId = String(formData.get("ruleId") ?? "").trim() || null;
  const num = (key: string) => Number(formData.get(key) ?? 0);
  const optNum = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const str = (key: string) => String(formData.get(key) ?? "");

  switch (intent) {
    case "save-catalog-price-rule": {
      const scope = str("scope");
      const targetId =
        scope === "PRODUCT"
          ? str("productId")
          : scope === "COLLECTION"
            ? str("collectionId")
            : scope === "VARIANT"
              ? str("variantId")
              : str("targetId");
      await (deps.upsertCatalogPriceRule ?? upsertCatalogPriceRule)({
        id: ruleId,
        catalogId,
        scope,
        targetId,
        mode: str("mode"),
        value: num("value"),
      });
      return { ok: true, intent };
    }
    case "delete-catalog-price-rule":
      if (ruleId) await (deps.deleteCatalogPriceRule ?? deleteCatalogPriceRule)(ruleId);
      return { ok: true, intent };

    case "save-catalog-floor-rule":
      await (deps.upsertCatalogFloorRule ?? upsertCatalogFloorRule)({
        id: ruleId,
        catalogId,
        productId: str("productId"),
        variantId: str("variantId"),
        minPercentOfBasePrice: num("minPercentOfBasePrice"),
        allowZeroFinalPrice: parseBoolean(formData.get("allowZeroFinalPrice")),
      });
      return { ok: true, intent };
    case "delete-catalog-floor-rule":
      if (ruleId) await (deps.deleteCatalogFloorRule ?? deleteCatalogFloorRule)(ruleId);
      return { ok: true, intent };

    case "save-catalog-discount-rule": {
      const scope = str("scope");
      const targetId =
        scope === "PRODUCT"
          ? str("productId")
          : scope === "COLLECTION"
            ? str("collectionId")
            : str("targetId");
      await (deps.upsertCatalogDiscountRule ?? upsertCatalogDiscountRule)({
        id: ruleId,
        catalogId,
        scope,
        targetId,
        code: str("code"),
        percentOff: num("percentOff"),
        priority: num("priority"),
        stackMode: str("stackMode"),
        minPricePercentOfBasePrice: optNum("minPricePercentOfBasePrice"),
      });
      return { ok: true, intent };
    }
    case "delete-catalog-discount-rule":
      if (ruleId) await (deps.deleteCatalogDiscountRule ?? deleteCatalogDiscountRule)(ruleId);
      return { ok: true, intent };

    case "save-catalog-quantity-rule":
      await (deps.upsertCatalogQuantityRule ?? upsertCatalogQuantityRule)({
        id: ruleId,
        catalogId,
        productId: str("productId"),
        variantId: str("variantId"),
        collectionId: str("collectionId"),
        moq: optNum("moq"),
        step: optNum("step"),
        max: optNum("max"),
      });
      return { ok: true, intent };
    case "delete-catalog-quantity-rule":
      if (ruleId) await (deps.deleteCatalogQuantityRule ?? deleteCatalogQuantityRule)(ruleId);
      return { ok: true, intent };

    case "add-catalog-membership":
      await (deps.addCatalogMembership ?? addCatalogMembership)({
        catalogId,
        productId: str("productId"),
      });
      return { ok: true, intent };
    case "remove-catalog-membership":
      if (ruleId) await (deps.removeCatalogMembership ?? removeCatalogMembership)(ruleId);
      return { ok: true, intent };

    case "save-catalog-variant-visibility":
      await (deps.upsertCatalogVariantVisibilityRule ?? upsertCatalogVariantVisibilityRule)({
        id: ruleId,
        catalogId,
        productId: str("productId"),
        variantId: str("variantId"),
        visibilityMode: str("visibilityMode"),
      });
      return { ok: true, intent };
    case "delete-catalog-variant-visibility":
      if (ruleId) {
        await (deps.deleteCatalogVariantVisibilityRule ?? deleteCatalogVariantVisibilityRule)(ruleId);
      }
      return { ok: true, intent };

    case "save-catalog-visibility":
      await (deps.upsertCatalogVisibilityRule ?? upsertCatalogVisibilityRule)({
        id: ruleId,
        catalogId,
        scope: str("scope"),
        targetId: str("targetId"),
        handle: str("handle"),
        visibilityMode: str("visibilityMode"),
      });
      return { ok: true, intent };
    case "delete-catalog-visibility":
      if (ruleId) {
        await (deps.deleteCatalogVisibilityRule ?? deleteCatalogVisibilityRule)(ruleId);
      }
      return { ok: true, intent };

    case "save-catalog-coupon":
      await (deps.upsertCatalogCouponRule ?? upsertCatalogCouponRule)({
        id: ruleId,
        catalogId,
        code: str("code"),
      });
      return { ok: true, intent };
    case "delete-catalog-coupon":
      if (ruleId) await (deps.deleteCatalogCouponRule ?? deleteCatalogCouponRule)(ruleId);
      return { ok: true, intent };

    case "save-catalog-cap":
      await (deps.setCatalogDiscountCap ?? setCatalogDiscountCap)({
        catalogId,
        maxCombinedPercentOff: num("maxCombinedPercentOff"),
      });
      return { ok: true, intent };
    case "delete-catalog-cap":
      await (deps.clearCatalogDiscountCap ?? clearCatalogDiscountCap)(catalogId);
      return { ok: true, intent };

    case "save-catalog-blacklist":
      await (deps.upsertCatalogBlacklistRule ?? upsertCatalogBlacklistRule)({
        id: ruleId,
        catalogId,
        leftType: str("leftType"),
        leftValue: str("leftValue"),
        rightType: str("rightType"),
        rightValue: str("rightValue"),
      });
      return { ok: true, intent };
    case "delete-catalog-blacklist":
      if (ruleId) await (deps.deleteCatalogBlacklistRule ?? deleteCatalogBlacklistRule)(ruleId);
      return { ok: true, intent };

    case "save-catalog-customer-quantity":
      await (deps.upsertCatalogCustomerQuantityRule ?? upsertCatalogCustomerQuantityRule)({
        id: ruleId,
        catalogId,
        customerId: str("customerId"),
        productId: str("productId"),
        maxOrderQuantity: num("maxOrderQuantity"),
      });
      return { ok: true, intent };
    case "delete-catalog-customer-quantity":
      if (ruleId) {
        await (deps.deleteCatalogCustomerQuantityRule ?? deleteCatalogCustomerQuantityRule)(ruleId);
      }
      return { ok: true, intent };

    default:
      return { ok: false, intent };
  }
}
