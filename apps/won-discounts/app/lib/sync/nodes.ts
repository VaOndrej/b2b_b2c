// Desired Won discount nodes for a config (spec §3 "Emise per uzel", C1 platí,
// C2 fallback): exactly ONE automatic node "Won Discounts" + ONE code node per
// code rule, in one of three states (C1, doctrine §14a "off ≠ erased"):
//   active    the rule is live (activeCodeRules): the node exists and is active,
//             all its codes as redeem codes;
//   inactive  the rule still exists but is off (disabled, no codes, schedule
//             ended, switched to automatic): an existing node is DEACTIVATED
//             (Shopify keeps its usage count and once-per-customer history),
//             never created;
//   absent    the rule was DELETED from the config: its node is deleted.
// Pure: no I/O.

import { activeCodeRules, type ActivityContext } from "../config-guards.server";
import type { ConfigView, SyncNodeRole } from "./types";
import { hashText } from "./util";

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
  /** False = keep an existing node deactivated; never create one. */
  active: boolean;
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

/** Fingerprint of a code set (order-insensitive, case-insensitive like Shopify codes). */
export function codesHash(codes: readonly string[]): string {
  return hashText([...new Set(codes.map((code) => code.toUpperCase()))].sort().join("\n"));
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

type RuleView = ConfigView["modules"]["codes"]["rules"][number];

/**
 * Classes a code rule's node must allow: from the rule's target/value, plus any
 * not-killed campaign override that re-targets or re-values it (the campaign
 * runs on the same node, so the node must already allow that class when it starts).
 */
function ruleClasses(config: ConfigView, rule: RuleView): DiscountClass[] {
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

function codeNode(config: ConfigView, rule: RuleView, active: boolean): DesiredNode {
  const usageLimit = rule.limits?.usageLimit;
  return {
    key: codeNodeKey(rule.id),
    role: { kind: "code", ruleId: rule.id },
    active,
    title: (rule.name.trim() || rule.id).slice(0, TITLE_MAX),
    discountClasses: ruleClasses(config, rule),
    codes: rule.method === "code" ? [...new Set((rule.codes ?? []).map((code) => code.toUpperCase()))] : [],
    startsAt: rule.schedule?.startsAt ?? null,
    endsAt: rule.schedule?.endsAt ?? null,
    usageLimit: typeof usageLimit === "number" && usageLimit > 0 ? usageLimit : null,
    appliesOncePerCustomer: rule.limits?.oncePerCustomer === true,
  };
}

/**
 * The automatic node + one entry per rule of the config: active code rules as
 * `active`, every other rule as `inactive` (only acts on a node the sync
 * already tracks under `code:<ruleId>`). A tracked node whose rule id is not in
 * the list at all belongs to a deleted rule.
 */
export function desiredNodes(config: ConfigView, ctx: ActivityContext = {}): DesiredNode[] {
  const nodes: DesiredNode[] = [
    {
      key: AUTO_NODE_KEY,
      role: { kind: "automatic" },
      active: true,
      title: AUTO_NODE_TITLE,
      discountClasses: [...CLASS_ORDER],
      codes: [],
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      appliesOncePerCustomer: false,
    },
  ];
  const active = new Set(activeCodeRules(config, ctx).map((rule) => rule.id));
  for (const rule of config.modules.codes.rules) nodes.push(codeNode(config, rule, active.has(rule.id)));
  return nodes;
}
