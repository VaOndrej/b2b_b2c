import type { CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";

import { WON_FAINT, WON_FONT } from "../lib/tokens";
import { WonToastCard } from "./WonToastCard";

// Live preview for a single notification recipe.
//
// It renders the SHARED WonToastCard (A1). It used to hand-draw its own card —
// a second implementation of the app's core visual primitive, which is exactly
// the drift A1 exists to forbid — and it drew `banner` as a full-width bar and
// `inline` as bare coloured text.
//
// THE STOREFRONT DOES NEITHER. In storefront-src/won-toasts.js, `surface` feeds
// only `isPersistentSurface()`: banner / inline / persistent-toast mean "don't
// auto-dismiss and stay exempt from the max-visible cap". Every surface renders
// through the same `notifCard()` into the same toast region. Showing a merchant
// a full-width bar for "Banner" was a preview of a state the runtime cannot
// produce — A4 ("a preview showing an impossible state is lying").
//
// So the shape is the same toast everywhere, and the surface is reported as what
// it actually controls: how long it stays.

type RecipeKey =
  | "countdown"
  | "announcement"
  | "stock.low"
  | "cart.activity"
  | "order.summary"
  | "order.created";

type Surface = "toast" | "banner" | "persistent-toast" | "inline";

// The storefront's notifCard() hard-codes `accentFor("info")` for EVERY
// notification type and never calls iconFor(). The preview used to pick a
// per-recipe accent (countdown → shipping green, stock.low → decreased red) and
// draw an icon, so a merchant tuning "Accent colour per event" on the Design
// page saw a colour on these toasts that their shoppers would never get.
// Matching the runtime is not a downgrade — it's the difference between a
// preview and a mock-up (A1).
const NOTIFICATION_ACCENT: ToastSemanticType = "info";

const DEFAULT_MSG: Record<RecipeKey, string> = {
  countdown: "Sale ends in {countdown}",
  announcement: "Free gift on orders over 1000 Kč this week!",
  "stock.low": "Only {count} left",
  "cart.activity": "{count} people added this recently",
  "order.summary": "{count} orders this week",
  "order.created": "{name} from {city} bought {product}",
};

const SAMPLE: Record<string, string> = {
  "{countdown}": "02:14:30",
  "{count}": "3",
  "{name}": "Anna",
  "{city}": "Praha",
  "{product}": "Ceramic Mug",
  "{time}": "2 min ago",
  "{qty}": "1",
  "{delta}": "+1",
  "{remaining}": "250 Kč",
  "{threshold}": "1000 Kč",
};

function fillSample(message: string): string {
  return message.replace(/\{[a-z]+\}/gi, (m) => SAMPLE[m] ?? m);
}

const TITLE_OF: Partial<Record<RecipeKey, string>> = {
  "order.created": "Recent order",
};

/**
 * What the surface ACTUALLY does at runtime, in the merchant's words (§4).
 * `persistent` mirrors isPersistentSurface() in the storefront runtime.
 */
function surfaceCaption(surface: Surface): string {
  return surface === "toast"
    ? "Fades out on its own"
    : "Stays until the shopper closes it";
}

export function NotificationPreview({
  type,
  message,
  surface = "toast",
  theme,
  customCss,
  closeable,
}: {
  type: RecipeKey;
  message?: string;
  surface?: Surface;
  theme: ToastTheme;
  /** Merchant's live custom CSS, so this type is never edited blind (§3k). */
  customCss?: string;
  closeable?: boolean;
}) {
  const tokens = styleTokensFor(theme) as CSSProperties;
  const raw = (message ?? "").trim() || DEFAULT_MSG[type];
  const text = fillSample(raw);
  const title = TITLE_OF[type];

  return (
    <div style={{ fontFamily: WON_FONT }}>
      <div
        style={{
          ...tokens,
          // The mock storefront behind the toast is always light — the app
          // darkens the toast, never the shop.
          background: "#eef1f4",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        {/* Live custom CSS scoped to the preview, with the SAME hooks the
            storefront exposes: [data-won-toast], [data-type], [data-won-type]. */}
        {customCss ? <style>{customCss}</style> : null}
        <WonToastCard
          theme={theme}
          type={NOTIFICATION_ACCENT}
          // The message is the primary line; a recipe with its own heading
          // (Recent sales) puts the message underneath it.
          title={title ?? text}
          detail={title ? text : ""}
          accent={accentFor(theme, NOTIFICATION_ACCENT)}
          // notifCard() renders no icon — see NOTIFICATION_ACCENT above.
          icon={false}
          // Real toast TYPE, so the merchant's `[data-won-type="announcement"]`
          // rule affects this preview exactly as it affects the storefront.
          wonType={type}
          closeable={closeable}
        />
      </div>
      <p style={{ color: WON_FAINT, fontSize: 12, marginTop: 6 }}>
        Live preview · {surfaceCaption(surface)} · sample data
      </p>
    </div>
  );
}
