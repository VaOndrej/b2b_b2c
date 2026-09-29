// BILL-1 server gate (spec §7 "Free / Pro a billing", docs/won-discounts/rozhodnuti.md
// "Free / Pro"; audit MVP 1 P1-1): what a shop's discount function may carry for
// its plan. The UI hides Pro fields on Free, but a stored config can still hold
// them (a seed, a downgrade, an import, a restored ConfigVersion), and the
// function applies whatever the payload says. So the sync calls
// gateConfigForPlan BEFORE building the function payload and the product
// targeting index; a Free shop's checkout then never sees Pro data. The STORED
// config is never changed (§14a: turning Pro off never erases the setup) — the
// gate returns a copy plus `stripped`, the list the admin turns into sentences
// (explainGate) so it can say exactly what is not in force.
//
// Free vs Pro, as far as the config types reach today:
//   Slevy a kódy   Free: every type        Pro: + segment / market targeting
//   Engine         Free: category switches Pro: + per-rule combinations (combinesWith)
//   Kampaně        Free: —                 Pro: ✓
//   Množstevní     Free: 1 global set      Pro: sets per product / collection, counting across the cart
//   Odměny         Free: 1 gift threshold, 1 gift   Pro: threshold ladder, choice of up to 3 gifts
//   Ochrana marže  Free: global minimum    Pro: per collection
//   Výprodej       Free: —                 Pro: the whole module
//
// How each Pro capability is neutralised on Free — never in a way that gives a
// customer MORE than the merchant set up:
//   - market / segment targeting: the rule is switched OFF. Dropping only the
//     targeting would widen the rule to every market / every customer;
//   - combinesWith: removed (the rule competes like any other: better one wins);
//   - campaigns: removed (the base rules apply);
//   - tier sets: the first global set stays, scoped and further sets go;
//     counting across the cart becomes per product (fewer items per count);
//   - gift ladder: the first threshold stays, with its first gift only;
//   - margin per collection: folded into the global floor, the STRICTEST value
//     wins (a larger discount than the Pro setup allowed is never possible).
//
// Downgrade (A6: running sales and campaigns finish, new ones cannot start).
// Nothing is running at a downgrade in MVP 1 (no campaign or outlet UI yet), so
// this gate strips campaigns outright. What later MVPs must add:
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

import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";
import type { UiLocale } from "./describe.ts";

export type ShopPlan = "free" | "pro";

/** Pro capabilities the gate can strip (a stable list: the admin maps them to its own copy too). */
export const PRO_CAPABILITIES = [
  "market_targeting",
  "segment_targeting",
  "rule_combinations",
  "campaigns",
  "tier_set_scope",
  "tier_sets_extra",
  "tier_count_across_cart",
  "gift_ladder",
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
  /** How many items the Free limit left out (tier sets, gift thresholds, gift choices, margin overrides). */
  count?: number;
}

export interface GatedConfig {
  config: WonDiscountsConfig;
  stripped: StrippedCapability[];
}

const nonEmpty = (list: readonly unknown[] | undefined): boolean => Array.isArray(list) && list.length > 0;

/**
 * The config a shop on `plan` may run: Pro → an exact copy; Free → a copy
 * without any Pro capability (see the header for how each is neutralised) and
 * the list of what was taken out. Pure; never mutates `config`.
 */
