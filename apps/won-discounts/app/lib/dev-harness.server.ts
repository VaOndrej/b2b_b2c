// Dev-only admin harness (Task 5 brief): lets us screenshot admin screens at
// 390/1440px without logging into Shopify admin. This module is server-only
// (`.server.ts`) and imported by exactly one route: app/routes/dev.preview.$.tsx.
//
// Production safety is BUILD-TIME, not just a runtime check: app/routes.ts
// excludes the dev.preview.$.tsx route file from the route manifest entirely
// unless NODE_ENV is exactly "development" or "test" (allowlist shared via
// ./dev-harness-env.ts), so the harness route — and this module — never reach
// a production/staging server bundle. isDevHarnessEnabled() below is a second,
// cheap belt-and-braces guard inside the loader itself, with the same
// allowlist, plus WON_DEV_HARNESS=0 to turn the harness off locally.
//
// The harness renders the REAL admin screens (audit P2-5): the same
// presentational components the embedded routes render, fed by fixture
// WonDiscountsConfigs (run through the real reader) and fixture store signals
// instead of the shop's stored ones. It never reads the database and never
// authenticates.

import type { AnalyticsScreenData } from "../components/model/analytics";
import type { AnalyticsSummary } from "./analytics/analytics.server";
import { analyticsScreenOf } from "./integration/analytics-admin.server";
import type { PlanActionResult, PlanScreenData } from "../components/model/plan";
import { codeRuleLimit } from "./ui-actions.server";
import { codeHash } from "@won/core/discounts/code-hash";
import { expandConfigAmounts } from "@won/core/discounts/market-amounts";
import { ACCENT_PRESETS, CONFIG_LIMITS, DEFAULT_CONFIG, readStoredConfig, sanitizeConfig, type Campaign, type WonDiscountsConfig } from "@won/core/discounts/config";
import { CAMPAIGN_LIMITS } from "@won/core/discounts/campaigns";
import type { MarginVariant } from "@won/core/discounts/margin";
import { explainGate, gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { productRuleIndex, variantKey } from "@won/core/discounts/targeting";

import type {
  AdminSignals,
  AppearanceScreenData,
  CartPlanView,
  CostCoverageView,
  CostMirrorView,
  GateNoteView,
  MarginImpactView,
  MarginOverviewView,
  MarginRuleImpactView,
  MarginScreenData,
  MarginSettingsView,
  NativeView,
  PreviewProductView,
  RuleSyncMap,
  SettingsScreenData,
  StorefrontSyncView,
  SyncView,
  ThemeTokensView,
  TiersBlockView,
  TiersOverviewView,
  TiersScreenData,
  TryCartLineView,
  RewardsScreenData,
  UiResult,
  OutletActionResult,
  OutletOverviewView,
  OutletScreenData,
  CampaignsActionResult,
  CampaignsOverviewView,
  CampaignsScreenData,
} from "../components/model/types";
import { presetOf } from "../components/model/appearance";
import { CAMPAIGN_BLOCK_HANDLE, cartBlockAddUrl, outletBlockAddUrl, placementLinks, REWARDS_PROGRESS_BLOCK_HANDLE, tiersBlockAddUrl } from "../components/model/embed";
import { MS_FIELD } from "../components/model/milestones";
import { marketRows } from "../components/model/markets-overview";
import { rewardsOverviewOf, rewardsScreenFacts, rewardsSectionStatus } from "./integration/rewards.server";
import { campaignsStatus, marginStatus, outletStatus } from "../components/model/module-status";
import { currencyViews } from "../components/model/markets";
import { TIERS_FIELD } from "../components/model/tiers";
import { aiPrompt, previewLookOf, sampleSet, storefrontTextDefaults, storefrontTextKeys } from "./integration/appearance.server";
import { tiersOverviewOf, tiersScreenFacts, tiersSectionStatus } from "./integration/tiers.server";
import { lossText, undoCostTexts, warningText } from "./native/copy";
import { isDevHarnessEnvironment } from "./dev-harness-env";
import { wordIssues } from "./integration/issue-copy";
import { impactRulesOf, impactView } from "./integration/margin-impact-view";
import { foldMarginCollections } from "./sync/products";
import { planTryCart } from "./integration/try-cart-plan";
import { outletOverviewOf, outletRunView } from "./integration/outlet-admin.server";
import { OUTLET_FIELD } from "../components/model/outlet";
import { CAMPAIGN_FIELD } from "../components/model/campaigns";
import { campaignRuleChoices, campaignsOverviewOf, campaignTierChoices, campaignView, type CampaignViewOptions } from "./integration/campaigns-admin.server";
import { OUTLET_LIMITS } from "@won/core/discounts/outlet";

export function isDevHarnessEnabled(): boolean {
  // eslint-disable-next-line no-undef
  return isDevHarnessEnvironment(process.env.NODE_ENV) && process.env.WON_DEV_HARNESS !== "0";
}

export const DEV_SHOP = "won-dev.myshopify.com";
export const DEV_TIMEZONE = "Europe/Prague";
/** Fixed "now" so harness screenshots are reproducible. */
export const DEV_NOW = new Date("2026-09-28T12:00:00Z");

const DEV_MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true },
  { handle: "sk", currency: "EUR", enabled: true },
  // A market that is switched off: rules may still hold HUF values (kept, shown read-only).
  { handle: "hu", currency: "HUF", enabled: false },
];

/** Shopify market names (read_markets) for the fixture handles. */
export const DEV_MARKET_NAMES: Readonly<Record<string, string>> = { cz: "Česko", sk: "Slovensko", hu: "Maďarsko", de: "Německo" };

/**
 * ?markets=shared: Germany sells in euros next to Slovakia. 7 Oct 2026: every market has its own amount, so the
 * forms get a field per market ("EUR@sk", "EUR@de"), each starting from what is stored for the euro — the config
 * is in the admin's columns, as loadConfig returns it (core expandConfigAmounts).
 */
export function devSharedMarket<T extends WonDiscountsConfig>(config: T, shared: boolean): T {
  return shared ? expandConfigAmounts({ ...config, markets: [...config.markets, { handle: "de", currency: "EUR", enabled: true, countries: ["DE"] }] }) : config;
}

/**
 * Přehled fixture: the real defaults, two enabled markets (CZK, EUR) plus a
 * switched-off one (HUF), and a realistic set of rules — an automatic %, a code
 * rule with a CZK-only minimum, a complete fixed CZK/EUR rule (with a kept HUF
 * value), a scheduled fixed rule missing its EUR value (warning), a switched-off
 * free-shipping rule and a segment-targeted rule checkout cannot evaluate yet —
 * run through the real reader.
 */
export const DEV_OVERVIEW_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEFAULT_CONFIG,
  markets: DEV_MARKETS,
  modules: {
    ...DEFAULT_CONFIG.modules,
    codes: {
      rules: [
        {
          id: "dev-fixture-1",
          enabled: true,
          name: "Podzimní sleva 10 %",
          method: "automatic",
          value: { kind: "percentage", percent: 10 },
          target: { kind: "order" },
        },
        {
          id: "dev-fixture-2",
          enabled: true,
          name: "VIP10",
          method: "code",
          codes: ["VIP10"],
          value: { kind: "percentage", percent: 10 },
          target: { kind: "order" },
          minimum: { subtotal: { CZK: 1000_00 } },
          limits: { oncePerCustomer: true },
        },
        {
          id: "dev-fixture-3",
          enabled: true,
          name: "Sleva 200 Kč / 8 €",
          method: "automatic",
          value: { kind: "fixed", amount: { CZK: 200_00, EUR: 8_00, HUF: 3000_00 } },
          target: { kind: "order" },
          minimum: { subtotal: { CZK: 1500_00, EUR: 60_00 } },
        },
        {
          id: "dev-fixture-4",
          enabled: true,
          name: "Černý pátek",
          method: "automatic",
          value: { kind: "fixed", amount: { CZK: 300_00 } },
          target: { kind: "order" },
          schedule: { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" },
        },
        {
          id: "dev-fixture-5",
          enabled: false,
          name: "Doprava zdarma",
          method: "automatic",
          value: { kind: "freeShipping" },
          target: { kind: "shipping" },
          minimum: { subtotal: { CZK: 1500_00, EUR: 60_00 } },
        },
        {
          id: "dev-fixture-6",
          enabled: true,
          name: "Stálí zákazníci 5 %",
          method: "automatic",
          value: { kind: "percentage", percent: 5 },
          target: { kind: "order" },
          targeting: { segments: ["gid://shopify/Segment/1"] },
        },
      ],
    },
  },
});

/** A brand-new shop: markets known, no rules yet, onboarding at step 1. */
export const DEV_EMPTY_FIXTURE: WonDiscountsConfig = readStoredConfig({ ...DEFAULT_CONFIG, markets: DEV_MARKETS });

/** Onboarding in progress: goals picked. */
export const DEV_ONBOARDING_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEFAULT_CONFIG,
  markets: DEV_MARKETS,
  onboarding: { goals: ["rewards", "migrate"], step: 2 },
});

const DEV_ACTIVATE_URL = `https://${DEV_SHOP}/admin/themes/current/editor?context=apps&activateAppId=dev-api-key/won_discounts_embed`;

/** Native discounts as the detector + planMove word them (app/lib/native/copy.ts sentences). */
export function devNative(locale: "cs" | "en" = "cs"): Extract<NativeView, { state: "ok" }> {
  return {
    state: "ok",
    discounts: [
      {
        id: "gid://shopify/DiscountCodeNode/1001",
        title: "LETO15",
        method: "code",
        code: "LETO15",
        summary: locale === "cs" ? "15 % z objednávky" : "15% off the order",
        movable: true,
        losses: [lossText({ code: "usage_history", used: 42 }, locale), lossText({ code: "once_per_customer" }, locale)],
        warnings: [warningText({ code: "usage_limit_remaining", used: 42, limit: 100, remaining: 58 }, locale)],
      },
      {
        id: "gid://shopify/DiscountAutomaticNode/1002",
        title: "Doprava zdarma nad 2 000 Kč",
        method: "automatic",
        summary: locale === "cs" ? "Doprava zdarma · od 2 000 Kč" : "Free shipping · from CZK 2,000",
        movable: true,
        losses: [lossText({ code: "usage_history", used: 0 }, locale)],
        warnings: [warningText({ code: "other_currencies", shopCurrency: "CZK", missing: ["EUR"] }, locale)],
      },
      {
        id: "gid://shopify/DiscountAutomaticNode/1003",
        title: "Kup 2, třetí zdarma",
        method: "automatic",
        movable: false,
        blockedReason: "bxgy",
        losses: [],
      },
    ],
    moved: [
      {
        backupId: "bk_dev_1",
        title: "JARO10",
        movedAt: "2026-09-20T10:00:00",
        state: "moved",
        // What its undo changes (shown before the confirmation) and how it stacks now (F4, F11).
        undoCosts: undoCostTexts({ method: "code", usageLimit: 100, oncePerCustomer: true }, locale),
        stacking: [warningText({ code: "stacks_with_native", titles: ["Kup 2, třetí zdarma"] }, locale)],
      },
    ],
    conflicts: [],
  };
}

export const DEV_NATIVE: NativeView = devNative("cs");

