// Single source of truth for turning internal model keys into human labels
// (doctrine §4c). Nothing in the admin UI may render a raw enum key
// (`added`, `order.created`, `product`) — it goes through one of these maps.

import type { ToastSemanticType } from "@won/core/toasts/config.types";

/** Cart-event wording rows: human title + a concrete example of the toast. */
export interface EventMeta {
  key: ToastSemanticType;
  /** Human name of the shopper-facing moment. */
  title: string;
  /** Concrete example of what the toast reads like. */
  example: string;
}

export const EVENT_META: EventMeta[] = [
  { key: "added", title: "Item added", example: "Added to cart" },
  { key: "removed", title: "Item removed", example: "Removed" },
  { key: "increased", title: "Quantity increased", example: "Updated" },
  { key: "decreased", title: "Quantity decreased", example: "Updated" },
  { key: "gift", title: "Gift unlocked", example: "Gift unlocked" },
  { key: "shipping", title: "Free shipping reached", example: "You've got free shipping!" },
];

/** Human names for notification rules / analytics rule ids. */
export const RULE_LABELS: Record<string, string> = {
  "cart.activity": "Cart activity",
  "stock.low": "Low-stock urgency",
  "order.summary": "Order summary",
  "order.created": "Recent sales",
  countdown: "Countdown timer",
  announcement: "Announcement",
  cart: "Cart toasts",
  // Semantic cart events can also surface as rule ids in analytics.
  added: "Item added",
  removed: "Item removed",
  increased: "Quantity increased",
  decreased: "Quantity decreased",
  gift: "Gift unlocked",
  shipping: "Free shipping reached",
};

export function ruleLabel(id: string): string {
  if (RULE_LABELS[id]) return RULE_LABELS[id];
  // Analytics rule ids can be namespaced, e.g. "cart:added" → map the suffix.
  const suffix = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return RULE_LABELS[suffix] ?? suffix;
}

/** Human names for page types (targeting + exclusions). */
export const PAGE_LABELS: Record<string, string> = {
  all: "Every page",
  product: "Product pages",
  collection: "Collection pages",
  cart: "Cart page",
  home: "Home page",
  search: "Search results",
  other: "Other pages",
};

export function pageLabel(p: string): string {
  return PAGE_LABELS[p] ?? p;
}

// Human language names for locale codes. Uses Intl.DisplayNames when available,
// with a small curated fallback so we never show a bare code as a heading.
const LANG_FALLBACK: Record<string, string> = {
  en: "English",
  cs: "Čeština",
  sk: "Slovenčina",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pl: "Polski",
  nl: "Nederlands",
  "pt-br": "Português (BR)",
  "pt-pt": "Português (PT)",
  pt: "Português",
  hu: "Magyar",
  ro: "Română",
};

let displayNames: Intl.DisplayNames | null = null;
try {
  displayNames = new Intl.DisplayNames(["en"], { type: "language" });
} catch {
  displayNames = null;
}

export function languageName(code: string): string {
  const c = code.toLowerCase();
  if (LANG_FALLBACK[c]) return LANG_FALLBACK[c];
  const name = displayNames?.of(c);
  if (name && name.toLowerCase() !== c) return name;
  return code.toUpperCase();
}