export function gateConfigForPlan(config: ReadonlyDeep<WonDiscountsConfig>, plan: ShopPlan): GatedConfig {
  const out = JSON.parse(JSON.stringify(config)) as WonDiscountsConfig;
  const stripped: StrippedCapability[] = [];
  if (plan === "pro") return { config: out, stripped };

  // Discount rules: targeting and per-rule combinations.
  for (const rule of out.modules.codes.rules) {
    const who = { ruleId: rule.id, name: rule.name };
    if (rule.combinesWith) {
      if (rule.combinesWith.ruleIds.length > 0) stripped.push({ capability: "rule_combinations", reason: "removed", ...who });
      delete rule.combinesWith;
    }
    if (rule.targeting) {
      const markets = nonEmpty(rule.targeting.markets);
      const segments = nonEmpty(rule.targeting.segments);
      if (markets) stripped.push({ capability: "market_targeting", reason: "rule_off", ...who });
      if (segments) stripped.push({ capability: "segment_targeting", reason: "rule_off", ...who });
      if (markets || segments) rule.enabled = false;
      delete rule.targeting;
    }
  }

  // Campaigns (killed ones never ship anyway; they are dropped silently).
  for (const campaign of out.campaigns) {
    if (!campaign.killed) stripped.push({ capability: "campaigns", reason: "removed", entityId: campaign.id, name: campaign.name });
  }
  out.campaigns = [];

  // Quantity tiers: exactly one global set, counted per product at most.
  const sets = out.modules.tiers.sets;
  const kept = sets.find((set) => set.scope === "global");
  const scoped = sets.filter((set) => set.scope !== "global").length;
  const extra = sets.filter((set) => set.scope === "global" && set !== kept).length;
  if (scoped > 0) stripped.push({ capability: "tier_set_scope", reason: "removed", count: scoped });
  if (extra > 0) stripped.push({ capability: "tier_sets_extra", reason: "removed", count: extra });
  if (kept && kept.countAcross === "cart") {
    kept.countAcross = "product";
    stripped.push({ capability: "tier_count_across_cart", reason: "reduced", entityId: kept.id });
  }
  out.modules.tiers.sets = kept ? [kept] : [];

  // Rewards: one gift threshold, one gift.
  const gifts = out.modules.rewards.gifts;
  if (gifts.length > 0) {
    const first = gifts[0];
    if (gifts.length > 1) stripped.push({ capability: "gift_ladder", reason: "reduced", entityId: first.id, count: gifts.length - 1 });
    if (first.choices.length > 1) {
      stripped.push({ capability: "gift_choices", reason: "reduced", entityId: first.id, count: first.choices.length - 1 });
      first.choices = first.choices.slice(0, 1);
    }
    out.modules.rewards.gifts = [first];
  }

  // Margin: per-collection settings fold into the global floor, strictest wins.
  const margin = out.modules.margin;
  if (margin.perCollection.length > 0) {
    for (const o of margin.perCollection) {
      if (o.maxDiscountPercent !== undefined) margin.global.maxDiscountPercent = Math.min(margin.global.maxDiscountPercent, o.maxDiscountPercent);
      if (o.minMarginPercent !== undefined) {
        margin.global.minMarginPercent = Math.max(margin.global.minMarginPercent ?? 0, o.minMarginPercent);
      }
    }
    stripped.push({ capability: "margin_per_collection", reason: "folded", count: margin.perCollection.length });
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

function csCount(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2]}`;
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
    case "rule_combinations":
      return cs
        ? `${ruleName} se ve Free nesčítá se slevami, které máš u ní vybrané (kombinace u jednotlivých slev jsou funkce Pro). Platí kombinování po kategoriích.`
        : `${ruleName} does not add up with the discounts you picked for it on Free (per-discount combinations are a Pro feature). The category switches apply.`;
    case "campaigns": {
      const name = s.name ? (cs ? `„${s.name}“` : `“${s.name}”`) : cs ? "bez názvu" : "without a name";
      return cs
        ? `Kampaň ${name} ve Free neběží, kampaně jsou funkce Pro. Platí běžné nastavení slev.`
        : `Campaign ${name} does not run on Free; campaigns are a Pro feature. Your regular discount settings apply.`;
    }
    case "tier_set_scope":
      return cs
        ? `${csCount(n, ["sada", "sady", "sad"])} množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro.`
        : `${n} quantity tier ${n === 1 ? "set" : "sets"} for selected products or collections ${n === 1 ? "does" : "do"} not apply on Free; that is a Pro feature.`;
    case "tier_sets_extra":
      return cs
        ? `Ve Free platí jen jedna sada množstevních slev pro celý obchod, ${n === 1 ? "další se neuplatní" : `dalších ${n} se neuplatní`}.`
        : `On Free only one quantity tier set for the whole store applies; the other ${n === 1 ? "one does" : `${n} do`} not.`;
    case "tier_count_across_cart":
      return cs
        ? "Množstevní slevy ve Free počítají kusy po produktech, ne napříč celým košíkem (to je funkce Pro)."
        : "On Free, quantity tiers count items per product, not across the whole cart (a Pro feature).";
    case "gift_ladder":
      return cs
        ? `Ve Free platí jen první dárkový práh, ${n === 1 ? "další práh se nenabízí" : `dalších ${n} prahů se nenabízí`} (žebřík prahů je funkce Pro).`
        : `On Free only the first gift threshold applies; the other ${n === 1 ? "one is" : `${n} are`} not offered (a threshold ladder is a Pro feature).`;
    case "gift_choices":
      return cs
        ? `Ve Free se nabízí jen první dárek z výběru, ${n === 1 ? "druhý ne" : `dalších ${n} ne`} (výběr dárků je funkce Pro).`
        : `On Free only the first gift of the choice is offered, not the other ${n === 1 ? "one" : n} (a gift choice is a Pro feature).`;
    case "margin_per_collection":
      return cs
        ? "Ochrana marže pro jednotlivé kolekce je funkce Pro. Ve Free platí jedno minimum pro celý obchod, použili jsme to nejpřísnější z tvého nastavení."
        : "Margin protection per collection is a Pro feature. On Free one minimum applies to the whole store; we used the strictest of your settings.";
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
