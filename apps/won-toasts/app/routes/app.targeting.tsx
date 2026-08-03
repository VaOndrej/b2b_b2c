import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import type { PageType } from "@won/core/toasts/targeting";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";

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

const control = {
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  font: "inherit",
  padding: "8px 10px",
} as const;

export default function TargetingRoute() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const isPro = config.plan === "pro";
  const t = config.targeting;

  return (
    <s-page heading="Targeting">
      {!isPro ? (
        <s-section heading="Pro feature">
          <s-paragraph>
            Targeting (which pages, devices and customers see toasts) is part of
            Pro. <a href="/app/plan">Upgrade to Pro</a> to enable it. Toasts run
            everywhere on Free.
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Where toasts run">
        <Form method="post">
          <fieldset
            disabled={!isPro}
            style={{ border: 0, padding: 0, opacity: isPro ? 1 : 0.55 }}
          >
            <div style={{ display: "grid", gap: 18, maxWidth: 420 }}>
              <div>
                <div style={{ marginBottom: 6 }}>Pages (none = all pages)</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {PAGE_TYPES.map((p) => (
                    <label
                      key={p}
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <input
                        type="checkbox"
                        name={`page_${p}`}
                        defaultChecked={t.pages.includes(p)}
                      />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label style={{ display: "grid", gap: 4 }}>
                <span>Device</span>
                <select name="device" defaultValue={t.device} style={control}>
                  <option value="both">both</option>
                  <option value="mobile">mobile only</option>
                  <option value="desktop">desktop only</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span>Customer</span>
                <select
                  name="customerState"
                  defaultValue={t.customerState}
                  style={control}
                >
                  <option value="both">everyone</option>
                  <option value="guest">guests only</option>
                  <option value="logged-in">logged-in only</option>
                </select>
              </label>

              <div>
                <button type="submit" disabled={!isPro || saving}>
                  {saving ? "Saving…" : "Save targeting"}
                </button>
                {actionData?.saved ? (
                  <span style={{ marginLeft: 12, color: "#1f8f5f" }}>Saved.</span>
                ) : null}
              </div>
            </div>
          </fieldset>
        </Form>
      </s-section>
    </s-page>
  );
}
