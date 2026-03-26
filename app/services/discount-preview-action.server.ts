import type { ActionFunctionArgs } from "react-router";
import { resolveSegment } from "../../core/segment/segment.engine.ts";
import type { PricingPipelineInput } from "../../core/pricing/pricing.pipeline.ts";
import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import { resolvePricingSimulationInput } from "./pricing-preview.server.ts";

type DiscountPreviewConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

type DiscountPreviewDeps = {
  authenticateAdmin: (request: Request) => Promise<unknown>;
  getConfig: () => Promise<DiscountPreviewConfig>;
  applyDiscount: (input: PricingPipelineInput) => unknown;
};

export function createDiscountPreviewAction(deps: DiscountPreviewDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    await deps.authenticateAdmin(request);
    const body = await request.json();
    const config = await deps.getConfig();
    const buyerHasB2BTag = Boolean(body.buyerHasB2BTag);
    const buyerHasPurchasingCompany = Boolean(body.buyerHasPurchasingCompany);

    const segment = resolveSegment({
      customerTags: buyerHasB2BTag ? [config.b2bTag] : [],
      b2bTag: config.b2bTag,
      hasPurchasingCompany: buyerHasPurchasingCompany,
    });

    const result = deps.applyDiscount({
      ...resolvePricingSimulationInput(config, {
        productId: String(body.productId ?? ""),
        variantId: body.variantId ? String(body.variantId) : undefined,
        segment: segment.segment,
        basePrice: Number(body.basePrice ?? 0),
        b2bOverridePrice:
          body.b2bOverridePrice != null ? Number(body.b2bOverridePrice) : undefined,
        quantity: Number(body.quantity ?? 1),
        tierPrices: Array.isArray(body.tierPrices)
          ? body.tierPrices
              .map((item: unknown): { minQuantity: number; unitPrice: number } | null => {
                const candidate = (item ?? {}) as Record<string, unknown>;
                const minQuantity = Number(candidate.minQuantity);
                const unitPrice = Number(candidate.unitPrice);
                if (
                  !Number.isFinite(minQuantity) ||
                  !Number.isFinite(unitPrice) ||
                  minQuantity < 1 ||
                  unitPrice < 0
                ) {
                  return null;
                }
                return {
                  minQuantity: Math.floor(minQuantity),
                  unitPrice,
                };
              })
              .filter(
                (
                  item: { minQuantity: number; unitPrice: number } | null,
                ): item is { minQuantity: number; unitPrice: number } => item != null,
              )
          : undefined,
        collectionIds: Array.isArray(body.collectionIds)
          ? body.collectionIds.map((collectionId: unknown) => String(collectionId))
          : [],
        enteredDiscountCodes: Array.isArray(body.enteredDiscountCodes)
          ? body.enteredDiscountCodes.map((code: unknown) => String(code))
          : [],
        discounts: Array.isArray(body.discounts) ? body.discounts : [],
      }),
    });

    return Response.json(result);
  };
}
