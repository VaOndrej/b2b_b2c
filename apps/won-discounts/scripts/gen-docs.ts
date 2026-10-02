/**
 * Support-docs reference generator (docs/nova-aplikace.md §9).
 *
 * Regenerates apps/won-discounts/docs/reference/*.generated.md from the code:
 * the runtime enums, limits, defaults and the Free/Pro gate of
 * @won/core/discounts, the app's own platform guard (active code discounts),
 * the module list and the admin copy (so the reference uses the admin's words).
 * Volatile facts live in code exactly once; the support chatbot consumes the
 * generated markdown. NEVER hand-edit the generated files.
 *
 *   npm run docs:gen -w won-discounts     # write the files
 *
 * `buildDocs()` is pure (a function of code only: no wall-clock, no env, no
 * locale-dependent Intl) so the freshness test (tests/docs-freshness.test.ts)
 * can diff committed vs. code and fail the gate when a constant changes but the
 * docs weren't regenerated.
 */
import { writeFileSync } from "node:fs";
import { OUTLET_LIMITS } from "@won/core/discounts/outlet";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPEARANCE_PRESETS,
  COMBINATION_CATEGORIES,
  CONFIG_LIMITS,
  createDefaultConfig,
  DEFAULT_CONFIG,
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  MINIMUM_SCOPES,
  SCHEMA_VERSION,
  TIER_COUNT_ACROSS_MODES,
  type CombinationCategory,
  type DiscountRule,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";
import { FUNCTION_METAFIELD_LIMIT_BYTES } from "@won/core/discounts/function-payload";
import { marginFloorUnit } from "@won/core/discounts/margin";
import { fromMinorUnits } from "@won/core/discounts/money";
import { ENTERED_CODE_PADDING, MAX_ENTERED_CODES, MAX_STACK_CANDIDATES, SEGMENT_TARGETING_SUPPORTED } from "@won/core/discounts/plan";
import {
  gateConfigForPlan,
  PRO_CAPABILITIES,
  type ProCapability,
  type StrippedCapability,
} from "@won/core/discounts/plan-gate";

import { MODULE_META, UPCOMING_MODULES, type AdminModule } from "../app/components/model/modules.ts";
import { RECIPE_KEYS, recipeRule } from "../app/components/model/rule-form.ts";
import { cs } from "../app/i18n/cs.ts";
import { en } from "../app/i18n/en.ts";
import type { MessageKey } from "../app/i18n/index.ts";
import { MAX_ACTIVE_CODE_RULES, SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS } from "../app/lib/config-guards.server.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(scriptDir, "..", "docs");

// --- Frontmatter + helpers ---------------------------------------------------------------------

type Frontmatter = {
  title: string;
  slug: string;
  feature: string;
  min_plan: "free" | "pro";
  summary: string;
  keywords: string[];
};

function frontmatter(fm: Frontmatter): string {
  return [
    "---",
    `title: ${fm.title}`,
    `slug: ${fm.slug}`,
    "layer: reference",
    `feature: ${fm.feature}`,
    `min_plan: ${fm.min_plan}`,
    "status: stable",
    `config_version: ${SCHEMA_VERSION}`,
    "source: generated",
    "generated_from: '@won/core/discounts'",
    "lang: en",
    `keywords: [${fm.keywords.join(", ")}]`,
    `summary: ${fm.summary}`,
    "---",
  ].join("\n");
}

const BANNER =
  "<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. " +
  "Run `npm run docs:gen -w won-discounts` to refresh. -->";

function doc(fm: Frontmatter, body: string): string {
  return `${frontmatter(fm)}\n\n${BANNER}\n\n${body.trim()}\n`;
}