/** Right after a move: the moved discount with its undo, and one move that did not finish (in the backup). */
export function devNativeMoved(locale: "cs" | "en" = "cs"): NativeView {
  const base = devNative(locale);
  return {
    ...base,
    discounts: base.discounts.filter((d) => d.id !== "gid://shopify/DiscountCodeNode/1001"),
    moved: [
      {
        backupId: "bk_dev_2",
        title: "LETO15",
        movedAt: "2026-09-28T14:05:00",
        state: "moved",
        undoCosts: undoCostTexts({ method: "code", usageLimit: 100, oncePerCustomer: true }, locale),
      },
      {
        backupId: "bk_dev_3",
        title: "PODZIM20",
        movedAt: "2026-09-28T13:40:00",
        state: "attention",
        note:
          locale === "cs"
            ? "Přesun se nepovedl (Sleva „PODZIM20“ se do Shopify nezapsala). Slevu se nepodařilo vrátit do Shopify. Je v záloze, klikni na „Vrátit zpět“."
            : "The move failed (The discount “PODZIM20” did not reach Shopify). The discount could not be put back into Shopify. It is in the backup, click “Undo”.",
      },
      ...base.moved,
    ],
  };
}

/** The Notice right after "Přesunout" (what to keep in mind, from planMove). */
export function devMovedResult(locale: "cs" | "en" = "cs"): UiResult {
  return {
    ok: true,
    message: "moved",
    count: 1,
    notes: [warningText({ code: "usage_limit_remaining", used: 42, limit: 100, remaining: 58 }, locale)],
  };
}

/** What Přehled looks like once sync, native detection and checkout checks are wired. */
export const DEV_SIGNALS: AdminSignals = {
  embed: { state: "off", activateUrl: DEV_ACTIVATE_URL },
  checkout: { state: "not_wired" },
  sync: { state: "ok", at: "2026-09-28T16:20:00" },
  native: DEV_NATIVE,
};

/** The stored settings are the ones Shopify runs / the last write failed (the module pages' state labels). */
const DEV_SYNC_OK: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
const DEV_SYNC_FAILED: SyncView = { state: "error", at: "2026-09-28T16:20:00", problems: [] };

/** Every fixture rule in Shopify as it is now (the per-rule facts after a clean sync). */
export const DEV_RULE_SYNC_OK: RuleSyncMap = Object.fromEntries(
  DEV_OVERVIEW_FIXTURE.modules.codes.rules.map((rule) => [rule.id, "synced" as const]),
);

/** The last sync failed on the VIP10 code rule (its code is taken by another Shopify discount). */
export const DEV_RULE_SYNC_FAILED: RuleSyncMap = { ...DEV_RULE_SYNC_OK, "dev-fixture-2": "failed" };

export const DEV_SIGNALS_SYNC_FAILED: AdminSignals = {
  ...DEV_SIGNALS,
  embed: { state: "on", activateUrl: DEV_ACTIVATE_URL },
  sync: {
    state: "error",
    at: "2026-09-28T16:20:00",
    problems: [
      {
        key: "sync.problem.codeTaken",
        params: { rule: "VIP10", detail: "\"VIP10\": could not create \"VIP10\": Code must be unique. Please try a different code." },
      },
    ],
  },
};

/** Two real codes the discount function cannot tell apart (same 8-hex hash), found deterministically. */
function collidingCodes(): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const code = `LETO${i}`;
    const other = seen.get(codeHash(code));
    if (other) return [other, code];
    seen.set(codeHash(code), code);
  }
}

/** Editor refusals as the save action returns them (harness `?result=`). */
export function devEditorResult(kind: string | null): UiResult | null {
  switch (kind) {
    case "unreadable":
      return { ok: false, reason: "unreadable_config" };
    case "too-many":
      return { ok: false, reason: "too_many_code_rules", count: 21, limit: 20, shopifyLimit: 25 };
    case "collision":
      return { ok: false, reason: "code_hash_collision", codes: [collidingCodes()] };
    case "sync-failed":
      return {
        ok: true,
        message: "saved",
        sync: {
          ok: false,
          problems: [{ key: "sync.problem.rule", params: { rule: "Černý pátek", detail: "\"Černý pátek\": Throttled (3 attempts)" } }],
          warnings: [],
        },
      };
    case "saved":
      return { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] } };
    case "base-changed":
      return { ok: false, reason: "base_changed" };
    case "busy":
      return { ok: false, reason: "busy" };
    case "syncing":
      return { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] }, syncing: { products: 1240 } };
    default:
      return null;
  }
}

export const DEV_EMBED_OFF = { state: "off" as const, activateUrl: DEV_ACTIVATE_URL };
export const DEV_EMBED_ON = { state: "on" as const, activateUrl: DEV_ACTIVATE_URL };

export const DEV_TRY_CART_LINES: TryCartLineView[] = [
  {
    variantId: "gid://shopify/ProductVariant/101",
    productId: "gid://shopify/Product/1",
    title: "Mikina Won",
    variantTitle: "M / černá",
    quantity: 2,
    unitPrice: { CZK: 1290_00, EUR: 52_00 },
  },
  {
    variantId: "gid://shopify/ProductVariant/102",
    productId: "gid://shopify/Product/2",
    title: "Čepice",
    quantity: 1,
    unitPrice: { CZK: 390_00, EUR: 16_00 },
  },
];

/**
 * The REAL engine plan for DEV_TRY_CART_LINES in CZK (Česko) with code VIP10 on
 * 28. 9. 2026 against DEV_OVERVIEW_FIXTURE — the same planTryCart the action
 * runs, on fixture prices instead of Shopify's.
 */
export function devTryCartPlan(locale: "cs" | "en"): CartPlanView {
  return planTryCart(DEV_OVERVIEW_FIXTURE, {
    lines: DEV_TRY_CART_LINES.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      title: line.variantTitle ? `${line.title} (${line.variantTitle})` : line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice.CZK ?? 0,
      collectionIds: [],
    })),
    currency: "CZK",
    countryCode: "CZ",
    codes: ["VIP10"],
    date: "2026-09-28",
    time: "14:00:00",
    shopTimezone: DEV_TIMEZONE,
    locale,
    market: DEV_MARKET_NAMES.cz,
  });
}

// --- F2 states (targeting freshness, Pro gate, checkout preview) ----------------------------

/**
 * The Přehled fixture plus a collection rule with a minimum counted on its own
 * products, and a Pro rule that targets one market and combines with another
 * rule — so the harness shows the targeting line, "Propisuje se", the minimum
 * scope choice and what the Free plan does not run.
 */
export const DEV_F2_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_OVERVIEW_FIXTURE,
  modules: {
    ...DEV_OVERVIEW_FIXTURE.modules,
    codes: {
      rules: [
        ...DEV_OVERVIEW_FIXTURE.modules.codes.rules,
        {
          id: "dev-f2-collection",
          enabled: true,
          name: "Podzimní kolekce 20 %",
          method: "automatic",
          value: { kind: "percentage", percent: 20 },
          target: { kind: "collections", ids: ["gid://shopify/Collection/7"] },
          minimum: { subtotal: { CZK: 2000_00, EUR: 80_00 }, scope: "entitled" },
        },
        {
          id: "dev-f2-market",
          enabled: true,
          name: "Jen Slovensko 5 %",
          method: "automatic",
          value: { kind: "percentage", percent: 5 },
          target: { kind: "order" },
          targeting: { markets: ["sk"] },
          combinesWith: { ruleIds: ["dev-fixture-1"] },
        },
      ],
    },
  },
});

/** What the Free plan does not run of DEV_F2_FIXTURE (the real gate + its sentences). */
export function devGate(locale: "cs" | "en"): { gate: GateNoteView[]; gateOff: string[] } {
  const { stripped } = gateConfigForPlan(DEV_F2_FIXTURE, "free", { now: "2026-09-28T14:00:00" });
  return {
    gate: explainGate(stripped, locale).map((e) => ({ text: e.text, ...(e.ruleId !== undefined ? { ruleId: e.ruleId } : {}) })),
    gateOff: stripped.filter((x) => x.reason === "rule_off" && x.ruleId).map((x) => x.ruleId as string),
  };
}

/** Per-rule facts right after a collection changed in Shopify: the collection rule is being refreshed. */
export const DEV_RULE_SYNC_F2: RuleSyncMap = {
  ...Object.fromEntries(DEV_F2_FIXTURE.modules.codes.rules.map((rule) => [rule.id, "synced" as const])),
  "dev-f2-collection": "refreshing",
};

/** Synced, but the automatic node was switched off in Shopify, and the targeting is being refreshed. */
export const DEV_SIGNALS_F2: AdminSignals = {
  ...DEV_SIGNALS,
  embed: { state: "on", activateUrl: DEV_ACTIVATE_URL },
  sync: { state: "ok", at: "2026-09-28T16:20:00", attention: [{ key: "sync.problem.autoInactive" }] },
  targeting: { state: "refreshing", since: "2026-09-28T16:24:00" },
};

/** Vyzkoušet košík with the warnings checkout differences and sync state give. */
export function devTryCartPlanWarnings(locale: "cs" | "en"): CartPlanView {
  const plan = devTryCartPlan(locale);
  return {
    ...plan,
    warnings: [
      { key: "tryCart.warning.tie", params: { lines: "Čepice" } },
      { key: "tryCart.warning.targeting" },
      { key: "tryCart.warning.notApplied" },
    ],
  };
}

// --- Ochrana marže (MVP 2) ------------------------------------------------------------------

const DEV_C7 = "gid://shopify/Collection/7";
const DEV_C9 = "gid://shopify/Collection/9";

/** Shopify titles of the fixture collections. */
export const DEV_MARGIN_COLLECTION_TITLES: Readonly<Record<string, string>> = {
  [DEV_C7]: "Podzimní kolekce",
  [DEV_C9]: "Doplňky",
};

/**
 * The F2 fixture with margin protection on: minimum margin 20 %, products
 * without a cost price at most 40 % off, and two Pro collection settings
 * (Podzimní kolekce: minimum margin 30 %; Doplňky: at most 10 % without a cost)
 * — run through the real reader.
 */
export const DEV_MARGIN_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_F2_FIXTURE,
  modules: {
    ...DEV_F2_FIXTURE.modules,
    margin: {
      enabled: true,
      global: { minMarginPercent: 20, maxDiscountPercent: 40 },
      perCollection: [
        { collectionId: DEV_C7, minMarginPercent: 30 },
        { collectionId: DEV_C9, maxDiscountPercent: 10 },
      ],
    },
  },
});

interface DevCostVariant {
  productId: string;
  variantId: string;
  title: string;
  /** CZK minor units. */
  price: number;
  /** EUR minor units (Slovensko market price), when the cart fixture uses it. */
  eur?: number;
  /** Cost price in MAJOR units of CZK (the shop currency), as the cost mirror holds it; null = none. */
  cost: number | null;
  collectionIds: string[];
}

