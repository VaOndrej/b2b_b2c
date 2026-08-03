import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

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

const input = {
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  font: "inherit",
  padding: "6px 8px",
  width: "100%",
} as const;

export default function EventsRoute() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const ship = config.milestones.find((m) => m.kind === "free_shipping");
  const gift = config.milestones.find((m) => m.kind === "gift");

  return (
    <s-page heading="Events &amp; messages">
      <s-section heading="Message templates">
        <s-paragraph>
          Edit the toast text per event and language. Placeholders:{" "}
          <code>{"{qty} {delta} {product} {remaining} {threshold}"}</code>.
        </s-paragraph>
        <Form method="post">
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
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
                        <input
                          name={`msg_${type}_${locale}`}
                          defaultValue={config.messages[type]?.[locale] ?? ""}
                          style={input}
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
              Free shipping stays your Shopify shipping rate; the gift is handled
              by Won GiftLadder (a <code>_gift_progress</code> line). Toasts only
              announce the crossing, so the threshold must match your real rate.
            </s-paragraph>

            <div style={{ display: "grid", gap: 12, maxWidth: 480, marginBottom: 18 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="ms_ship_enabled"
                  defaultChecked={ship?.enabled ?? false}
                />
                <span>Announce free shipping</span>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Threshold (in your currency, e.g. 1500)</span>
                <input
                  name="ms_ship_threshold"
                  defaultValue={ship ? String(ship.thresholdCents / 100) : ""}
                  style={{ ...input, maxWidth: 220 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Label</span>
                <input
                  name="ms_ship_label"
                  defaultValue={ship?.label ?? "free shipping"}
                  style={{ ...input, maxWidth: 300 }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="ms_gift_enabled"
                  defaultChecked={gift?.enabled ?? false}
                />
                <span>Announce gift unlocked (with Won GiftLadder)</span>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Label</span>
                <input
                  name="ms_gift_label"
                  defaultValue={gift?.label ?? "a gift"}
                  style={{ ...input, maxWidth: 300 }}
                />
              </label>
            </div>
          </s-section>

          <div style={{ marginTop: 18 }}>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save events"}
            </button>
            {actionData?.saved ? (
              <span style={{ marginLeft: 12, color: "#1f8f5f" }}>Saved.</span>
            ) : null}
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
