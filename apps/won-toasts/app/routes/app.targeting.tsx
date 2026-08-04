import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import type { PageType } from "@won/core/toasts/targeting";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { useSavedToast } from "../lib/use-saved-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

const PAGE_TYPES: PageType[] = [
  "product",
  "collection",
  "cart",
  "home",
  "search",
  "other",
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  if (config.plan !== "pro") {
    return { saved: false, gated: true };
  }
  const form = await request.formData();
  const pages = PAGE_TYPES.filter((p) => form.get(`page_${p}`) === "on");
  await updateToastConfig(session.shop, {
    targeting: {
      pages,
      device: (form.get("device") as "both" | "mobile" | "desktop") ?? "both",
      customerState:
        (form.get("customerState") as "both" | "guest" | "logged-in") ?? "both",
    },
  });
  return { saved: true };
};

export default function TargetingRoute() {
  const { config } = useLoaderData<typeof loader>();
  useSavedToast();
  const isPro = config.plan === "pro";
  const t = config.targeting;

  return (
    <s-page heading="Targeting">
      {!isPro ? (
        <s-section heading="Targeting is a Pro feature">
          <s-banner tone="info" heading="Toasts run everywhere on Free">
            Choosing which pages, devices and customers see toasts is part of
            Pro.
          </s-banner>
          <s-paragraph>
            <s-link href="/app/plan">Upgrade to Pro</s-link> to enable
            targeting.
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Where toasts run">
        <Form method="post" data-save-bar>
          <s-stack direction="block" gap="large">
            <s-stack direction="block" gap="base">
              <s-text type="strong">Pages (none = all pages)</s-text>
              <s-stack direction="inline" gap="base">
                {PAGE_TYPES.map((p) => (
                  <s-checkbox
                    key={p}
                    label={p}
                    name={`page_${p}`}
                    value="on"
                    checked={t.pages.includes(p)}
                    disabled={!isPro}
                  />
                ))}
              </s-stack>
            </s-stack>

            <s-select
              label="Device"
              name="device"
              value={t.device}
              disabled={!isPro}
            >
              <s-option value="both">both</s-option>
              <s-option value="mobile">mobile only</s-option>
              <s-option value="desktop">desktop only</s-option>
            </s-select>

            <s-select
              label="Customer"
              name="customerState"
              value={t.customerState}
              disabled={!isPro}
            >
              <s-option value="both">everyone</s-option>
              <s-option value="guest">guests only</s-option>
              <s-option value="logged-in">logged-in only</s-option>
            </s-select>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
