import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";

import type {
  NotificationPage,
  NotificationRule,
  NotificationSurface,
  NotificationType,
} from "@won/core/toasts/notifications";
import {
  NOTIFICATION_PAGES,
  sanitizeNotifications,
} from "@won/core/toasts/notifications";
import type {
  MilestoneRuleConfig,
  ToastSemanticType,
  ToastTheme,
  ToastTypeKey,
  ToastTypeOverride,
} from "@won/core/toasts/config.types";
import { cartEventEnabled } from "@won/core/toasts/config.defaults";
import { resolveTypeBehavior, resolveTypeTheme } from "@won/core/toasts/type-style";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { NotificationPreview } from "../components/NotificationPreview";
import { AnimatedToastPreview } from "../components/AnimatedToastPreview";
import { StorefrontPreview } from "../components/StorefrontPreview";
import { ProFrame } from "../components/ProFrame";
import { SegmentedNav } from "../components/SegmentedNav";
import { MessageMatrix } from "../components/MessageMatrix";
import { mergeMessages } from "../lib/localization";
import { TypeStyleFields } from "../components/TypeStyleFields";
import { useSavedToast } from "../lib/use-saved-toast";
import { readTypeOverride } from "../lib/type-override";
import { persistConfig } from "../lib/persist-config.server";
import { pageLabel } from "../lib/labels";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

// ---- data contract (kept identical to the old Recipes/Events actions) ----

const SURFACES: NotificationSurface[] = [
  "toast",
  "banner",
  "persistent-toast",
  "inline",
];
const PICKABLE_PAGES: NotificationPage[] = NOTIFICATION_PAGES.filter(
  (p) => p !== "all",
);
const EVENT_TYPES: ToastSemanticType[] = [
  "added",
  "removed",
  "increased",
  "decreased",
  "gift",
  "shipping",
];
function readPages(form: FormData, type: NotificationType): NotificationPage[] {
  return PICKABLE_PAGES.filter((p) => form.get(`${type}_page_${p}`) === "on");
}

function buildRule(
  form: FormData,
  type: NotificationType,
): NotificationRule | null {
  const enabled = form.get(`${type}_enabled`) === "on";
  const surface =
    (form.get(`${type}_surface`) as NotificationSurface) ?? "toast";
  const pages = readPages(form, type);
  const message = String(form.get(`${type}_message`) ?? "");
  if (type === "countdown") {
    const mode = form.get("countdown_mode");
    const base = { id: "countdown", type, enabled, surface, pages, message };
    if (mode === "evergreen") {
      const hours = Number(form.get("countdown_evergreen_hours")) || 0;
      return { ...base, evergreenMs: Math.round(hours * 3_600_000) };
    }
    const endsAt = String(form.get("countdown_ends_at") ?? "").trim();
    return { ...base, endsAt: endsAt || undefined };
  }
  if (type === "stock.low") {
    return {
      id: "stock.low", type, enabled, surface, pages, message,
      threshold: Number(form.get("stock.low_threshold")) || 1,
    };
  }
  if (type === "announcement") {
    // Only the DEFAULT message is edited here (kept compact); per-language
    // translations live on the Languages page and are preserved by the caller.
    const variants = String(form.get("announcement_variants") ?? "")
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    return {
      id: "announcement", type, enabled, surface, pages, message,
      ...(variants.length ? { variants } : {}),
    };
  }
  if (type === "order.summary") {
    return {
      id: "order.summary", type, enabled, surface, pages, message,
      windowHours: Number(form.get("order.summary_window_hours")) || 168,
    };
  }
  if (type === "order.created") {
    return {
      id: "order.created", type, enabled, surface, pages, message,
      showName: form.get("order.created_show_name") === "on",
      showCity: form.get("order.created_show_city") === "on",
      minOrders: Number(form.get("order.created_min_orders")) || 5,
    };
  }
  return {
    id: "cart.activity", type, enabled, surface, pages, message,
    windowHours: Number(form.get("cart.activity_window_hours")) || 24,
  };
}

function toCents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const RECIPE_KEYS: ToastTypeKey[] = [
  "cart",
  "countdown",
  "announcement",
  "stock.low",
  "cart.activity",
  "order.summary",
  "order.created",
];


