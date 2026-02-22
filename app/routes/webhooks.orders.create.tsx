import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { validateMargin } from "../../core/margin/margin.guard";
import {
  buildFloorRuleset,
  getOrCreateMarginGuardConfig,
  recordMarginViolation,
} from "../services/margin-guard-config.server";

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toProductGid(productId: unknown): string {
  const raw = String(productId ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("gid://shopify/Product/")) {
    return raw;
  }
  return `gid://shopify/Product/${raw}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response();
  }

  const config = await getOrCreateMarginGuardConfig();
  const floorRuleset = buildFloorRuleset(config);
  const lineItems = Array.isArray((payload as any)?.line_items)
    ? (payload as any).line_items
    : [];

  for (const lineItem of lineItems) {
    const quantity = Math.max(1, toNumber(lineItem?.quantity, 1));
    const productId = toProductGid(lineItem?.product_id);
    if (!productId) {
      continue;
    }

    const unitBasePrice = roundMoney(toNumber(lineItem?.price, 0));
    const totalDiscount = roundMoney(toNumber(lineItem?.total_discount, 0));
    const perUnitDiscount = roundMoney(totalDiscount / quantity);
    const unitFinalPrice = roundMoney(Math.max(0, unitBasePrice - perUnitDiscount));

    const validation = validateMargin({
      productId,
      segment: "B2C",
      effectiveBasePrice: unitBasePrice,
      finalPrice: unitFinalPrice,
      ruleset: floorRuleset,
    });

    if (!validation.allowed) {
      await recordMarginViolation({
        shop,
        productId,
        segment: "B2C",
        basePrice: unitBasePrice,
        finalPrice: unitFinalPrice,
        floorPrice: validation.floorPrice,
        violationAmount: validation.violationAmount,
        source: `orders_create_webhook:${(payload as any)?.id ?? "unknown"}:${lineItem?.id ?? "line"}`,
      });
    }
  }

  return new Response();
};
