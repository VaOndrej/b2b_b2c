// BILL-1 server gate (spec §7 "Free / Pro a billing", docs/won-discounts/rozhodnuti.md
// "Free / Pro"; audit MVP 1 P1-1): what a shop's discount function may carry for
// its plan. The UI hides Pro fields on Free, but a stored config can still hold
// them (a seed, a downgrade, an import, a restored ConfigVersion), and the
// function applies whatever the payload says. So the sync MUST call
// gateConfigForPlan BEFORE building the function payload
// (buildShopFunctionConfig) and the product targeting index
// (productRuleIndex); only then does a Free shop's checkout never see Pro
// data. The STORED config is never changed (§14a: turning Pro off never erases
// the setup) — the gate returns a copy plus `stripped`, the list the admin
// turns into sentences (explainGate) so it can say exactly what is not in force.
//
// Free vs Pro, as far as the config types reach today:
//   Slevy a kódy   Free: every type        Pro: + segment / market targeting,
//                                               minimum quantity per product / collection
//   Generované kódy Free: ≤ 100 a batch,   Pro: ≤ 1 000 a batch, pattern options
//                  random behind a prefix       (middle, suffix, length, alphabet)
//   Engine         Free: category switches Pro: + per-rule combinations (combinesWith)
//   Kampaně        Free: —                 Pro: ✓
//   Množstevní     Free: 1 global set      Pro: sets per product / collection, counting across the cart
//   Milníky        Free: 2 steps a market, 1 gift   Pro: 6 steps a market, choice of up to 3 gifts
//   Ochrana marže  Free: global minimum    Pro: per collection
//   Výprodej       Free: —                 Pro: the whole module
//
// How each Pro capability is neutralised on Free — never in a way that gives a
// customer MORE than the merchant set up:
//   - market / segment targeting: the rule is switched OFF. Dropping only the
//     targeting would widen the rule to every market / every customer;
//   - per-item minimum quantity (plan 2026-10-06 bod 8): the rule is switched
//     OFF, for the same reason: dropping the items' minimums would give the
//     discount from the first piece (or from the common minimum) — MORE than
//     the Pro setup. Keeping the rule for the items without their own minimum
//     would be as safe (less is never more), but then one discount would half
//     apply with no place in the admin to say so; off is one clear state, and
//     removing the minimums (the editor offers it) turns the rule back on;
//     a finishing campaign's re-target that carries such minimums switches its
//     rule off for the campaign likewise;
//   - generated code batches (dávka 4): a batch with a Pro pattern is LEFT OUT
//     (its codes are not recognised and leave the Shopify discount: no
//     discount, never more); a batch above the Free size keeps its first 100
//     codes. Both come back untouched with Pro (the codes are rebuilt from the
//     stored batch, §14a);
//   - combinesWith: removed (the rule competes like any other: better one wins);
//   - campaigns: removed (the base rules apply); one finishing after a downgrade
//     keeps its rule overrides and the kept global tier set's, not those of the
//     tier sets narrowed below (MVP 6.1);
//   - tier sets (MVP 3, contract K1): the first global set stays, counting
//     across the cart becomes per product (fewer items per count); a further
//     global set goes (under K1 no product reaches it anyway); every SCOPED
//     set stays but INERT (`breaks: []`; its counting mode is left as it is —
//     with no break it gives nothing, and the gated payload is never larger
//     than the stored one's there), see below;
//   - Milníky (milestones.ts): per market the 2 steps with the lowest cart values stay (free shipping, gift tiers
//     and "ms-" order discounts are one ladder); a step past them is not offered in that market; a gift that
//     stays offers its first gift only;
//   - custom look of the storefront blocks (MVP 7): removed (a ready-made look applies);
//   - margin per collection: folded into the global floor, the STRICTEST value
//     wins (a larger discount than the Pro setup allowed is never possible).
//
// Tier sets and K1 (MVP 3): exactly one set applies to a product — the first
// set listing it, else the first listing one of its collections, else the
// first global set (tiers.ts). A scoped set may be LESS generous than the
// global one, so removing it on Free would hand its products the global set —
// a larger discount. It is kept inert instead: its products keep their
// `tierRef` to it (targeting.ts) and get no tier at all. What a Free shop runs
// for a product is therefore its own Pro set (counted no wider) or nothing
// (tests/discounts/tiers-gate.test.ts, property tests). Counting per product
// instead of across the cart counts fewer items, and fewer items never reach
// more: config/tiers.ts keeps a set of one kind with values that never fall
// as the quantity grows (review I1: "3 ks −10 %, 10 ks −50 Kč/ks" or
// "3 ks −20 %, 5 ks −10 %" would otherwise give more on Free for some carts).
//
// Downgrade (A6: running sales and campaigns finish, new ones cannot start).
// MVP 6 (K3): `opts.finishing` = the campaigns running at the downgrade (the sync
// records them, ShopSyncState.campaignsFinishing); they stay until their end, any
// other campaign is stripped. Original MVP 1 notes:
//   - MVP 5 (Kampaně): the downgrade moment must be recorded (entitlement
//     history); a campaign whose window had already started at that moment
//     keeps shipping until its window ends — the gate then needs that list
//     (e.g. "campaign ids allowed to finish") and must keep exactly those;
//   - MVP 6 (Výprodej): outlet runs live in the app DB and in product metafields
//     (`outlet`), not in this config. A run active at the downgrade finishes
//     (prices restored at its end); the sync must not start or extend runs for a
//     Free shop, and the gate's config-level view has nothing to strip for it.
// Analytics (Pro reports) and appearance (Pro custom look) are admin features,
// outside the function payload.

