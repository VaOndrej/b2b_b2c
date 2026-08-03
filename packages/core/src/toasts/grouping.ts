// Grouping — merge a batch of cart events into fewer toasts per the admin
// grouping config. A burst of rapid changes to the same product becomes one
// "+N" toast; group-by-type collapses many products into one. Pure + tested;
// the storefront mirrors it.

import type { CartEventType, ToastCartEvent } from "./cart-events.ts";
import type { GroupingSettings } from "./config.types.ts";

export interface GroupedToast {
  key: string;
  /** The shared type, or "mixed" when a group spans multiple event types. */
  type: CartEventType | "mixed";
  count: number;
  /** Sum of deltas across the group (used when mergeDeltas is on). */
  totalDelta: number;
  events: ToastCartEvent[];
  /** First event in the group — source of image/title for the merged toast. */
  representative: ToastCartEvent;
}

function groupKey(event: ToastCartEvent, mode: GroupingSettings["mode"]): string {
  switch (mode) {
    case "by-type":
      return `type:${event.type}`;
    case "by-variant":
      return `variant:${event.variantId}`;
    case "by-product": {
      const pid =
        event.line.productId ??
        (event.line as { product_id?: number }).product_id ??
        event.variantId;
      return `product:${pid}`;
    }
    default:
      return "";
  }
}

/**
 * Group a batch of events. With mode "off" (or mergeDeltas off) each event maps
 * to its own single-event group, preserving order. Otherwise events sharing a
 * key merge; group order follows first appearance.
 */
export function groupEvents(
  events: readonly ToastCartEvent[],
  grouping: GroupingSettings,
): GroupedToast[] {
  if (grouping.mode === "off" || !grouping.mergeDeltas) {
    return events.map((event, index) => ({
      key: `${index}`,
      type: event.type,
      count: 1,
      totalDelta: event.delta,
      events: [event],
      representative: event,
    }));
  }

  const order: string[] = [];
  const groups = new Map<string, GroupedToast>();

  for (const event of events) {
    const key = groupKey(event, grouping.mode);
    const existing = groups.get(key);
    if (!existing) {
      order.push(key);
      groups.set(key, {
        key,
        type: event.type,
        count: 1,
        totalDelta: event.delta,
        events: [event],
        representative: event,
      });
    } else {
      existing.count += 1;
      existing.totalDelta += event.delta;
      existing.events.push(event);
      if (existing.type !== event.type) existing.type = "mixed";
    }
  }

  return order.map((key) => groups.get(key)!);
}
