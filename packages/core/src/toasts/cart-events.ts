// Framework-free cart diff — the heart of Won Toasts. Given two /cart.js
// snapshots it returns the semantic events to toast about. This is the CANONICAL
// spec: the storefront mirrors this algorithm in plain JS (no build step for
// theme assets), and the admin live preview imports this module directly, so
// both stay aligned via the shared unit tests here.
//
// Principle: gift lines (property `_gift_progress`, set by Won GiftLadder) are
// NOT cart events — a gift appearing/disappearing is a milestone, handled
// separately (MVP4). Diffing them here would double-announce.

export interface CartLineProperties {
  _gift_progress?: unknown;
  [key: string]: unknown;
}

export interface CartLineSnapshot {
  /** Shopify line key — stable per (variant + properties); the identity we diff on. */
  key: string;
  variantId: number;
  productId?: number;
  quantity: number;
  title?: string;
  variantTitle?: string;
  image?: string | null;
  /** final_line_price in minor units (cents/haléře). */
  linePrice?: number;
  /** final_price (per unit) in minor units. */
  unitPrice?: number;
  properties?: CartLineProperties | null;
}

export interface CartSnapshot {
  items: CartLineSnapshot[];
}

export type CartEventType = "added" | "removed" | "increased" | "decreased";

// Runtime allow-list — single source of truth for the support-docs reference
// generator. `satisfies` makes it a type error if it drifts from the union.
export const CART_EVENT_TYPES = [
  "added",
  "removed",
  "increased",
  "decreased",
] as const satisfies readonly CartEventType[];

export interface ToastCartEvent {
  type: CartEventType;
  key: string;
  variantId: number;
  /** Signed quantity change (negative for removed/decreased). */
  delta: number;
  /** Resulting quantity after the change (0 for removed). */
  quantity: number;
  /** The relevant line — the "after" line, or the "before" line for removed. */
  line: CartLineSnapshot;
}

/** A gift line is a reward artifact, not a cart action the shopper took. */
export function isGiftLine(line: CartLineSnapshot): boolean {
  const props = line.properties;
  return Boolean(props && Object.prototype.hasOwnProperty.call(props, "_gift_progress"));
}

function indexByKey(
  snapshot: CartSnapshot | null | undefined,
): Map<string, CartLineSnapshot> {
  const map = new Map<string, CartLineSnapshot>();
  const items = snapshot?.items ?? [];
  for (const line of items) {
    if (!line || typeof line.key !== "string" || isGiftLine(line)) {
      continue;
    }
    map.set(line.key, line);
  }
  return map;
}

/**
 * Diff two cart snapshots into an ordered list of toast events. Order is
 * deterministic: changes to lines present in `after` (added / increased /
 * decreased) follow `after`'s order, then removed lines follow `before`'s
 * order. Lines whose quantity did not change produce no event.
 */
export function deriveEvents(
  before: CartSnapshot | null | undefined,
  after: CartSnapshot | null | undefined,
): ToastCartEvent[] {
  const beforeMap = indexByKey(before);
  const afterMap = indexByKey(after);
  const events: ToastCartEvent[] = [];

  for (const line of after?.items ?? []) {
    if (!line || typeof line.key !== "string" || isGiftLine(line)) continue;
    if (!afterMap.has(line.key)) continue; // guard against dupes
    const prev = beforeMap.get(line.key);
    const prevQty = prev?.quantity ?? 0;
    const delta = line.quantity - prevQty;
    if (delta === 0) continue;
    if (prevQty === 0) {
      events.push({
        type: "added",
        key: line.key,
        variantId: line.variantId,
        delta,
        quantity: line.quantity,
        line,
      });
    } else {
      events.push({
        type: delta > 0 ? "increased" : "decreased",
        key: line.key,
        variantId: line.variantId,
        delta,
        quantity: line.quantity,
        line,
      });
    }
  }

  for (const line of before?.items ?? []) {
    if (!line || typeof line.key !== "string" || isGiftLine(line)) continue;
    if (afterMap.has(line.key)) continue;
    events.push({
      type: "removed",
      key: line.key,
      variantId: line.variantId,
      delta: -line.quantity,
      quantity: 0,
      line,
    });
  }

  return events;
}
