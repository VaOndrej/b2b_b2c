import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import type { PageType } from "@won/core/toasts/targeting";
import { PAGE_TYPES } from "@won/core/toasts/targeting";
import { sanitizeExclusions } from "@won/core/toasts/exclusions";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { ProFrame } from "../components/ProFrame";
import { SegmentedNav } from "../components/SegmentedNav";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";
import { pageLabel } from "../lib/labels";

const TARGETING_SEGMENTS = [
  { key: "never", label: "Where it never runs" },
  { key: "run", label: "Where it runs", pro: true },
];

const PAGES = PAGE_TYPES as readonly PageType[];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const form = await request.formData();

  // Exclusions are Free — always saved.
  const exPages = PAGES.filter((p) => form.get(`exclude_page_${p}`) === "on");
  const exUrls = String(form.get("exclude_urls") ?? "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);

  const updates: Parameters<typeof updateToastConfig>[1] = {
    exclusions: sanitizeExclusions({ pages: exPages, urls: exUrls }),
  };

  // Positive targeting (which pages/devices/customers SEE toasts) is Pro.
  if (config.plan === "pro") {
    const pages = PAGES.filter((p) => form.get(`page_${p}`) === "on");
    updates.targeting = {
      pages,
      device: (form.get("device") as "both" | "mobile" | "desktop") ?? "both",
      customerState:
        (form.get("customerState") as "both" | "guest" | "logged-in") ?? "both",
    };
  }

  return persistConfig(() => updateToastConfig(session.shop, updates));
};

export default function TargetingRoute() {
  const { config } = useLoaderData<typeof loader>();
  const saveError = useSavedToast();
  const isPro = config.plan === "pro";
  const t = config.targeting;
  const ex = config.exclusions;
  const [seg, setSeg] = useState("never");
  const panel = (key: string): React.CSSProperties => ({
    display: seg === key ? "block" : "none",
  });

  return (
    <s-page heading="Targeting">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}
      <s-section>
        <s-paragraph>
          Decide <s-text type="strong">where</s-text> toasts run. Choosing
          specific pages, devices and customers is Pro; turning the app off on
          specific pages is Free.
        </s-paragraph>
      </s-section>

      {/* Same studio shell as Toasts/Design (doctrine §7b). */}
      <SegmentedNav items={TARGETING_SEGMENTS} selected={seg} onSelect={setSeg} ariaLabel="Targeting sections" />

      <Form method="post" data-save-bar>
        {/* ---- Where toasts run (Pro) ---- */}
        <div style={panel("run")}>
        <s-section heading="Where toasts run">
          <ProFrame locked={!isPro}>
          <s-stack direction="block" gap="large">
            <s-badge tone={isPro ? "success" : "info"}>
              {isPro ? "Pro" : "Pro — upgrade to choose"}
            </s-badge>
            {!isPro ? (
              <s-paragraph>
                On Free, toasts run everywhere (minus your exclusions below).{" "}
                <s-link href="/app/plan">Upgrade to Pro</s-link> to target
                specific pages, devices and customers.
              </s-paragraph>
            ) : null}

            <s-stack direction="block" gap="small">
              <s-text type="strong">Pages</s-text>
              <s-text color="subdued">
                None selected = every page. Pick pages to run only there.
              </s-text>
              <s-stack direction="inline" gap="base">
                {PAGES.map((p) => (
                  <s-checkbox
                    key={p}
                    label={pageLabel(p)}
                    name={`page_${p}`}
                    value="on"
                    checked={t.pages.includes(p)}
                    disabled={!isPro}
                  />
                ))}
              </s-stack>
            </s-stack>

            <s-select
              label="Devices"
              name="device"
              value={t.device}
              disabled={!isPro}
              details="Limit toasts to one device type, or show on both."
            >
              <s-option value="both">Both</s-option>
              <s-option value="mobile">Mobile only</s-option>
              <s-option value="desktop">Desktop only</s-option>
            </s-select>

            <s-select
              label="Customers"
              name="customerState"
              value={t.customerState}
              disabled={!isPro}
              details="Show to everyone, or only guests / only logged-in shoppers."
            >
              <s-option value="both">Everyone</s-option>
              <s-option value="guest">Guests only</s-option>
              <s-option value="logged-in">Logged-in only</s-option>
            </s-select>
          </s-stack>
          </ProFrame>
        </s-section>
        </div>

        {/* ---- Where they never run (Free) ---- */}
        <div style={panel("never")}>
        <s-section heading="Where they never run">
          <s-stack direction="block" gap="large">
            <s-badge tone="success">Free</s-badge>
            <s-paragraph>
              Turn the app off where it doesn’t belong. Excluded pages and URLs
              stop <s-text type="strong">everything</s-text> — cart toasts and
              notifications alike.
            </s-paragraph>

            <s-stack direction="block" gap="small">
              <s-text type="strong">Whole page types</s-text>
              <s-stack direction="inline" gap="base">
                {PAGES.map((p) => (
                  <s-checkbox
                    key={p}
                    label={pageLabel(p)}
                    name={`exclude_page_${p}`}
                    value="on"
                    checked={ex.pages.includes(p)}
                  />
                ))}
              </s-stack>
            </s-stack>

            <s-text-area
              label="Specific URLs"
              name="exclude_urls"
              rows={5}
              value={ex.urls.join("\n")}
              placeholder={"/checkout*\n/pages/legal"}
              details="One pattern per line. Use * as a wildcard (e.g. /checkout*). Query strings and hashes are ignored."
            />

            <s-text color="subdued">
              You can also add{" "}
              <s-text type="strong">
                {'<meta name="won-toasts:active" content="false">'}
              </s-text>{" "}
              to any template to opt that page out with no config here.
            </s-text>
          </s-stack>
        </s-section>
        </div>
      </Form>
    </s-page>
  );
}
