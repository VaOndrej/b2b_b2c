import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { PRO_FEATURES } from "@won/core/toasts/tier";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import {
  billingDevMode,
  cancelProSubscription,
  checkActivePlan,
  requestProSubscription,
} from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  let config = await getToastConfig(session.shop);

  // Source of truth for the real plan is Shopify's active subscriptions; sync
  // the stored plan to it (best-effort — never breaks the page).
  if (!billingDevMode()) {
    const real = await checkActivePlan(admin);
    if (real && real !== config.plan) {
      config = await updateToastConfig(session.shop, { plan: real });
    }
  }
  return { config, dev: billingDevMode() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  // Dev/review fallback: flip the stored plan directly, no charge.
  if (billingDevMode()) {
    await updateToastConfig(session.shop, {
      plan: intent === "upgrade" ? "pro" : "free",
    });
    return { saved: true };
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
  await updateToastConfig(session.shop, { plan: "free" });
  return { saved: true };
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
    <s-page heading="Plan">
      <s-section heading="Your plan">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone={isPro ? "success" : "neutral"}>
            {isPro ? "Pro" : "Free"}
          </s-badge>
          <s-text color="subdued">
            You are on the {isPro ? "Pro" : "Free"} plan.
          </s-text>
        </s-stack>

        <s-paragraph>
          <strong>Free</strong> keeps all cart events, the default look,
          localization, accessibility, preview and basic grouping — nothing
          essential is crippled. <strong>Pro ($5/mo)</strong> unlocks scope:
        </s-paragraph>
        <s-unordered-list>
          {PRO_FEATURES.map((f) => (
            <s-list-item key={f}>{f.replace(/_/g, " ")}</s-list-item>
          ))}
        </s-unordered-list>

        {error ? (
          <s-banner tone="critical" heading="Billing error">
            {error}
          </s-banner>
        ) : null}

        <Form method="post">
          <input
            type="hidden"
            name="intent"
            value={isPro ? "cancel" : "upgrade"}
          />
          <s-button variant="primary" type="submit" loading={busy}>
            {isPro ? "Cancel Pro (back to Free)" : "Upgrade to Pro ($5/mo)"}
          </s-button>
        </Form>

        <s-paragraph>
          <em>
            {dev
              ? "Developer mode: plan changes are applied instantly with no charge (WON_BILLING_DEV=1)."
              : "Secure recurring billing is handled by Shopify. You’ll confirm the charge on Shopify’s page; cancel anytime."}
          </em>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
