// MVP14 — accessibility helpers. Pure mapping from a toast's semantic type to
// the right ARIA role and live-region politeness, plus a screen-reader summary.
// Default: ambient toasts are polite/status; genuinely urgent ones (low stock)
// are assertive/alert. A merchant override always wins.

export type Politeness = "polite" | "assertive";

/** Types worth interrupting a screen reader for. Everything else is polite. */
const ASSERTIVE_TYPES = new Set(["stock", "stock.low"]);

export function politenessFor(
  type: string,
  override?: Politeness,
): Politeness {
  if (override === "polite" || override === "assertive") return override;
  return ASSERTIVE_TYPES.has(type) ? "assertive" : "polite";
}

/** role=alert pairs with assertive; role=status with polite (WAI-ARIA). */
export function ariaRoleFor(type: string, override?: Politeness): "status" | "alert" {
  return politenessFor(type, override) === "assertive" ? "alert" : "status";
}

/** A single SR-friendly line: "Title. Detail" with empties trimmed. */
export function screenReaderText(title: string, detail: string): string {
  return [title, detail]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(". ");
}
