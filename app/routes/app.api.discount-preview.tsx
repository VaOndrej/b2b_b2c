import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig, buildFloorRuleset } from "../services/margin-guard-config.server";
import { resolveSegment } from "../../core/segment/segment.engine";
import { applyDiscountFunction } from "../../functions/discount-function/src";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const body = await request.json();
  const config = await getOrCreateMarginGuardConfig();
  const buyerHasB2BTag = Boolean(body.buyerHasB2BTag);

  const segment = resolveSegment({
    customerTags: buyerHasB2BTag ? [config.b2bTag] : [],
    b2bTag: config.b2bTag,
  });

  const result = applyDiscountFunction({
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

  return Response.json(result);
};