/** A small catalogue as the cost mirror knows it (prices, costs, collections). */
const DEV_COST_VARIANTS: DevCostVariant[] = [
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/101", title: "Mikina Won — M / černá", price: 1290_00, eur: 52_00, cost: 900, collectionIds: [DEV_C7] },
  { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/103", title: "Mikina Won — L / černá", price: 1290_00, eur: 52_00, cost: 900, collectionIds: [DEV_C7] },
  { productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/102", title: "Čepice", price: 390_00, eur: 16_00, cost: 300, collectionIds: [DEV_C7] },
  { productId: "gid://shopify/Product/3", variantId: "gid://shopify/ProductVariant/104", title: "Ponožky Won", price: 149_00, eur: 6_00, cost: null, collectionIds: [DEV_C7, DEV_C9] },
  { productId: "gid://shopify/Product/4", variantId: "gid://shopify/ProductVariant/105", title: "Batoh", price: 1990_00, cost: 1100, collectionIds: [] },
  { productId: "gid://shopify/Product/5", variantId: "gid://shopify/ProductVariant/106", title: "Nákrčník", price: 290_00, cost: 250, collectionIds: [] },
  { productId: "gid://shopify/Product/6", variantId: "gid://shopify/ProductVariant/107", title: "Samolepky Won", price: 59_00, cost: null, collectionIds: [] },
];

function marginSettingsView(config: WonDiscountsConfig, opts: { collections: boolean }): MarginSettingsView {
  const m = config.modules.margin;
  return {
    enabled: m.enabled,
    minMarginPercent: m.global.minMarginPercent ?? null,
    maxDiscountPercent: m.global.maxDiscountPercent,
    collections: opts.collections
      ? m.perCollection.map((c) => ({
          collectionId: c.collectionId,
          title: DEV_MARGIN_COLLECTION_TITLES[c.collectionId] ?? c.collectionId,
          minMarginPercent: c.minMarginPercent ?? null,
          maxDiscountPercent: c.maxDiscountPercent ?? null,
        }))
      : [],
  };
}

/**
 * Přehled zásahů for the fixture catalogue: the REAL core marginImpact on the
 * config and the fixture costs (what margin-impact.server.ts computes from the
 * cost mirror in the background), per rule, through the same view the server
 * sends (margin-impact-view.ts; `focusRuleId` = `?rule=`, filtered there).
 */
function devImpactRules(config: WonDiscountsConfig, variants: readonly DevCostVariant[] = DEV_COST_VARIANTS) {
  const byProduct = new Map<string, { variantIds: string[]; collectionIds: Set<string> }>();
  for (const v of variants) {
    const entry = byProduct.get(v.productId) ?? { variantIds: [], collectionIds: new Set<string>() };
    entry.variantIds.push(v.variantId);
    for (const c of v.collectionIds) entry.collectionIds.add(c);
    byProduct.set(v.productId, entry);
  }
  const index = productRuleIndex(
    config,
    [...byProduct].map(([productId, e]) => ({ productId, variantIds: e.variantIds, collectionIds: [...e.collectionIds] })),
  );
  const measured: MarginVariant[] = variants.map((v) => {
    const entry = index.get(v.productId);
    return {
      productId: v.productId,
      variantId: v.variantId,
      title: v.title,
      price: v.price,
      cost: v.cost === null ? null : v.cost * 100,
      ruleRefs: [...(entry?.ruleIds ?? []), ...(entry?.variantRuleIds?.[variantKey(v.variantId)] ?? [])],
      marginRefs: entry?.marginRefs ?? [],
    };
  });
  return impactRulesOf(config, measured, "CZK");
}

export function devMarginImpact(
  config: WonDiscountsConfig,
  opts: { variants?: readonly DevCostVariant[]; focusRuleId?: string | null; status?: MarginImpactView["status"] } = {},
): MarginImpactView {
  const status = opts.status ?? "ready";
  const impact = status === "computing" ? null : devImpactRules(config, opts.variants);
  return impactView({ impact, status }, config, opts.focusRuleId);
}

/**
 * The rule editor's note (ruleMarginImpact on the fixture): `pro` = the count
 * of variants (Pro), else no number (Free); `computing` = nothing computed yet.
 */
export function devRuleMarginImpact(ruleId: string, opts: { pro?: boolean; computing?: boolean } = {}): MarginRuleImpactView | null {
  if (opts.computing) return { state: "computing" };
  const rule = devImpactRules(DEV_MARGIN_FIXTURE).rules.find((r) => r.ruleId === ruleId);
  if (!rule || rule.variants === 0) return null;
  return opts.pro ? { state: "ready", discountClass: rule.discountClass, variants: rule.variants } : { state: "ready", discountClass: rule.discountClass };
}

const DEV_MIRROR_FRESH: CostMirrorView = { state: "fresh", at: "2026-09-28T06:10:00" };

const DEV_COVERAGE: CostCoverageView = {
  variants: 1240,
  variantsWithCost: 1226,
  productsWithoutCost: 8,
  sample: [
    { productId: "gid://shopify/Product/3", title: "Ponožky Won", variantsWithoutCost: 4 },
    { productId: "gid://shopify/Product/6", title: "Samolepky Won", variantsWithoutCost: 3 },
    { productId: "gid://shopify/Product/21", title: "Dárková krabička", variantsWithoutCost: 2 },
    { productId: "gid://shopify/Product/22", title: "Plakát Won 50 × 70 cm", variantsWithoutCost: 1 },
    { productId: "gid://shopify/Product/23", title: "Taška přes rameno", variantsWithoutCost: 1 },
    { productId: "gid://shopify/Product/24", title: "Placka", variantsWithoutCost: 1 },
    { productId: "gid://shopify/Product/25", title: "Dárkový poukaz", variantsWithoutCost: 1 },
    { productId: "gid://shopify/Product/26", title: "Klíčenka", variantsWithoutCost: 1 },
  ],
};

/** A larger catalogue for Přehled zásahů (state `many`): 16 more Mikina Won variants in Podzimní kolekce. */
const DEV_MANY_VARIANTS: DevCostVariant[] = [
  ...DEV_COST_VARIANTS,
  ...["S", "M", "L", "XL"].flatMap((size, i) =>
    ["šedá", "modrá", "zelená", "bílá"].map((color, j) => ({
      productId: "gid://shopify/Product/1",
      variantId: `gid://shopify/ProductVariant/11${i}${j}`,
      title: `Mikina Won — ${size} / ${color}`,
      price: 1290_00,
      cost: 900 + i * 10 + j,
      collectionIds: [DEV_C7],
    })),
  ),
];

/**
 * Ochrana marže as loadMarginScreen hands it over, per harness state:
 *   default          on, costs read this morning, 8 products without a cost;
 *   running          just switched on: the first read of the costs is running (nothing known yet:
 *                    the ceiling-only sentence, audit P2-1; the impact is still being computed);
 *   failed-first     the first read failed (coverage unknown: the ceiling-only sentence);
 *   reauth           the background has no Shopify session (OQ4: "open the app");
 *   zero             every product has a cost;
 *   off              protection off, never read;
 *   stale            the last full read is 2 days old ("Obnovit nákupní ceny");
 *   failed           a later read failed (the costs of the last complete read stay);
 *   too-large        Pro: Podzimní kolekce did not fit the 10 000-product limit (P1-1);
 *   many             Pro: a rule lowered on 19 variants (10 rows shown, the count says all);
 *   impact-updating  Pro: the numbers are being recomputed (the previous ones shown);
 *   impact-computing Pro: nothing computed yet;
 *   gate             Free with collection settings stored (folded, core explainGate).
 * Pro (`plan`) gets the collection settings and Přehled zásahů (core marginImpact,
 * `focusRuleId` = `?rule=`, narrowed like the server does); Free gets `impact: null` (BILL-1).
 */
export function devMarginScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; focusRuleId?: string | null }): MarginScreenData {
  const data = devMarginScreenData(opts);
  const { settings } = data;
  // The same function as the home tile, on the screen's own facts.
  const status = marginStatus(
    { enabled: settings.enabled, minMarginPercent: settings.minMarginPercent, maxDiscountPercent: settings.maxDiscountPercent, productsWithoutCost: data.coverage ? data.coverage.productsWithoutCost : null, mirror: data.mirror, ...(data.tooLarge.length > 0 ? { tooLarge: data.tooLarge } : {}) },
    DEV_SYNC_OK,
  );
  return { ...data, status };
}

function devMarginScreenData(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; focusRuleId?: string | null }): MarginScreenData {
  const { plan, state } = opts;
  const pro = plan === "pro";
  const collections = pro || state === "gate";
  const impact = (o: Parameters<typeof devMarginImpact>[1] = {}) => (pro ? devMarginImpact(DEV_MARGIN_FIXTURE, { focusRuleId: opts.focusRuleId, ...o }) : null);
  const base: MarginScreenData = {
    plan,
    shopCurrency: "CZK",
    configVersion: "dev-config-version",
    settings: marginSettingsView(DEV_MARGIN_FIXTURE, { collections }),
    mirror: DEV_MIRROR_FRESH,
    coverage: DEV_COVERAGE,
    impact: impact(),
    gateNotes: [],
    tooLarge: [],
  };
  if (state === "gate" && !pro) {
    const { stripped } = gateConfigForPlan(DEV_MARGIN_FIXTURE, "free", { now: "2026-09-28T14:00:00" });
    base.gateNotes = explainGate(
      stripped.filter((x) => x.capability === "margin_per_collection"),
      opts.locale,
    ).map((e) => ({ text: e.text }));
  }
  switch (state) {
    case "running":
      return { ...base, mirror: { state: "running", done: 340, total: 1240, since: "2026-09-28T13:55:00" }, coverage: null, impact: impact({ status: "computing" }) };
    case "failed-first":
      return {
        ...base,
        mirror: {
          state: "failed",
          at: "2026-09-28T06:10:00",
          problems: [{ key: "margin.mirror.readFailed" }, { key: "margin.mirror.detail", params: { detail: "costs.read: Throttled (3 attempts)" } }],
        },
        coverage: null,
        impact: impact({ status: "computing" }),
      };
    case "reauth":
      return { ...base, mirror: { state: "failed", at: "2026-09-28T06:10:00", problems: [{ key: "margin.mirror.reauth" }] } };
    case "zero": {
      const withCosts = DEV_COST_VARIANTS.map((v) => ({ ...v, cost: v.cost ?? Math.round(v.price / 200) }));
      return {
        ...base,
        coverage: { variants: 1240, variantsWithCost: 1240, productsWithoutCost: 0, sample: [] },
        impact: impact({ variants: withCosts }),
      };
    }
    case "off":
      return {
        ...base,
        settings: { ...base.settings, enabled: false },
        mirror: { state: "off" },
        coverage: null,
        impact: null,
      };
    case "stale":
      return { ...base, mirror: { state: "stale", at: "2026-09-26T06:10:00" } };
    case "failed":
      return {
        ...base,
        mirror: {
          state: "failed",
          at: "2026-09-28T06:10:00",
          problems: [{ key: "margin.mirror.readFailed" }, { key: "margin.mirror.detail", params: { detail: "costs.read: Throttled (3 attempts)" } }],
        },
      };
    case "too-large":
      // What checkout runs: the collection's values folded into the whole store's (the server counts the impact the same way).
      return {
        ...base,
        tooLarge: pro ? [{ collectionId: DEV_C7, title: "Podzimní kolekce", count: null }] : [],
        impact: pro ? devMarginImpact(foldMarginCollections(DEV_MARGIN_FIXTURE, new Set([DEV_C7])) as WonDiscountsConfig, { focusRuleId: opts.focusRuleId }) : null,
      };
    case "many":
      return { ...base, impact: impact({ variants: DEV_MANY_VARIANTS }) };
    case "impact-updating":
      return { ...base, impact: impact({ status: "updating" }) };
    case "impact-computing":
      return { ...base, impact: impact({ status: "computing" }) };
    default:
      return base;
  }
}

