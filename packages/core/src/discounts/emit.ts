// Emission per node (spec §3 "Emise per uzel", verdicts C1/C2). Every Won node
// computes the SAME plan and emits only the stacks it owns:
//   - the automatic node: stacks owned by automatic rules;
//   - a code node: stacks owned by its rule, and only when the triggering code
//     is one of that rule's entered codes.
// Outside Shopify Plus only one product discount applies per cart line, so the
// plan has at most one stack per line and exactly one node emits it; a Pro stack
// (combinesWith) is emitted once, as a summed value, by its owner's node. A code
// whose node emits nothing shows as `applicable: false` in Shopify — explain.ts
// tells the customer why.
//
// The candidate shapes map 1:1 onto the function output (T2):
//   percent       → value.percentage.value
//   fixedPerItem  → value.fixedAmount { amount, appliesToEachItem: true }
//   fixedTotal    → value.fixedAmount { amount, appliesToEachItem: false }
// with amounts in minor units (money.ts fromMinorUnits for the decimal string).
// `amount` is what the plan expects Shopify to take off, for checks and logs.

import { normalizeCode } from "./cart.ts";
import type { CartPlan, EmittedValue, ShippingValue } from "./plan.ts";

export type NodeRole = { kind: "automatic" } | { kind: "code"; ruleId: string };

export type ProductCandidate = { lineId: string; ruleId: string; message: string; amount: number } & EmittedValue;

export type OrderCandidate = {
  ruleId: string;
  message: string;
  amount: number;
  /** Outlet, gift and margin-excluded lines: the candidate's `orderSubtotal.excludedCartLineIds`. */
  excludedLineIds: string[];
} & EmittedValue;

export type DeliveryCandidate = { ruleId: string; message: string; amount: number | null } & ShippingValue;

export interface NodeEmission {
  productCandidates: ProductCandidate[];
  orderCandidates: OrderCandidate[];
  deliveryCandidates: DeliveryCandidate[];
}

export function emitForNode(plan: CartPlan, role: NodeRole, triggeringCode: string | null): NodeEmission {
  const out: NodeEmission = { productCandidates: [], orderCandidates: [], deliveryCandidates: [] };
  if (plan.reason) return out;

  let owns: (ownerRuleId: string, ownerMethod: string) => boolean;
  if (role.kind === "automatic") {
    owns = (_id, method) => method === "automatic";
  } else {
    const trigger = typeof triggeringCode === "string" ? normalizeCode(triggeringCode) : "";
    const rule = plan.rules.find((r) => r.ruleId === role.ruleId);
    if (!trigger || !rule || rule.method !== "code" || !rule.enteredCodes.includes(trigger)) return out;
    owns = (id, method) => method === "code" && id === role.ruleId;
  }

  for (const line of plan.lines) {
    const stack = line.product;
    if (!stack || !owns(stack.ownerRuleId, stack.ownerMethod)) continue;
    out.productCandidates.push({
      lineId: line.lineId,
      ruleId: stack.ownerRuleId,
      message: stack.message,
      amount: stack.amount,
      ...stack.value,
    });
  }
  const order = plan.order;
  if (order && owns(order.ownerRuleId, order.ownerMethod)) {
    out.orderCandidates.push({
      ruleId: order.ownerRuleId,
      message: order.message,
      amount: order.amount,
      excludedLineIds: [...order.excludedLineIds],
      ...order.value,
    });
  }
  const shipping = plan.shipping;
  if (shipping && owns(shipping.ownerRuleId, shipping.ownerMethod)) {
    out.deliveryCandidates.push({
      ruleId: shipping.ownerRuleId,
      message: shipping.message,
      amount: shipping.amount,
      ...shipping.value,
    });
  }
  return out;
}
