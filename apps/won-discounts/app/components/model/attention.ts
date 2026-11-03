// Přehled, "Vyžaduje pozornost": one row per CAUSE, not one card per thing (audit 2026-11-03 F2, zásada E1). Two
// discounts without an amount for Slovensko are one row "2 slevy nemají hodnotu pro Slovensko", with a link to each
// discount's field; a cause met once keeps its own sentence and its one button.

export interface AttentionItem {
  /** Unique per thing (a discount's warning, a module's missing amount). */
  key: string;
  /** Things with the same cause are one row: e.g. `missingCurrency:EUR` for every discount without a euro amount. */
  cause: string;
  /** The sentence about this one thing ("„VIP10“ nemá hodnotu pro Slovensko…"). */
  text: string;
  /** The name of the thing in a row of several ("VIP10"). */
  name: string;
  /** The field that fixes it. */
  href: string;
}

export interface AttentionGroup {
  cause: string;
  items: AttentionItem[];
}

/** Groups by cause, in the order the causes first appear; items keep their order. */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const groups = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const list = groups.get(item.cause) ?? [];
    list.push(item);
    groups.set(item.cause, list);
  }
  return [...groups].map(([cause, list]) => ({ cause, items: list }));
}

/** The cause of a discount's warning: its kind, and for a missing amount the currencies it misses. */
export function ruleWarningCause(kind: string, currencies: readonly string[] = []): string {
  return kind === "missingCurrency" ? `${kind}:${[...currencies].sort().join(",")}` : kind;
}
