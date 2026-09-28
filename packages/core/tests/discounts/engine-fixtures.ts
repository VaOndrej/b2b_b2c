// Shared builders for the engine tests (not a test file itself: no `.test.ts`).
// Rules go through the real sanitizer and the real shop payload builder, so the
// engine is always tested on exactly what the function will read.

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import type { CartLineInput, CartPlanInput } from "../../src/discounts/cart.ts";
import type { CartPlan, RuleOutcome } from "../../src/discounts/plan.ts";
import { buildShopFunctionConfig, type FunctionConfigPayload } from "../../src/discounts/function-payload.ts";

export type RawRule = Record<string, unknown>;

const PRODUCTS_TARGET = { kind: "products", productIds: [], variantIds: [] };

/** Percentage off the lines whose `ruleIds` contain `id`. */
export function pct(id: string, percent: number, extra: RawRule = {}): RawRule {
  return { id, name: `Rule ${id}`, method: "automatic", value: { kind: "percentage", percent }, target: PRODUCTS_TARGET, ...extra };
}

/** Fixed amount per item (minor units per currency) off the lines whose `ruleIds` contain `id`. */
export function fixed(id: string, amount: Record<string, number>, extra: RawRule = {}): RawRule {
  return { id, name: `Rule ${id}`, method: "automatic", value: { kind: "fixed", amount }, target: PRODUCTS_TARGET, ...extra };
}

export function orderPct(id: string, percent: number, extra: RawRule = {}): RawRule {
  return pct(id, percent, { target: { kind: "order" }, ...extra });
}

export function orderFixed(id: string, amount: Record<string, number>, extra: RawRule = {}): RawRule {
  return fixed(id, amount, { target: { kind: "order" }, ...extra });
}

export function freeShip(id: string, extra: RawRule = {}): RawRule {
  return { id, name: `Rule ${id}`, method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" }, ...extra };
}

export function code(codes: string[], extra: RawRule = {}): RawRule {
  return { method: "code", codes, ...extra };
}

export function configOf(rules: RawRule[], extra: Record<string, unknown> = {}): WonDiscountsConfig {
  return sanitizeConfig({ ...extra, modules: { codes: { rules } } }).config;
}

export function payloadOf(rules: RawRule[], extra: Record<string, unknown> = {}): FunctionConfigPayload {
  return buildShopFunctionConfig(configOf(rules, extra)).payload;
}

export function line(
  id: string,
  unitPrice: number,
  quantity = 1,
  ruleIds: string[] = [],
  extra: Partial<CartLineInput> = {},
): CartLineInput {
  return {
    id,
    variantId: `gid://shopify/ProductVariant/${id}`,
    productId: `gid://shopify/Product/${id}`,
    quantity,
    unitPrice,
    ruleIds,
    ...extra,
  };
}

export function cartOf(lines: CartLineInput[], extra: Partial<CartPlanInput> = {}): CartPlanInput {
  return { currency: "CZK", lines, enteredCodes: [], today: "2026-10-01", ...extra };
}

export function outcome(plan: CartPlan, ruleId: string): RuleOutcome {
  const found = plan.rules.find((r) => r.ruleId === ruleId);
  if (!found) throw new Error(`no outcome for rule ${ruleId}`);
  return found;
}

export function lineOf(plan: CartPlan, lineId: string) {
  const found = plan.lines.find((l) => l.lineId === lineId);
  if (!found) throw new Error(`no plan line ${lineId}`);
  return found;
}

/** Rule ids of a line's product stack, in component order ([] when none). */
export function winners(plan: CartPlan, lineId: string): string[] {
  return lineOf(plan, lineId).product?.components.map((c) => c.ruleId) ?? [];
}