/** A number in plain English formatting (no Intl: the output must not depend on the runtime's ICU). */
function num(n: number): string {
  const [int, frac] = String(n).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** An admin text with its `{placeholders}` shown as a neutral marker. */
function copy(key: MessageKey, lang: "en" | "cs" = "en"): string {
  const text = (lang === "en" ? en : cs)[key];
  return text.replace(/\{(\w+)\}/g, (_whole, name: string) => `‹${name}›`);
}

function money(minor: number, currency: string): string {
  return `${fromMinorUnits(minor, currency)} ${currency}`;
}

// --- Pro capabilities (plan-gate.ts) -----------------------------------------------------------

type Area = "discounts" | AdminModule;

/** Merchant-facing name of each Pro capability and the admin area it lives in. */
const CAPABILITY_META: { readonly [K in ProCapability]: { label: string; area: Area } } = {
  market_targeting: { label: "Show a discount only in chosen markets", area: "discounts" },
  segment_targeting: { label: "Show a discount only to chosen customer segments", area: "discounts" },
  rule_combinations: { label: "Choose per discount which other discounts it stacks with", area: "discounts" },
  campaigns: { label: "Campaigns: start and end many discounts at once (e.g. Black Friday)", area: "campaigns" },
  tier_set_scope: { label: "Quantity discount sets for chosen products or collections", area: "tiers" },
  tier_sets_extra: { label: "More than one quantity discount set", area: "tiers" },
  tier_count_across_cart: { label: "Quantity discounts counted across the whole cart", area: "tiers" },
  gift_ladder: { label: "A ladder of several gift thresholds", area: "rewards" },
  gift_choices: { label: "A choice of gifts at one threshold", area: "rewards" },
  margin_per_collection: { label: "Margin protection settings per collection", area: "margin" },
};

/** What the server gate does with a Pro setting on Free (StrippedCapability.reason). */
const ON_FREE: { readonly [K in StrippedCapability["reason"]]: string } = {
  rule_off:
    "The whole discount does not apply on Free (removing only its targeting would widen it to everyone).",
  removed: "The Pro setting is left out; the rest keeps working.",
  reduced: "Kept within the Free limit.",
  folded: "Merged into the store-wide setting; the strictest value wins.",
};

function areaBuilt(area: Area): boolean {
  return area === "discounts" || !(UPCOMING_MODULES as readonly string[]).includes(area);
}

function capabilityAvailable(cap: ProCapability): boolean {
  if (cap === "segment_targeting") return SEGMENT_TARGETING_SUPPORTED;
  return areaBuilt(CAPABILITY_META[cap].area);
}

function areaName(area: Area): string {
  return area === "discounts" ? en["nav.discounts"] : en[MODULE_META[area].title];
}

/**
 * A config that uses every Pro capability once, run through the real Free gate:
 * the "on Free" column is what the code does, not what this file claims.
 */
function freeGateReasons(): Map<ProCapability, StrippedCapability["reason"]> {
  const probe: WonDiscountsConfig = createDefaultConfig();
  const rule = (id: string, extra: Partial<DiscountRule>): DiscountRule => ({
    id,
    enabled: true,
    name: id,
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...extra,
  });
  probe.modules.codes.rules = [
    rule("a", { targeting: { markets: ["m"] }, combinesWith: { ruleIds: ["b"] } }),
    rule("b", { targeting: { segments: ["s"] } }),
  ];
  probe.campaigns = [
    { id: "c", name: "c", window: { start: "2000-01-01T00:00:00", end: "2000-01-02T00:00:00" }, overrides: [], killed: false },
  ];
  probe.modules.tiers.sets = [
    { id: "t1", scope: "global", countAcross: "cart", breaks: [{ minQty: 2, percent: 5 }] },
    { id: "t2", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
    { id: "t3", scope: { productIds: ["p"] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
  ];
  probe.modules.rewards.gifts = [
    { id: "g1", threshold: { USD: 1000 }, choices: ["v1", "v2"] },
    { id: "g2", threshold: { USD: 2000 }, choices: ["v3"] },
  ];
  probe.modules.margin.perCollection = [{ collectionId: "1", minMarginPercent: 20 }];

  const reasons = new Map<ProCapability, StrippedCapability["reason"]>();
  for (const s of gateConfigForPlan(probe, "free").stripped) if (!reasons.has(s.capability)) reasons.set(s.capability, s.reason);
  const missing = PRO_CAPABILITIES.filter((c) => !reasons.has(c));
  if (missing.length > 0) {
    throw new Error(`gen-docs: the Free-gate probe does not exercise ${missing.join(", ")}; extend freeGateReasons().`);
  }
  return reasons;
}

// --- Documents ---------------------------------------------------------------------------------

function planLimitsDoc(): string {
  const reasons = freeGateReasons();
  const available = PRO_CAPABILITIES.filter(capabilityAvailable);
  const planned = PRO_CAPABILITIES.filter((c) => !capabilityAvailable(c));
  const capRow = (c: ProCapability) => {
    const reason = reasons.get(c);
    if (!reason) throw new Error(`gen-docs: no Free-gate reason for ${c}.`);
    return `| ${CAPABILITY_META[c].label} | ${areaName(CAPABILITY_META[c].area)} | ${ON_FREE[reason]} |`;
  };
  const upcoming = UPCOMING_MODULES.map((m) => `- **${en[MODULE_META[m].title]}**${MODULE_META[m].pro ? " (Pro)" : ""}: ${en[`soon.${m}`]}`);

  return doc(
    {
      title: "Free vs Pro plans",
      slug: "plan-limits",
      feature: "plans",
      min_plan: "free",
      summary: "What the Free plan includes, which Won Discounts features need Pro, and what happens to Pro settings on Free.",
      keywords: ["free", "pro", "plan", "pricing", "limits", "upgrade", "downgrade", "tarif"],
    },
    `# Free vs Pro plans

Free limits **scope, never quality**: the same engine, checkout consistency,
margin protection, Try a cart and moving Shopify discounts work in full on Free.

**Pro price:** ${en["plan.pro.title"].replace(/^Pro\s*·\s*/, "")}.
**Availability:** ${en["plan.pro.soon"]}

## Free includes

- Every discount type (${DISCOUNT_VALUE_KINDS.map((k) => en[`editor.value.${k}`].toLowerCase()).join(", ")}),
  automatic or with a code
- Up to ${num(CONFIG_LIMITS.rules)} discounts, at most ${num(MAX_ACTIVE_CODE_RULES)} active code discounts at a time
- The default combination rules
- ${en["nav.tryCart"]}: which discounts apply to a cart and why
- ${en["nav.margin"]}: one store-wide minimum margin and one ceiling for products without a cost price
- Moving Shopify discounts into Won, with Undo
- Admin in Czech or English

## Pro unlocks (available now)

| Pro capability | Area | On Free |
|---|---|---|
${available.map(capRow).join("\n")}

With per-discount combinations, at most **${MAX_STACK_CANDIDATES}** discounts stack on one line
(or on the order).

## Pro capabilities of modules not built yet

These belong to planned modules or are not supported at checkout yet. They are
listed so the plan comparison is complete; none of them can be set up today.

| Pro capability | Area | On Free |
|---|---|---|
${planned.map(capRow).join("\n")}

## Planned modules

${upcoming.join("\n")}

## What "On Free" means

Pro settings are **never erased**: they stay saved, but the server leaves them
out of what checkout runs while the shop is on Free. The admin lists each one
that is not in force. A Pro setting is always neutralised in the direction that
gives customers **less**, never more than the merchant set up.`,
  );
}

function limitsDoc(): string {
  return doc(
    {
      title: "Limits",
      slug: "limits",
      feature: "core",
      min_plan: "free",
      summary: "Exact limits of Won Discounts — discounts per shop, active code discounts, codes, stacking, margin collections and settings size.",
      keywords: ["limit", "maximum", "how many", "codes", "code discounts", "25", "size", "too many discounts"],
    },
    `# Limits

## Discounts and codes

| What | Limit |
|---|---|
| Discounts in one shop | ${num(CONFIG_LIMITS.rules)} |
| Active code discounts at the same time | ${num(MAX_ACTIVE_CODE_RULES)} |
| Codes in one code discount | ${num(CONFIG_LIMITS.codesPerRule)} |
| Length of one code (Shopify itself allows 255; a Shopify discount with a longer code stays in Shopify) | ${num(CONFIG_LIMITS.codeLength)} characters |
| Products, variants or collections picked in one discount | ${num(CONFIG_LIMITS.listItems)} each |
| Discounts stacked on one line or on the order (Pro) | ${num(MAX_STACK_CANDIDATES)} |
| Codes a customer enters that are counted (the first ones entered; later codes are not counted) | ${num(MAX_ENTERED_CODES)} |
| Spaces a customer types around a code that still count (a code entered with more does not apply) | ${num(ENTERED_CODE_PADDING)} characters |

**Why the code-discount limit:** every active code discount is its own Shopify
discount, and Shopify runs at most ${num(SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS)} discount
functions per store (other apps' discounts count too). All automatic Won
discounts run in one. A scheduled code discount counts as active. To offer more
codes, add them to an existing code discount.

## Margin protection

| What | Limit |
|---|---|
| Minimum margin | 0–${num(CONFIG_LIMITS.minMarginPercent)} % |
| Ceiling for products without a cost price | 0–100 % |
| Collections with their own margin setting (Pro) | ${num(CONFIG_LIMITS.marginOverrides)} |

## Settings size

| What | Limit |
|---|---|
| Discount settings the checkout function reads | ${num(FUNCTION_CONFIG_BUDGET_BYTES)} bytes (Shopify's hard limit is ${num(FUNCTION_METAFIELD_LIMIT_BYTES)}) |
| All saved app settings | ${num(CONFIG_LIMITS.storedConfigBytes / 1024)} KiB |

A save that would go over either limit is refused with an explanation; nothing
is saved. Fewer discounts, fewer codes or fewer collections with their own
margin setting make room.

## Quantity tiers

| What | Limit |
|---|---|
| Quantity tier sets (Pro; Free has one global set) | ${num(CONFIG_LIMITS.tierSets)} |
| Quantity breaks in one tier set | ${num(CONFIG_LIMITS.breaksPerTierSet)} |
| Ways to count quantity | ${TIER_COUNT_ACROSS_MODES.length} (\`${TIER_COUNT_ACROSS_MODES.join("`, `")}\`; \`cart\` is Pro) |
| Combined size of every tier set (checkout reads a compact copy) | ${num(CONFIG_LIMITS.tierPayloadBytes)} bytes |

All tier sets together share that last, much smaller budget, so many sets with
many breaks and several currencies can run out of room well before the set or
break counts above. A save that would not fit is refused with the byte count
and the budget; nothing is saved.

## Clearance (Pro)

| What | Limit |
|---|---|
| Clearance discount | ${OUTLET_LIMITS.percentMin}–${OUTLET_LIMITS.percentMax} %, whole percent |
| Quota (pieces to sell) | 1–${num(OUTLET_LIMITS.quotaMax)} |
| Sales not ended at once, per store | ${num(OUTLET_LIMITS.running)} |
| Sales not ended per variant | 1 |
| Market price lists one sale changes | ${OUTLET_LIMITS.priceLists} |

## Block appearances

${APPEARANCE_PRESETS.length} presets for the quantity-tiers product-page block:
\`${APPEARANCE_PRESETS.join("`, `")}\`. An unrecognised value falls back to
\`${APPEARANCE_PRESETS[0]}\`.`,
  );
}

const COMBINATION_LABELS: { readonly [K in CombinationCategory]: string } = {
  outletWithAnything: "Clearance item + any other discount",
  productWithProduct: "Product discount + another product discount on the same item",
  productWithOrder: "Product discount + order discount",
  productWithShipping: "Product discount + shipping discount",
  orderWithShipping: "Order discount + shipping discount",
};

function combinationValue(category: CombinationCategory): string {
  const value: unknown = DEFAULT_CONFIG.engine.combination[category];
  if (value === "best") return "No: the better one for the customer wins";
  if (value === true) return "Yes, they add up";
  if (value === false) return "No";
  throw new Error(`gen-docs: no wording for combination value ${String(value)} (${category}).`);
}

function combinationDoc(): string {
  const rows = COMBINATION_CATEGORIES.map((c) => {
    const note = c === "outletWithAnything" && !areaBuilt("outlet") ? " (Clearance is a planned module)" : "";
    return `| ${COMBINATION_LABELS[c]}${note} | ${combinationValue(c)} |`;
  });
  return doc(
    {
      title: "Default combination rules",
      slug: "combination-defaults",
      feature: "engine",
      min_plan: "free",
      summary: "Which kinds of Won discounts add up by default and which compete, plus the Pro stacking cap.",
      keywords: ["combine", "combination", "stack", "add up", "better wins", "kombinace", "sčítání"],
    },
    `# Default combination rules

What happens when two Won discounts of these kinds could apply to the same cart:

| Discounts | Combine by default? |
|---|---|
${rows.join("\n")}

- Two **order** discounts do not add up either: the better one for the customer wins.
- Of several **shipping** discounts one applies: a percentage (free shipping = 100 %)
  ranks above a fixed amount, the larger first.
- **Pro:** a discount can be set to stack with chosen other discounts of the same
  kind. At most **${MAX_STACK_CANDIDATES}** discounts stack on one line (or on the order).`,
  );
}

function marginDoc(): string {
  const margin = DEFAULT_CONFIG.modules.margin;
  // A worked example computed by the engine's own floor arithmetic (margin.ts).
  const price = 10000;
  const cost = 6000;
  const minMargin = 20;
  const withCost = marginFloorUnit({ unitPrice: price, costMinor: cost, minMarginPercent: minMargin, maxDiscountPercent: margin.global.maxDiscountPercent });
  const noCost = marginFloorUnit({ unitPrice: price, costMinor: null, minMarginPercent: minMargin, maxDiscountPercent: margin.global.maxDiscountPercent });
  const usd = (minor: number) => money(minor, "USD");
  return doc(
    {
      title: "Margin protection settings",
      slug: "margin-settings",
      feature: "margin",
      min_plan: "free",
      summary: "Margin protection defaults, accepted values, the floor formula and a worked example computed by the engine.",
      keywords: ["margin", "minimum margin", "cost price", "floor", "ceiling", "default", "ochrana marže", "nákupní cena"],
    },
    `# Margin protection settings

| Setting | Default | Accepted values |
|---|---|---|
| ${en["margin.enabled"]} | ${margin.enabled ? "on" : "off"} | on / off |
| ${en["margin.min.label"]} | empty (= never below the cost price) | 0–${num(CONFIG_LIMITS.minMarginPercent)} %, one decimal, rounded up |
| ${en["margin.max.label"]} | ${num(margin.global.maxDiscountPercent)} % | 0–100 %, one decimal, rounded down |
| Settings per collection (Pro) | none | up to ${num(CONFIG_LIMITS.marginOverrides)} collections |

Rounding always goes the stricter way, so a saved value never allows a larger
discount than the one typed.

## The floor of one item

- **With a cost price:** lowest price = cost price ÷ (1 − minimum margin).
- **Without a cost price** (or not read yet): lowest price = price × (1 − ceiling).

## Worked example

A product at ${usd(price)} with a cost price of ${usd(cost)}, minimum margin ${minMargin} %:
the lowest price is **${usd(withCost.floorUnit)}**, so a Won discount can take off at most
${usd(price - withCost.floorUnit)}.

The same product without a cost price and the default ${num(margin.global.maxDiscountPercent)} % ceiling:
the lowest price is **${usd(noCost.floorUnit)}**, a discount of at most ${usd(price - noCost.floorUnit)}.`,
  );
}

const STATUS_ROWS: readonly { label: MessageKey; text: MessageKey | null; note?: string }[] = [
  { label: "status.live", text: null, note: "Switched on, inside its dates, and this version is in Shopify: it applies at checkout." },
  { label: "status.off", text: null, note: "Switched off. It does not apply." },
  { label: "status.scheduled", text: "status.scheduledText" },
  { label: "status.ended", text: "status.endedText" },
  { label: "status.draft", text: "status.draftText" },
  { label: "status.notSynced", text: "status.notSyncedText" },
  { label: "status.syncFailed", text: "status.syncFailedText" },
  { label: "status.refreshing", text: "status.refreshingText" },
  { label: "status.unsupported", text: "status.noCodeText" },
  { label: "status.unsupported", text: "status.noTargetText" },
  { label: "status.unsupported", text: "status.noValueText" },
  { label: "status.unsupported", text: "status.marketOffText" },
  { label: "status.unsupported", text: "status.proOffText" },
  { label: "status.unsupported", text: "status.unsupportedText" },
];

function statusesDoc(): string {
  const rows = STATUS_ROWS.map(
    (r) => `| ${copy(r.label)} | ${copy(r.label, "cs")} | ${r.text ? copy(r.text) : (r.note ?? "")} |`,
  );
  return doc(
    {
      title: "Discount statuses",
      slug: "discount-statuses",
      feature: "discounts",
      min_plan: "free",
      summary: "Every status a Won discount can show in the admin (English and Czech label) and what it means.",
      keywords: ["status", "live", "not running", "not synced", "scheduled", "ended", "běží", "neběží", "nepropsáno"],
    },
    `# Discount statuses

Each discount in the list shows one status. Only **${en["status.live"]}** and
**${en["status.refreshing"]}** mean it applies at checkout right now.

| Status (EN) | Status (CS) | What it means |
|---|---|---|
${rows.join("\n")}`,
  );
}

function recipeLine(key: (typeof RECIPE_KEYS)[number]): string {
  const currencies = ["CZK", "EUR", "GBP", "PLN", "USD"];
  const rule = recipeRule(key, { id: "r_recipe", locale: "en", currencies });
  const amounts = (m: Record<string, number>) => Object.entries(m).map(([c, a]) => money(a, c)).join(", ");
  const value =
    rule.value.kind === "percentage"
      ? `${en["editor.value.percentage"]} ${num(rule.value.percent)} %`
      : rule.value.kind === "fixed"
        ? `${en["editor.value.fixed"]} ${amounts(rule.value.amount)}`
        : en["editor.value.freeShipping"];
  const parts = [
    value,
    `${en["editor.target.label"]}: ${en[`editor.target.${rule.target.kind}`]}`,
    rule.method === "code" ? `${en["editor.method.code"]}: ${(rule.codes ?? []).join(", ")}` : en[`editor.method.${rule.method}`],
  ];
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && Object.keys(subtotal).length > 0) parts.push(`${en["editor.minimum.title"]}: ${amounts(subtotal)}`);
  if (rule.limits?.oncePerCustomer) parts.push(en["editor.limits.once"]);
  const title = key === "blank" ? en["recipe.blank.title"] : en[`recipe.${key}.title`];
  const body = key === "blank" ? "" : ` (${en[`recipe.${key}.body`]})`;
  return `| ${title}${body} | ${parts.join(" · ")} |`;
}

function discountOptionsDoc(): string {
  const row = (key: string, label: string, labelCs: string) => `| ${label} | ${labelCs} | \`${key}\` |`;
  return doc(
    {
      title: "Discount options",
      slug: "discount-options",
      feature: "discounts",
      min_plan: "free",
      summary: "Every discount type, target, way of applying and minimum option in Discounts & codes, plus what each recipe pre-fills.",
      keywords: ["discount type", "percentage", "fixed amount", "free shipping", "code", "automatic", "recipe", "minimum"],
    },
    `# Discount options

The options of a discount in **${en["nav.discounts"]}** (${cs["nav.discounts"]}), with the
admin's English and Czech wording.

## ${en["editor.value.label"]}

| EN | CS | Key |
|---|---|---|
${DISCOUNT_VALUE_KINDS.map((k) => row(k, en[`editor.value.${k}`], cs[`editor.value.${k}`])).join("\n")}

## ${en["editor.target.label"]}

| EN | CS | Key |
|---|---|---|
${DISCOUNT_TARGET_KINDS.map((k) => row(k, en[`editor.target.${k}`], cs[`editor.target.${k}`])).join("\n")}

Free shipping always applies to shipping.

## ${en["editor.method.label"]}

| EN | CS | Key |
|---|---|---|
${DISCOUNT_METHODS.map((k) => row(k, en[`editor.method.${k}`], cs[`editor.method.${k}`])).join("\n")}

## ${en["editor.minimum.scope"]}

| EN | CS | Key |
|---|---|---|
${MINIMUM_SCOPES.map((k) => row(k, en[`editor.minimum.scope.${k}`], cs[`editor.minimum.scope.${k}`])).join("\n")}

A new discount counts its minimum on the whole cart. A discount moved from
Shopify keeps Shopify's rule: the minimum counts only the selected products.

## Recipes

What each recipe pre-fills. Amounts are suggested only for the currencies
listed; any other currency starts empty, so the discount is not offered there
until you fill it in.

| Recipe | Pre-filled |
|---|---|
${RECIPE_KEYS.map(recipeLine).join("\n")}`,
  );
}

/** Pure: build the full map of generated docs { path relative to docs/: content }. */
export function buildDocs(): Record<string, string> {
  return {
    "reference/plan-limits.generated.md": planLimitsDoc(),
    "reference/limits.generated.md": limitsDoc(),
    "reference/combination-defaults.generated.md": combinationDoc(),
    "reference/margin-settings.generated.md": marginDoc(),
    "reference/discount-options.generated.md": discountOptionsDoc(),
    "reference/discount-statuses.generated.md": statusesDoc(),
  };
}

function main(): void {
  for (const [rel, content] of Object.entries(buildDocs())) {
    const abs = join(DOCS_DIR, rel);
    writeFileSync(abs, content, "utf8");
    console.log(`wrote ${relative(process.cwd(), abs)}`);
  }
}

// Run only when invoked directly (not when imported by the freshness test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
