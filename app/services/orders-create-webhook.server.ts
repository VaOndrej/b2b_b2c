import { validateMargin } from "../../core/margin/margin.guard.ts";
import { resolveSegment } from "../../core/segment/segment.engine.ts";
import { computeEffectiveBasePrice } from "../../core/pricing/pricing.engine.ts";
import type { TierPrice } from "../../core/pricing/pricing.types.ts";
import type { Segment } from "../../core/segment/segment.types.ts";
import { buildFloorRuleset } from "./margin-guard-config.server.ts";

interface ProductFloorConfig {
  productId: string;
  segment: string | null;
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice?: number | null;
}

interface ProductTierPriceConfig {
  productId: string;
  segment: string | null;
  minQuantity: number;
  unitPrice: number;
}

interface OrderCompanyRef {
  company?: {
    id?: string | null;
  } | null;
}

interface OrderCustomerRef {
  tags?: unknown;
  purchasing_company?: OrderCompanyRef | null;
}

interface OrderBuyerIdentity {
  customer?: {
    purchasing_company?: OrderCompanyRef | null;
  } | null;
  purchasing_company?: OrderCompanyRef | null;
}

export interface OrdersCreatePayload {
  id?: unknown;
  customer?: OrderCustomerRef | null;
  buyer_identity?: OrderBuyerIdentity | null;
  purchasing_company?: OrderCompanyRef | null;
  line_items?: OrderLineItem[] | null;
}

export interface OrderLineItem {
  id?: unknown;
  product_id?: unknown;
  quantity?: unknown;
  price?: unknown;
  total_discount?: unknown;
}

export interface OrderMarginConfig {
  b2bTag: string;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent?: number;
  allowZeroFinalPrice: boolean;
  productFloors: ProductFloorConfig[];
  productTierPrices?: ProductTierPriceConfig[];
}

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

function parseTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((tag) => String(tag ?? "").trim())
      .filter(Boolean);
  }
  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function resolveOrderSegment(input: {
  payload: OrdersCreatePayload;
  b2bTag: string;
}): Segment {
  const customerTags = parseTags(input.payload?.customer?.tags);
  const hasPurchasingCompany = Boolean(
    input.payload?.buyer_identity?.customer?.purchasing_company?.company?.id ??
      input.payload?.buyer_identity?.purchasing_company?.company?.id ??
      input.payload?.customer?.purchasing_company?.company?.id ??
      input.payload?.purchasing_company?.company?.id,
  );

  return resolveSegment({
    customerTags,
    b2bTag: input.b2bTag,
    hasPurchasingCompany,
  }).segment;
}

function findB2BOverridePrice(input: {
  productId: string;
  segment: Segment;
  productFloors: ProductFloorConfig[];
}): number | undefined {
  if (input.segment !== "B2B") {
    return undefined;
  }

  const exactMatch = input.productFloors.find(
    (floor) => floor.productId === input.productId && floor.segment === "B2B",
  );
  const fallbackMatch = input.productFloors.find(
    (floor) => floor.productId === input.productId && floor.segment == null,
  );
  const value = exactMatch?.b2bOverridePrice ?? fallbackMatch?.b2bOverridePrice;

  return Number.isFinite(value ?? null) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function findTierPrices(input: {
  productId: string;
  segment: Segment;
  productTierPrices?: ProductTierPriceConfig[];
}): TierPrice[] {
  const segmentSpecific = (input.productTierPrices ?? []).filter(
    (tier) => tier?.productId === input.productId && tier.segment === input.segment,
  );
  const generic = (input.productTierPrices ?? []).filter(
    (tier) => tier?.productId === input.productId && tier.segment == null,
  );
  const relevant = segmentSpecific.length > 0 ? segmentSpecific : generic;

  return relevant.map((tier) => ({
    minQuantity: tier.minQuantity,
    unitPrice: tier.unitPrice,
  }));
}

export function evaluateOrderLine(input: {
  lineItem: OrderLineItem;
  segment: Segment;
  config: OrderMarginConfig;
}) {
  const quantity = Math.max(1, toNumber(input.lineItem?.quantity, 1));
  const productId = toProductGid(input.lineItem?.product_id);
  if (!productId) {
    return null;
  }

  const basePrice = roundMoney(toNumber(input.lineItem?.price, 0));
  const totalDiscount = roundMoney(toNumber(input.lineItem?.total_discount, 0));
  const perUnitDiscount = roundMoney(totalDiscount / quantity);

  const b2bOverridePrice = findB2BOverridePrice({
    productId,
    segment: input.segment,
    productFloors: input.config.productFloors,
  });
  const tierPrices = findTierPrices({
    productId,
    segment: input.segment,
    productTierPrices: input.config.productTierPrices,
  });

  const pricing = computeEffectiveBasePrice({
    productId,
    segment: input.segment,
    quantity,
    basePrice,
    b2bOverridePrice,
    tierPrices,
  });

  const finalPrice = roundMoney(
    Math.max(0, pricing.effectiveBasePrice - perUnitDiscount),
  );

  const validation = validateMargin({
    productId,
    segment: input.segment,
    effectiveBasePrice: pricing.effectiveBasePrice,
    finalPrice,
    ruleset: buildFloorRuleset(input.config),
  });

  return {
    productId,
    quantity,
    segment: input.segment,
    basePrice,
    effectiveBasePrice: pricing.effectiveBasePrice,
    finalPrice,
    validation,
  };
}
