import { resolvePricingSimulationInput } from "../../../app/services/pricing-preview.server.ts";
import type { PricingPipelineInput } from "../../../core/pricing/pricing.pipeline.ts";
import type { TierPrice } from "../../../core/pricing/pricing.types.ts";
import { resolveSegment } from "../../../core/segment/segment.engine.ts";
import type { DiscountInput } from "../../../core/discount/discount.rules.ts";

interface CartValidateRequestBody {
  productId: string;
  variantId?: string;
  customerId?: string;
  basePrice: number;
  b2bOverridePrice?: number;
  buyerHasB2BTag: boolean;
  buyerHasPurchasingCompany: boolean;
  quantity: number;
  collectionIds: string[];
  enteredDiscountCodes: string[];
  tierPrices?: TierPrice[];
  discounts: DiscountInput[];
}

function badRequest(message: string, details?: Record<string, unknown>) {
  return Response.json(
    {
      ok: false,
      error: message,
      contract: "INTERNAL_ADMIN_ENDPOINT",
      ...(details ? { details } : {}),
    },
    { status: 400 },
  );
}

function normalizeQuantity(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => Boolean(item));
}

function normalizeDiscountInputs(value: unknown): DiscountInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): DiscountInput | null => {
      const candidate = (item ?? {}) as Record<string, unknown>;
      const code = candidate.code == null ? undefined : String(candidate.code).trim();
      const percentOff =
        candidate.percentOff == null ? undefined : Number(candidate.percentOff);
      const priority =
        candidate.priority == null ? undefined : Number(candidate.priority);
      const stackMode =
        candidate.stackMode === "STACKABLE" ||
        candidate.stackMode === "EXCLUSIVE" ||
        candidate.stackMode === "NEVER_WITH_COUPONS"
          ? candidate.stackMode
          : undefined;
      const sourceId =
        candidate.sourceId == null ? undefined : String(candidate.sourceId).trim();

      if (!code && !Number.isFinite(percentOff)) {
        return null;
      }

      return {
        code: code || undefined,
        percentOff: Number.isFinite(percentOff) ? percentOff : undefined,
        priority: Number.isFinite(priority) ? priority : undefined,
        stackMode: stackMode || undefined,
        sourceId: sourceId || undefined,
      };
    })
    .filter((item): item is DiscountInput => item != null);
}

async function parseRequestBody(
  request: Request,
): Promise<
  | { ok: true; body: CartValidateRequestBody }
  | { ok: false; response: Response }
