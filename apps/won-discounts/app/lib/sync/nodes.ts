// Desired Won discount nodes for a config (spec §3 "Emise per uzel", C1 platí,
// C2 fallback): exactly ONE automatic node "Won Discounts" + ONE code node per
// active code rule (all its codes as redeem codes). Pure: no I/O.

import { createHash } from "node:crypto";

import { activeCodeRules } from "../config-guards.server";
import type { ConfigView, SyncNodeRole } from "./types";

export const FUNCTION_HANDLE = "won-discounts-engine";
export const AUTO_NODE_KEY = "auto";
export const AUTO_NODE_TITLE = "Won Discounts";
/** SyncRun rows kept per shop (Přehled shows the latest; older ones are pruned). */
export const SYNC_RUNS_KEPT = 20;
/** Shopify's discount title limit. */
const TITLE_MAX = 255;

export type DiscountClass = "PRODUCT" | "ORDER" | "SHIPPING";
const CLASS_ORDER: DiscountClass[] = ["PRODUCT", "ORDER", "SHIPPING"];

export interface DesiredNode {
  /** WonNode.key: "auto" | "code:<ruleId>". */
  key: string;
  role: SyncNodeRole;
  title: string;
  discountClasses: DiscountClass[];
  /** Code nodes: every code of the rule, upper-case, config order (the first one creates the node). */
  codes: string[];
  /** ISO date-times with zone (rule.schedule), or null = not set in the config. */
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  appliesOncePerCustomer: boolean;
}

export const ALL_COMBINE = { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true } as const;

export function codeNodeKey(ruleId: string): string {
  return `code:${ruleId}`;
}

export function roleKey(role: SyncNodeRole): string {
  return role.kind === "automatic" ? AUTO_NODE_KEY : codeNodeKey(role.ruleId);
}

/** Fingerprint of a code set (order-insensitive, case-insensitive like Shopify codes). */
export function codesHash(codes: readonly string[]): string {
  const normalized = [...new Set(codes.map((code) => code.toUpperCase()))].sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex").slice(0, 32);
}

/** Fingerprint of a JSON payload as written (WonNode.varsVersion stores it for the vars). */
export function payloadHash(json: string): string {
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}

function classesFor(target: unknown, value: unknown): DiscountClass[] {
  const out = new Set<DiscountClass>();
  const kind = (target as { kind?: unknown } | null | undefined)?.kind;
  if (kind === "products" || kind === "collections") out.add("PRODUCT");
  if (kind === "order") out.add("ORDER");
  if (kind === "shipping") out.add("SHIPPING");
  if ((value as { kind?: unknown } | null | undefined)?.kind === "freeShipping") out.add("SHIPPING");
  return [...out];
}

/**
 * Classes a code rule's node must allow: from the rule's target/value, plus any
 * live campaign override that re-targets or re-values it (the campaign runs on
 * the same node, so the node must already allow that class when it starts).
 */
function ruleClasses(config: ConfigView, rule: ConfigView["modules"]["codes"]["rules"][number]): DiscountClass[] {
  const classes = new Set<DiscountClass>(classesFor(rule.target, rule.value));
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      if (override.ruleId !== rule.id) continue;
      const patch = override.patch as { target?: unknown; value?: unknown };
      for (const c of classesFor(patch.target ?? rule.target, patch.value ?? rule.value)) classes.add(c);
    }
  }
  if (classes.size === 0) classes.add("ORDER"); // unreachable for a sanitized rule; never send an empty list
  return CLASS_ORDER.filter((c) => classes.has(c));
}

export function desiredNodes(config: ConfigView): DesiredNode[] {
  const nodes: DesiredNode[] = [
    {
      key: AUTO_NODE_KEY,
      role: { kind: "automatic" },
      title: AUTO_NODE_TITLE,
      discountClasses: [...CLASS_ORDER],
      codes: [],
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      appliesOncePerCustomer: false,
    },
  ];
  for (const rule of activeCodeRules(config)) {
    const usageLimit = rule.limits?.usageLimit;
    nodes.push({
      key: codeNodeKey(rule.id),
      role: { kind: "code", ruleId: rule.id },
      title: (rule.name.trim() || rule.id).slice(0, TITLE_MAX),
      discountClasses: ruleClasses(config, rule),
      codes: [...new Set((rule.codes ?? []).map((code) => code.toUpperCase()))],
      startsAt: rule.schedule?.startsAt ?? null,
      endsAt: rule.schedule?.endsAt ?? null,
      usageLimit: typeof usageLimit === "number" && usageLimit > 0 ? usageLimit : null,
      appliesOncePerCustomer: rule.limits?.oncePerCustomer === true,
    });
  }
  return nodes;
}
