import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import type {
  MilestoneRuleConfig,
  ToastLocale,
  ToastMessages,
  ToastSemanticType,
} from "@won/core/toasts/config.types";

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

const EVENT_TYPES: ToastSemanticType[] = [
  "added",
  "removed",
  "increased",
  "decreased",
  "gift",
  "shipping",
];
const LOCALES: ToastLocale[] = ["cs", "sk", "en"];

function toCents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();

  const messages: ToastMessages = {};
  for (const type of EVENT_TYPES) {
    const perLocale: Partial<Record<ToastLocale, string>> = {};
    for (const locale of LOCALES) {
      const value = String(f.get(`msg_${type}_${locale}`) ?? "").trim();
      if (value) perLocale[locale] = value;
    }
    if (Object.keys(perLocale).length > 0) messages[type] = perLocale;
  }

  // Both milestones are always stored (with an enabled flag) so toggling off
  // persists. Thresholds are announcements — they must match the real rates.
  const milestones: MilestoneRuleConfig[] = [
    {
      id: "free_shipping",
      kind: "free_shipping",
      enabled: f.get("ms_ship_enabled") === "on",
      thresholdCents: toCents(f.get("ms_ship_threshold")),
      label: String(f.get("ms_ship_label") ?? "free shipping").slice(0, 80),
    },
    {
      id: "gift",
      kind: "gift",
      enabled: f.get("ms_gift_enabled") === "on",
      thresholdCents: 0,
      label: String(f.get("ms_gift_label") ?? "a gift").slice(0, 80),
    },
  ];

  await updateToastConfig(session.shop, { messages, milestones });
  return { saved: true };
};

export default function EventsRoute() {
  const { config } = useLoaderData<typeof loader>();
  useSavedToast();

  const ship = config.milestones.find((m) => m.kind === "free_shipping");
  const gift = config.milestones.find((m) => m.kind === "gift");

  return (
    <s-page heading="Events & messages">
      <s-section heading="Message templates">
        <s-paragraph>
          Edit the toast text per event and language. Placeholders:{" "}
          <code>{"{qty} {delta} {product} {remaining} {threshold}"}</code>.
        </s-paragraph>
        <Form method="post" data-save-bar>
          <s-stack direction="block" gap="large">
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  minWidth: 620,
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 6 }}>Event</th>
                    {LOCALES.map((l) => (
                      <th key={l} style={{ textAlign: "left", padding: 6 }}>
                        {l.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EVENT_TYPES.map((type) => (
                    <tr key={type}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{type}</td>
                      {LOCALES.map((locale) => (
                        <td key={locale} style={{ padding: 6 }}>
                          <s-text-field
                            label={`${type} ${locale.toUpperCase()} template`}
                            labelAccessibilityVisibility="exclusive"
                            name={`msg_${type}_${locale}`}
                            value={config.messages[type]?.[locale] ?? ""}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <s-section heading="Milestones (announce only — Won Toasts never grants)">
              <s-paragraph>
                Free shipping stays your Shopify shipping rate; the gift is
                handled by Won GiftLadder (a <code>_gift_progress</code> line).
                Toasts only announce the crossing, so the threshold must match
                your real rate.
              </s-paragraph>

              {/* Two bold-labelled groups on the same page — the shipping and
                  gift controls are visually separate so a toggle never looks
                  like it belongs to the other group. */}
              <s-stack direction="block" gap="large">
                <s-stack direction="block" gap="base">
                  <s-text type="strong">Free shipping</s-text>
                  <s-switch
                    label="Announce free shipping"
                    name="ms_ship_enabled"
                    value="on"
                    checked={ship?.enabled ?? false}
                  />
                  <s-text-field
                    label="Threshold (in your currency, e.g. 1500)"
                    name="ms_ship_threshold"
                    value={ship ? String(ship.thresholdCents / 100) : ""}
                  />
                  <s-text-field
                    label="Free shipping label"
                    name="ms_ship_label"
                    value={ship?.label ?? "free shipping"}
                  />
                </s-stack>

                <s-stack direction="block" gap="base">
                  <s-text type="strong">Gift</s-text>
                  <s-switch
                    label="Announce gift unlocked (with Won GiftLadder)"
                    name="ms_gift_enabled"
                    value="on"
                    checked={gift?.enabled ?? false}
                  />
                  <s-text-field
                    label="Gift label"
                    name="ms_gift_label"
                    value={gift?.label ?? "a gift"}
                  />
                </s-stack>
              </s-stack>
            </s-section>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
