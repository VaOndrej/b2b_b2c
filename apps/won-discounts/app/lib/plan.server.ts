// The ONE server-side plan resolver (BILL-1, spec §7 "Free / Pro"). Everything
// that decides what a shop may run asks here: the sync (gateConfigForPlan
// before the function payload and the product index), the admin pages (what
// is not in force, explainGate) and the editor (which Pro fields are writable).
//
// Pro only from a verified subscription, Free on ANY uncertainty
// (@won/app-kit/entitlement). Billing (spec §7, Tarif) is not built yet, so
// there is no subscription to verify: production always resolves Free.
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

import { isDevHarnessEnvironment } from "./dev-harness-env";

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
 * The plan in force for `shop` (the shop is unused until billing reads its
 * subscription). `env` is injectable for tests.
 */
export async function resolvePlan(
  shop?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ResolvedPlan> {
  void shop;
  const entitlement = await resolveEntitlement(async () => devPlanOverride(env));
  return { plan: entitlement.pro ? "pro" : "free", pro: entitlement.pro };
}

/** Just the plan id (the sync's `SyncDeps.plan`). */
export async function planOf(shop: string): Promise<ShopPlan> {
  return (await resolvePlan(shop)).plan;
}