import { isProCodeBatch } from "./code-batch.ts";
import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import { csPlural, formatPercent, type UiLocale } from "./describe.ts";
import { isMilestoneRule, MILESTONE_LIMITS, milestonesOverLimit, withoutMarkets } from "./milestones.ts";

export type ShopPlan = "free" | "pro";

/** Pro capabilities the gate can strip (a stable list: the admin maps them to its own copy too). */
export const PRO_CAPABILITIES = [
  "market_targeting",
  "segment_targeting",
  "rule_combinations",
  "item_minimum_quantity",
  "code_batch_pattern",
  "code_batch_size",
  "campaigns",
  "tier_set_scope",
  "tier_sets_extra",
  "tier_count_across_cart",
  "milestone_steps",
  "gift_choices",
  "margin_per_collection",
] as const;
export type ProCapability = (typeof PRO_CAPABILITIES)[number];

export interface StrippedCapability {
  capability: ProCapability;
  /**
   * What the gate did:
   *   removed  the Pro setting is left out;
   *   rule_off the rule does not apply at all (removing only its targeting would widen it);
   *   reduced  kept within the Free limit (first threshold, first gift, per-product counting);
   *   folded   merged into the Free setting, the strictest value wins.
   */
  reason: "removed" | "rule_off" | "reduced" | "folded";
  /** The discount rule it was on. */
  ruleId?: string;
  /** The campaign, tier set or gift tier it was on. */
  entityId?: string;
  /** The rule's or campaign's name, for the sentence ("" = unnamed). */
  name?: string;
  /** How many items the Free limit left out (tier sets, milestone steps, gift choices, margin overrides). */
  count?: number;
  /** Their ids: tier sets, milestone steps ("shipping", a gift tier's id, an "ms-" rule's id), gift choice variants, margin override collections. */
  removedIds?: string[];
  /** margin_per_collection: the global values the fold changed (a key only when it changed). */
  values?: {
    maxDiscountPercent?: { from: number; to: number };
    minMarginPercent?: { from: number | null; to: number };
  };
}

export interface GateOptions {
  /**
   * A6 (MVP 6, K3): ids of the campaigns that were running when the shop went
   * from Pro to Free — they finish (kept until their end, `now` required to
   * drop them after it); every other campaign is stripped as before.
   */
  finishing?: readonly string[];
  /**
   * Shop-local `YYYY-MM-DDTHH:MM:SS`. A campaign whose window already ended is
   * not reported (it is not in force on any plan). Without it every campaign
   * that is not killed is reported.
   */
  now?: string;
}

export interface GatedConfig {
  config: WonDiscountsConfig;
  stripped: StrippedCapability[];
}

const nonEmpty = (list: readonly unknown[] | undefined): boolean => Array.isArray(list) && list.length > 0;

/** A (rule or campaign patch) target that carries per-item minimum quantities. */
function hasItemMinimums(target: unknown): boolean {
  return typeof target === "object" && target !== null && nonEmpty((target as { itemMinimums?: unknown[] }).itemMinimums);
}