export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const isPro = config.plan === "pro";
  const form = await request.formData();

  // --- notification recipes ---
  const rules: NotificationRule[] = [];
  for (const type of ["countdown", "announcement"] as NotificationType[]) {
    const r = buildRule(form, type);
    if (r) rules.push(r);
  }
  for (const type of [
    "stock.low", "cart.activity", "order.summary", "order.created",
  ] as NotificationType[]) {
    if (isPro) {
      const r = buildRule(form, type);
      if (r) rules.push(r);
    } else {
      const existing = config.notifications.find((n) => n.type === type);
      if (existing) rules.push(existing);
    }
  }

  // Announcement translations are owned by the Languages page — this page only
  // edits the default message, so carry the stored translations forward (a save
  // here must not wipe them).
  const priorAnnouncement = config.notifications.find((n) => n.type === "announcement");
  const priorAnnMessages =
    priorAnnouncement && "messages" in priorAnnouncement
      ? priorAnnouncement.messages
      : undefined;
  if (priorAnnMessages) {
    for (const r of rules) {
      if (r.type === "announcement") r.messages = priorAnnMessages;
    }
  }

  // --- cart-toast messages (DEFAULT locale only) + milestones ---
  // The Toasts page keeps the source copy compact: it edits only the default
  // language. Translations live on the Languages page, which owns every other
  // locale. Merge so a save here never drops those translations.
  const defaultLocale = config.locales.defaultLocale;
  const messageEdits: Record<string, Record<string, string>> = {};
  for (const type of EVENT_TYPES) {
    messageEdits[type] = {
      [defaultLocale]: String(form.get(`msg_${type}_${defaultLocale}`) ?? ""),
    };
  }
  const messages = mergeMessages(config.messages, messageEdits);

  const milestones: MilestoneRuleConfig[] = [
    {
      id: "free_shipping", kind: "free_shipping",
      enabled: form.get("ms_ship_enabled") === "on",
      thresholdCents: toCents(form.get("ms_ship_threshold")),
      label: String(form.get("ms_ship_label") ?? "free shipping").slice(0, 80),
    },
    {
      id: "gift", kind: "gift",
      enabled: form.get("ms_gift_enabled") === "on",
      thresholdCents: 0,
      label: String(form.get("ms_gift_label") ?? "a gift").slice(0, 80),
    },
  ];

  // Per cart-event on/off (added/removed/increased/decreased). A switch posts
  // "on" only when checked; unchecked → store false. Empty map = all on.
  const cartEvents: Partial<Record<ToastSemanticType, boolean>> = {};
  for (const t of ["added", "removed", "increased", "decreased"] as ToastSemanticType[]) {
    if (form.get(`cart_enable_${t}`) !== "on") cartEvents[t] = false;
  }

  // Per-type Look/timing overrides (Pro). On Free the fields are locked and don't
  // submit; we leave byType untouched (gating forces the default look anyway).
  const byType: Partial<Record<ToastTypeKey, ToastTypeOverride>> = {};
  if (isPro) {
    for (const key of RECIPE_KEYS) {
      const ov = readTypeOverride(form, key, config);
      if (ov) byType[key] = ov;
    }
  }

  return persistConfig(() =>
    updateToastConfig(session.shop, {
      notifications: sanitizeNotifications(rules),
      messages,
      milestones,
      cartEvents,
      ...(isPro ? { byType } : {}),
    }),
  );
};

// ---- presentation ----

function ruleOf(config: { notifications: NotificationRule[] }, type: NotificationType) {
  return config.notifications.find((n) => n.type === type);
}

// Advanced fields collapse behind a disclosure so the primary config stays short
// (doctrine §8). Hidden fields still submit — collapsing only affects visibility.
function Advanced({
  children,
  summary = "Advanced (where it shows)",
}: {
  children: React.ReactNode;
  summary?: string;
}) {
  return (
    <details style={{ marginTop: 4 }}>
      <summary
        style={{ cursor: "pointer", color: "#5c6975", fontSize: 13, padding: "6px 0" }}
      >
        {summary}
      </summary>
      <s-stack direction="block" gap="base">
        {children}
      </s-stack>
    </details>
  );
}

