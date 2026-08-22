// Per-type Look & timing override (doctrine §7c: configure a toast where it
// lives, no jumping to Design). Fields are pre-filled from the RESOLVED default
// for this type; on save the action stores only what differs (default +
// override, §8b/§8). Pro scope. Field names are namespaced `bt_<key>_*`.
//
// This used to hide inside a bare <details> triangle — the single most valuable
// Pro feature in the app, rendered visually weaker than the plain <select> next
// to it. A hidden Pro feature cannot be desired (§16a), and a collapsed block
// that says nothing breaks §9d. It is now a first-class WonSection whose header
// states, from the shared formatter, whether this toast inherits the global
// design or diverges — and whose locked state SHOWS what Pro buys (§16c).

import type { ToastAppConfig, ToastTypeKey } from "@won/core/toasts/config.types";
import { describeTypeStyle } from "@won/core/toasts/describe";
import { resolveTypeStyle } from "@won/core/toasts/type-style";

import { MiniToast, MiniToastPair } from "./MiniToast";
import { ProSell } from "./ProSell";
import { WonBlock, WonSection } from "./WonSection";

/** Sample content for the proof — one recognisable cart toast. */
const SAMPLE = { title: "Added to cart", detail: "Widget Pro", delta: "+1" };

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
  const summary = describeTypeStyle(config, typeKey);
  const customised = summary !== "Inherits your global design";

  // The mechanism, drawn with the SAME renderer the storefront uses (A1): the
  // global look on the left, a visibly different per-type look on the right. The
  // right-hand card is a demonstration of the capability, not a claim about the
  // merchant's data — §12 is about shopper-facing facts, and this states none.
  const proof = (
    <MiniToastPair
      left={
        <MiniToast
          theme={config.theme}
          title={SAMPLE.title}
          detail={SAMPLE.detail}
          delta={SAMPLE.delta}
          wonType={typeKey}
          label="Your global design"
        />
      }
      right={
        <MiniToast
          theme={{ ...config.theme, mode: "dark", colorBg: "#15181d", colorText: "#f4f6f8", cornerRadius: 4 }}
          title={SAMPLE.title}
          detail={SAMPLE.detail}
          delta={SAMPLE.delta}
          wonType={typeKey}
          label="This toast, its own way"
        />
      }
    />
  );

  return (
    <WonSection
      title="Look & timing for this toast"
      glyph="look"
      summary={summary}
      hint={
        customised
          ? "Only this toast uses these values — your other toasts keep the global look."
          : "Change anything here and it applies to only this toast."
      }
      pro
      locked={!isPro}
      collapsible
      defaultOpen={customised}
    >
      <s-stack direction="block" gap="base">
        {!isPro ? (
          <ProSell
            benefit="Give this one toast its own colours, size and timing — so your cart toast doesn’t have to look like your announcements."
            proof={proof}
          />
        ) : null}

        <WonBlock title="Look" summary="Colours, shape and motion for this toast only.">
          <s-stack direction="block" gap="base">
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
              <s-select label="Shadow" name={`bt_${p}_shadow`} value={theme.shadow} disabled={!isPro} details="How far the toast appears to lift off the page.">
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
              <s-select label="Entry animation" name={`bt_${p}_animationIn`} value={theme.animationIn} disabled={!isPro} details="How this toast slides or fades in.">
                <s-option value="slide">Slide</s-option>
                <s-option value="fade">Fade</s-option>
                <s-option value="pop">Pop</s-option>
                <s-option value="slide-scale">Slide + scale</s-option>
              </s-select>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-switch label="Product image" name={`bt_${p}_showImage`} value="on" checked={theme.showImage} disabled={!isPro} details="Show the item’s thumbnail (cart toasts)." />
              <s-switch label="Quantity change (+N)" name={`bt_${p}_showDelta`} value="on" checked={theme.showDelta} disabled={!isPro} details="Show the “+N” badge (cart toasts)." />
              <s-switch label="Border" name={`bt_${p}_border`} value="on" checked={theme.border} disabled={!isPro} details="Draw a thin outline around this toast." />
              <s-switch label="Backdrop blur" name={`bt_${p}_backdropBlur`} value="on" checked={theme.backdropBlur} disabled={!isPro} details="Frost whatever sits behind the toast." />
            </s-stack>
            <s-color-field label="Border colour" name={`bt_${p}_borderColor`} value={theme.borderColor} disabled={!isPro} details="Used when Border is on." />
          </s-stack>
        </WonBlock>

        <WonBlock title="Timing & interaction" summary="How long this toast stays and what a click does.">
          <s-stack direction="block" gap="base">
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
        </WonBlock>
      </s-stack>
    </WonSection>
  );
}
