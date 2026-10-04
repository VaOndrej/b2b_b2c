// The ONE server-side plan resolver (BILL-1, spec §7 "Free / Pro"). Everything
// that decides what a shop may run asks here: the sync (gateConfigForPlan
// before the function payload and the product index), the admin pages (what
// is not in force, explainGate) and the editor (which Pro fields are writable).
//
// Pro only from a verified subscription, Free on ANY uncertainty
// (@won/app-kit/entitlement). MVP 7: the subscription is Shopify Billing's,
// mirrored in ShopEntitlement (billing.server.ts storedPlan: an ACTIVE
// subscription of our plan, checked recently). The app's database is handed in
// once on boot (setPlanDatabase, entry.server.tsx); without one — unit tests,
// scripts — and for a call without a shop there is nothing to verify: Free.
//
// Dev-only override (testing Pro on the dev store): an env variable (see
// devPlanOverride) honoured ONLY in a development build AND when NODE_ENV is
// on the dev-harness allowlist ("development", "test" — lib/dev-harness-env.ts).
//   - BUILD-TIME (F2 re-review M-1): `react-router build` (vite) replaces
//     import.meta.env.DEV with `false`, so the override is dead code and is
//     dropped from build/server entirely — the production bundle does not even
//     contain the variable's name (tests/contracts/dev-harness.contract.test.ts
//     builds and greps it). A misconfigured NODE_ENV in production cannot turn
//     it on;
//   - `vite dev` (shopify app dev): import.meta.env.DEV is true;
//   - tsx (unit tests) has no import.meta.env: the NODE_ENV allowlist decides.

import { resolveEntitlement } from "@won/app-kit/entitlement";
import type { ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../generated/prisma/client";
import { storedPlan } from "./billing.server";
import { isDevHarnessEnvironment } from "./dev-harness-env";

let planDb: PrismaClient | null = null;

/** The database resolvePlan reads the shop's subscription from (entry.server.tsx; null = none: always Free). */
export function setPlanDatabase(db: PrismaClient | null): void {
  planDb = db;
}

export type { ShopPlan };

export interface ResolvedPlan {
  plan: ShopPlan;
  pro: boolean;
}

/** The dev override, or null (a production build, not a dev environment, or not set). */
export function devPlanOverride(env: Readonly<Record<string, string | undefined>> = process.env): ShopPlan | null {
  if (import.meta.env?.DEV === false) return null;
  if (!isDevHarnessEnvironment(env.NODE_ENV)) return null;
  return env.WON_DEV_PLAN?.trim().toLowerCase() === "pro" ? "pro" : null;
}

/**
 * The plan in force for `shop`: the dev override, else the shop's verified
 * subscription (storedPlan). `env` and `db` are injectable for tests.
 */
export async function resolvePlan(
  shop?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  db: PrismaClient | null = planDb,
): Promise<ResolvedPlan> {
  const entitlement = await resolveEntitlement(async () => devPlanOverride(env) ?? (shop && db ? await storedPlan(db, shop) : null));
  return { plan: entitlement.pro ? "pro" : "free", pro: entitlement.pro };
}

/** Just the plan id (the sync's `SyncDeps.plan`). */
export async function planOf(shop: string): Promise<ShopPlan> {
  return (await resolvePlan(shop)).plan;
}
