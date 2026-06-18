import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  recordMarginViolation,
} from "../services/margin-guard-config.server";
import {
  loadCatalogRulesets,
  resolveCatalogRuleset,
} from "../services/catalog-ruleset.server";
import {
  buildOrderMarginConfig,
  evaluateOrderLine,
  type OrdersCreatePayload,
  resolveOrderCatalogContext,
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

  // MVP_5_3 #2.3c — resolve the order's price catalog and source the floor/tier/
  // override config from it (catalog tables), not the legacy config children.
  const rulesets = await loadCatalogRulesets().catch(() => []);
  const ruleset = resolveCatalogRuleset(
    rulesets,
    resolveOrderCatalogContext(orderPayload),
  );
  if (!ruleset) {
    return new Response();
  }
  const orderConfig = buildOrderMarginConfig({ ruleset, b2bTag: config.b2bTag });
  const segment = ruleset.segment;

  for (const lineItem of lineItems) {
    const result = evaluateOrderLine({ lineItem, segment, config: orderConfig });
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
