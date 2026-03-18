import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  recordMarginViolation,
} from "../services/margin-guard-config.server";
import {
  evaluateOrderLine,
  type OrdersCreatePayload,
  resolveOrderSegment,
} from "../services/orders-create-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response();
  }

  const orderPayload = payload as OrdersCreatePayload;
  const config = await getOrCreateMarginGuardConfig();
  const lineItems = Array.isArray(orderPayload.line_items)
    ? orderPayload.line_items
    : [];
  const segment = resolveOrderSegment({ payload: orderPayload, b2bTag: config.b2bTag });

  for (const lineItem of lineItems) {
    const result = evaluateOrderLine({ lineItem, segment, config });
    if (!result) continue;

    if (!result.validation.allowed) {
      await recordMarginViolation({
        shop,
        productId: result.productId,
        segment: result.segment,
        basePrice: result.effectiveBasePrice,
        finalPrice: result.finalPrice,
        floorPrice: result.validation.floorPrice,
        violationAmount: result.validation.violationAmount,
        source: `orders_create_webhook:${orderPayload.id ?? "unknown"}:${lineItem.id ?? "line"}`,
      });
    }
  }

  return new Response();
};
