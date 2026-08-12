// MVP14 — real Shopify Billing via Admin GraphQL (app subscriptions). Kept
// self-contained (no changes to the shared app factory) and defensive: every
// call is wrapped so a billing hiccup never breaks the admin. A dev fallback
// (WON_BILLING_DEV=1) flips the stored plan directly for local review without a
// live charge. Test charges are used outside production.

export const PRO_PLAN_NAME = "Won Toasts Pro";
const PRO_PRICE = { amount: "5.00", currencyCode: "USD" } as const;

type AdminGraphql = {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// eslint-disable-next-line no-undef
const isProd = (): boolean => process.env.NODE_ENV === "production";
// eslint-disable-next-line no-undef
export const billingDevMode = (): boolean => process.env.WON_BILLING_DEV === "1";
const isTestCharge = (): boolean => !isProd();

/**
 * Whether to bypass Shopify Billing and flip the stored plan directly (no
 * charge). True in any non-production run (`shopify app dev`, local build) or
 * when WON_BILLING_DEV=1 — so Pro is testable in dev without a live subscription.
 * Production always uses real Shopify Billing.
 */
export const billingBypassed = (): boolean => billingDevMode() || !isProd();

interface Subscription {
  id: string;
  name: string;
  status: string;
}

async function activeSubscriptions(admin: AdminGraphql): Promise<Subscription[]> {
  const res = await admin.graphql(
    `#graphql
    query WonToastsActiveSubs {
      currentAppInstallation {
        activeSubscriptions { id name status }
      }
    }`,
  );
  const data = (await res.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: Subscription[] } };
  };
  return data?.data?.currentAppInstallation?.activeSubscriptions ?? [];
}

/**
 * Derive the plan from an `app_subscriptions/update` webhook payload, so the
 * stored plan reconciles the moment Shopify's subscription state changes — not
 * only when the merchant happens to open the Plan page (doctrine BILL-1).
 * Returns null when the update isn't for our Pro plan (ignore it). Any non-ACTIVE
 * status (cancelled / expired / frozen / declined) resolves to "free" — default
 * to Free on any uncertainty.
 */
export function planFromSubscriptionUpdate(payload: unknown): "pro" | "free" | null {
  const sub = (payload as { app_subscription?: { name?: string; status?: string } })
    ?.app_subscription;
  if (!sub || sub.name !== PRO_PLAN_NAME) return null;
  return sub.status === "ACTIVE" ? "pro" : "free";
}

/** Real plan from Shopify's active subscriptions. null if the query fails. */
export async function checkActivePlan(
  admin: AdminGraphql,
): Promise<"pro" | "free" | null> {
  try {
    const subs = await activeSubscriptions(admin);
    return subs.some((s) => s.status === "ACTIVE" && s.name === PRO_PLAN_NAME)
      ? "pro"
      : "free";
  } catch {
    return null;
  }
}

/** Create a Pro subscription; returns Shopify's confirmation URL to redirect to. */
export async function requestProSubscription(
  admin: AdminGraphql,
  returnUrl: string,
): Promise<string | null> {
  try {
    const res = await admin.graphql(
      `#graphql
      mutation WonToastsSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $amount: Decimal!, $currency: CurrencyCode!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          test: $test
          lineItems: [{
            plan: { appRecurringPricingDetails: { price: { amount: $amount, currencyCode: $currency }, interval: EVERY_30_DAYS } }
          }]
        ) {
          confirmationUrl
          userErrors { message }
        }
      }`,
      {
        variables: {
          name: PRO_PLAN_NAME,
          returnUrl,
          test: isTestCharge(),
          amount: PRO_PRICE.amount,
          currency: PRO_PRICE.currencyCode,
        },
      },
    );
    const data = (await res.json()) as {
      data?: { appSubscriptionCreate?: { confirmationUrl?: string } };
    };
    return data?.data?.appSubscriptionCreate?.confirmationUrl ?? null;
  } catch {
    return null;
  }
}

/** Cancel any active Pro subscription (best-effort). */
export async function cancelProSubscription(admin: AdminGraphql): Promise<void> {
  try {
    const subs = await activeSubscriptions(admin);
    for (const s of subs) {
      if (s.name !== PRO_PLAN_NAME) continue;
      await admin.graphql(
        `#graphql
        mutation WonToastsCancel($id: ID!) {
          appSubscriptionCancel(id: $id) { userErrors { message } }
        }`,
        { variables: { id: s.id } },
      );
    }
  } catch {
    // best-effort
  }
}
