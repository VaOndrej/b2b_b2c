import { useEffect, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import {
  FREE_MAX_PER_SESSION,
  PRO_FEATURES,
} from "@won/core/toasts/tier";
import {
  LOCALE_LIMIT_FREE,
  LOCALE_LIMIT_PRO,
} from "@won/core/toasts/locales";

// Human labels for Pro feature keys (doctrine §4c — never render the raw enum
// key or a `key.replace(/_/g," ")` of it).
const FEATURE_LABELS: Record<string, string> = {
  design_studio: "Full design studio (custom colours, shape & motion)",
  advanced_grouping: "Anti-spam tuning — merge rules, your own caps & rate limits",
  custom_css: "Custom CSS styling",
  targeting: "Page, device & customer targeting",
  unlimited_milestones: "Unlimited milestones",
  remove_branding: "Remove Won branding",
  analytics: "Insights — impressions, interactions & per-toast metrics",
  experiments: "A/B experiments",
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, " ");
}

// Pro capabilities that are gated outside the PRO_FEATURES/isFeatureAllowed list
// (per-type look via gateConfigForPlan; the Pro toast types via the recipe action;
// language count via the locale limit). Shown as bullets so the Pro card reflects
// what the plan actually unlocks, without inventing unenforced feature flags.
const EXTRA_PRO_FEATURES = [
  "Per-type look & behaviour (each toast styled on its own)",
  "Pro toast types — low-stock, cart activity, order summary, recent sales",
  `Up to ${String(LOCALE_LIMIT_PRO)} languages (Free covers ${String(LOCALE_LIMIT_FREE)})`,
  "Merge tuning — what counts as “the same thing”, and how fast",
  `Your own session limit — raise it past ${String(FREE_MAX_PER_SESSION)}, or turn it off`,
  "Advanced caps — per-minute rate limiting and duplicate suppression",
];

// What Free already includes — stated positively so the merchant sees Free isn't
// crippled (doctrine: Pro gates scope, never quality).
// Every line here is checked against what the code ACTUALLY serves on Free
// (gateConfigForPlan). "Basic anti-spam — merge, cap & quiet mode" used to sit in
// this list while merge tuning was Pro-locked in the admin and the session cap is
// pinned server-side — a plan page that oversells Free is the same class of lie
// as a summary that oversells a setting (§12).
const FREE_FEATURES = [
  "All cart-event toasts (add, remove, update) — each on/off",
  "Countdown timer & announcements",
  "The default look, presets & live preview",
  "Free-shipping & gift milestones",
  `Localization in ${String(LOCALE_LIMIT_FREE)} languages`,
  "Sensible merging out of the box — rapid cart changes become one toast",
  `Shopper protection — max ${String(FREE_MAX_PER_SESSION)} toasts a visit, plus quiet mode`,
  "Exclusions — turn toasts off on any page",
];

function Feature({ children }: { children: ReactNode }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-icon type="check-circle" tone="success" />
      <s-text>{children}</s-text>
    </s-stack>
  );
}

