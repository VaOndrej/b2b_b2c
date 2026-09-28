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

import { DEFAULT_CONFIG, readStoredConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import type {
  AdminSignals,
  CartPlanView,
  NativeView,
  TryCartLineView,
} from "../components/model/types";
import { isDevHarnessEnvironment } from "./dev-harness-env";

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

export const DEV_NATIVE: NativeView = {
  state: "ok",
  discounts: [
    {
      id: "gid://shopify/DiscountCodeNode/1001",
      title: "LETO15",
      method: "code",
      code: "LETO15",
      summary: "15 % z objednávky",
      movable: true,
      losses: ["usage_history", "once_per_customer"],
    },
    {
      id: "gid://shopify/DiscountAutomaticNode/1002",
      title: "Doprava zdarma nad 2 000 Kč",
      method: "automatic",
      summary: "Doprava zdarma",
      movable: true,
      losses: [],
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
  moved: [{ backupId: "bk_dev_1", title: "JARO10", movedAt: "2026-09-20T10:00:00" }],
};

/** What Přehled looks like once sync, native detection and checkout checks are wired. */
export const DEV_SIGNALS: AdminSignals = {
  embed: { state: "off", activateUrl: DEV_ACTIVATE_URL },
  checkout: { state: "verified", at: "2026-09-28T15:40:00" },
  sync: { state: "ok", at: "2026-09-28T16:20:00" },
  native: DEV_NATIVE,
};

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
 * The plan the engine returns for DEV_TRY_CART_LINES in CZK with code VIP10 on
 * 28. 9. 2026 against DEV_OVERVIEW_FIXTURE (A1: order discounts don't stack, the
 * better one wins; ties go to priority, then id). Sentences in the requested
 * admin language, as explainPlan writes them.
 */
export function devTryCartPlan(locale: "cs" | "en"): CartPlanView {
  const cs = locale === "cs";
  return {
    currency: "CZK",
    date: "2026-09-28",
    lines: [
      { lineId: "line-1", title: "Mikina Won", quantity: 2, subtotal: 2580_00, discount: 0, total: 2580_00 },
      { lineId: "line-2", title: "Čepice", quantity: 1, subtotal: 390_00, discount: 0, total: 390_00 },
    ],
    explain: [
      {
        tone: "success",
        text: cs ? "Podzimní sleva 10 %: −297 Kč z objednávky." : "Podzimní sleva 10 %: CZK 297 off the order.",
      },
      {
        tone: "warning",
        text: cs
          ? "Kód VIP10 se neuplatní. Stejně výhodná Podzimní sleva 10 % už platí a slevy z objednávky se nesčítají."
          : "Code VIP10 doesn't apply. Podzimní sleva 10 % is just as good and order discounts don't stack.",
      },
      {
        tone: "info",
        text: cs
          ? "Sleva 200 Kč / 8 € se neuplatní, Podzimní sleva 10 % je výhodnější."
          : "Sleva 200 Kč / 8 € doesn't apply; Podzimní sleva 10 % is better.",
      },
      {
        tone: "info",
        text: cs ? "Černý pátek platí od 27. 11. 2026." : "Černý pátek starts on 27 Nov 2026.",
      },
      {
        tone: "info",
        text: cs ? "Počítá se do slevy z objednávky." : "Counts towards the order discount.",
        lineIds: ["line-1", "line-2"],
      },
    ],
    totals: { subtotal: 2970_00, productDiscount: 0, orderDiscount: 297_00, total: 2673_00 },
  };
}
