// Přehled zásahů, the pure part (MVP 2 audit P2-2): core marginImpact → per
// rule, the count of EVERY variant protection lowers it on (the number the
// rule editor gives too) and only its largest losses as rows; the screen's
// view narrowed to one rule on the server (`?rule=`), with a cap on the rows
// sent. No DB, no Shopify: margin-impact.server.ts computes it in the
// background, the dev harness renders it on a fixture catalogue.

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { buildMarginPayload, marginImpact, resolveProductMargin, type MarginVariant } from "@won/core/discounts/margin";

import type { MarginImpactRowView, MarginImpactRuleView, MarginImpactView } from "../../components/model/types";

/** Rows kept per rule (its largest losses; the count covers all of them). */
export const MARGIN_IMPACT_ROWS_PER_RULE = 10;
/** Rows sent to the screen at most, all rules together (the counts are never capped). */
export const MARGIN_IMPACT_ROWS_MAX = 200;

/** A computed impact: every enabled rule core measured (variants may be 0), config order, rows ≤ MARGIN_IMPACT_ROWS_PER_RULE. */
export interface StoredImpactRules {
  rules: MarginImpactRuleView[];
  withoutCost: number;
}

export interface ImpactRead {
  /** The stored result (the current state's, or the previous one while `status` is "updating"); null = none yet. */
  impact: StoredImpactRules | null;
  status: MarginImpactView["status"];
}

/** Core marginImpact → per rule: the count of every variant it is lowered on, and its top rows. */
export function impactRulesOf(config: WonDiscountsConfig, variants: readonly MarginVariant[], currency: string): StoredImpactRules {
  const impact = marginImpact(config, variants, currency);
  const names = new Map(config.modules.codes.rules.map((rule) => [rule.id, rule.name]));
  const payload = buildMarginPayload({ ...config.modules.margin, enabled: true }, currency);
  const variantOf = new Map(variants.map((v) => [v.variantId, v]));
  // The settings checkout resolves (more than 4 refs → the store's strictest setting).
  const sourceOf = (variantId: string) => {
    const v = variantOf.get(variantId);
    return resolveProductMargin(payload, v?.marginRefs ?? [], v?.marginRefCount)?.source ?? "global";
  };
  return {
    rules: impact.rules.map((rule) => ({
      ruleId: rule.ruleId,
      ruleName: names.get(rule.ruleId) ?? "",
      discountClass: rule.discountClass,
      variants: rule.variants,
      rows:
        rule.discountClass === "product"
          ? rule.capped.slice(0, MARGIN_IMPACT_ROWS_PER_RULE).map(
              (c): MarginImpactRowView => ({
                productId: c.productId,
                variantId: c.variantId,
                title: c.title,
                wanted: c.wanted,
                allowed: c.allowed,
                basis: c.basis,
                source: sourceOf(c.variantId),
              }),
            )
          : [],
    })),
    withoutCost: impact.withoutCost,
  };
}

/**
 * The screen's view (Pro): the rules protection lowers (variants > 0), each
 * with its top rows — or only `focusRuleId`'s (`?rule=`, filtered HERE, so a
 * rule outside the largest losses is never shown empty) — at most
 * MARGIN_IMPACT_ROWS_MAX rows in all (the counts are never capped).
 */
export function impactView(read: ImpactRead, config: WonDiscountsConfig, focusRuleId?: string | null): MarginImpactView {
  const all = (read.impact?.rules ?? []).filter((rule) => rule.variants > 0);
  const focus = focusRuleId ? config.modules.codes.rules.find((rule) => rule.id === focusRuleId) : undefined;
  const chosen = focusRuleId ? all.filter((rule) => rule.ruleId === focusRuleId) : all;
  let left = MARGIN_IMPACT_ROWS_MAX;
  const rules = chosen.map((rule) => {
    const rows = rule.rows.slice(0, Math.max(0, left));
    left -= rows.length;
    return { ...rule, rows };
  });
  return {
    rules,
    withoutCost: read.impact?.withoutCost ?? 0,
    status: read.status,
    ...(focusRuleId ? { focus: { ruleId: focusRuleId, ruleName: focus?.name ?? "" } } : {}),
  };
}