function PlanCard({
  name,
  price,
  priceSub,
  current,
  highlighted,
  intro,
  features,
  footer,
}: {
  name: string;
  price: string;
  priceSub?: string;
  current: boolean;
  highlighted?: boolean;
  intro?: string;
  features: string[];
  footer?: ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${highlighted ? "#C8912A" : "#e1e4e8"}`,
        borderRadius: 16,
        padding: 20,
        background: "#fff",
        boxShadow: highlighted ? "0 4px 16px rgba(200,145,42,.16)" : "0 1px 3px rgba(0,0,0,.06)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-text type="strong">{name}</s-text>
        {current ? (
          <s-badge tone="success">Current plan</s-badge>
        ) : highlighted ? (
          <s-badge>Recommended</s-badge>
        ) : null}
      </s-stack>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: "#111418" }}>{price}</span>
        {priceSub ? <span style={{ color: "#6b7280", fontSize: 14 }}>{priceSub}</span> : null}
      </div>
      {intro ? <s-text color="subdued">{intro}</s-text> : null}
      <s-stack direction="block" gap="small">
        {features.map((f) => (
          <Feature key={f}>{f}</Feature>
        ))}
      </s-stack>
      {footer ? <div style={{ marginTop: "auto", paddingTop: 6 }}>{footer}</div> : null}
    </div>
  );
}

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import {
  billingBypassed,
  cancelProSubscription,
  checkActivePlan,
  requestProSubscription,
} from "../services/billing.server";
import { persistConfig } from "../lib/persist-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  let config = await getToastConfig(session.shop);

  // Source of truth for the real plan is Shopify's active subscriptions; sync
  // the stored plan to it (best-effort — never breaks the page). Skipped when
  // billing is bypassed (dev), where the stored plan is authoritative.
  if (!billingBypassed()) {
    try {
      const real = await checkActivePlan(admin);
      if (real && real !== config.plan) {
        config = await updateToastConfig(session.shop, { plan: real });
      }
    } catch (err) {
      // Best-effort plan sync — a billing/DB hiccup must never white-screen the
      // Plan page. Fall back to the stored plan (already in `config`).
      // eslint-disable-next-line no-console
      console.error("[won-toasts] plan sync failed:", err);
    }
  }
  return { config, dev: billingBypassed() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  // Dev/review fallback: flip the stored plan directly, no charge.
  if (billingBypassed()) {
    return persistConfig(() =>
      updateToastConfig(session.shop, {
        plan: intent === "upgrade" ? "pro" : "free",
      }),
    );
  }

  if (intent === "upgrade") {
    const url = new URL(request.url);
    // eslint-disable-next-line no-undef
    const appUrl = process.env.SHOPIFY_APP_URL || url.origin;
    const returnUrl = `${appUrl}/app/plan`;
    const confirmationUrl = await requestProSubscription(admin, returnUrl);
    if (confirmationUrl) return { confirmationUrl };
    return { error: "Could not start the subscription. Please try again." };
  }

  // Cancel → back to Free.
  await cancelProSubscription(admin);
  return persistConfig(() => updateToastConfig(session.shop, { plan: "free" }));
};

export default function PlanRoute() {
  const { config, dev } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const isPro = config.plan === "pro";

  // Real billing: redirect (top frame) to Shopify's confirmation page.
  const confirmationUrl = (actionData as { confirmationUrl?: string } | undefined)
    ?.confirmationUrl;
  useEffect(() => {
    if (confirmationUrl && typeof window !== "undefined") {
      window.open(confirmationUrl, "_top");
    }
  }, [confirmationUrl]);

  const error = (actionData as { error?: string } | undefined)?.error;

  return (
    <s-page heading="Plan" inlineSize="large">
      <s-section>
        {error ? (
          <s-banner tone="critical" heading="Billing error">
            {error}
          </s-banner>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          <PlanCard
            name="Free"
            price="Free"
            current={!isPro}
            features={FREE_FEATURES}
            footer={
              isPro ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="cancel" />
                  <s-button type="submit" loading={busy}>
                    {dev ? "Switch back to Free (dev)" : "Cancel Pro (back to Free)"}
                  </s-button>
                </Form>
              ) : (
                <s-text color="subdued">You’re on this plan.</s-text>
              )
            }
          />

          <PlanCard
            name="Pro"
            price="$5"
            priceSub="/ month"
            highlighted
            current={isPro}
            intro="Everything in Free, plus:"
            features={[...PRO_FEATURES.map(featureLabel), ...EXTRA_PRO_FEATURES]}
            footer={
              !isPro ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="upgrade" />
                  <s-button variant="primary" type="submit" loading={busy}>
                    {dev ? "Switch to Pro (dev — no charge)" : "Upgrade to Pro"}
                  </s-button>
                </Form>
              ) : (
                <s-text color="subdued">You’re on this plan.</s-text>
              )
            }
          />
        </div>

        <s-paragraph>
          <s-text color="subdued">
            {dev
              ? "Developer mode: plan changes are applied instantly with no charge (WON_BILLING_DEV=1)."
              : "Secure recurring billing is handled by Shopify. You’ll confirm the charge on Shopify’s page; cancel anytime."}
          </s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
