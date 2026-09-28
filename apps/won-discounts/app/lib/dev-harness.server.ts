// Dev-only admin harness (Task 5 brief): lets us screenshot admin screens at
// 390/1440px without logging into Shopify admin. This module is server-only
// (`.server.ts`) and imported by exactly one route: app/routes/dev.preview.$.tsx.
//
// Production safety is BUILD-TIME, not just a runtime check: app/routes.ts
// excludes the dev.preview.$.tsx route file from the route manifest entirely
// when NODE_ENV === "production" (via flatRoutes' ignoredRouteFiles), so the
// harness route — and this module — never reach the production server bundle.
// isDevHarnessEnabled() below is a second, cheap belt-and-braces guard inside
// the loader itself, for the (non-production) case where someone sets
// WON_DEV_HARNESS=0 to turn the harness off locally.
//
// MVP 0 scope: the harness renders a standalone "Přehled v0" preview against a
// local fixture — it must NOT import from packages/core/src/discounts (that
// module is being written concurrently by another agent). The real Přehled v0
// route (app/routes/app._index.tsx) is rewritten separately.

export function isDevHarnessEnabled(): boolean {
  // eslint-disable-next-line no-undef
  return process.env.NODE_ENV !== "production" && process.env.WON_DEV_HARNESS !== "0";
}

/** Status of a fixture discount campaign. Never render this raw — use statusLabel(). */
export type DevDiscountStatus = "active" | "scheduled" | "ended";

/** Kind of fixture discount. Never render this raw — use typeLabel(). */
export type DevDiscountType = "automatic" | "code";

export interface DevDiscountFixtureItem {
  id: string;
  name: string;
  status: DevDiscountStatus;
  type: DevDiscountType;
  /** Human-readable summary of the discount value, already localized. */
  valueSummary: string;
}

export interface DevOverviewFixture {
  shopName: string;
  items: DevDiscountFixtureItem[];
}

// Local fixture only (doctrine §4c: no raw enum keys reach the UI — see
// statusLabel/typeLabel below). Do NOT import this shape from @won/core.
export const DEV_OVERVIEW_FIXTURE: DevOverviewFixture = {
  shopName: "won-preview-shop.myshopify.com",
  items: [
    {
      id: "dev-fixture-1",
      name: "Podzimní sleva 10 %",
      status: "active",
      type: "automatic",
      valueSummary: "10 % z ceny košíku",
    },
    {
      id: "dev-fixture-2",
      name: "VIP10",
      status: "scheduled",
      type: "code",
      valueSummary: "10 % s kódem, od 1. 10.",
    },
    {
      id: "dev-fixture-3",
      name: "Black Friday 2025",
      status: "ended",
      type: "automatic",
      valueSummary: "20 % z ceny košíku",
    },
  ],
};

const STATUS_LABELS: Record<DevDiscountStatus, string> = {
  active: "Aktivní",
  scheduled: "Naplánovaná",
  ended: "Ukončená",
};

const TYPE_LABELS: Record<DevDiscountType, string> = {
  automatic: "Automatická",
  code: "Kódová",
};

export function statusLabel(status: DevDiscountStatus): string {
  return STATUS_LABELS[status];
}

export function typeLabel(type: DevDiscountType): string {
  return TYPE_LABELS[type];
}