/** Margin page action results (harness `?result=`). */
export function devMarginResult(kind: string | null, locale: "cs" | "en" = "cs"): UiResult | null {
  switch (kind) {
    case "refreshed":
      return { ok: true, message: "synced", syncing: { costs: true } };
    case "saved":
      return { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] }, syncing: { costs: true } };
    case "invalid":
      return {
        ok: false,
        reason: "invalid",
        errors: [
          { field: "minMarginPercent", key: "margin.error.percent", params: { max: 95 } },
          { field: "collectionMax[1]", key: "margin.error.percent", params: { max: 100 } },
        ],
        // B14: what the refused form posted comes back, the screen shows it again (also the refused 150 and 120).
        values: {
          enabled: ["on"],
          minMarginPercent: ["150"],
          maxDiscountPercent: ["35"],
          "collectionId[]": [DEV_C7, DEV_C9],
          "collectionMin[]": ["30", ""],
          "collectionMax[]": ["", "120"],
        },
      };
    case "unreadable":
      return { ok: false, reason: "unreadable_config" };
    case "fixes": {
      // What the core sanitizer reports when a percent with two decimals got past the form
      // (it keeps one decimal, rounded to the stricter side): the save's `fixes`, worded from
      // code + params in the admin language exactly as the server's savedResult words them.
      const { issues } = sanitizeConfig({
        ...DEV_MARGIN_FIXTURE,
        modules: { ...DEV_MARGIN_FIXTURE.modules, margin: { ...DEV_MARGIN_FIXTURE.modules.margin, global: { minMarginPercent: 12.55, maxDiscountPercent: 40 } } },
      });
      return {
        ok: true,
        message: "saved",
        fixes: wordIssues(
          issues.filter((i) => i.path === "modules.margin" || i.path.startsWith("modules.margin.")),
          locale,
        ),
        sync: { ok: true, problems: [], warnings: [] },
      };
    }
    default:
      return null;
  }
}

/**
 * The Přehled card (AdminSignals.margin, filled by loadStoreSignals): `running` = the
 * first read of the costs (no green "Běží", the ceiling-only line), `reauth` = the
 * background has no session (OQ4), `too-large` = a Pro collection over the limit.
 */
export function devMarginOverview(state: "fresh" | "stale" | "off" | "running" | "reauth" | "too-large"): MarginOverviewView {
  if (state === "off") return { enabled: false, minMarginPercent: null, maxDiscountPercent: 50, productsWithoutCost: null, mirror: { state: "off" } };
  if (state === "running") {
    return { enabled: true, minMarginPercent: 20, maxDiscountPercent: 40, productsWithoutCost: null, mirror: { state: "running", done: 340, total: 1240, since: "2026-09-28T13:55:00" } };
  }
  if (state === "reauth") {
    return {
      enabled: true,
      minMarginPercent: 20,
      maxDiscountPercent: 40,
      productsWithoutCost: DEV_COVERAGE.productsWithoutCost,
      mirror: { state: "failed", at: "2026-09-28T06:10:00", problems: [{ key: "margin.mirror.reauth" }] },
    };
  }
  if (state === "too-large") {
    return {
      enabled: true,
      minMarginPercent: 20,
      maxDiscountPercent: 40,
      productsWithoutCost: DEV_COVERAGE.productsWithoutCost,
      mirror: DEV_MIRROR_FRESH,
      tooLarge: [{ collectionId: DEV_C7, title: "Podzimní kolekce", count: null }],
    };
  }
  return {
    enabled: true,
    minMarginPercent: 20,
    maxDiscountPercent: 40,
    productsWithoutCost: DEV_COVERAGE.productsWithoutCost,
    mirror: state === "stale" ? { state: "stale", at: "2026-09-26T06:10:00" } : DEV_MIRROR_FRESH,
  };
}

/** A shop-currency → EUR rate estimated from market prices (what try-cart does when the cart is not in CZK). */
const DEV_ESTIMATED_RATE = 0.04;

/**
 * Vyzkoušet košík with margin protection: the Slovensko market (EUR) cart of
 * Mikina Won × 2, Čepice and Ponožky Won × 2 against DEV_MARGIN_FIXTURE — the
 * SAME planTryCart the action runs, on fixture prices and the fixture cost
 * prices (what try-cart.server.ts reads from VariantCost), converted by a rate
 * ESTIMATED from market prices (the cart is not in the shop currency).
 */
export function devTryCartPlanMargin(locale: "cs" | "en"): CartPlanView {
  const cart = [
    { v: DEV_COST_VARIANTS[0], quantity: 2 },
    { v: DEV_COST_VARIANTS[2], quantity: 1 },
    { v: DEV_COST_VARIANTS[3], quantity: 2 },
  ];
  return planTryCart(DEV_MARGIN_FIXTURE, {
    lines: cart.map(({ v, quantity }) => ({
      variantId: v.variantId,
      productId: v.productId,
      title: v.title,
      quantity,
      unitPrice: v.eur ?? 0,
      collectionIds: v.collectionIds,
      ...(v.cost !== null ? { unitCost: v.cost, unitCostCurrency: "CZK" } : {}),
    })),
    currency: "EUR",
    countryCode: "SK",
    codes: [],
    date: "2026-09-28",
    time: "14:00:00",
    shopTimezone: DEV_TIMEZONE,
    locale,
    market: DEV_MARKET_NAMES.sk,
    shopCurrency: "CZK",
    shopToCartRate: DEV_ESTIMATED_RATE,
    rateEstimated: true,
  });
}

/** The cart lines of devTryCartPlanMargin, for the cart block. */
export const DEV_TRY_CART_MARGIN_LINES: TryCartLineView[] = [
  { ...DEV_TRY_CART_LINES[0], quantity: 2 },
  DEV_TRY_CART_LINES[1],
  {
    variantId: "gid://shopify/ProductVariant/104",
    productId: "gid://shopify/Product/3",
    title: "Ponožky Won",
    quantity: 2,
    unitPrice: { CZK: 149_00, EUR: 6_00 },
  },
];

// --- Množstevní slevy, Vzhled, Nastavení (MVP 3) ----------------------------------------------------

const DEV_P1 = "gid://shopify/Product/1";

/**
 * The F2 fixture with quantity tiers: a whole-store set (od 3 ks −10 %, od 5
 * ks −15 %, od 10 ks −20 %, variants of a product counted together), a Pro set
 * for Mikina Won and Podzimní kolekce (an amount per item, counted across the
 * cart; its top tier has no EUR value — MKT-1), margin protection on and the
 * "highlight" look — run through the real reader.
 */
export const DEV_TIERS_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_F2_FIXTURE,
  modules: {
    ...DEV_F2_FIXTURE.modules,
    margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 40 }, perCollection: [] },
    tiers: {
      sets: [
        {
          id: "global",
          scope: "global",
          countAcross: "product",
          breaks: [
            { minQty: 3, percent: 10 },
            { minQty: 5, percent: 15 },
            { minQty: 10, percent: 20 },
          ],
        },
        {
          id: "t_devautumn",
          scope: { productIds: [DEV_P1], collectionIds: [DEV_C7] },
          countAcross: "cart",
          breaks: [
            { minQty: 2, amountOff: { CZK: 30_00, EUR: 1_20 } },
            { minQty: 6, amountOff: { CZK: 60_00 } },
          ],
        },
      ],
    },
  },
  storefront: { appearancePreset: "highlight", cardPricesEnabled: false },
});

/** Shopify titles of the fixture's scoped products / collections. */
const DEV_TIER_TITLES: ReadonlyMap<string, string> = new Map([
  [DEV_P1, "Mikina Won"],
  [DEV_C7, "Podzimní kolekce"],
  ["gid://shopify/Product/21", "Dárkový poukaz"],
  ["gid://shopify/Product/22", "Vzorek zdarma"],
  ["gid://shopify/Collection/23", "Tištěné katalogy"],
  ["gid://shopify/Collection/24", "Obaly"],
]);

/** ?state=exceptions: a second exception — four things picked ("a další 2"), no quantity discount for them. */
const DEV_TIERS_EXCEPTIONS_FIXTURE: WonDiscountsConfig = {
  ...DEV_TIERS_FIXTURE,
  modules: {
    ...DEV_TIERS_FIXTURE.modules,
    tiers: {
      ...DEV_TIERS_FIXTURE.modules.tiers,
      sets: [
        ...DEV_TIERS_FIXTURE.modules.tiers.sets,
        { id: "t_devnone", scope: { productIds: ["gid://shopify/Product/21", "gid://shopify/Product/22"], collectionIds: ["gid://shopify/Collection/23", "gid://shopify/Collection/24"] }, countAcross: "product", breaks: [] },
      ],
    },
  },
};

/** The live theme as readThemeLook reads it (tmp/e2e-themes Horizon / Dawn settings_data). */
export const DEV_TOKENS_HORIZON: ThemeTokensView = {
  themeName: "Horizon",
  fontBody: "Inter",
  fontHeading: "Inter",
  colorText: "#000000",
  colorBackground: "#ffffff",
  colorAccent: null,
  radius: 4,
  fontSize: 14,
};
export const DEV_TOKENS_DAWN: ThemeTokensView = {
  themeName: "Dawn",
  fontBody: "Assistant",
  fontHeading: "Assistant",
  colorText: "#121212",
  colorBackground: "#ffffff",
  colorAccent: "#c0392b",
  radius: 0,
  fontSize: 16,
};

/** The accent is the block's own setting (readThemeLook): no block on the product page → none. */
function devTokens(theme: string | null | undefined, block: TiersBlockView): ThemeTokensView {
  const tokens = theme === "dawn" ? DEV_TOKENS_DAWN : DEV_TOKENS_HORIZON;
  return block.state === "on" ? tokens : { ...tokens, colorAccent: null };
}

/** A real product for the preview (readPreviewProduct): the shop's money format included. */
export const DEV_PREVIEW_PRODUCT: PreviewProductView = {
  productId: DEV_P1,
  title: "Mikina Won",
  unitPrice: 790_00,
  currency: "CZK",
  url: `https://${DEV_SHOP}/products/mikina-won`,
  moneyFormat: "{{amount_with_comma_separator}} Kč",
};

const DEV_ADD_BLOCK_URL = tiersBlockAddUrl(DEV_SHOP, "dev-api-key");

function devBlock(state: string | null): TiersBlockView {
  if (state === "empty" || state === "block-off") return { state: "off", addUrl: DEV_ADD_BLOCK_URL };
  if (state === "block-unknown") return { state: "unknown", addUrl: DEV_ADD_BLOCK_URL };
  // Audit P3-8: the block only in an alternate product template (most products do not use it).
  if (state === "alternate") return { state: "off", addUrl: DEV_ADD_BLOCK_URL, alternates: ["product.bundle"] };
  if (state === "no-scope") return { state: "no_scope" };
  return { state: "on", themeName: "Horizon" };
}

function devStorefront(state: string | null): StorefrontSyncView {
  if (state === "empty") return { state: "missing" };
  if (state === "pending") return { state: "pending" };
  if (state === "failed" || state === "failed-first") {
    return {
      state: "failed",
      at: "2026-09-28T16:20:00",
      problems: [{ key: "sync.problem.storefrontConfig", params: { detail: "metafieldsSet: Throttled (3 attempts)" } }],
      // failed-first: never written before — no previous table on the site (review fix 7).
      previous: state === "failed",
    };
  }
  return { state: "synced", at: "2026-09-28T16:20:00" };
}