function PagePicker({ type, pages }: { type: NotificationType; pages: NotificationPage[] }) {
  return (
    <s-stack direction="block" gap="small">
      <s-text type="strong">Show on pages (none = everywhere)</s-text>
      <s-stack direction="inline" gap="base">
        {PICKABLE_PAGES.map((p) => (
          <s-checkbox key={p} label={pageLabel(p)} name={`${type}_page_${p}`} value="on" checked={pages.includes(p)} />
        ))}
      </s-stack>
    </s-stack>
  );
}

const SURFACE_LABEL: Record<NotificationSurface, string> = {
  toast: "Floating toast",
  banner: "Full-width banner",
  "persistent-toast": "Toast that stays until dismissed",
  inline: "Inline on the page",
};

function SurfaceSelect({ type, value }: { type: NotificationType; value: NotificationSurface }) {
  return (
    <s-select
      label="How it appears"
      name={`${type}_surface`}
      value={value}
      details="Toast floats in a corner; banner spans the page width; inline sits in the page content."
    >
      {SURFACES.map((s) => (
        <s-option key={s} value={s}>{SURFACE_LABEL[s]}</s-option>
      ))}
    </s-select>
  );
}

// Clickable copy tokens (doctrine §4): merchants tap a chip to insert {count},
// {name}, … instead of memorising and typing them. Native chip buttons (same as
// the SegmentedNav) — inline, auto-width.
function TokenChips({
  field,
  tokens,
  onInsert,
}: {
  field: string;
  tokens: string[];
  onInsert: (field: string, token: string) => void;
}) {
  if (!tokens.length) return null;
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-text color="subdued">Insert:</s-text>
      {tokens.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onInsert(field, t)}
          style={{
            display: "inline-flex",
            padding: "3px 8px",
            borderRadius: 8,
            border: "1px solid #d5d9de",
            background: "#fff",
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            color: "#1a1f24",
          }}
        >
          {t}
        </button>
      ))}
    </s-stack>
  );
}

// A message field with a clean "Message" label and its tokens offered as chips
// below (never baked into the label).
function MessageField({
  name,
  value,
  tokens,
  details,
  disabled,
  onInsert,
}: {
  name: string;
  value: string;
  tokens: string[];
  details: string;
  disabled?: boolean;
  onInsert: (field: string, token: string) => void;
}) {
  return (
    <s-stack direction="block" gap="small">
      <s-text-field label="Message" name={name} value={value} details={details} disabled={disabled} />
      {disabled ? null : <TokenChips field={name} tokens={tokens} onInsert={onInsert} />}
    </s-stack>
  );
}

interface RecipeMeta {
  key: string;
  label: string;
  plan: "free" | "pro";
  blurb: string;
}

const RECIPES: RecipeMeta[] = [
  { key: "cart", label: "Cart toasts", plan: "free", blurb: "The add/remove/update toasts — the core of the app." },
  { key: "countdown", label: "Countdown timer", plan: "free", blurb: "A truthful sale or deadline timer." },
  { key: "announcement", label: "Announcement", plan: "free", blurb: "Your own message — a sale, a shipping cutoff." },
  { key: "stock.low", label: "Low-stock urgency", plan: "pro", blurb: "“Only N left” — from real inventory." },
  { key: "cart.activity", label: "Cart activity", plan: "pro", blurb: "“N people added this recently” — real counter." },
  { key: "order.summary", label: "Order summary", plan: "pro", blurb: "“N orders this week” — from real orders." },
  { key: "order.created", label: "Recent sales", plan: "pro", blurb: "“Anna from Praha bought …” — real orders only." },
];

