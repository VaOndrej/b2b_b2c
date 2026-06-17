import {
  deleteCouponSegmentRule,
  deleteDiscountCombinationBlacklistRule,
  deleteDiscountRule,
  deleteDiscountSegmentCap,
  upsertCouponSegmentRule,
  upsertDiscountCombinationBlacklistRule,
  upsertDiscountRule,
  upsertDiscountSegmentCap,
} from "./margin-guard-config.server.ts";

// MVP_5_1 (move-not-copy): the discount-area action handlers (coupon segment
// rules, advanced discount orchestration, combination blacklist, segment caps)
// extracted from the app.settings.tsx monolith so the standalone
// app.settings.discounts route and the legacy all-in-one workspace share ONE
// implementation. Pure DB writes — the cart-validation activation tail stays in
// each route action (it needs the admin client).

export const DISCOUNT_SETTINGS_INTENTS = [
  "save-coupon-segment-rule",
  "delete-coupon-segment-rule",
  "save-discount-rule",
  "delete-discount-rule",
  "save-discount-blacklist-rule",
  "delete-discount-blacklist-rule",
  "save-discount-segment-cap",
  "delete-discount-segment-cap",
] as const;

export type DiscountSettingsIntent = (typeof DISCOUNT_SETTINGS_INTENTS)[number];

export function isDiscountSettingsIntent(
  intent: string,
): intent is DiscountSettingsIntent {
  return (DISCOUNT_SETTINGS_INTENTS as readonly string[]).includes(intent);
}

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Applies a discount-area form submission to the database. Returns true when the
 * intent belonged to this module (so callers know whether to run the shared
 * cart-validation activation tail), false otherwise.
 */
export async function handleDiscountSettingsAction(
  formData: FormData,
): Promise<boolean> {
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-coupon-segment-rule") {
    const code = String(formData.get("code") ?? "").trim();
    const allowedSegmentRaw = String(formData.get("allowedSegment") ?? "ALL").trim();
    if (code) {
      await upsertCouponSegmentRule({
        code,
        allowedSegment:
          allowedSegmentRaw === "B2B" || allowedSegmentRaw === "B2C"
            ? allowedSegmentRaw
            : "ALL",
      });
    }
    return true;
  }

  if (intent === "delete-coupon-segment-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteCouponSegmentRule(id);
    }
    return true;
  }

  if (intent === "save-discount-rule") {
    const scopeRaw = String(formData.get("scope") ?? "GLOBAL").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const targetId =
      scopeRaw === "PRODUCT"
        ? String(formData.get("productId") ?? "").trim()
        : scopeRaw === "COLLECTION"
          ? String(formData.get("collectionId") ?? "").trim()
          : undefined;
    const code = String(formData.get("code") ?? "").trim();
    const percentOff = parseNumber(formData.get("percentOff"), NaN);
    const priority = Math.floor(parseNumber(formData.get("priority"), 100));
    const minPricePercentOfBasePriceRaw = String(
      formData.get("minPricePercentOfBasePrice") ?? "",
    ).trim();
    const minPricePercentOfBasePrice = minPricePercentOfBasePriceRaw
      ? Number(minPricePercentOfBasePriceRaw)
      : null;
    await upsertDiscountRule({
      scope:
        scopeRaw === "COLLECTION" ||
        scopeRaw === "PRODUCT" ||
        scopeRaw === "COUPON"
          ? scopeRaw
          : "GLOBAL",
      targetId,
      code,
      segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
      percentOff,
      priority,
      stackMode:
        String(formData.get("stackMode") ?? "STACKABLE").trim() === "EXCLUSIVE"
          ? "EXCLUSIVE"
          : String(formData.get("stackMode") ?? "STACKABLE").trim() ===
              "NEVER_WITH_COUPONS"
            ? "NEVER_WITH_COUPONS"
            : "STACKABLE",
      minPricePercentOfBasePrice:
        minPricePercentOfBasePrice != null &&
        Number.isFinite(minPricePercentOfBasePrice)
          ? minPricePercentOfBasePrice
          : null,
    });
    return true;
  }

  if (intent === "delete-discount-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountRule(id);
    }
    return true;
  }

  if (intent === "save-discount-blacklist-rule") {
    await upsertDiscountCombinationBlacklistRule({
      leftType:
        String(formData.get("leftType") ?? "COUPON_CODE").trim() === "RULE_ID"
          ? "RULE_ID"
          : String(formData.get("leftType") ?? "COUPON_CODE").trim() === "SCOPE"
            ? "SCOPE"
            : "COUPON_CODE",
      leftValue: String(formData.get("leftValue") ?? "").trim(),
      rightType:
        String(formData.get("rightType") ?? "COUPON_CODE").trim() === "RULE_ID"
          ? "RULE_ID"
          : String(formData.get("rightType") ?? "COUPON_CODE").trim() === "SCOPE"
            ? "SCOPE"
            : "COUPON_CODE",
      rightValue: String(formData.get("rightValue") ?? "").trim(),
      segment:
        String(formData.get("segment") ?? "").trim() === "B2B"
          ? "B2B"
          : String(formData.get("segment") ?? "").trim() === "B2C"
            ? "B2C"
            : "ALL",
    });
    return true;
  }

  if (intent === "delete-discount-blacklist-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountCombinationBlacklistRule(id);
    }
    return true;
  }

  if (intent === "save-discount-segment-cap") {
    await upsertDiscountSegmentCap({
      segment:
        String(formData.get("segment") ?? "").trim() === "B2B"
          ? "B2B"
          : String(formData.get("segment") ?? "").trim() === "B2C"
            ? "B2C"
            : "ALL",
      maxCombinedPercentOff: parseNumber(
        formData.get("maxCombinedPercentOff"),
        NaN,
      ),
    });
    return true;
  }

  if (intent === "delete-discount-segment-cap") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountSegmentCap(id);
    }
    return true;
  }

  return false;
}
