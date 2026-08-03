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
      <s-section heading={`You are on the ${config.plan.toUpperCase()} plan`}>
        <s-paragraph>
          <strong>Free</strong> keeps all cart events, the default look,
          localization, accessibility, preview and basic grouping — nothing
          essential is crippled. <strong>Pro ($5/mo)</strong> unlocks scope:
        </s-paragraph>
        <ul>
          {PRO_FEATURES.map((f) => (
            <li key={f}>{f.replace(/_/g, " ")}</li>
          ))}
        </ul>

        <Form method="post">
          <input type="hidden" name="plan" value={isPro ? "free" : "pro"} />
          <button type="submit" disabled={busy}>
            {busy
              ? "Updating…"
              : isPro
                ? "Switch to Free"
                : "Upgrade to Pro ($5/mo)"}
          </button>
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