/**
 * Množstevní slevy as loadTiersScreen hands it over (the same pure
 * tiersScreenFacts), per harness state:
 *   default        Free: the whole-store set, the Pro set stored (not in force:
 *                  the gate sentences), margin on, a product rule that competes,
 *                  the table on Horizon's product page, the storefront current;
 *   plan=pro       the Pro set editable (MKT-1 note: its top tier has no EUR);
 *   empty          a new shop: no set (the preview shows an example), the table
 *                  not on the product page (the deep link), nothing written yet;
 *   dawn           Dawn's tokens + a block accent; failed / pending — the
 *                  storefront config; block-unknown / no-scope — the block check.
 */
export function devTiersScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; theme?: string | null; accent?: string | null; embed?: string | null; shared?: boolean }): TiersScreenData {
  const base = devSharedMarket(opts.state === "empty" ? DEV_EMPTY_FIXTURE : opts.state === "exceptions" ? DEV_TIERS_EXCEPTIONS_FIXTURE : DEV_TIERS_FIXTURE, opts.shared === true);
  // ?accent=green: a stored ready-made colour; ?embed=off | noscope: Won on the storefront is off / not readable.
  const accent = ACCENT_PRESETS.find((a) => a === opts.accent);
  const config = accent ? { ...base, storefront: { ...base.storefront, accent } } : base;
  return {
    plan: opts.plan,
    shopCurrency: "CZK",
    configVersion: "dev-config-version",
    currencies: currencyViews(config.markets, { marketNames: DEV_MARKET_NAMES }),
    ...tiersScreenFacts(config, { plan: opts.plan, locale: opts.locale, titles: DEV_TIER_TITLES, syncable: true }),
    block: devBlock(opts.state),
    // ?state=sync-failed: the last write to Shopify failed — the section says "Vyžaduje pozornost", as the home tile does.
    status: tiersSectionStatus(config, opts.plan, devBlock(opts.state), opts.state === "sync-failed" ? DEV_SYNC_FAILED : DEV_SYNC_OK),
    storefront: devStorefront(opts.state),
    preview: {
      tokens: devTokens(opts.theme === "dawn" || opts.state === "dawn" ? "dawn" : opts.theme, devBlock(opts.state)),
      preset: presetOf(config.storefront.appearancePreset),
      product: DEV_PREVIEW_PRODUCT,
      // ?state=custom: a stored Pro custom look and a changed text — the preview shows both (the gate drops the look on Free).
      look: previewLookOf(opts.state === "custom" ? DEV_CUSTOM_LOOK_FIXTURE : config, opts.plan),
    },
    // Pro only (BILL-1): products per Pro set as the last sync wrote them (tierProductCounts).
    productsWithSets: opts.plan === "pro" && opts.state !== "empty" ? { t_devautumn: 14 } : null,
    outletWithAnything: opts.state === "outlet",
    embed: opts.embed === "off" ? DEV_EMBED_OFF : opts.embed === "noscope" ? { state: "no_scope", activateUrl: null } : DEV_EMBED_ON,
  };
}

/** Množstevní slevy action results (harness `?result=`). */
export function devTiersResult(kind: string | null): UiResult | null {
  switch (kind) {
    case "saved":
      return { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] } };
    case "invalid":
      return {
        ok: false,
        reason: "invalid",
        errors: [
          { field: TIERS_FIELD.percent("global", "r1"), key: "tiers.error.notAscending", params: { min: 3 } },
          { field: TIERS_FIELD.min("global", "r2"), key: "tiers.error.minTaken", params: { min: 5 } },
        ],
      };
    case "invalid-exception":
      // A refusal about one exception: the page opens that exception (the others stay rows).
      return { ok: false, reason: "invalid", errors: [{ field: TIERS_FIELD.min("t_devautumn", "r1"), key: "tiers.error.minTaken", params: { min: 2 } }] };
    case "unreadable":
      return { ok: false, reason: "unreadable_config" };
    case "too-large":
      // The server's refusal of tiers over the checkout's room for them: shown at the room-for-tiers line.
      return { ok: false, reason: "invalid", errors: [{ field: TIERS_FIELD.set, key: "tiers.error.tooLarge", params: { percent: 112 } }] };
    default:
      return null;
  }
}

/** DEV_TIERS_FIXTURE with a Pro custom look and one changed storefront text (the previews of ?state=custom). */
const DEV_CUSTOM_LOOK_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_TIERS_FIXTURE,
  storefront: { ...DEV_TIERS_FIXTURE.storefront, custom: { vars: { accent: "#0a7d4f", tint: "#f2fbf6", radius: 4 }, css: ".won-tiers__heading { text-transform: uppercase; }" } },
  locales: { ...DEV_TIERS_FIXTURE.locales, cs: { "tiers.heading": "Kup víc, plať míň" } },
});

/** Vzhled as loadAppearanceScreen hands it over; `empty` = no set yet (the looks show an example). */
export function devAppearanceScreen(opts: { plan: "free" | "pro"; state: string | null; theme?: string | null }): AppearanceScreenData {
  const config = opts.state === "empty" ? DEV_EMPTY_FIXTURE : DEV_TIERS_FIXTURE;
  return {
    plan: opts.plan,
    configVersion: "dev-config-version",
    preset: presetOf(config.storefront.appearancePreset),
    tokens: devTokens(opts.theme, devBlock(opts.state)),
    sample: sampleSet(gateConfigForPlan(config, opts.plan).config),
    product: DEV_PREVIEW_PRODUCT,
    block: devBlock(opts.state),
    embed: opts.state === "empty" ? DEV_EMBED_OFF : DEV_EMBED_ON,
    // MVP 7: ?state=custom = a custom look, card prices on and a changed text; ?state=issue = stored CSS that cannot be used.
    cardPrices: opts.state === "custom",
    custom:
      opts.state === "custom" || opts.state === "issue"
        ? { accent: "#0a7d4f", line: "", tint: "#f2fbf6", radius: "4", css: opts.state === "issue" ? ".a{background:url(x)}" : ".won-tiers__heading { text-transform: uppercase; }" }
        : { accent: "", line: "", tint: "", radius: "", css: "" },
    customIssue: opts.state === "issue" ? "forbidden" : null,
    texts: storefrontTextKeys().map((key) => {
      const d = storefrontTextDefaults();
      return {
        key,
        defaults: { cs: d.cs[key] ?? "", sk: d.sk[key] ?? "", en: d.en[key] ?? "" },
        values: { cs: opts.state === "custom" && key === "tiers.heading" ? "Kup víc, plať míň" : "", sk: "", en: "" },
      };
    }),
    cardBlockUrl: "https://won-dev.myshopify.com/admin/themes/current/editor?template=collection&addAppBlockId=dev/card_tiers&target=mainSection",
    aiPrompt: aiPrompt(),
    previewLook: previewLookOf(opts.state === "custom" ? DEV_CUSTOM_LOOK_FIXTURE : config, opts.plan),
  };
}

/** Nastavení: the switches as stored (`changed` = two switched off, as a shop may have them). */
export function devSettingsScreen(opts: { plan: "free" | "pro"; state: string | null; shared?: boolean; fallback?: boolean; highest?: boolean }): SettingsScreenData {
  const c = DEFAULT_CONFIG.engine.combination;
  const combination = {
    outletWithAnything: c.outletWithAnything,
    productWithOrder: c.productWithOrder,
    productWithShipping: c.productWithShipping,
    orderWithShipping: c.orderWithShipping,
  };
  return {
    plan: opts.plan,
    configVersion: "dev-config-version",
    currencies: currencyViews(devSharedMarket(DEV_OVERVIEW_FIXTURE, opts.shared === true).markets, { marketNames: DEV_MARKET_NAMES }),
    combination: opts.state === "changed" ? { ...combination, productWithOrder: false, productWithShipping: false } : combination,
    // ?fallback=1: "a customer from a country in no market gets the lowest amount" is on.
    unknownMarketLowest: opts.fallback === true,
    // ?highest=1: minimum spend and free shipping take the highest amount, the rest the lowest.
    unknownMarketHighest: opts.highest === true ? ["minimum", "shipping"] : [],
    // The same shop as the home page's ?state=modules: the discounts, rewards and tiers of the three fixtures.
    markets: marketRows(
      devSharedMarket({ ...DEV_OVERVIEW_FIXTURE, modules: { ...DEV_OVERVIEW_FIXTURE.modules, rewards: DEV_REWARDS_FIXTURE.modules.rewards, tiers: DEV_TIERS_FIXTURE.modules.tiers } }, opts.shared === true),
      { plan: opts.plan, names: DEV_MARKET_NAMES, locale: "cs" },
    ),
  };
}

/** The Přehled card (AdminSignals.tiers): the whole-store set in force, the table not on the product page yet. */
export function devTiersOverview(state: "on" | "off" | "empty", plan: "free" | "pro" = "free"): TiersOverviewView {
  return tiersOverviewOf(state === "empty" ? DEV_EMPTY_FIXTURE : DEV_TIERS_FIXTURE, plan, state === "on" ? devBlock(null) : devBlock("block-off"));
}

/** The cart of devTryCartPlanTiers: 4 caps reach the whole-store "od 3 ks −10 %", 2 hoodies are in the Pro set. */
export const DEV_TRY_CART_TIER_LINES: TryCartLineView[] = [
  { ...DEV_TRY_CART_LINES[0]!, quantity: 2 },
  { ...DEV_TRY_CART_LINES[1]!, quantity: 4 },
];

/**
 * Vyzkoušet košík with quantity tiers: the SAME planTryCart the action runs on
 * DEV_TIERS_FIXTURE gated for the plan (BILL-1) — on Free the hoodie's Pro set is
 * inert (no tier, K1), on Pro it gets that set through the product's tierRef;
 * the caps get the whole-store set. Margin protection is on, no cost is known
 * (the percent ceiling of 40 % does not lower a tier here).
 */
export function devTryCartPlanTiers(locale: "cs" | "en", plan: "free" | "pro" = "free"): CartPlanView {
  const gated = gateConfigForPlan(DEV_TIERS_FIXTURE, plan, { now: "2026-09-28T14:00:00" }).config;
  return planTryCart(gated, {
    lines: DEV_TRY_CART_TIER_LINES.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      title: line.variantTitle ? `${line.title} (${line.variantTitle})` : line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice.CZK ?? 0,
      collectionIds: [],
    })),
    currency: "CZK",
    countryCode: "CZ",
    codes: [],
    date: "2026-09-28",
    time: "14:00:00",
    shopTimezone: DEV_TIMEZONE,
    locale,
    market: DEV_MARKET_NAMES.cz,
    shopCurrency: "CZK",
  });
}

// --- Odměny (MVP 4) ---------------------------------------------------------------------------------------------

const DEV_GIFT_SOCKS = "gid://shopify/ProductVariant/49000000000001";
const DEV_GIFT_CAP = "gid://shopify/ProductVariant/49000000000002";
const DEV_GIFT_BAG = "gid://shopify/ProductVariant/49000000000003";
const DEV_GIFT_MUG = "gid://shopify/ProductVariant/49000000000004";

