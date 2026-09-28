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

import type {
  AdminSignals,
  CartPlanView,
  NativeView,
  RuleSyncMap,
  TryCartLineView,
  UiResult,
} from "../components/model/types";
import { lossText, warningText } from "./native/copy";
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
    moved: [{ backupId: "bk_dev_1", title: "JARO10", movedAt: "2026-09-20T10:00:00", state: "moved" }],
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
      { backupId: "bk_dev_2", title: "LETO15", movedAt: "2026-09-28T14:05:00", state: "moved" },
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
