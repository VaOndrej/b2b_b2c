import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { sanitizeGlobalSettings } from "@won/core/toasts/config.defaults";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { PositionField } from "../components/PositionField";
import { useSavedToast } from "../lib/use-saved-toast";

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
    // switches: absent means false
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
    frequency: {
      maxPerSession: form.get("maxPerSession"),
      cooldownMs: form.get("cooldownMs"),
      suppressAfterDismissMs: form.get("suppressAfterDismissMs"),
      quietMode: form.get("quietMode") === "on",
    },
  });

  // Merge onto the shop's current global so unrelated fields are preserved
  // (deep-merge nested groups so their untouched keys survive too).
  const current = await getToastConfig(session.shop);
  const merged = { ...current.global, ...patch };
  if (patch.grouping) {
    merged.grouping = { ...current.global.grouping, ...patch.grouping };
  }
  if (patch.frequency) {
    merged.frequency = { ...current.global.frequency, ...patch.frequency };
  }
  await updateToastConfig(session.shop, { global: merged });
  return { saved: true };
};

export default function BehaviorRoute() {
  const { config } = useLoaderData<typeof loader>();
  const g = config.global;
  useSavedToast();

  return (
    <s-page heading="Behavior">
      <s-section heading="How toasts appear and dismiss">
        <s-paragraph>
          These are the storefront defaults. Every value is stored here in the
          admin — the storefront only renders what you configure. Design
          (colours, animation) lives on the Appearance page.
        </s-paragraph>

        <Form method="post" data-save-bar>
          <s-stack direction="block" gap="large">
            <PositionField name="position" defaultValue={g.position} />

            <s-number-field
              label="Duration (ms)"
              name="durationMs"
              value={String(g.durationMs)}
              min={800}
              max={60000}
              step={100}
            />

            <s-stack direction="inline" gap="base">
              <s-number-field
                label="Offset top/bottom (px)"
                name="offsetTop"
                value={String(g.offsetTop)}
                min={0}
                max={400}
              />
              <s-number-field
                label="Offset inline (px)"
                name="offsetInline"
                value={String(g.offsetInline)}
                min={0}
                max={400}
              />
              <s-number-field
                label="Max visible"
                name="maxVisible"
                value={String(g.maxVisible)}
                min={1}
                max={6}
              />
            </s-stack>

            <s-select
              label="Stack direction"
              name="stackDirection"
              value={g.stackDirection}
            >
              <s-option value="newest-top">newest-top</s-option>
              <s-option value="newest-bottom">newest-bottom</s-option>
            </s-select>

            <s-select
              label="Overflow strategy"
              name="overflowStrategy"
              value={g.overflowStrategy}
            >
              <s-option value="collapse">collapse (+N more)</s-option>
              <s-option value="queue">queue</s-option>
            </s-select>

            <s-select
              label="Click a toast to…"
              name="clickAction"
              value={g.clickAction}
            >
              <s-option value="open-cart">open cart</s-option>
              <s-option value="go-to-product">go to product</s-option>
              <s-option value="none">do nothing</s-option>
            </s-select>

            <s-switch
              label="Auto-dismiss after the duration"
              name="autoDismiss"
              value="on"
              checked={g.autoDismiss}
            />
            <s-switch
              label="Pause auto-dismiss on hover"
              name="pauseOnHover"
              value="on"
              checked={g.pauseOnHover}
            />
            <s-switch
              label="Show a close (×) button"
              name="closeable"
              value="on"
              checked={g.closeable}
            />

            <s-section heading="Grouping & anti-spam">
              <s-stack direction="block" gap="base">
                <s-select
                  label="Group rapid changes"
                  name="grouping_mode"
                  value={g.grouping.mode}
                >
                  <s-option value="by-product">by product</s-option>
                  <s-option value="by-variant">by variant</s-option>
                  <s-option value="by-type">by event type</s-option>
                  <s-option value="off">off</s-option>
                </s-select>
                <s-number-field
                  label="Burst window (ms)"
                  name="burstWindowMs"
                  value={String(g.grouping.burstWindowMs)}
                  min={0}
                  max={5000}
                  step={50}
                />
                <s-number-field
                  label="Dedupe window (ms)"
                  name="dedupeWindowMs"
                  value={String(g.grouping.dedupeWindowMs)}
                  min={0}
                  max={10000}
                  step={100}
                />
                <s-number-field
                  label="Max toasts / minute"
                  name="rateLimitPerMin"
                  value={String(g.grouping.rateLimitPerMin)}
                  min={0}
                  max={240}
                />
                <s-switch
                  label="Merge quantity changes into one “+N”"
                  name="mergeDeltas"
                  value="on"
                  checked={g.grouping.mergeDeltas}
                />
              </s-stack>
            </s-section>

            {/* MVP8 — frequency governance. Caps how often toasts appear per
                visitor; the storefront enforces these limits before rendering. */}
            <s-section heading="Frequency &amp; quiet mode">
              <s-paragraph>
                Protects shoppers from spam. 0 means no limit. Quiet mode mutes
                everything without changing your other settings.
              </s-paragraph>
              <s-stack direction="block" gap="base">
                <s-number-field
                  label="Max toasts per session (0 = unlimited)"
                  name="maxPerSession"
                  value={String(g.frequency.maxPerSession)}
                  min={0}
                  max={100}
                />
                <s-number-field
                  label="Cooldown between same-type toasts (ms)"
                  name="cooldownMs"
                  value={String(g.frequency.cooldownMs)}
                  min={0}
                  max={3600000}
                  step={100}
                />
                <s-number-field
                  label="Hide a dismissed toast for (ms)"
                  name="suppressAfterDismissMs"
                  value={String(g.frequency.suppressAfterDismissMs)}
                  min={0}
                  max={86400000}
                  step={1000}
                />
                <s-switch
                  label="Quiet mode — mute all toasts"
                  name="quietMode"
                  value="on"
                  checked={g.frequency.quietMode}
                />
              </s-stack>
            </s-section>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
