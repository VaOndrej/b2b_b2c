import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildFloorRuleset, getOrCreateMarginGuardConfig, recordMarginViolation } from "../services/margin-guard-config.server";
import { resolveSegment } from "../../core/segment/segment.engine";
import { validateCartLine } from "../../functions/cart-validation/src";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  const config = await getOrCreateMarginGuardConfig();

  const segment = resolveSegment({
    customerTags: body.customerTags ?? [],
    b2bTag: config.b2bTag,
  });

  const result = validateCartLine({
    productId: String(body.productId ?? ""),
    variantId: body.variantId ? String(body.variantId) : undefined,
    segment: segment.segment,
    basePrice: Number(body.basePrice ?? 0),
    b2bOverridePrice:
      body.b2bOverridePrice != null ? Number(body.b2bOverridePrice) : undefined,
    discounts: Array.isArray(body.discounts) ? body.discounts : [],
    discountRules: {
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff ?? undefined,
    },
    floorRuleset: buildFloorRuleset(config),
  });

  if (!result.valid) {
    await recordMarginViolation({
      shop: session.shop,
      productId: String(body.productId ?? ""),
      customerId: body.customerId ? String(body.customerId) : undefined,
      segment: segment.segment,
      basePrice: Number(body.basePrice ?? 0),
      finalPrice: result.result.finalPrice,
      floorPrice: result.result.floorPrice,
      violationAmount: result.result.violationAmount,
      source: "api_cart_validation",
    });
  }

  return Response.json(result);
};
