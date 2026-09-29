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

import { codeHash } from "@won/core/discounts/code-hash";
import { DEFAULT_CONFIG, readStoredConfig, type WonDiscountsConfig } from "@won/core/discounts/config";
import { buildMarginPayload, marginImpact, resolveMargin, type MarginVariant } from "@won/core/discounts/margin";
import { explainGate, gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { productRuleIndex, variantKey } from "@won/core/discounts/targeting";

import type {
  AdminSignals,
  CartPlanView,
  CostCoverageView,
  CostMirrorView,
  GateNoteView,
  MarginImpactRowView,
  MarginImpactView,
  MarginOverviewView,
  MarginScreenData,
  MarginSettingsView,
  NativeView,
  RuleSyncMap,
  TryCartLineView,
  UiResult,
} from "../components/model/types";
import { lossText, undoCostTexts, warningText } from "./native/copy";
import { isDevHarnessEnvironment } from "./dev-harness-env";
import { planTryCart } from "./integration/try-cart-plan";

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
export const DEV_MARKET_NAMES: Readonly<Record<string, string>> = { cz: "Česko", sk: "Slovensko", hu: "Maďarsko" };

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
            ? "Přesun se nepovedl (Sleva „PODZIM20“ se do Shopify nepropsala). Slevu se nepodařilo vrátit do Shopify. Je v záloze, klikni na „Vrátit zpět“."
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
 * config and the fixture costs (what margin.server.ts computes from the cost
 * mirror), mapped to the view (source = core resolveMargin's).
 */
export function devMarginImpact(config: WonDiscountsConfig, variants: readonly DevCostVariant[] = DEV_COST_VARIANTS): MarginImpactView {
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
  const impact = marginImpact(config, measured, "CZK");
  const payload = buildMarginPayload({ ...config.modules.margin, enabled: true }, "CZK");
  const refsOf = new Map(measured.map((m) => [m.variantId, m.marginRefs]));
  const names = new Map(config.modules.codes.rules.map((r) => [r.id, r.name]));
  const rows: MarginImpactRowView[] = impact.rules
    .filter((r) => r.discountClass === "product")
    .flatMap((r) =>
      r.capped.map((c) => ({
        ruleId: r.ruleId,
        ruleName: names.get(r.ruleId) ?? "",
        productId: c.productId,
        variantId: c.variantId,
        title: c.title,
        wanted: c.wanted,
        allowed: c.allowed,
        basis: c.basis,
        source: resolveMargin(payload, refsOf.get(c.variantId) ?? [])?.source ?? ("global" as const),
      })),
    )
    .sort((a, b) => b.wanted - b.allowed - (a.wanted - a.allowed))
    .slice(0, 50);
  return {
    rows,
    orderRules: impact.rules
      .filter((r) => r.discountClass === "order" && r.variants > 0)
      .map((r) => ({ ruleId: r.ruleId, ruleName: names.get(r.ruleId) ?? "", variantsBelow: r.variants })),
    withoutCost: impact.withoutCost,
  };
}

/** The rule editor's note: on how many products protection lowers this rule (ruleMarginImpact on the fixture). */
export function devRuleMarginImpact(ruleId: string): number | null {
  const impact = devMarginImpact(DEV_MARGIN_FIXTURE);
  const products = new Set(impact.rows.filter((r) => r.ruleId === ruleId).map((r) => r.productId));
  const order = impact.orderRules.find((r) => r.ruleId === ruleId)?.variantsBelow ?? 0;
  return products.size + order;
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

/**
 * Ochrana marže as loadMarginScreen hands it over, per harness state:
 *   default  on, costs read this morning, 8 products without a cost;
 *   running  just switched on: the first read of the costs is running (nothing known yet);
 *   zero     every product has a cost;
 *   off      protection off, never read;
 *   stale    the last full read is 2 days old ("Obnovit nákupní ceny");
 *   failed   the last read failed;
 *   gate     Free with collection settings stored (folded, core explainGate).
 * Pro (`plan`) gets the collection settings and Přehled zásahů (core marginImpact);
 * Free gets `impact: null` (BILL-1).
 */
export function devMarginScreen(opts: { plan: "free" | "pro"; state: string | null; locale: "cs" | "en" }): MarginScreenData {
  const { plan, state } = opts;
  const pro = plan === "pro";
  const collections = pro || state === "gate";
  const base: MarginScreenData = {
    plan,
    shopCurrency: "CZK",
    configVersion: "dev-config-version",
    settings: marginSettingsView(DEV_MARGIN_FIXTURE, { collections }),
    mirror: DEV_MIRROR_FRESH,
    coverage: DEV_COVERAGE,
    impact: pro ? devMarginImpact(DEV_MARGIN_FIXTURE) : null,
    gateNotes: [],
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
      return { ...base, mirror: { state: "running", done: 340, total: 1240, since: "2026-09-28T13:55:00" }, coverage: null, impact: null };
    case "zero": {
      const withCosts = DEV_COST_VARIANTS.map((v) => ({ ...v, cost: v.cost ?? Math.round(v.price / 200) }));
      return {
        ...base,
        coverage: { variants: 1240, variantsWithCost: 1240, productsWithoutCost: 0, sample: [] },
        impact: pro ? devMarginImpact(DEV_MARGIN_FIXTURE, withCosts) : null,
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
          problems: [{ key: "sync.problem.other", params: { detail: "Throttled (3 attempts)" } }],
        },
      };
    default:
      return base;
  }
}

/** Margin page action results (harness `?result=`). */
export function devMarginResult(kind: string | null): UiResult | null {
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
      };
    case "unreadable":
      return { ok: false, reason: "unreadable_config" };
    default:
      return null;
  }
}

/** The Přehled card (AdminSignals.margin, filled by loadAdminSignals). */
export function devMarginOverview(state: "fresh" | "stale" | "off"): MarginOverviewView {
  if (state === "off") return { enabled: false, minMarginPercent: null, maxDiscountPercent: 50, productsWithoutCost: null, mirror: { state: "off" } };
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