/**
 * The config a shop on `plan` may run: Pro → an exact copy; Free → a copy
 * without any Pro capability (see the header for how each is neutralised) and
 * the list of what that changes. Pure; never mutates `config`. Pro data of a
 * rule that is off, or of a campaign that is over (`opts.now`), is stripped all
 * the same but not reported: nothing about it was in force.
 */
export function gateConfigForPlan(config: ReadonlyDeep<WonDiscountsConfig>, plan: ShopPlan, opts: GateOptions = {}): GatedConfig {
  const out = JSON.parse(JSON.stringify(config)) as WonDiscountsConfig;
  const stripped: StrippedCapability[] = [];
  if (plan === "pro") return { config: out, stripped };

  // Discount rules: targeting and per-rule combinations.
  const itemRulesOff = new Set<string>();
  for (const rule of out.modules.codes.rules) {
    const who = { ruleId: rule.id, name: rule.name };
    const report = rule.enabled;
    if (rule.combinesWith) {
      if (report && rule.combinesWith.ruleIds.length > 0) stripped.push({ capability: "rule_combinations", reason: "removed", ...who });
      delete rule.combinesWith;
    }
    // Per-item minimum quantities: the rule is off (see the header); the minimums themselves go too, so the
    // product refs the sync writes for a Free shop carry none.
    if (hasItemMinimums(rule.target)) {
      if (report) stripped.push({ capability: "item_minimum_quantity", reason: "rule_off", ...who });
      rule.enabled = false;
      delete (rule.target as { itemMinimums?: unknown }).itemMinimums;
      itemRulesOff.add(rule.id);
    }
    // Generated code batches: Pro patterns out, a batch above the Free size cut to it.
    if (rule.codeBatches) {
      const codeRule = report && rule.method === "code";
      const kept = [];
      for (const batch of rule.codeBatches) {
        if (isProCodeBatch(batch)) {
          if (codeRule) stripped.push({ capability: "code_batch_pattern", reason: "removed", ...who, entityId: batch.id, count: batch.count - (batch.removed?.length ?? 0) });
          continue;
        }
        const max = CONFIG_LIMITS.codeBatchSizeFree;
        if (batch.count > max) {
          const before = batch.count - (batch.removed?.length ?? 0);
          batch.count = max;
          if (batch.removed) batch.removed = batch.removed.filter((i) => i < max);
          if (batch.removed && batch.removed.length === 0) delete batch.removed;
          const after = batch.count - (batch.removed?.length ?? 0);
          if (codeRule) stripped.push({ capability: "code_batch_size", reason: "reduced", ...who, entityId: batch.id, count: before - after });
        }
        kept.push(batch);
      }
      if (kept.length > 0) rule.codeBatches = kept;
      else delete rule.codeBatches;
    }
    if (rule.targeting) {
      const markets = nonEmpty(rule.targeting.markets);
      const segments = nonEmpty(rule.targeting.segments);
      if (report && markets) stripped.push({ capability: "market_targeting", reason: "rule_off", ...who });
      if (report && segments) stripped.push({ capability: "segment_targeting", reason: "rule_off", ...who });
      if (markets || segments) rule.enabled = false;
      delete rule.targeting;
    }
  }

  // Campaigns (killed or ended ones are not in force anyway: dropped silently). A6: the ones running at the
  // downgrade (`finishing`) stay until their end — a later edit cannot extend them (the admin refuses on Free).
  const finishing = new Set(opts.finishing ?? []);
  const keep: typeof out.campaigns = [];
  for (const campaign of out.campaigns) {
    const ended = opts.now !== undefined && campaign.window.end !== "" && campaign.window.end <= opts.now;
    if (campaign.killed || ended) continue;
    if (finishing.has(campaign.id) && opts.now !== undefined) keep.push(campaign);
    else stripped.push({ capability: "campaigns", reason: "removed", entityId: campaign.id, name: campaign.name });
  }
  out.campaigns = keep;
  // A campaign finishing on Free must not bring per-item minimums back through a re-target: that override
  // switches its rule off instead (the same neutralisation as on the rule itself).
  for (const campaign of out.campaigns) {
    for (const override of campaign.overrides) {
      // (Nor may it switch a rule the gate turned off for its minimums back on, without them.)
      if (itemRulesOff.has(override.ruleId) && override.patch.enabled === true && !("target" in override.patch)) delete override.patch.enabled;
      if (!hasItemMinimums(override.patch.target)) continue;
      delete (override.patch.target as { itemMinimums?: unknown }).itemMinimums;
      override.patch.enabled = false;
    }
  }

  // Quantity tiers (K1): one global set, counted per product at most; scoped
  // sets INERT (no breaks), so their products never fall back to the global set.
  const sets = out.modules.tiers.sets;
  const kept = sets.find((set) => set.scope === "global");
  const scopedSets = sets.filter((set) => set.scope !== "global");
  // A scoped set without a break was not in force: made inert all the same, not reported.
  const scoped = scopedSets.filter((set) => set.breaks.length > 0).map((set) => set.id);
  const extra = sets.filter((set) => set.scope === "global" && set !== kept).map((set) => set.id);
  if (scoped.length > 0) stripped.push({ capability: "tier_set_scope", reason: "removed", count: scoped.length, removedIds: scoped });
  if (extra.length > 0) stripped.push({ capability: "tier_sets_extra", reason: "removed", count: extra.length, removedIds: extra });
  if (kept && kept.countAcross === "cart") {
    kept.countAcross = "product";
    stripped.push({ capability: "tier_count_across_cart", reason: "reduced", entityId: kept.id });
  }
  for (const set of scopedSets) set.breaks = [];
  out.modules.tiers.sets = sets.filter((set) => set === kept || set.scope !== "global");
  // MVP 6.1 (L5): a campaign finishing on Free must not bring back what the gate just narrowed — its overrides of
  // the scoped sets (inert now) and of the further global sets go; the kept global set's override stays.
  const narrowed = new Set(sets.filter((set) => set !== kept).map((set) => set.id));
  for (const campaign of out.campaigns) campaign.overrides = campaign.overrides.filter((o) => !narrowed.has(o.ruleId));

  // MVP 7: the custom look of the storefront blocks is Pro (never checkout data: not reported in `stripped`, the
  // Vzhled screen shows it locked). The stored config keeps it.
  delete out.storefront.custom;

  // Milníky: PER MARKET the MILESTONE_LIMITS.free steps with the lowest cart values stay (milestones.ts: free
  // shipping, the gift tiers and the order discounts with an "ms-" id are ONE ladder). A step past them loses its
  // amount for that market — it is not offered there, never more than the merchant set up; a step left without
  // any market goes (a discount rule is switched off: without a minimum it would apply to every cart).
  const over = milestonesOverLimit(out, "free");
  if (over.length > 0) {
    const rewards = out.modules.rewards;
    for (const { step, keys, everywhere } of over) {
      const threshold = everywhere ? {} : withoutMarkets(step.threshold, keys, out.markets);
      const none = Object.keys(threshold).length === 0;
      if (step.kind === "shipping") {
        if (none) delete rewards.freeShipping;
        else rewards.freeShipping = { threshold };
      } else if (step.kind === "gift") {
        if (none) rewards.gifts = rewards.gifts.filter((g) => g.id !== step.id);
        else rewards.gifts = rewards.gifts.map((g) => (g.id === step.id ? { ...g, threshold } : g));
      } else {
        const rule = out.modules.codes.rules.find((r) => r.id === step.id && isMilestoneRule(r));
        if (rule && none) rule.enabled = false;
        else if (rule) rule.minimum = { ...rule.minimum, subtotal: threshold };
      }
    }
    stripped.push({ capability: "milestone_steps", reason: "reduced", count: over.length, removedIds: over.map((o) => o.step.id) });
  }
  for (const gift of out.modules.rewards.gifts) {
    if (gift.choices.length <= 1) continue;
    const removedIds = gift.choices.slice(1);
    stripped.push({ capability: "gift_choices", reason: "reduced", entityId: gift.id, count: removedIds.length, removedIds });
    gift.choices = gift.choices.slice(0, 1);
  }

  // Margin: per-collection settings fold into the global floor, strictest wins.
  const margin = out.modules.margin;
  if (margin.perCollection.length > 0) {
    const before = { max: margin.global.maxDiscountPercent, min: margin.global.minMarginPercent ?? null };
    for (const o of margin.perCollection) {
      if (o.maxDiscountPercent !== undefined) margin.global.maxDiscountPercent = Math.min(margin.global.maxDiscountPercent, o.maxDiscountPercent);
      if (o.minMarginPercent !== undefined) {
        margin.global.minMarginPercent = Math.max(margin.global.minMarginPercent ?? 0, o.minMarginPercent);
      }
    }
    const values: NonNullable<StrippedCapability["values"]> = {};
    if (margin.global.maxDiscountPercent !== before.max) {
      values.maxDiscountPercent = { from: before.max, to: margin.global.maxDiscountPercent };
    }
    const minAfter = margin.global.minMarginPercent;
    if (minAfter !== undefined && minAfter !== before.min) values.minMarginPercent = { from: before.min, to: minAfter };
    stripped.push({
      capability: "margin_per_collection",
      reason: "folded",
      count: margin.perCollection.length,
      removedIds: margin.perCollection.map((o) => o.collectionId),
      values,
    });
    margin.perCollection = [];
  }

  return { config: out, stripped };
}

