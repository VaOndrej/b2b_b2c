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
import { PlanBadge } from "../components/PlanBadge";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";
import { pageLabel } from "../lib/labels";

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

  return (
    <s-page heading="Targeting" inlineSize="large">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}
      {/* One visual section, not two cards (Wave-0 decision): "where toasts show"
          is a single question. Free leads with the always-usable default (run
          everywhere, turn off where needed); Pro narrows it down below a divider.
          The two data models (exclusions Free, targeting Pro) stay separate and
          are gated independently in the action + gateConfigForPlan — only the UI
          merges. Free must never read as blocked. */}
      <Form method="post" data-save-bar>
        <s-section heading="Where toasts show">
          <s-stack direction="block" gap="large">
            <s-paragraph>
              By default toasts run on <s-text type="strong">every page</s-text>.
              Turn them off where they don’t belong (Free), or narrow them to
              specific pages, devices and customers (Pro).
            </s-paragraph>

            {/* ---- Run everywhere, except… (Free) ---- */}
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="small">
                <s-text type="strong">Run everywhere, except…</s-text>
                <PlanBadge tier="free" />
              </s-stack>
              <s-text color="subdued">
                Excluded pages and URLs stop{" "}
                <s-text type="strong">everything</s-text> — cart toasts and
                notifications alike.
              </s-text>

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

            {/* ---- Narrow it down (Pro), same card, below a divider ---- */}
            <s-box borderWidth="base" />

            <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="large">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text type="strong">Narrow it down</s-text>
                  {/* This IS the page's Free-vs-Pro split, so the Pro marker earns
                      its place here (it pairs with the Free badge above) even though
                      the amber frame already hints at it. */}
                  <PlanBadge tier="pro" locked={!isPro} />
                </s-stack>
                {!isPro ? (
                  <s-paragraph>
                    On Free, toasts run everywhere (minus your exclusions above).{" "}
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
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}
