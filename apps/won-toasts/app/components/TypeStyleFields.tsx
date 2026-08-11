// Per-type Look & timing override (doctrine §7c: configure a toast where it lives,
// no jumping to Design). Fields are pre-filled from the RESOLVED default for this
// type; on save the action stores only what differs (default + override, §8b/§8).
// Pro scope (per-type customisation). Field names are namespaced `bt_<key>_*`.

import type { ToastAppConfig, ToastTypeKey } from "@won/core/toasts/config.types";
import { resolveTypeStyle } from "@won/core/toasts/type-style";

import { ProFrame } from "./ProFrame";
import { PlanBadge } from "./PlanBadge";

export function TypeStyleFields({
  typeKey,
  config,
  isPro,
}: {
  typeKey: ToastTypeKey;
  config: ToastAppConfig;
  isPro: boolean;
}) {
  const { theme, behavior } = resolveTypeStyle(config, typeKey);
  const p = typeKey;
  // Whether this type actually diverges from the global Design — drives the
  // summary hint so a collapsed override still tells you if it's touched.
  const customised = Boolean(
    config.byType?.[typeKey]?.theme || config.byType?.[typeKey]?.behavior,
  );

  // Collapsed disclosure (merchant-review point 3): per-type look & timing is a
  // power feature almost nobody opens, so it must not dominate the page. The
  // summary still surfaces the Pro badge + whether it's customised; the single
  // ProFrame container replaces the old s-box+ProFrame nesting that clashed.
  // Hidden <details> fields still submit — collapsing only affects visibility.
  return (
    <details style={{ marginTop: 4 }}>
      {/* inline-flex span (not s-stack, which is block) so the content sits NEXT
          TO the disclosure triangle, not on the line below it. */}
      <summary style={{ cursor: "pointer", padding: "6px 0" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, verticalAlign: "middle" }}>
          <s-text type="strong">Look &amp; timing for this toast</s-text>
          <PlanBadge tier="pro" locked={!isPro} />
          <s-text color="subdued">
            {customised ? "· customised" : "· inherits your global Design"}
          </s-text>
        </span>
      </summary>
      <ProFrame locked={!isPro}>
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Leave everything as-is to inherit your global Design. Change anything
            here and it applies to <s-text type="strong">only this toast</s-text> —
            your other toasts keep the global look.
          </s-text>

          <s-text type="strong">Look</s-text>
          <s-select label="Theme mode" name={`bt_${p}_mode`} value={theme.mode} disabled={!isPro} details="System follows the shopper's light/dark; custom uses the colours below.">
            <s-option value="system">System (auto light/dark)</s-option>
            <s-option value="light">Light</s-option>
            <s-option value="dark">Dark</s-option>
            <s-option value="custom">Custom colours</s-option>
          </s-select>
          <s-stack direction="inline" gap="base">
            <s-color-field label="Background" name={`bt_${p}_colorBg`} value={theme.colorBg} disabled={!isPro} details="Used when theme mode is Custom." />
            <s-color-field label="Text" name={`bt_${p}_colorText`} value={theme.colorText} disabled={!isPro} details="Used when theme mode is Custom." />
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-number-field label="Corner radius" name={`bt_${p}_cornerRadius`} value={String(theme.cornerRadius)} min={0} max={32} disabled={!isPro} details="Roundness of the corners, in pixels (0 = square)." />
            <s-number-field label="Width" name={`bt_${p}_width`} value={String(theme.width)} min={240} max={600} disabled={!isPro} details="How wide this toast is, in pixels." />
            <s-select label="Shadow" name={`bt_${p}_shadow`} value={theme.shadow} disabled={!isPro}>
              <s-option value="none">None</s-option>
              <s-option value="sm">Small</s-option>
              <s-option value="md">Medium</s-option>
              <s-option value="lg">Large</s-option>
            </s-select>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-select label="Density" name={`bt_${p}_density`} value={theme.density} disabled={!isPro} details="Compact packs the text tighter.">
              <s-option value="comfortable">Comfortable</s-option>
              <s-option value="compact">Compact</s-option>
            </s-select>
            <s-select label="Entry animation" name={`bt_${p}_animationIn`} value={theme.animationIn} disabled={!isPro} details="How this toast slides/fades in.">
              <s-option value="slide">Slide</s-option>
              <s-option value="fade">Fade</s-option>
              <s-option value="pop">Pop</s-option>
              <s-option value="slide-scale">Slide + scale</s-option>
            </s-select>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-switch label="Product image" name={`bt_${p}_showImage`} value="on" checked={theme.showImage} disabled={!isPro} details="Show the item’s thumbnail (cart toasts)." />
            <s-switch label="Quantity change (+N)" name={`bt_${p}_showDelta`} value="on" checked={theme.showDelta} disabled={!isPro} details="Show the “+N” badge (cart toasts)." />
            <s-switch label="Border" name={`bt_${p}_border`} value="on" checked={theme.border} disabled={!isPro} />
            <s-switch label="Backdrop blur" name={`bt_${p}_backdropBlur`} value="on" checked={theme.backdropBlur} disabled={!isPro} />
          </s-stack>
          <s-color-field label="Border colour" name={`bt_${p}_borderColor`} value={theme.borderColor} disabled={!isPro} details="Used when Border is on." />

          <s-text type="strong">Timing &amp; interaction</s-text>
          <s-stack direction="inline" gap="base">
            <s-number-field label="Stay on screen for" name={`bt_${p}_durationSec`} value={String(behavior.durationMs / 1000)} min={1} max={60} step={0.5} disabled={!isPro} details="Seconds this toast stays before it fades out." />
            <s-select label="Click a toast to…" name={`bt_${p}_clickAction`} value={behavior.clickAction} disabled={!isPro} details="What happens when a shopper clicks this toast.">
              <s-option value="open-cart">Open the cart</s-option>
              <s-option value="go-to-product">Go to the product</s-option>
              <s-option value="none">Do nothing</s-option>
            </s-select>
          </s-stack>
          <s-switch label="Show a close (×) button" name={`bt_${p}_closeable`} value="on" checked={behavior.closeable} disabled={!isPro} details="Lets shoppers dismiss this toast themselves." />
        </s-stack>
      </ProFrame>
    </details>
  );
}