/** Shopify names of the gift variants (rewards.server.ts giftTitles). */
const DEV_GIFT_TITLES: ReadonlyMap<string, string> = new Map([
  [DEV_GIFT_SOCKS, "Ponožky Won — M"],
  [DEV_GIFT_CAP, "Kšiltovka Won"],
  [DEV_GIFT_BAG, "Plátěná taška Won"],
  [DEV_GIFT_MUG, "Hrnek Won"],
]);

/**
 * The rewards fixture: free shipping from 1 000 Kč / 40 € and a ladder — socks
 * from 1 500 Kč (EUR missing: MKT-1 note), and on Pro a choice of 3 from
 * 3 000 Kč with a fallback — run through the real reader.
 */
export const DEV_REWARDS_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_F2_FIXTURE,
  modules: {
    ...DEV_F2_FIXTURE.modules,
    rewards: {
      freeShipping: { threshold: { CZK: 1000_00, EUR: 40_00 } },
      gifts: [
        { id: "gift-socks", threshold: { CZK: 1500_00 }, choices: [DEV_GIFT_SOCKS] },
        { id: "gift-choice", threshold: { CZK: 3000_00, EUR: 120_00 }, choices: [DEV_GIFT_CAP, DEV_GIFT_BAG, DEV_GIFT_MUG], fallbackVariantId: DEV_GIFT_SOCKS },
      ],
      countOtherDiscounts: false,
    },
  },
});

/**
 * The same shop with discount steps (Milníky): 5 % off the order from 2 000 Kč / 80 €, and 500 Kč / 20 € off
 * from 5 000 Kč / 200 € — the order rules with the "ms-" prefix that core milestones.ts reads as steps.
 */
export const DEV_MILESTONES_FIXTURE: WonDiscountsConfig = readStoredConfig({
  ...DEV_REWARDS_FIXTURE,
  modules: {
    ...DEV_REWARDS_FIXTURE.modules,
    codes: {
      rules: [
        ...DEV_REWARDS_FIXTURE.modules.codes.rules,
        { id: "ms-five", enabled: true, name: "", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" }, minimum: { subtotal: { CZK: 2000_00, EUR: 80_00 }, scope: "cart" } },
        { id: "ms-fixed", enabled: true, name: "", method: "automatic", value: { kind: "fixed", amount: { CZK: 500_00, EUR: 20_00 } }, target: { kind: "order" }, minimum: { subtotal: { CZK: 5000_00, EUR: 200_00 }, scope: "cart" } },
      ],
    },
  },
});

/**
 * Milníky as loadRewardsScreen hands it over (the same pure rewardsScreenFacts):
 *   default     the rewards stored BEFORE Milníky (free shipping, two gift tiers) read as three steps; on Free the
 *               third is past the limit of each market it has an amount for (shown, editable, not in force there);
 *   plan=pro    every step editable, the choice of 3 gifts;
 *   discounts   the same ladder with two discount steps (a percent and an amount): five steps;
 *   empty       a new shop: nothing set, the app embed off;
 *   embed-draft | embed-unknown | embed-no-scope   the other states of the app embed check (each has its own
 *               sentence and action on the page).
 */
export function devRewardsScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; shared?: boolean }): RewardsScreenData {
  const config = devSharedMarket(opts.state === "empty" ? DEV_EMPTY_FIXTURE : opts.state === "discounts" ? DEV_MILESTONES_FIXTURE : DEV_REWARDS_FIXTURE, opts.shared === true);
  return {
    plan: opts.plan,
    configVersion: "dev-config-version",
    currencies: currencyViews(config.markets, { marketNames: DEV_MARKET_NAMES }),
    ...rewardsScreenFacts(config, { plan: opts.plan, locale: opts.locale, titles: DEV_GIFT_TITLES }),
    status: rewardsSectionStatus(config, opts.plan, "CZK", DEV_SYNC_OK),
    embed:
      opts.state === "empty"
        ? DEV_EMBED_OFF
        : opts.state === "embed-draft"
          ? { state: "draft_only", activateUrl: DEV_EMBED_OFF.activateUrl }
          : opts.state === "embed-unknown"
            ? { state: "unknown", activateUrl: DEV_EMBED_OFF.activateUrl }
            : opts.state === "embed-no-scope"
              ? { state: "no_scope", activateUrl: DEV_EMBED_OFF.activateUrl }
              : DEV_EMBED_ON,
    cartBlockAddUrl: cartBlockAddUrl(DEV_SHOP, "dev-api-key"),
    placements: placementLinks(DEV_SHOP, "dev-api-key", REWARDS_PROGRESS_BLOCK_HANDLE),
    // The cart block and the top bar are there, the ladder is on no product page yet; a new shop has nothing; the
    // theme could not be read (no scope) → nothing is known.
    placed: opts.state === "embed-no-scope" ? {} : opts.state === "empty" ? { cartBlock: false, rewardsProduct: false, rewardsHome: false, topBarRewards: false } : { cartBlock: true, rewardsProduct: false, rewardsHome: false, topBarRewards: true },
  };
}

/** Milníky action results (harness `?result=`). */
export function devRewardsResult(kind: string | null): UiResult | null {
  if (kind === "saved") return { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] } };
  if (kind === "invalid") {
    return {
      ok: false,
      reason: "invalid",
      errors: [
        { field: MS_FIELD.amount("gift-socks", "EUR"), key: "rewards.error.amount" },
        { field: MS_FIELD.choice("gift-socks"), key: "rewards.error.giftChoice" },
      ],
    };
  }
  // A form with more steps than the plan runs (an older client, a crafted request) — the refusal is shown at the list.
  if (kind === "too-many") return { ok: false, reason: "invalid", errors: [{ field: MS_FIELD.step, key: "milestones.error.limit", params: { max: 6, pro: 6 } }] };
  if (kind === "limit-free") return { ok: false, reason: "invalid", errors: [{ field: MS_FIELD.step, key: "milestones.error.limitFree", params: { max: 2, pro: 6 } }] };
  return null;
}

/**
 * Vyzkoušet košík with rewards: the SAME planTryCart the action runs on
 * DEV_REWARDS_FIXTURE gated for the plan, with the gift candidates the action
 * reads (each tier's first variant, fixture prices). Free: 2 hoodies + a cap
 * (2 970 Kč) reach free shipping and the socks; the second threshold is Pro.
 * Pro: 3 hoodies + a cap (4 260 Kč) reach both — the second offers a choice of 3.
 */
export function devTryCartPlanRewards(locale: "cs" | "en", plan: "free" | "pro" = "free"): CartPlanView {
  const gated = gateConfigForPlan(DEV_REWARDS_FIXTURE, plan, { now: "2026-09-28T14:00:00" }).config;
  const prices: Readonly<Record<string, number>> = { [DEV_GIFT_SOCKS]: 99_00, [DEV_GIFT_CAP]: 249_00 };
  const giftCandidates = new Map(
    gated.modules.rewards.gifts.map((tier) => {
      const variantId = tier.choices[0]!;
      const line = {
        variantId,
        productId: `gid://shopify/Product/${variantId.split("/").pop()}`,
        title: DEV_GIFT_TITLES.get(variantId) ?? variantId,
        quantity: 1,
        unitPrice: prices[variantId] ?? 0,
        collectionIds: [],
        giftTierId: tier.id,
        choices: tier.choices.length,
      };
      return [tier.id, line] as const;
    }),
  );
  return planTryCart(gated, {
    lines: devTryCartRewardLines(plan).map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      title: line.variantTitle ? `${line.title} (${line.variantTitle})` : line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice.CZK ?? 0,
      collectionIds: [],
    })),
    currency: "CZK",
    countryCode: "CZ",
    codes: [],
    date: "2026-09-28",
    time: "14:00:00",
    shopTimezone: DEV_TIMEZONE,
    locale,
    market: DEV_MARKET_NAMES.cz,
    shopCurrency: "CZK",
    giftCandidates,
  });
}

/** The cart of devTryCartPlanRewards. */
export function devTryCartRewardLines(plan: "free" | "pro"): TryCartLineView[] {
  return [{ ...DEV_TRY_CART_LINES[0]!, quantity: plan === "pro" ? 3 : 2 }, DEV_TRY_CART_LINES[1]!];
}

// --- Výprodej (MVP 5) --------------------------------------------------------------------------------------

const DEV_OUTLET_TITLES = new Map([
  ["gid://shopify/ProductVariant/7001", "Mikina Won — L"],
  ["gid://shopify/ProductVariant/7002", "Kšiltovka Won"],
  ["gid://shopify/ProductVariant/7003", "Ponožky Won — 39–42"],
  ["gid://shopify/ProductVariant/7004", "Taška Won"],
]);

type DevRun = Parameters<typeof outletRunView>[0];
type DevEvent = Parameters<typeof outletRunView>[1][number];

function devRun(id: string, variant: number, over: Partial<DevRun>): DevRun {
  return {
    id,
    shop: DEV_SHOP,
    productId: `gid://shopify/Product/${variant - 1000}`,
    variantId: `gid://shopify/ProductVariant/${variant}`,
    quota: 10,
    percent: 30,
    endsAt: null,
    priceListIds: "[]",
    showBadge: true,
    status: "active",
    endReason: null,
    sold: 0,
    returned: 0,
    returnPending: 0,
    backup: JSON.stringify({ currency: "CZK", variant: { price: 1490_00, compareAt: null }, lists: [] }),
    sale: JSON.stringify({ currency: "CZK", variant: { price: 1043_00, compareAt: 1490_00 }, lists: [] }),
    error: null,
    attempts: 0,
    nextAttemptAt: null,
    createdAt: new Date("2026-09-20T08:00:00Z"),
    startedAt: new Date("2026-09-20T08:00:05Z"),
    endedAt: null,
    updatedAt: new Date("2026-09-27T10:00:00Z"),
    ...over,
  } as DevRun;
}

function devEvent(runId: string, kind: string, at: string, qty = 0, detail?: unknown): DevEvent {
  return { id: `${runId}-${kind}-${at}`, shop: DEV_SHOP, runId, kind, qty, orderId: null, lineId: null, key: `${kind}:${runId}:${at}`, detail: detail === undefined ? null : JSON.stringify(detail), at: new Date(at) } as DevEvent;
}

const DEV_OUTLET_RUNS: DevRun[] = [
  devRun("run-hoodie", 7001, {
    sold: 7,
    returned: 1,
    endsAt: new Date("2026-10-05T22:00:00Z"),
    priceListIds: JSON.stringify(["gid://shopify/PriceList/1"]),
    backup: JSON.stringify({ currency: "CZK", variant: { price: 1490_00, compareAt: null }, lists: [{ id: "gid://shopify/PriceList/1", currency: "EUR", price: 59_00, compareAt: null }] }),
  }),
  devRun("run-cap", 7002, { quota: 5, percent: 50, sold: 6, status: "ending", endReason: "quota", backup: JSON.stringify({ currency: "CZK", variant: { price: 399_00, compareAt: null }, lists: [] }), sale: JSON.stringify({ currency: "CZK", variant: { price: 200_00, compareAt: 399_00 }, lists: [] }), error: "end: HTTP 503", nextAttemptAt: new Date("2026-09-28T12:05:00Z") }),
  devRun("run-socks", 7003, {
    quota: 20,
    percent: 20,
    sold: 20,
    status: "ended",
    endReason: "quota",
    returnPending: 2,
    returned: 2,
    endedAt: new Date("2026-09-25T15:30:00Z"),
    backup: JSON.stringify({ currency: "CZK", variant: { price: 199_00, compareAt: null }, lists: [] }),
    sale: JSON.stringify({ currency: "CZK", variant: { price: 159_00, compareAt: 199_00 }, lists: [] }),
  }),
  devRun("run-bag", 7004, {
    quota: 8,
    percent: 15,
    sold: 3,
    status: "ended",
    endReason: "manual",
    endedAt: new Date("2026-09-22T09:00:00Z"),
    backup: JSON.stringify({ currency: "CZK", variant: { price: 890_00, compareAt: null }, lists: [] }),
    sale: JSON.stringify({ currency: "CZK", variant: { price: 757_00, compareAt: 890_00 }, lists: [] }),
  }),
];

