import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";

import { PRO_FEATURES } from "@won/core/toasts/tier";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const plan = form.get("plan") === "pro" ? "pro" : "free";
  // NOTE: production billing is Shopify managed pricing / Billing API (needs a
  // live store). This action flips the stored plan directly for development and
  // review; wire the real recurring charge before App Store submission (MVP5
  // exit). See docs/won-toasts-build-log.md.
  await updateToastConfig(session.shop, { plan });
  return { saved: true };
};

export default function PlanRoute() {
  const { config } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const isPro = config.plan === "pro";

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

        <Form method="post">
          <input type="hidden" name="plan" value={isPro ? "free" : "pro"} />
          <s-button variant="primary" type="submit" loading={busy}>
            {isPro ? "Switch to Free" : "Upgrade to Pro ($5/mo)"}
          </s-button>
        </Form>

        <s-paragraph>
          <em>
            Development toggle. Production billing uses Shopify managed pricing /
            Billing API (connected before App Store submission).
          </em>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
