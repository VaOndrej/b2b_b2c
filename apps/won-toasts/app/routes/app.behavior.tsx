import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { sanitizeGlobalSettings } from "@won/core/toasts/config.defaults";

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

  const patch = sanitizeGlobalSettings({
    position: form.get("position"),
    offsetTop: form.get("offsetTop"),
    offsetInline: form.get("offsetInline"),
    durationMs: form.get("durationMs"),
    maxVisible: form.get("maxVisible"),
    clickAction: form.get("clickAction"),
    stackDirection: form.get("stackDirection"),
    overflowStrategy: form.get("overflowStrategy"),
    // checkboxes: absent means false
    autoDismiss: form.get("autoDismiss") === "on",
    pauseOnHover: form.get("pauseOnHover") === "on",
    closeable: form.get("closeable") === "on",
    grouping: {
      mode: form.get("grouping_mode"),
      burstWindowMs: form.get("burstWindowMs"),
      dedupeWindowMs: form.get("dedupeWindowMs"),
      rateLimitPerMin: form.get("rateLimitPerMin"),
      mergeDeltas: form.get("mergeDeltas") === "on",
    },
  });

  // Merge onto the shop's current global so unrelated fields are preserved
  // (deep-merge grouping so its untouched keys survive too).
  const current = await getToastConfig(session.shop);
  const merged = { ...current.global, ...patch };
  if (patch.grouping) {
    merged.grouping = { ...current.global.grouping, ...patch.grouping };
  }
  await updateToastConfig(session.shop, { global: merged });
  return { saved: true };
};

const POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

const field = { display: "grid", gap: "6px", maxWidth: "360px" } as const;
const input = {
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  font: "inherit",
  padding: "8px 10px",
} as const;
const row = { display: "flex", gap: "10px", alignItems: "center" } as const;

export default function BehaviorRoute() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const g = config.global;

  return (
    <s-page heading="Behavior">
      <s-section heading="How toasts appear and dismiss">
        <s-paragraph>
          These are the storefront defaults. Every value is stored here in the
          admin — the storefront only renders what you configure. Design (colors,
          animation) lives on the Appearance page.
        </s-paragraph>

        <Form method="post">
          <div style={{ display: "grid", gap: "18px" }}>
            <label style={field}>
              <span>Position</span>
              <select name="position" defaultValue={g.position} style={input}>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label style={field}>
              <span>Duration (ms)</span>
              <input
                type="number"
                name="durationMs"
                min={800}
                max={60000}
                step={100}
                defaultValue={g.durationMs}
                style={input}
              />
            </label>

            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <label style={field}>
                <span>Offset top/bottom (px)</span>
                <input
                  type="number"
                  name="offsetTop"
                  min={0}
                  max={400}
                  defaultValue={g.offsetTop}
                  style={input}
                />
              </label>
              <label style={field}>
                <span>Offset inline (px)</span>
                <input
                  type="number"
                  name="offsetInline"
                  min={0}
                  max={400}
                  defaultValue={g.offsetInline}
                  style={input}
                />
              </label>
              <label style={field}>
                <span>Max visible</span>
                <input
                  type="number"
                  name="maxVisible"
                  min={1}
                  max={6}
                  defaultValue={g.maxVisible}
                  style={input}
                />
              </label>
            </div>

            <label style={field}>
              <span>Stack direction</span>
              <select
                name="stackDirection"
                defaultValue={g.stackDirection}
                style={input}
              >
                <option value="newest-top">newest-top</option>
                <option value="newest-bottom">newest-bottom</option>
              </select>
            </label>

            <label style={field}>
              <span>Overflow strategy</span>
              <select
                name="overflowStrategy"
                defaultValue={g.overflowStrategy}
                style={input}
              >
                <option value="collapse">collapse (+N more)</option>
                <option value="queue">queue</option>
              </select>
            </label>

            <label style={field}>
              <span>Click a toast to…</span>
              <select
                name="clickAction"
                defaultValue={g.clickAction}
                style={input}
              >
                <option value="open-cart">open cart</option>
                <option value="go-to-product">go to product</option>
                <option value="none">do nothing</option>
              </select>
            </label>

            <label style={row}>
              <input
                type="checkbox"
                name="autoDismiss"
                defaultChecked={g.autoDismiss}
              />
              <span>Auto-dismiss after the duration</span>
            </label>
            <label style={row}>
              <input
                type="checkbox"
                name="pauseOnHover"
                defaultChecked={g.pauseOnHover}
              />
              <span>Pause auto-dismiss on hover</span>
            </label>
            <label style={row}>
              <input
                type="checkbox"
                name="closeable"
                defaultChecked={g.closeable}
              />
              <span>Show a close (×) button</span>
            </label>

            <fieldset
              style={{ border: "1px solid #e2e6ea", borderRadius: 10, padding: 14 }}
            >
              <legend>Grouping &amp; anti-spam</legend>
              <div style={{ display: "grid", gap: "14px", maxWidth: 360 }}>
                <label style={field}>
                  <span>Group rapid changes</span>
                  <select
                    name="grouping_mode"
                    defaultValue={g.grouping.mode}
                    style={input}
                  >
                    <option value="by-product">by product</option>
                    <option value="by-variant">by variant</option>
                    <option value="by-type">by event type</option>
                    <option value="off">off</option>
                  </select>
                </label>
                <label style={field}>
                  <span>Burst window (ms)</span>
                  <input
                    type="number"
                    name="burstWindowMs"
                    min={0}
                    max={5000}
                    step={50}
                    defaultValue={g.grouping.burstWindowMs}
                    style={input}
                  />
                </label>
                <label style={field}>
                  <span>Dedupe window (ms)</span>
                  <input
                    type="number"
                    name="dedupeWindowMs"
                    min={0}
                    max={10000}
                    step={100}
                    defaultValue={g.grouping.dedupeWindowMs}
                    style={input}
                  />
                </label>
                <label style={field}>
                  <span>Max toasts / minute</span>
                  <input
                    type="number"
                    name="rateLimitPerMin"
                    min={0}
                    max={240}
                    defaultValue={g.grouping.rateLimitPerMin}
                    style={input}
                  />
                </label>
                <label style={row}>
                  <input
                    type="checkbox"
                    name="mergeDeltas"
                    defaultChecked={g.grouping.mergeDeltas}
                  />
                  <span>Merge quantity changes into one “+N”</span>
                </label>
              </div>
            </fieldset>

            <div>
              <button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save behavior"}
              </button>
              {actionData?.saved ? (
                <span style={{ marginLeft: "12px", color: "#1f8f5f" }}>
                  Saved.
                </span>
              ) : null}
            </div>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}