const DEV_OUTLET_EVENTS: DevEvent[] = [
  devEvent("run-hoodie", "started", "2026-09-20T08:00:05Z", 0, { percent: 30, before: 1490_00, after: 1043_00, currency: "CZK" }),
  devEvent("run-hoodie", "sale", "2026-09-21T10:12:00Z", 3),
  devEvent("run-hoodie", "sale", "2026-09-23T18:40:00Z", 4),
  devEvent("run-hoodie", "refund", "2026-09-26T09:00:00Z", 1),
  devEvent("run-cap", "started", "2026-09-20T08:00:05Z", 0, { percent: 50, before: 399_00, after: 200_00, currency: "CZK" }),
  devEvent("run-cap", "sale", "2026-09-27T09:58:00Z", 5),
  devEvent("run-cap", "quota_reached", "2026-09-27T09:58:01Z"),
  devEvent("run-cap", "oversold", "2026-09-27T10:01:00Z", 1),
  devEvent("run-cap", "end_failed", "2026-09-27T10:00:00Z"),
  devEvent("run-socks", "started", "2026-09-20T08:00:05Z", 0, { percent: 20, before: 199_00, after: 159_00, currency: "CZK" }),
  devEvent("run-socks", "ended", "2026-09-25T15:30:00Z", 0, { reason: "quota" }),
  devEvent("run-socks", "price_restored", "2026-09-25T15:30:00Z", 0, { field: "price" }),
  devEvent("run-socks", "return_after_end", "2026-09-26T11:00:00Z", 2),
];

const devMoney = (locale: "cs" | "en") => (minor: number, currency: string) =>
  new Intl.NumberFormat(locale === "en" ? "en-US" : "cs-CZ", { style: "currency", currency }).format(minor / 100);

/** Výprodej screen: ?plan=pro, ?state=empty (no sale yet), ?orders=on (the app reads orders; default off, F-O1). */
export function devOutletScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; orders?: boolean }): OutletScreenData {
  const runs = opts.state === "empty" ? [] : DEV_OUTLET_RUNS;
  const view = (r: DevRun) =>
    outletRunView(
      r,
      DEV_OUTLET_EVENTS.filter((e) => e.runId === r.id),
      { locale: opts.locale, timezone: DEV_TIMEZONE, titles: DEV_OUTLET_TITLES, listTitles: new Map([["gid://shopify/PriceList/1", "Slovensko"]]), money: devMoney(opts.locale) },
    );
  return {
    plan: opts.plan,
    status: outletStatus(outletOverviewOf(runs, DEV_OUTLET_TITLES, opts.orders ?? false), opts.plan),
    configVersion: "dev-config-version",
    shopCurrency: "CZK",
    today: "2026-09-28",
    display: "strike_badge",
    reopen: "ask",
    running: runs.filter((r) => r.status !== "ended").map(view),
    ended: runs.filter((r) => r.status === "ended").map(view),
    priceLists: [
      { id: "gid://shopify/PriceList/1", title: "Slovensko", currency: "EUR" },
      { id: "gid://shopify/PriceList/2", title: "Česko", currency: "CZK" },
    ],
    limits: { percentMin: OUTLET_LIMITS.percentMin, percentMax: OUTLET_LIMITS.percentMax, quotaMax: OUTLET_LIMITS.quotaMax, running: OUTLET_LIMITS.running, priceLists: OUTLET_LIMITS.priceLists },
    badgeBlockAddUrl: outletBlockAddUrl(DEV_SHOP, "dev-api-key"),
    placed: { outletBadge: false },
    ordersCounted: opts.orders ?? false,
  };
}

/** Výprodej action results (harness `?result=`). */
export function devOutletResult(kind: string | null): OutletActionResult | null {
  if (kind === "started") return { ok: true, kind: "started", skippedLists: 1 };
  if (kind === "ended") return { ok: true, kind: "ended" };
  if (kind === "invalid") {
    return {
      ok: false,
      reason: "invalid",
      errors: [
        { field: OUTLET_FIELD.variant, key: "outlet.error.variant" },
        { field: OUTLET_FIELD.quota, key: "outlet.error.quota", params: { max: OUTLET_LIMITS.quotaMax } },
      ],
      // B14: what the refused form posted comes back, the screen shows it again.
      values: { [OUTLET_FIELD.quota]: ["0"], [OUTLET_FIELD.percent]: ["30"], [OUTLET_FIELD.endsOn]: ["2026-10-12"], [OUTLET_FIELD.priceList]: ["gid://shopify/PriceList/1"] },
    };
  }
  if (kind === "failed") {
    return {
      ok: false,
      reason: "failed",
      message: "HTTP 503",
      // A failed start keeps the picked variant (its name and price as the picker gave them) and the typed values.
      values: {
        [OUTLET_FIELD.variant]: ["gid://shopify/ProductVariant/7001"],
        [OUTLET_FIELD.product]: ["gid://shopify/Product/701"],
        [OUTLET_FIELD.variantTitle]: ["Mikina Won — L"],
        [OUTLET_FIELD.variantPrice]: ["1490.00"],
        [OUTLET_FIELD.quota]: ["10"],
        [OUTLET_FIELD.percent]: ["30"],
      },
    };
  }
  if (kind === "settings-pro") return { ok: false, reason: "invalid", errors: [{ field: OUTLET_FIELD.display, key: "outlet.error.settingsPro" }] };
  return null;
}

/** The Přehled card with a running sale, one waiting for a decision and a failed step. */
export function devOutletOverview(orders = false): OutletOverviewView {
  return outletOverviewOf(DEV_OUTLET_RUNS, DEV_OUTLET_TITLES, orders);
}


// --- Kampaně (MVP 6) --------------------------------------------------------------------------------

const DEV_CAMPAIGN_NOW = "2026-09-28T14:00:00";

const DEV_CAMPAIGNS: Campaign[] = [
  {
    id: "weekend",
    name: "Víkend −20 %",
    window: { start: "2026-09-26T00:00:00", end: "2026-09-29T00:00:00" },
    overrides: [
      { ruleId: "dev-fixture-1", patch: { value: { kind: "percentage", percent: 20 } } },
      { ruleId: "dev-fixture-5", patch: { enabled: true } },
    ],
    killed: false,
  },
  {
    id: "bf",
    name: "Black Friday",
    window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" },
    overrides: [
      { ruleId: "dev-fixture-3", patch: { value: { kind: "fixed", amount: { CZK: 400_00, EUR: 16_00 } } } },
      { ruleId: "dev-fixture-4", patch: { enabled: true } },
      // MVP 6.1: the whole-store set's breaks in the campaign (more generous than DEV_TIERS_FIXTURE's 10 / 15 / 20 %).
      { ruleId: "global", patch: { breaks: [{ minQty: 3, percent: 15 }, { minQty: 5, percent: 20 }, { minQty: 10, percent: 30 }] } },
      // An override of something that is gone: counted as unused.
      { ruleId: "dev-tier-set", patch: { breaks: [{ minQty: 2, percent: 20 }] } },
    ],
    killed: false,
  },
  { id: "summer", name: "Letní výprodej", window: { start: "2026-08-01T00:00:00", end: "2026-08-03T00:00:00" }, overrides: [{ ruleId: "dev-fixture-6", patch: { value: { kind: "percentage", percent: 15 } } }], killed: false },
  { id: "test", name: "Zkouška", window: { start: "2026-10-05T00:00:00", end: "2026-10-06T00:00:00" }, overrides: [{ ruleId: "dev-fixture-1", patch: { enabled: false } }], killed: true },
];

/** Kampaně screen: Free by default (?plan=pro), ?state=empty, ?edit=<id>, ?state=finishing (Free, A6). */
/** The tiers fixture with the whole-store set in amounts per item, for both markets (?state=suggest). */
const DEV_CAMPAIGN_AMOUNT_TIERS_FIXTURE: WonDiscountsConfig = {
  ...DEV_TIERS_FIXTURE,
  modules: {
    ...DEV_TIERS_FIXTURE.modules,
    tiers: {
      ...DEV_TIERS_FIXTURE.modules.tiers,
      sets: DEV_TIERS_FIXTURE.modules.tiers.sets.map((set) =>
        set.scope === "global" ? { ...set, breaks: [{ minQty: 3, amountOff: { CZK: 30_00, EUR: 1_20 } }, { minQty: 5, amountOff: { CZK: 50_00, EUR: 2_00 } }] } : set,
      ),
    },
  },
};

/** "Black Friday" with the campaign's amounts typed only in the shop currency (?state=suggest). */
const DEV_CAMPAIGN_SUGGEST: Campaign = {
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" },
  overrides: [
    { ruleId: "dev-fixture-3", patch: { value: { kind: "fixed", amount: { CZK: 400_00 } } } },
    { ruleId: "global", patch: { breaks: [{ minQty: 3, amountOff: { CZK: 40_00, EUR: 1_60 } }, { minQty: 5, amountOff: { CZK: 60_00, EUR: 2_40 } }] } },
  ],
  killed: false,
};

export function devCampaignsScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en"; edit: string | null }): CampaignsScreenData {
  // ?state=suggest: "Black Friday" has its amounts only in the shop currency (the whole-store tiers are amounts per
  // item too), so the other market's fields are empty and get a suggested amount.
  const suggest = opts.state === "suggest";
  const tiersConfig = suggest ? DEV_CAMPAIGN_AMOUNT_TIERS_FIXTURE : DEV_TIERS_FIXTURE;
  const campaigns = opts.state === "empty" ? [] : suggest ? DEV_CAMPAIGNS.map((c) => (c.id === "bf" ? DEV_CAMPAIGN_SUGGEST : c)) : DEV_CAMPAIGNS;
  const rules = new Map(DEV_OVERVIEW_FIXTURE.modules.codes.rules.map((r) => [r.id, r]));
  const viewOpts: CampaignViewOptions = { locale: opts.locale, now: DEV_CAMPAIGN_NOW, rules, tiers: tiersConfig.modules.tiers, finishing: new Set(opts.state === "finishing" ? ["weekend"] : []), plan: opts.plan };
  const views = campaigns.map((c) => campaignView(c, viewOpts));
  return {
    plan: opts.plan,
    status: campaignsStatus(campaignsOverviewOf(campaigns, { now: DEV_CAMPAIGN_NOW, locale: opts.locale, plan: opts.plan, finishing: viewOpts.finishing }), opts.plan, DEV_SYNC_OK),
    configVersion: "dev-config-version",
    today: DEV_CAMPAIGN_NOW.slice(0, 10),
    nowTime: DEV_CAMPAIGN_NOW.slice(11, 16),
    timezone: DEV_TIMEZONE,
    campaigns: views,
    rules: campaignRuleChoices(DEV_OVERVIEW_FIXTURE, opts.locale),
    tierSets: campaignTierChoices(tiersConfig, opts.locale),
    currencies: currencyViews(DEV_OVERVIEW_FIXTURE.markets, { marketNames: DEV_MARKET_NAMES }),
    editing: opts.edit ? (views.find((v) => v.id === opts.edit && (v.status === "running" || v.status === "scheduled")) ?? null) : null,
    limits: { campaigns: CONFIG_LIMITS.campaigns, maxDays: CAMPAIGN_LIMITS.maxDays, minLeadMinutes: CAMPAIGN_LIMITS.minLeadMinutes },
    placements: placementLinks(DEV_SHOP, "dev-api-key", CAMPAIGN_BLOCK_HANDLE),
    placed: { campaignHome: true, campaignProduct: false, topBarCampaign: false },
  };
}