// --- Sentences for the admin ---------------------------------------------------------------------

export interface GateExplanation {
  text: string;
  ruleId?: string;
  entityId?: string;
}

/** "1 sada" · "2 sady" · "5 sad". */
function csCount(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${csPlural(n, forms)}`;
}

/** "další sada" · "další 2 sady" · "dalších 5 sad" (n ≥ 1). */
function csOthers(n: number, forms: readonly [string, string, string]): string {
  return n === 1 ? `další ${forms[0]}` : `${csPlural(n, ["další", "další", "dalších"])} ${csCount(n, forms)}`;
}

/** Czech verb agreeing with a counted subject: 1 → sg, 2–4 → pl, 5+ → sg (neuter). */
function csVerb(n: number, singular: string, plural: string): string {
  return n >= 2 && n <= 4 ? plural : singular;
}

/** "max. sleva 20 % (bylo 50 %), min. marže 25 % (bylo 10 %)" / "…" — the fold's changed values. */
function marginChange(values: StrippedCapability["values"], locale: UiLocale): string {
  const cs = locale === "cs";
  const parts: string[] = [];
  const max = values?.maxDiscountPercent;
  if (max) {
    const to = formatPercent(max.to, locale);
    const from = formatPercent(max.from, locale);
    parts.push(cs ? `max. sleva ${to} (bylo ${from})` : `a maximum discount of ${to} (was ${from})`);
  }
  const min = values?.minMarginPercent;
  if (min) {
    const to = formatPercent(min.to, locale);
    const from = min.from === null ? (cs ? "nenastaveno" : "not set") : formatPercent(min.from, locale);
    parts.push(cs ? `min. marže ${to} (bylo ${from})` : `a minimum margin of ${to} (was ${from})`);
  }
  return parts.join(cs ? ", " : " and ");
}

function sentence(s: StrippedCapability, locale: UiLocale): string {
  const cs = locale === "cs";
  const n = s.count ?? 1;
  const ruleName = s.name ? (cs ? `Sleva „${s.name}“` : `“${s.name}”`) : cs ? "Sleva bez názvu" : "An unnamed discount";
  switch (s.capability) {
    case "market_targeting":
      return cs
        ? `${ruleName} cílí na vybrané trhy. To je funkce Pro, ve Free se proto neuplatní vůbec.`
        : `${ruleName} targets selected markets. That is a Pro feature, so on Free it does not apply at all.`;
    case "segment_targeting":
      return cs
        ? `${ruleName} cílí na segment zákazníků. To je funkce Pro, ve Free se proto neuplatní vůbec.`
        : `${ruleName} targets a customer segment. That is a Pro feature, so on Free it does not apply at all.`;
    case "item_minimum_quantity":
      return cs
        ? `${ruleName} má minimum kusů u jednotlivých produktů nebo kolekcí. To je funkce Pro, ve Free se proto neuplatní vůbec.`
        : `${ruleName} has a minimum quantity for individual products or collections. That is a Pro feature, so on Free it does not apply at all.`;
    case "code_batch_pattern":
      return cs
        ? `${ruleName}: ${csCount(n, ["vygenerovaný kód", "vygenerované kódy", "vygenerovaných kódů"])} s vlastním vzorem ve Free neplatí, vzor kódů je funkce Pro.`
        : `${ruleName}: ${n} generated ${n === 1 ? "code" : "codes"} with a custom pattern ${n === 1 ? "does" : "do"} not work on Free; code patterns are a Pro feature.`;
    case "code_batch_size":
      return cs
        ? `${ruleName}: ve Free platí z jedné dávky nejvýš ${CONFIG_LIMITS.codeBatchSizeFree} vygenerovaných kódů, ${csOthers(n, ["kód", "kódy", "kódů"])} neplatí.`
        : `${ruleName}: on Free at most ${CONFIG_LIMITS.codeBatchSizeFree} generated codes of a batch work; the other ${n === 1 ? "one does" : `${n} do`} not.`;
    case "rule_combinations":
      return cs
        ? `${ruleName} se ve Free nesčítá se slevami, které máte u ní vybrané (kombinace u jednotlivých slev jsou funkce Pro). Platí kombinování po kategoriích.`
        : `${ruleName} does not add up with the discounts you picked for it on Free (per-discount combinations are a Pro feature). The category switches apply.`;
    case "campaigns": {
      const name = s.name ? (cs ? `„${s.name}“` : `“${s.name}”`) : cs ? "bez názvu" : "without a name";
      return cs
        ? `Kampaň ${name} ve Free neběží, kampaně jsou funkce Pro. Platí běžné nastavení slev.`
        : `Campaign ${name} does not run on Free; campaigns are a Pro feature. Your regular discount settings apply.`;
    }
    case "tier_set_scope":
      // K1: their products do not fall back to the store-wide set either.
      return cs
        ? `${csCount(n, ["sada", "sady", "sad"])} množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v ${n === 1 ? "ní" : "nich"} ve Free nedostanou žádnou množstevní slevu.`
        : `${n} quantity tier ${n === 1 ? "set" : "sets"} for selected products or collections ${n === 1 ? "does" : "do"} not apply on Free; that is a Pro feature. ${n === 1 ? "Its products get" : "Products in them get"} no quantity tier on Free.`;
    case "tier_sets_extra":
      return cs
        ? `Ve Free platí jen jedna sada množstevních slev pro celý obchod, ${csOthers(n, ["sada", "sady", "sad"])} se neuplatní.`
        : `On Free only one quantity tier set for the whole store applies; the other ${n === 1 ? "one does" : `${n} do`} not.`;
    case "tier_count_across_cart":
      return cs
        ? "Množstevní slevy ve Free počítají kusy po produktech, ne napříč celým košíkem (to je funkce Pro)."
        : "On Free, quantity tiers count items per product, not across the whole cart (a Pro feature).";
    case "milestone_steps":
      return cs
        ? `Ve Free platí v každém trhu ${MILESTONE_LIMITS.free} stupně Milníků s nejnižší částkou. ${n === 1 ? "Jeden stupeň se proto někde nenabízí" : `${csCount(n, ["stupeň", "stupně", "stupňů"])} se proto někde ${csVerb(n, "nenabízí", "nenabízejí")}`}. V Pro jich platí ${MILESTONE_LIMITS.pro}.`
        : `On Free each market runs the ${MILESTONE_LIMITS.free} Milestones steps with the lowest amount. ${n === 1 ? "One step is" : `${n} steps are`} therefore not offered somewhere. Pro runs ${MILESTONE_LIMITS.pro}.`;
    case "gift_choices":
      return cs
        ? `Ve Free se nabízí jen první dárek z výběru, ${csOthers(n, ["dárek", "dárky", "dárků"])} ne (výběr dárků je funkce Pro).`
        : `On Free only the first gift of the choice is offered, not the other ${n === 1 ? "one" : n} (a gift choice is a Pro feature).`;
    case "margin_per_collection": {
      const change = marginChange(s.values, locale);
      if (cs) {
        return change
          ? `Ochrana marže pro jednotlivé kolekce je funkce Pro. Ve Free platí jedno minimum pro celý obchod: použili jsme to nejpřísnější z vašeho nastavení, ${change}.`
          : "Ochrana marže pro jednotlivé kolekce je funkce Pro. Ve Free platí jedno minimum pro celý obchod, vaše globální nastavení se nemění.";
      }
      return change
        ? `Margin protection per collection is a Pro feature. On Free one minimum applies to the whole store: we used the strictest of your settings, ${change}.`
        : "Margin protection per collection is a Pro feature. On Free one minimum applies to the whole store; your global setting stays as it is.";
    }
  }
}

/**
 * One human sentence per stripped capability (doctrine §4c: never an enum key
 * on screen), in the admin's language, with the rule / entity it is about.
 */
export function explainGate(stripped: readonly StrippedCapability[], locale: UiLocale): GateExplanation[] {
  return stripped.map((s) => ({
    text: sentence(s, locale),
    ...(s.ruleId !== undefined ? { ruleId: s.ruleId } : {}),
    ...(s.entityId !== undefined ? { entityId: s.entityId } : {}),
  }));
}
