// Shared server-side entitlement resolver (doctrine BILL-1). Every app derives
// "is this shop entitled to Pro?" from Shopify's authoritative subscription state
// — never from a client flag — and MUST default to the free plan on ANY
// uncertainty (a failed/absent check never grants a paid plan). This helper makes
// that safe default the path of least resistance so no app re-invents gating.

export interface Entitlement {
  /** The resolved plan id (the free plan when unknown/failed). */
  plan: string;
  /** True only when the resolved plan is one of the paid plans. */
  pro: boolean;
}

export interface EntitlementOptions {
  /** Plan ids that count as paid. Default: ["pro"]. */
  paidPlans?: string[];
  /** The safe fallback plan id. Default: "free". */
  freePlan?: string;
}

/**
 * Resolve entitlement from an app-supplied check that returns the authoritative
 * plan id (from Shopify Billing) or null when it can't be determined. Any null
 * result OR thrown error resolves to the free plan — uncertainty is never Pro.
 */
export async function resolveEntitlement(
  check: () => Promise<string | null | undefined>,
  options: EntitlementOptions = {},
): Promise<Entitlement> {
  const freePlan = options.freePlan ?? "free";
  const paidPlans = options.paidPlans ?? ["pro"];
  try {
    const real = await check();
    if (real == null) return { plan: freePlan, pro: false };
    return { plan: real, pro: paidPlans.includes(real) };
  } catch {
    return { plan: freePlan, pro: false };
  }
}