/** Kampaně action results (harness `?result=`). */
export function devCampaignsResult(kind: string | null): CampaignsActionResult | null {
  if (kind === "saved") return { ok: true, kind: "saved", sync: { ok: true, problems: [], warnings: [] } };
  if (kind === "killed") return { ok: true, kind: "killed" };
  if (kind === "invalid") {
    return {
      ok: false,
      reason: "invalid",
      errors: [
        { field: CAMPAIGN_FIELD.startDate, key: "campaign.error.overlap", params: { other: "Black Friday" } },
        { field: CAMPAIGN_FIELD.use, key: "campaign.error.empty" },
      ],
      // B14: what the refused form posted comes back, the screen shows it again.
      values: { [CAMPAIGN_FIELD.name]: ["Podzimní akce"], [CAMPAIGN_FIELD.startDate]: ["2026-11-28"], [CAMPAIGN_FIELD.startTime]: ["08:15"], [CAMPAIGN_FIELD.endDate]: ["2026-11-29"], [CAMPAIGN_FIELD.endTime]: ["23:59"] },
    };
  }
  // An error about one discount and one about the time: each at its own control, with the typed values kept.
  if (kind === "invalid-rule") {
    return {
      ok: false,
      reason: "invalid",
      errors: [
        { field: CAMPAIGN_FIELD.endTime, key: "campaign.error.time" },
        { field: CAMPAIGN_FIELD.use, key: "campaign.error.value", params: { rule: "Podzimní sleva 10 %" }, at: "dev-fixture-1" },
      ],
      values: {
        [CAMPAIGN_FIELD.name]: ["Podzimní akce"],
        [CAMPAIGN_FIELD.startDate]: ["2026-10-10"],
        [CAMPAIGN_FIELD.startTime]: ["08:15"],
        [CAMPAIGN_FIELD.endDate]: ["2026-10-12"],
        [CAMPAIGN_FIELD.use]: ["dev-fixture-1"],
        [`${CAMPAIGN_FIELD.percent}dev-fixture-1`]: ["150"],
      },
    };
  }
  // With ?state=suggest&edit=bf: the merchant raised the amounts per item in the shop currency and emptied the other
  // market's — refused (a campaign may only improve a level), the form comes back and suggests the missing amounts.
  if (kind === "invalid-tier") {
    return {
      ok: false,
      reason: "invalid",
      errors: [{ field: CAMPAIGN_FIELD.tierUse, key: "campaign.error.tierLess", params: { set: "Celý obchod", qty: 3, currency: " (EUR)" }, at: "global" }],
      values: {
        [CAMPAIGN_FIELD.name]: ["Black Friday"],
        [CAMPAIGN_FIELD.startDate]: ["2026-11-27"],
        [CAMPAIGN_FIELD.startTime]: ["00:00"],
        [CAMPAIGN_FIELD.endDate]: ["2026-11-30"],
        [CAMPAIGN_FIELD.endTime]: ["23:59"],
        [CAMPAIGN_FIELD.use]: ["dev-fixture-3"],
        [`${CAMPAIGN_FIELD.amount}dev-fixture-3.CZK`]: ["400"],
        [`${CAMPAIGN_FIELD.amount}dev-fixture-3.EUR`]: [""],
        [CAMPAIGN_FIELD.tierUse]: ["global"],
        [`${CAMPAIGN_FIELD.tierQty}global.0`]: ["3"],
        [`${CAMPAIGN_FIELD.tierAmount}global.0.CZK`]: ["40"],
        [`${CAMPAIGN_FIELD.tierAmount}global.0.EUR`]: [""],
        [`${CAMPAIGN_FIELD.tierQty}global.1`]: ["5"],
        [`${CAMPAIGN_FIELD.tierAmount}global.1.CZK`]: ["60"],
        [`${CAMPAIGN_FIELD.tierAmount}global.1.EUR`]: [""],
      },
    };
  }
  if (kind === "sync-pending") return { ok: true, kind: "saved", sync: { ok: false, problems: [], warnings: [] } };
  return null;
}

/** The Přehled card: Víkend running, Black Friday next (?state=campaigns-finishing: Free, A6). */
export function devCampaignsOverview(opts: { locale: "cs" | "en"; finishing?: boolean }): CampaignsOverviewView {
  return campaignsOverviewOf(DEV_CAMPAIGNS, { now: DEV_CAMPAIGN_NOW, locale: opts.locale, plan: opts.finishing ? "free" : "pro", finishing: new Set(opts.finishing ? ["weekend"] : []) });
}

// --- Tarif (MVP 7, contracts M1–M3) --------------------------------------------------------------------------

/** Tarif: Free by default; ?plan=pro = a subscription on trial; ?state=dev | unknown | clean; ?result=<kind>. */
export function devPlanScreen(opts: { plan: "free" | "pro"; state: string | null; result: string | null }): PlanScreenData & { result: PlanActionResult | null } {
  const pro = opts.plan === "pro";
  const results: Record<string, PlanActionResult> = {
    subscribe_failed: { ok: false, kind: "subscribe", detail: "Shop cannot accept charges" },
    cancelled: { ok: true, kind: "cancel", synced: true },
    cancel_pending: { ok: true, kind: "cancel", synced: false },
    uninstall_done: { ok: true, kind: "uninstall_prep", ended: 2, restored: 1, failed: [] },
    uninstall_partial: { ok: false, kind: "uninstall_prep", ended: 1, restored: 1, failed: [{ what: "outlet", detail: "cena se nezapsala" }] },
  };
  return {
    plan: opts.plan,
    subscribed: pro && opts.state !== "dev",
    devOverride: opts.state === "dev",
    billingKnown: opts.state !== "unknown",
    trialEndsText: pro && opts.state !== "dev" ? "18. 10. 2026 14:00" : null,
    test: true,
    price: { amount: "29", currency: "USD", trialDays: 14 },
    codeRules: codeRuleLimit(DEV_OVERVIEW_FIXTURE),
    maxRules: CONFIG_LIMITS.rules,
    finishing: pro ? { campaigns: ["Víkend −20 %"], outlets: 2 } : { campaigns: [], outlets: 0 },
    uninstall: opts.state === "clean" ? { outlets: 0, natives: [] } : { outlets: 2, natives: ["LETO15", "Doprava zdarma nad 2 000 Kč"] },
    result: opts.result ? (results[opts.result] ?? null) : null,
  };
}

// --- Přehledy (MVP 7, contract M4) ---------------------------------------------------------------------------

/** Přehledy: Free by default; ?plan=pro; ?state=empty | unavailable. The same analyticsScreenOf the loader runs. */
export function devAnalyticsScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en" }): AnalyticsScreenData {
  const empty = opts.state === "empty" || opts.state === "unavailable";
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 5 + i)).toISOString().slice(0, 10);
    const orders = empty ? 0 : 2 + ((i * 7) % 6);
    return { day, orders, cost: orders * (9_000 + ((i * 13) % 5) * 2_500), revenue: orders * 118_000 };
  });
  const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((total, d) => total + pick(d), 0);
  const orders = sum((d) => d.orders);
  const summary: AnalyticsSummary = {
    days: 30,
    currency: empty ? null : "CZK",
    otherCurrencyOrders: empty ? 0 : 3,
    orders,
    discountedOrders: Math.round(orders * 0.6),
    discountCost: sum((d) => d.cost),
    revenue: sum((d) => d.revenue),
    averageOrder: orders ? Math.round(sum((d) => d.revenue) / orders) : 0,
    series: days,
    rules: empty
      ? []
      : [
          { key: "dev-fixture-1", kind: "rule", orders: 61, cost: 742_000, revenue: 7_198_000 },
          { key: "tiers", kind: "tier", orders: 24, cost: 318_500, revenue: 3_410_000 },
          { key: "gift", kind: "gift", orders: 12, cost: 119_000, revenue: 2_260_000 },
          { key: "other", kind: "other", orders: 4, cost: 21_000, revenue: 380_000 },
        ],
    gifts: empty ? 0 : 12,
    outletItems: empty ? 0 : 31,
  };
  return analyticsScreenOf(summary, {
    plan: opts.plan,
    available: opts.state !== "unavailable",
    locale: opts.locale,
    config: DEV_OVERVIEW_FIXTURE,
    shopCurrency: "CZK",
    otherCurrencies: empty ? [] : ["EUR"],
  });
}

// --- Přehled: every module at once (feedback 3, body 1 až 3) -------------------------------------------------

/**
 * The home page's signals built from the SAME fixtures the module pages render (`/dev/preview/tiers`, `rewards`,
 * `margin`, `outlet`, `campaigns`), so a tile and its page can be compared:
 *   on      everything set up and written; a Pro shop also has a sale and a campaign running;
 *   off     a shop with nothing set up yet;
 *   failed  everything set up, the last write to Shopify failed.
 */
export function devModuleSignals(opts: { mode: "on" | "off" | "failed"; plan: "free" | "pro"; locale: "cs" | "en" }): AdminSignals {
  const { mode, plan, locale } = opts;
  const off = mode === "off";
  const pro = plan === "pro";
  const rewardsView = rewardsOverviewOf(off ? DEV_EMPTY_FIXTURE : DEV_REWARDS_FIXTURE, plan, "CZK");
  const firstGift = gateConfigForPlan(DEV_REWARDS_FIXTURE, plan).config.modules.rewards.gifts.map((g) => DEV_GIFT_TITLES.get(g.choices[0] ?? "") ?? null);
  return {
    ...DEV_SIGNALS,
    embed: DEV_EMBED_ON,
    sync: mode === "failed" ? DEV_SIGNALS_SYNC_FAILED.sync : DEV_SYNC_OK,
    native: { state: "ok", discounts: [], moved: [], conflicts: [] },
    tiers: tiersOverviewOf(off ? DEV_EMPTY_FIXTURE : DEV_TIERS_FIXTURE, plan, devBlock(null)),
    rewards: off ? rewardsView : { ...rewardsView, giftNames: firstGift },
    margin: devMarginOverview(off ? "off" : "fresh"),
    // A Free shop has no sale and no campaign: the tiles say they are Pro.
    outlet: pro && !off ? devOutletOverview(true) : { running: 0, pendingReturns: [], oversold: 0, problems: 0, ordersCounted: true },
    campaigns: pro && !off ? devCampaignsOverview({ locale }) : { running: null, next: null, finishing: false },
    analytics: { available: true, empty: true, days: 30, tiles: [] },
  };
}
