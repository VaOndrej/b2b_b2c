// Live native discounts that fight a Won rule (Přehled "slevy mimo Won" +
// conflicts, spec §4.1). Pure. The Won engine cannot see native discounts, so
// any overlap means Won cannot promise what the shopper pays; a shared code is
// worse: Shopify refuses one code on two discounts, so the Won node cannot sync.
//
// Only what is certain is reported: equal codes, shared product / variant /
// collection ids, two order discounts, two shipping discounts. "Collection vs
// product" would need catalog reads and is left to the move itself.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { conflictText } from "./copy.ts";
import type { ConflictKind, NativeConflict, NativeDiscount, NativeLocale } from "./types.ts";

function overlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

function targetConflict(native: NativeDiscount, rule: DiscountRule): ConflictKind | null {
  const n = native.target;
  const r = rule.target;
  if (!n) return null;
  if (n.kind === "order" && r.kind === "order") return "both_order";
  if (n.kind === "shipping" && r.kind === "shipping") return "both_shipping";
  if (n.kind === "products" && r.kind === "products") {
    if (overlap(n.productIds, r.productIds) || overlap(n.variantIds, r.variantIds)) return "same_products";
  }
  if (n.kind === "collections" && r.kind === "collections" && overlap(n.ids, r.ids)) return "same_collections";
  return null;
}

/** A live code discount Won cannot move (BXGY, another app's) — only its codes matter here. */
export interface OtherCodeHolder {
  id: string;
  title: string;
  codes: readonly string[];
}

/**
 * Conflicts between live (ACTIVE / SCHEDULED) native discounts and enabled Won
 * rules. `natives` may be first-page reads (detection): codes and ids beyond
 * the first page are not compared. `others` are live code discounts of types
 * Won cannot move (BXGY, other apps): a code they hold blocks a Won node just
 * the same.
 */
export function findConflicts(
  natives: readonly NativeDiscount[],
  config: WonDiscountsConfig,
  locale: NativeLocale = "cs",
  others: readonly OtherCodeHolder[] = [],
): NativeConflict[] {
  const rules = config.modules.codes.rules.filter((r) => r.enabled);
  const out: NativeConflict[] = [];
  for (const other of others) {
    const held = new Set(other.codes.map((c) => c.trim().toUpperCase()));
    for (const rule of rules) {
      const shared = (rule.codes ?? []).filter((c) => held.has(c.trim().toUpperCase()));
      if (shared.length === 0) continue;
      out.push({
        kind: "same_code",
        nativeId: other.id,
        nativeTitle: other.title,
        ruleId: rule.id,
        ruleName: rule.name,
        codes: shared,
        message: conflictText("same_code", other.title, rule.name || rule.id, locale, shared, false),
      });
    }
  }
  for (const native of natives) {
    if (native.status === "EXPIRED") continue;
    const nativeCodes = new Set(native.codes.map((c) => c.trim().toUpperCase()));
    for (const rule of rules) {
      if (rule.origin?.nativeId === native.id) continue;
      const shared = (rule.codes ?? []).filter((c) => nativeCodes.has(c.trim().toUpperCase()));
      if (shared.length > 0) {
        out.push({
          kind: "same_code",
          nativeId: native.id,
          nativeTitle: native.title,
          ruleId: rule.id,
          ruleName: rule.name,
          codes: shared,
          message: conflictText("same_code", native.title, rule.name || rule.id, locale, shared),
        });
      }
      const kind = targetConflict(native, rule);
      // Two code discounts only meet when both codes are entered; the shared
      // code case above is the one that always bites.
      if (kind && !(native.method === "code" && rule.method === "code")) {
        out.push({
          kind,
          nativeId: native.id,
          nativeTitle: native.title,
          ruleId: rule.id,
          ruleName: rule.name,
          message: conflictText(kind, native.title, rule.name || rule.id, locale),
        });
      }
    }
  }
  return out;
}
