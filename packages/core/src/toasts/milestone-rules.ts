// Milestone rules — the "free shipping / gift / quantity discount" progress the
// shopper wants to see. Pure evaluation on top of the milestone state machine.
//
// PRINCIPLE (announces, doesn't grant): Won Toasts does NOT make shipping free
// or add the gift. Free shipping is the merchant's Shopify shipping rate; the
// gift is Won GiftLadder (a `_gift_progress` line, priced 0 by a Function). This
// module only detects the crossing and reports progress so the storefront can
// announce it. The `thresholdCents` here must match the merchant's real rate.

import type { CartSnapshot } from "./cart-events.ts";
import { isGiftLine } from "./cart-events.ts";
import { milestoneState, type MilestoneState } from "./milestones.ts";

export type MilestoneKind = "free_shipping" | "gift" | "qty_discount";

export interface MilestoneRule {
  id: string;
  kind: MilestoneKind;
  enabled: boolean;
  /** Threshold in minor units (cents/haléře) for value-based milestones. */
  thresholdCents: number;
  label: string;
}

export interface CartMilestoneState {
  subtotalCents: number;
  hasGiftLine: boolean;
}

export interface MilestoneEvent {
  id: string;
  kind: MilestoneKind;
  state: MilestoneState;
  remaining: number;
  progress: number;
  label: string;
}

/** Eligible subtotal = sum of non-gift line prices (final_line_price cents). */
export function eligibleSubtotalCents(cart: CartSnapshot | null | undefined): number {
  const items = cart?.items ?? [];
  let total = 0;
  for (const line of items) {
    if (!line || isGiftLine(line)) continue;
    total += Number(line.linePrice ?? 0) || 0;
  }
  return total;
}

/** True when the cart currently has a Won GiftLadder gift line. */
export function cartHasGiftLine(cart: CartSnapshot | null | undefined): boolean {
  return (cart?.items ?? []).some((line) => line && isGiftLine(line));
}

export function cartMilestoneState(
  cart: CartSnapshot | null | undefined,
): CartMilestoneState {
  return {
    subtotalCents: eligibleSubtotalCents(cart),
    hasGiftLine: cartHasGiftLine(cart),
  };
}

/**
 * Evaluate all enabled milestone rules for a cart transition. Value-based rules
 * (free_shipping, qty_discount) use the subtotal state machine. Gift rules
 * driven by GiftLadder key off the presence of a gift line (its appearance is
 * the crossing); if no gift line is used they fall back to the subtotal.
 */
export function evaluateMilestones(
  prev: CartMilestoneState,
  next: CartMilestoneState,
  rules: readonly MilestoneRule[],
): MilestoneEvent[] {
  const events: MilestoneEvent[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.kind === "gift" && (prev.hasGiftLine || next.hasGiftLine)) {
      let state: MilestoneState;
      if (next.hasGiftLine) {
        state = prev.hasGiftLine ? "reached" : "just_reached";
      } else {
        state = prev.hasGiftLine ? "just_lost" : "unreached";
      }
      events.push({
        id: rule.id,
        kind: rule.kind,
        state,
        remaining: 0,
        progress: next.hasGiftLine ? 1 : 0,
        label: rule.label,
      });
      continue;
    }

    const reading = milestoneState(
      prev.subtotalCents,
      next.subtotalCents,
      rule.thresholdCents,
    );
    events.push({
      id: rule.id,
      kind: rule.kind,
      state: reading.state,
      remaining: reading.remaining,
      progress: reading.progress,
      label: rule.label,
    });
  }
  return events;
}