> {
  if (request.method.toUpperCase() !== "POST") {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: "Method not allowed. Use POST.",
          contract: "INTERNAL_ADMIN_ENDPOINT",
        },
        { status: 405 },
      ),
    };
  }

  const contentType = String(request.headers.get("content-type") ?? "");
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: "Unsupported content type. Use application/json.",
          contract: "INTERNAL_ADMIN_ENDPOINT",
        },
        { status: 415 },
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {
      ok: false,
      response: badRequest("Invalid JSON payload."),
    };
  }

  const body = (parsed ?? {}) as Record<string, unknown>;
  const productId = String(body.productId ?? "").trim();
  if (!productId) {
    return {
      ok: false,
      response: badRequest("Missing required field: productId."),
    };
  }

  const basePrice = Number(body.basePrice);
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    return {
      ok: false,
      response: badRequest("Invalid required field: basePrice must be >= 0."),
    };
  }

  const b2bOverrideRaw = body.b2bOverridePrice;
  let b2bOverridePrice: number | undefined;
  if (b2bOverrideRaw != null) {
    const parsedB2BOverridePrice = Number(b2bOverrideRaw);
    if (
      !Number.isFinite(parsedB2BOverridePrice) ||
      parsedB2BOverridePrice < 0
    ) {
      return {
        ok: false,
        response: badRequest(
          "Invalid optional field: b2bOverridePrice must be >= 0 when provided.",
        ),
      };
    }
    b2bOverridePrice = parsedB2BOverridePrice;
  }

  const quantity = normalizeQuantity(body.quantity);
  return {
    ok: true,
    body: {
      productId,
      variantId: body.variantId ? String(body.variantId) : undefined,
      customerId: body.customerId ? String(body.customerId) : undefined,
      basePrice,
      b2bOverridePrice,
      buyerHasB2BTag: Boolean(body.buyerHasB2BTag),
      buyerHasPurchasingCompany: Boolean(body.buyerHasPurchasingCompany),
      quantity,
      collectionIds: normalizeStringList(body.collectionIds),
      enteredDiscountCodes: normalizeStringList(body.enteredDiscountCodes),
      tierPrices: Array.isArray(body.tierPrices)
        ? body.tierPrices
            .map((item): TierPrice | null => {
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
            .filter((item): item is TierPrice => item != null)
        : undefined,
      discounts: normalizeDiscountInputs(body.discounts),
    },
  };
}

type ConfigShape = {
  b2bTag: string;
  allowStacking: boolean;
  maxCombinedPercentOff: number | null;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent?: number;
  allowZeroFinalPrice: boolean;
  productFloors: Array<{
    productId: string;
    segment: string | null;
    minPercentOfBasePrice: number;
    allowZeroFinalPrice: boolean | null;
    b2bOverridePrice?: number | null;
  }>;
  productTierPrices?: Array<{
    productId: string;
    segment: string | null;
    minQuantity: number;
    unitPrice: number;
  }>;
  discountRules?: Array<{
    id: string;
    scope: string;
    targetId: string | null;
    code: string | null;
    segment: string | null;
    percentOff: number;
    priority: number;
    stackMode: string;
    minPricePercentOfBasePrice: number | null;
  }>;
  discountCombinationBlacklistRules?: Array<{
    leftType: string;
    leftValue: string;
    rightType: string;
    rightValue: string;
    segment: string | null;
  }>;
  discountSegmentCaps?: Array<{
    segment: string;
    maxCombinedPercentOff: number;
  }>;
};

type ValidationResult = {
  valid: boolean;
  result: {
    finalPrice: number;
    floorPrice: number;
    violationAmount: number;
  };
};

type ActionDeps = {
  authenticateAdmin: (request: Request) => Promise<{ session: { shop: string } }>;
  getConfig: () => Promise<ConfigShape>;
  validate: (input: PricingPipelineInput) => ValidationResult;
  recordViolation: (input: {
    shop: string;
    productId: string;
    customerId?: string;
    segment: "B2B" | "B2C";
    basePrice: number;
    finalPrice: number;
    floorPrice: number;
    violationAmount: number;
    source: string;
  }) => Promise<unknown>;
};

export function createCartValidateAdminAction(deps: ActionDeps) {
  return async ({ request }: { request: Request }) => {
    const parsed = await parseRequestBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }
    const body = parsed.body;
    const { session } = await deps.authenticateAdmin(request);
    const config = await deps.getConfig();

    const segment = resolveSegment({
      customerTags: body.buyerHasB2BTag ? [config.b2bTag] : [],
      b2bTag: config.b2bTag,
      hasPurchasingCompany: body.buyerHasPurchasingCompany,
    });

    const result = deps.validate(
      resolvePricingSimulationInput(config, {
        productId: body.productId,
        variantId: body.variantId,
        segment: segment.segment,
        basePrice: body.basePrice,
      b2bOverridePrice: body.b2bOverridePrice,
      quantity: body.quantity,
      tierPrices: body.tierPrices,
      collectionIds: body.collectionIds,
      enteredDiscountCodes: body.enteredDiscountCodes,
      discounts: body.discounts,
      }),
    );

    if (!result.valid) {
      await deps.recordViolation({
        shop: session.shop,
        productId: body.productId,
        customerId: body.customerId,
        segment: segment.segment,
        basePrice: body.basePrice,
        finalPrice: result.result.finalPrice,
        floorPrice: result.result.floorPrice,
        violationAmount: result.result.violationAmount,
        source: "api_cart_validation",
      });
    }

    return Response.json({
      ok: true,
      contract: "INTERNAL_ADMIN_ENDPOINT",
      result,
    });
  };
}