export default function ToastsRoute() {
  const { config } = useLoaderData<typeof loader>();
  const saveError = useSavedToast();
  const isPro = config.plan === "pro";

  // Selected recipe can be deep-linked (Insights suggestions → /app/toasts?rule=…).
  const [searchParams] = useSearchParams();
  const ruleParam = searchParams.get("rule");
  const [selected, setSelected] = useState<string>(
    ruleParam && RECIPES.some((r) => r.key === ruleParam) ? ruleParam : "cart",
  );
  const [animate, setAnimate] = useState(false);
  const [countdownMode, setCountdownMode] = useState<string>(
    (ruleOf(config, "countdown") as { endsAt?: string })?.endsAt ? "fixed" : "evergreen",
  );

  // Live preview: read the form on every input so each recipe's preview reflects
  // what the merchant is typing (doctrine §2/§3 — same pattern as Appearance).
  const formRef = useRef<HTMLFormElement>(null);
  const [snap, setSnap] = useState<Record<string, string>>({});
  const readForm = () => {
    const el = formRef.current;
    if (!el) return;
    const obj: Record<string, string> = {};
    for (const [k, v] of new FormData(el).entries()) obj[k] = String(v);
    // FormData omits unchecked switches, so capture every switch's state
    // explicitly (needed for the live per-type preview to reflect toggles).
    el.querySelectorAll("[name]").forEach((node) => {
      const checked = (node as unknown as { checked?: boolean }).checked;
      const name = node.getAttribute("name");
      if (typeof checked === "boolean" && name) obj[`__on_${name}`] = checked ? "1" : "0";
    });
    setSnap(obj);
  };
  // Live preview binds to NATIVE input/change — React onInput/onChange never fire
  // for s-* web components, so the preview would look frozen (doctrine §2).
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const handler = () => readForm();
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
    return () => {
      el.removeEventListener("input", handler);
      el.removeEventListener("change", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Insert a copy token into a message field on chip click, so merchants never
  // hand-type {count}/{name} (doctrine §4 — tokens are clickable chips). Sets the
  // Polaris field's value property and fires input so the live preview updates.
  const insertToken = (fieldName: string, token: string) => {
    const el = formRef.current?.querySelector(
      `[name="${fieldName}"]`,
    ) as (HTMLElement & { value?: string }) | null;
    if (!el) return;
    el.value = `${el.value ?? ""}${token}`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const defaultLocale = config.locales.defaultLocale;
  const liveMsg = (type: string, stored?: string) =>
    snap[`${type}_message`] ?? stored ?? "";
  const liveSurface = (type: string, stored?: string) =>
    (snap[`${type}_surface`] ?? stored ?? "toast") as
      | "toast"
      | "banner"
      | "persistent-toast"
      | "inline";

  const countdown = ruleOf(config, "countdown") as
    | Extract<NotificationRule, { type: "countdown" }> | undefined;
  const stock = ruleOf(config, "stock.low") as
    | Extract<NotificationRule, { type: "stock.low" }> | undefined;
  const activity = ruleOf(config, "cart.activity") as
    | Extract<NotificationRule, { type: "cart.activity" }> | undefined;
  const announcement = ruleOf(config, "announcement") as
    | Extract<NotificationRule, { type: "announcement" }> | undefined;
  const orderSummary = ruleOf(config, "order.summary") as
    | Extract<NotificationRule, { type: "order.summary" }> | undefined;
  const social = ruleOf(config, "order.created") as
    | Extract<NotificationRule, { type: "order.created" }> | undefined;

  const evergreenHours = countdown?.evergreenMs ? String(countdown.evergreenMs / 3_600_000) : "24";
  const ship = config.milestones.find((m) => m.kind === "free_shipping");
  const gift = config.milestones.find((m) => m.kind === "gift");

  const enabledOf: Record<string, boolean> = {
    cart: true,
    countdown: countdown?.enabled ?? false,
    announcement: announcement?.enabled ?? false,
    "stock.low": stock?.enabled ?? false,
    "cart.activity": activity?.enabled ?? false,
    "order.summary": orderSummary?.enabled ?? false,
    "order.created": social?.enabled ?? false,
  };

  const panel = (key: string): React.CSSProperties => ({
    display: selected === key ? "block" : "none",
  });

  // The right column shows the preview for the SELECTED recipe, with its live
  // message + surface — so every storefront-affecting control moves the preview
  // (doctrine §3c). Cart toasts show the full multi-accent scene.
  const annMsg =
    snap[`announcement_msg_${defaultLocale}`] ??
    snap["announcement_message"] ??
    announcement?.messages?.[defaultLocale] ??
    announcement?.message;
  // Live per-type resolution for the preview: start from the saved resolved
  // style, then overlay whatever the merchant is editing right now (snap) — so
  // the per-type Look/timing fields move the preview live, like everything else.
  const onOf = (name: string): boolean | undefined => {
    const raw = snap[`__on_${name}`];
    return raw === undefined ? undefined : raw === "1";
  };
  function liveTypeTheme(key: string): ToastTheme {
    const saved = resolveTypeTheme(config, key as ToastTypeKey);
    const s = (n: string) => snap[`bt_${key}_${n}`];
    const numv = (n: string) => {
      const x = s(n);
      return x !== undefined && x !== "" ? Number(x) : undefined;
    };
    return {
      ...saved,
      mode: (s("mode") as ToastTheme["mode"]) || saved.mode,
      colorBg: s("colorBg") || saved.colorBg,
      colorText: s("colorText") || saved.colorText,
      cornerRadius: numv("cornerRadius") ?? saved.cornerRadius,
      width: numv("width") ?? saved.width,
      shadow: (s("shadow") as ToastTheme["shadow"]) || saved.shadow,
      density: (s("density") as ToastTheme["density"]) || saved.density,
      animationIn: (s("animationIn") as ToastTheme["animationIn"]) || saved.animationIn,
      borderColor: s("borderColor") || saved.borderColor,
      showImage: onOf(`bt_${key}_showImage`) ?? saved.showImage,
      showDelta: onOf(`bt_${key}_showDelta`) ?? saved.showDelta,
      border: onOf(`bt_${key}_border`) ?? saved.border,
      backdropBlur: onOf(`bt_${key}_backdropBlur`) ?? saved.backdropBlur,
    };
  }
  function liveTypeBehavior(key: string) {
    const saved = resolveTypeBehavior(config, key as ToastTypeKey);
    const s = (n: string) => snap[`bt_${key}_${n}`];
    const durSec = s("durationSec");
    const durMs =
      durSec !== undefined && durSec !== "" ? Math.round(Number(durSec) * 1000) : saved.durationMs;
    return {
      durationMs: Number.isFinite(durMs) && durMs > 0 ? durMs : saved.durationMs,
      clickAction: (s("clickAction") as typeof saved.clickAction) || saved.clickAction,
      closeable: onOf(`bt_${key}_closeable`) ?? saved.closeable,
    };
  }
  function renderPreview() {
    // Preview reflects the SELECTED type's resolved look/behaviour (default +
    // saved override + LIVE edits from the form).
    const selKey = selected as ToastTypeKey;
    const pvTheme = liveTypeTheme(selKey);
    const pvBeh = liveTypeBehavior(selKey);
    switch (selected) {
      case "cart":
        // Animate → motion/timing close-up. Otherwise the schematic storefront:
        // the cart toast in context, where it actually lands (global placement),
        // so the merchant sees it on their shop, not as a floating list.
        return animate ? (
          <AnimatedToastPreview
            theme={pvTheme}
            durationMs={pvBeh.durationMs}
            stackDirection={config.global.stackDirection}
            maxVisible={config.global.maxVisible}
            closeable={pvBeh.closeable}
            customCss={isPro ? pvTheme.customCss : undefined}
          />
        ) : (
          <StorefrontPreview
            theme={pvTheme}
            position={config.global.position}
            offsetTop={config.global.offsetTop}
            offsetInline={config.global.offsetInline}
            maxVisible={config.global.maxVisible}
            stackDirection={config.global.stackDirection}
            closeable={pvBeh.closeable}
            customCss={isPro ? pvTheme.customCss : undefined}
          />
        );
      case "countdown":
        return <NotificationPreview type="countdown" message={liveMsg("countdown", countdown?.message)} surface={liveSurface("countdown", countdown?.surface)} theme={pvTheme} />;
      case "announcement":
        return <NotificationPreview type="announcement" message={annMsg} surface={liveSurface("announcement", announcement?.surface)} theme={pvTheme} />;
      case "stock.low":
        return <NotificationPreview type="stock.low" message={liveMsg("stock.low", stock?.message)} surface={liveSurface("stock.low", stock?.surface)} theme={pvTheme} />;
      case "cart.activity":
        return <NotificationPreview type="cart.activity" message={liveMsg("cart.activity", activity?.message)} surface={liveSurface("cart.activity", activity?.surface)} theme={pvTheme} />;
      case "order.summary":
        return <NotificationPreview type="order.summary" message={liveMsg("order.summary", orderSummary?.message)} surface={liveSurface("order.summary", orderSummary?.surface)} theme={pvTheme} />;
      case "order.created":
        return <NotificationPreview type="order.created" message={liveMsg("order.created", social?.message)} surface={liveSurface("order.created", social?.surface)} theme={pvTheme} />;
      default:
        return null;
    }
  }

  return (
    <s-page heading="Toasts" inlineSize="large">
      <s-section>
        <s-paragraph>
          Everything Won Toasts can show, in one place. Pick a toast on the left to
          set it up — each uses <s-text type="strong">real data</s-text> and obeys
          your frequency &amp; quiet-mode settings.
        </s-paragraph>
      </s-section>

      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}

      {/* Studio shell picker (doctrine §7b/§3h): shared SegmentedNav — same shape
          on every config page. Selection = highlighted chip; green "On" = live. */}
      <SegmentedNav
        items={RECIPES.map((r) => ({
          key: r.key,
          label: r.label,
          pro: r.plan === "pro",
          on: enabledOf[r.key],
        }))}
        selected={selected}
        onSelect={setSelected}
        ariaLabel="Toast types"
      />

      <s-grid gridTemplateColumns="minmax(0, 1fr) 340px" gap="large">

        <Form ref={formRef} method="post" data-save-bar>
          {/* ---- Cart toasts (Free) ---- */}
          <div style={panel("cart")}>
            <s-section heading="Cart toasts">
              <s-stack direction="block" gap="large">
                <s-badge tone="success">Free</s-badge>
                <s-paragraph>
                  Shown automatically when the cart changes. Turn each one on or off
                  and edit what it says — all in one place. Add languages in{" "}
                  <s-link href="/app/design">Design → Languages</s-link>.
                </s-paragraph>

                {/* Unified per-event control (doctrine §7c/§8b): toggle + wording +
                    (for gift/shipping) their milestone settings inline. No Advanced. */}
                <s-stack direction="block" gap="base">
                  <s-text type="strong">Cart events</s-text>
                  <s-text color="subdued">
                    Toggle each toast on or off and write its wording in your default
                    language. Blank uses the built-in text. Translate into other
                    languages on <s-link href="/app/languages">Languages</s-link>.
                    Gift &amp; free shipping only <s-text type="strong">announce</s-text>{" "}
                    a milestone — they never grant it.
                  </s-text>
                  <MessageMatrix
                    theme={config.theme}
                    locales={[defaultLocale]}
                    messages={config.messages}
                    toggleFor={(key) => {
                      if (key === "gift") return { name: "ms_gift_enabled", checked: gift?.enabled ?? false };
                      if (key === "shipping") return { name: "ms_ship_enabled", checked: ship?.enabled ?? false };
                      return { name: `cart_enable_${key}`, checked: cartEventEnabled(config, key as ToastSemanticType) };
                    }}
                    extraFor={(key) => {
                      if (key === "shipping")
                        return (
                          <s-stack direction="inline" gap="base">
                            <s-money-field
                              label="Free-shipping threshold"
                              name="ms_ship_threshold"
                              value={ship ? String(ship.thresholdCents / 100) : ""}
                              min={0}
                              details="The cart total that unlocks free shipping, in your store currency. The real rule lives in your Shopify shipping settings — this only announces it."
                            />
                            <s-text-field
                              label="What to call it"
                              name="ms_ship_label"
                              value={ship?.label ?? "free shipping"}
                              details="Used in the message, e.g. “You’ve got free shipping”."
                            />
                          </s-stack>
                        );
                      if (key === "gift")
                        return (
                          <s-text-field
                            label="What to call the gift"
                            name="ms_gift_label"
                            value={gift?.label ?? "a gift"}
                            details="Used in the message, e.g. “You unlocked a gift”. Requires Won GiftLadder to actually grant it."
                          />
                        );
                      return null;
                    }}
                  />
                </s-stack>
              </s-stack>
              <TypeStyleFields typeKey="cart" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Countdown (Free) ---- */}
          <div style={panel("countdown")}>
            <s-section heading="Countdown timer">
              <s-stack direction="block" gap="base">
                <s-badge tone="success">Free</s-badge>
                <s-switch label="Show a countdown" name="countdown_enabled" checked={countdown?.enabled ?? false} />
                <s-select label="Counts down to" name="countdown_mode" value={countdownMode}
                  details="Fixed date ends for everyone at once; a rolling window restarts per visitor."
                  onChange={(e) => setCountdownMode((e.currentTarget as unknown as { value: string }).value)}>
                  <s-option value="evergreen">A rolling window per visitor</s-option>
                  <s-option value="fixed">A fixed date</s-option>
                </s-select>
                {countdownMode === "evergreen" ? (
                  <s-number-field label="Restart for each visitor after" name="countdown_evergreen_hours" value={evergreenHours} min={1} details="Hours before each visitor gets a fresh countdown (24 = one day)." />
                ) : (
                  <s-date-field label="End date" name="countdown_ends_at" value={(countdown?.endsAt ?? "").slice(0, 10)} />
                )}
                <MessageField name="countdown_message" value={countdown?.message ?? "Sale ends in {countdown}"} tokens={["{countdown}"]} details="Shown with the timer. {countdown} is replaced by the time left." onInsert={insertToken} />
                <Advanced>
                  <SurfaceSelect type="countdown" value={countdown?.surface ?? "banner"} />
                  <PagePicker type="countdown" pages={countdown?.pages ?? []} />
                </Advanced>
              </s-stack>
              <TypeStyleFields typeKey="countdown" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Announcement (Free) ---- */}
          <div style={panel("announcement")}>
            <s-section heading="Announcement">
              <s-stack direction="block" gap="base">
                <s-badge tone="success">Free</s-badge>
                <s-switch label="Show an announcement" name="announcement_enabled" checked={announcement?.enabled ?? false} />
                <s-paragraph>Your own message, written in your default language.</s-paragraph>
                <s-text-field label="Message" name="announcement_message" value={announcement?.message ?? ""} placeholder="Free gift on orders over 1000 Kč this week!" details="Translate it into your other languages on Languages." />
                <s-text color="subdued">
                  Add translations on <s-link href="/app/languages">Languages</s-link>.
                </s-text>
                <Advanced>
                  <SurfaceSelect type="announcement" value={announcement?.surface ?? "banner"} />
                  <s-text-area label="A/B variants (one per line; splits shoppers evenly)" name="announcement_variants" rows={3} value={(announcement?.variants ?? []).join("\n")} />
                  <PagePicker type="announcement" pages={announcement?.pages ?? []} />
                </Advanced>
              </s-stack>
              <TypeStyleFields typeKey="announcement" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Low stock (Pro) ---- */}
          <div style={panel("stock.low")}>
            <s-section heading="Low-stock urgency">
              <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="base">
                <s-badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Pro — upgrade to enable"}</s-badge>
                <s-switch label="Show low-stock nudges" name="stock.low_enabled" checked={stock?.enabled ?? false} disabled={!isPro} />
                <s-paragraph>Shows “Only N left” only when real inventory is below your threshold. Out of stock never shouts.</s-paragraph>
                <s-number-field label="Show when inventory is below" name="stock.low_threshold" value={String(stock?.threshold ?? 5)} min={1} disabled={!isPro} details="Only shows when real inventory is at or below this number." />
                <MessageField name="stock.low_message" value={stock?.message ?? "Only {count} left"} tokens={["{count}"]} details="{count} is replaced by the real units left." disabled={!isPro} onInsert={insertToken} />
                <Advanced>
                  <SurfaceSelect type="stock.low" value={stock?.surface ?? "inline"} />
                  <PagePicker type="stock.low" pages={stock?.pages ?? ["product"]} />
                </Advanced>
              </s-stack>
              </ProFrame>
              <TypeStyleFields typeKey="stock.low" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Cart activity (Pro) ---- */}
          <div style={panel("cart.activity")}>
            <s-section heading="Cart activity">
              <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="base">
                <s-badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Pro — upgrade to enable"}</s-badge>
                <s-switch label="Show cart activity" name="cart.activity_enabled" checked={activity?.enabled ?? false} disabled={!isPro} />
                <s-paragraph>“{"{count}"} people added this recently” — a real, server-side counter. Never fabricated.</s-paragraph>
                <s-number-field label="Look back over" name="cart.activity_window_hours" value={String(activity?.windowHours ?? 24)} min={1} disabled={!isPro} details="Hours of add-to-cart activity to count (24 = one day)." />
                <MessageField name="cart.activity_message" value={activity?.message ?? "{count} people added this recently"} tokens={["{count}"]} details="{count} is replaced by the real number of shoppers." disabled={!isPro} onInsert={insertToken} />
                <Advanced>
                  <SurfaceSelect type="cart.activity" value={activity?.surface ?? "toast"} />
                  <PagePicker type="cart.activity" pages={activity?.pages ?? ["product"]} />
                </Advanced>
              </s-stack>
              </ProFrame>
              <TypeStyleFields typeKey="cart.activity" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Order summary (Pro) ---- */}
          <div style={panel("order.summary")}>
            <s-section heading="Order summary">
              <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="base">
                <s-badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Pro — upgrade to enable"}</s-badge>
                <s-switch label="Show an order summary" name="order.summary_enabled" checked={orderSummary?.enabled ?? false} disabled={!isPro} />
                <s-paragraph>“{"{count}"} orders this week” — counted from your real orders. Silent until there are orders in the window.</s-paragraph>
                <s-number-field label="Look back over" name="order.summary_window_hours" value={String(orderSummary?.windowHours ?? 168)} min={1} max={720} disabled={!isPro} details="Hours of orders to count (168 = 7 days)." />
                <MessageField name="order.summary_message" value={orderSummary?.message ?? "{count} orders this week"} tokens={["{count}"]} details="{count} is replaced by the real order count." disabled={!isPro} onInsert={insertToken} />
                <Advanced>
                  <SurfaceSelect type="order.summary" value={orderSummary?.surface ?? "toast"} />
                  <PagePicker type="order.summary" pages={orderSummary?.pages ?? []} />
                </Advanced>
              </s-stack>
              </ProFrame>
              <TypeStyleFields typeKey="order.summary" config={config} isPro={isPro} />
            </s-section>
          </div>

          {/* ---- Recent sales (Pro) ---- */}
          <div style={panel("order.created")}>
            <s-section heading="Recent sales (social proof)">
              <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="base">
                <s-badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Pro — upgrade to enable"}</s-badge>
                <s-switch label="Show recent sales" name="order.created_enabled" checked={social?.enabled ?? false} disabled={!isPro} />
                <s-paragraph>
                  “Anna from Praha bought a Mug” — from <s-text type="strong">real orders only</s-text>,
                  storing just a first name + city. Stays off until you have enough orders. Shoppers opt out with a{" "}
                  <s-text type="strong">won_social_optout</s-text> order note.
                </s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-checkbox label="Show first name" name="order.created_show_name" value="on" checked={social?.showName ?? true} disabled={!isPro} />
                  <s-checkbox label="Show city" name="order.created_show_city" value="on" checked={social?.showCity ?? true} disabled={!isPro} />
                </s-stack>
                <s-number-field label="Minimum real orders before it turns on" name="order.created_min_orders" value={String(social?.minOrders ?? 5)} min={1} disabled={!isPro} details="Cold-start honesty: stays hidden until you have at least this many real orders." />
                <MessageField name="order.created_message" value={social?.message ?? "{name} from {city} bought {product}"} tokens={["{name}", "{city}", "{product}", "{time}"]} details="Tokens are filled from the real order." disabled={!isPro} onInsert={insertToken} />
                <Advanced>
                  <SurfaceSelect type="order.created" value={social?.surface ?? "toast"} />
                  <PagePicker type="order.created" pages={social?.pages ?? []} />
                </Advanced>
              </s-stack>
              </ProFrame>
              <TypeStyleFields typeKey="order.created" config={config} isPro={isPro} />
            </s-section>
          </div>

          {!isPro ? (
            <s-section>
              <s-banner tone="info" heading="Some toasts are Pro">
                <s-paragraph>
                  <s-link href="/app/plan">Upgrade to Pro</s-link> to turn on low-stock,
                  cart activity, order summary and recent sales. Cart toasts, countdown
                  and announcements are included on Free.
                </s-paragraph>
              </s-banner>
            </s-section>
          ) : null}
        </Form>

        {/* Preview column — sticky, always visible, reflects the selected
            recipe's live message + surface (doctrine §3c). */}
        <div style={{ position: "sticky", top: 12, alignSelf: "start" }}>
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">Preview</s-text>
              {selected === "cart" ? (
                <s-switch
                  label="Animate"
                  checked={animate}
                  onChange={(e) =>
                    setAnimate((e.currentTarget as unknown as { checked: boolean }).checked)
                  }
                />
              ) : null}
            </s-stack>
            {renderPreview()}
          </s-stack>
        </div>
      </s-grid>
    </s-page>
  );
}
