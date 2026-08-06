import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";

import {
  DEFAULT_THEME,
  sanitizeGlobalSettings,
  sanitizeTheme,
} from "@won/core/toasts/config.defaults";
import { PRESET_LOOKS, applyLookPreset } from "@won/core/toasts/presets";
import {
  LOCALE_LIMIT_FREE,
  LOCALE_LIMIT_PRO,
  capLocales,
  localeLimit,
  normalizeLocale,
} from "@won/core/toasts/locales";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  listConfigVersions,
  restoreConfigVersion,
  updateToastConfig,
} from "../services/toast-config.server";
import { ToastPreview } from "../components/ToastPreview";
import { AnimatedToastPreview } from "../components/AnimatedToastPreview";
import { StorefrontPreview } from "../components/StorefrontPreview";
import { ProFrame } from "../components/ProFrame";
import { PositionField } from "../components/PositionField";
import { SegmentedNav } from "../components/SegmentedNav";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";
import { EVENT_META, languageName } from "../lib/labels";

// Languages the merchant can pick from (open BCP-47; this is just a convenient
// starter set — resolveMessage accepts any code).
const COMMON_LOCALES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "cs", label: "Čeština" },
  { code: "sk", label: "Slovenčina" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
  { code: "nl", label: "Nederlands" },
  { code: "pt-br", label: "Português (BR)" },
  { code: "hu", label: "Magyar" },
  { code: "ro", label: "Română" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  // History is non-critical: if the ConfigVersion table/client isn't ready yet
  // (e.g. a dev server started before the migration), never break the page.
  let versions: { id: string; createdAt: string }[] = [];
  try {
    versions = (await listConfigVersions(session.shop)).map((v) => ({
      id: v.id,
      createdAt: v.createdAt.toISOString(),
    }));
  } catch {
    versions = [];
  }
  return { config, versions };
};

function readThemeFields(f: FormData) {
  return sanitizeTheme({
    mode: f.get("mode"),
    colorBg: f.get("colorBg"),
    colorText: f.get("colorText"),
    accent: {
      added: f.get("accent_added"),
      removed: f.get("accent_removed"),
      increased: f.get("accent_increased"),
      decreased: f.get("accent_decreased"),
      gift: f.get("accent_gift"),
      shipping: f.get("accent_shipping"),
    },
    cornerRadius: f.get("cornerRadius"),
    shadow: f.get("shadow"),
    width: f.get("width"),
    density: f.get("density"),
    animationIn: f.get("animationIn"),
    border: f.get("border") === "on",
    backdropBlur: f.get("backdropBlur") === "on",
    showImage: f.get("showImage") === "on",
    showDelta: f.get("showDelta") === "on",
    showIcon: f.get("showIcon") === "on",
    customCss: f.get("customCss"),
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = f.get("intent");

  // One-click preset look. "default" restores the original theme.
  if (intent === "applyLook") {
    const preset = String(f.get("preset") ?? "");
    const current = await getToastConfig(session.shop);
    const theme =
      preset === "default" ? DEFAULT_THEME : applyLookPreset(current.theme, preset);
    return persistConfig(() => updateToastConfig(session.shop, { theme }));
  }

  // Roll back to a stored version (auto history — replaces raw-JSON backup).
  if (intent === "restore") {
    return persistConfig(() =>
      restoreConfigVersion(session.shop, String(f.get("versionId") ?? "")),
    );
  }

  // Main save: Look (theme) + Placement/Timing/Grouping/Frequency (global).
  // Time is entered in human units (seconds/minutes, doctrine §4) and converted
  // to the ms the engine stores here at the boundary.
  const savedTheme = readThemeFields(f);
  const num = (name: string) => Number(String(f.get(name) ?? "").replace(",", "."));
  const secToMs = (name: string) => Math.round(num(name) * 1000);
  const minToMs = (name: string) => Math.round(num(name) * 60000);
  const patch = sanitizeGlobalSettings({
    position: f.get("position"),
    offsetTop: f.get("offsetTop"),
    offsetInline: f.get("offsetInline"),
    durationMs: secToMs("durationSec"),
    maxVisible: f.get("maxVisible"),
    clickAction: f.get("clickAction"),
    stackDirection: f.get("stackDirection"),
    overflowStrategy: f.get("overflowStrategy"),
    autoDismiss: f.get("autoDismiss") === "on",
    pauseOnHover: f.get("pauseOnHover") === "on",
    closeable: f.get("closeable") === "on",
    grouping: {
      mode: f.get("grouping_mode"),
      burstWindowMs: secToMs("burstWindowSec"),
      dedupeWindowMs: secToMs("dedupeWindowSec"),
      rateLimitPerMin: f.get("rateLimitPerMin"),
      mergeDeltas: f.get("mergeDeltas") === "on",
    },
    frequency: {
      maxPerSession: f.get("maxPerSession"),
      cooldownMs: secToMs("cooldownSec"),
      suppressAfterDismissMs: minToMs("suppressAfterDismissMin"),
      quietMode: f.get("quietMode") === "on",
    },
  });

  const current = await getToastConfig(session.shop);
  const mergedGlobal = { ...current.global, ...patch };
  if (patch.grouping) mergedGlobal.grouping = { ...current.global.grouping, ...patch.grouping };
  if (patch.frequency) mergedGlobal.frequency = { ...current.global.frequency, ...patch.frequency };

  // Languages (locale-as-data): checked codes + default. Free is capped to its
  // language limit (the default is always kept).
  const chosen = COMMON_LOCALES.map((l) => l.code).filter((c) => f.get(`lang_${c}`) === "on");
  const extra = String(f.get("lang_custom") ?? "")
    .split(/[\s,]+/)
    .map((c) => normalizeLocale(c))
    .filter(Boolean);
  const wantDefault = normalizeLocale(f.get("default_locale")) || "en";
  const dedup = capLocales(
    [wantDefault, ...chosen, ...extra],
    localeLimit(current.plan),
  );
  const locales = {
    enabledLocales: dedup.length ? dedup : ["en"],
    defaultLocale: wantDefault,
  };

  return persistConfig(() =>
    updateToastConfig(session.shop, {
      theme: {
        ...current.theme,
        ...savedTheme,
        accent: { ...current.theme.accent, ...(savedTheme.accent ?? {}) },
      },
      global: mergedGlobal,
      locales,
    }),
  );
};

const TOGGLES = [
  ["showImage", "Product image"],
  ["showDelta", "Quantity change (+N)"],
  ["showIcon", "Event icon"],
  ["border", "Border"],
  ["backdropBlur", "Backdrop blur"],
] as const;

const LOOK_PRESETS: { id: keyof typeof PRESET_LOOKS | "default"; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "bold", label: "Bold" },
  { id: "luxury", label: "Luxury" },
  { id: "playful", label: "Playful" },
  { id: "default", label: "Default" },
];

// Studio-shell segments (doctrine §7b) — one focused panel at a time instead of
// a single long scroll of sections.
const DESIGN_SEGMENTS = [
  { key: "look", label: "Look" },
  { key: "placement", label: "Placement" },
  { key: "timing", label: "Timing" },
  { key: "rules", label: "Anti-spam" },
  { key: "languages", label: "Languages" },
  { key: "advanced", label: "Advanced" },
];

// A titled group of controls — gives the page a readable rhythm instead of a
// flat wall of fields (doctrine §8). Reused for every Design section.
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small">
        <s-text type="strong">{title}</s-text>
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
      {children}
    </s-stack>
  );
}

export default function DesignRoute() {
  const { config, versions } = useLoaderData<typeof loader>();
  const saveError = useSavedToast();
  const isPro = config.plan === "pro";
  const loc = config.locales;
  const langLimit = isPro ? LOCALE_LIMIT_PRO : LOCALE_LIMIT_FREE;

  const formRef = useRef<HTMLFormElement>(null);
  const [theme, setTheme] = useState(config.theme);
  const [animate, setAnimate] = useState(false);
  // Live timing/stacking for the animated preview, read from the form.
  const [live, setLive] = useState({
    durationMs: config.global.durationMs,
    stackDirection: config.global.stackDirection,
    maxVisible: config.global.maxVisible,
    closeable: config.global.closeable,
    position: config.global.position,
    offsetTop: config.global.offsetTop,
    offsetInline: config.global.offsetInline,
  });
  const sync = useCallback(() => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const patch = readThemeFields(fd);
    setTheme((prev) => ({ ...prev, ...patch, accent: { ...prev.accent, ...(patch.accent ?? {}) } }));
    setLive({
      durationMs:
        Math.round((Number(fd.get("durationSec")) || 0) * 1000) || config.global.durationMs,
      stackDirection:
        (fd.get("stackDirection") as "newest-top" | "newest-bottom") ?? config.global.stackDirection,
      maxVisible: Number(fd.get("maxVisible")) || config.global.maxVisible,
      closeable: fd.get("closeable") === "on",
      position: (fd.get("position") as typeof config.global.position) ?? config.global.position,
      offsetTop: Number(fd.get("offsetTop")) || 0,
      offsetInline: Number(fd.get("offsetInline")) || 0,
    });
  }, [config]);

  // Live preview MUST bind to NATIVE input/change events — React's onInput/onChange
  // never fire for s-* web components, so the preview would look frozen (doctrine
  // §2 invariant). Attach on the form ref.
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
    };
  }, [sync]);

  // When the loader reloads (applying a preset saves + revalidates, or any save),
  // resync the preview state to the new saved config — otherwise clicking a preset
  // updates the DB but the preview keeps the old look.
  useEffect(() => {
    setTheme(config.theme);
    setLive({
      durationMs: config.global.durationMs,
      stackDirection: config.global.stackDirection,
      maxVisible: config.global.maxVisible,
      closeable: config.global.closeable,
      position: config.global.position,
      offsetTop: config.global.offsetTop,
      offsetInline: config.global.offsetInline,
    });
  }, [config]);

  const isCustom = theme.mode === "custom";
  const g = config.global;
  // Segment can be deep-linked (e.g. Insights suggestions → /app/design?seg=timing).
  const [searchParams] = useSearchParams();
  const [seg, setSeg] = useState(
    () => searchParams.get("seg") ?? "look",
  );
  const panel = (key: string): React.CSSProperties => ({
    display: seg === key ? "block" : "none",
  });

  return (
    <s-page heading="Design">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}
      {/* Start from a curated look in one click, then fine-tune. Kept above the
          shell (its own mini-forms) so it can't nest inside the main Form. */}
      <s-section heading="Start from a look">
        <s-paragraph>Pick a preset, then fine-tune below. Applying a preset saves immediately.</s-paragraph>
        <s-stack direction="inline" gap="base">
          {LOOK_PRESETS.map((p) => (
            <Form key={p.id} method="post">
              <input type="hidden" name="intent" value="applyLook" />
              <input type="hidden" name="preset" value={p.id} />
              <s-button type="submit">{p.label}</s-button>
            </Form>
          ))}
        </s-stack>
      </s-section>

      {/* Studio shell (doctrine §7b): same picker + one panel + sticky preview as
          Toasts. Hidden panels still submit (display:none) so one Save Bar covers
          the whole form. */}
      <SegmentedNav items={DESIGN_SEGMENTS} selected={seg} onSelect={setSeg} ariaLabel="Design sections" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(260px,340px)",
          gap: "28px",
          alignItems: "start",
        }}
      >
        <Form
          method="post"
          ref={formRef}
          data-save-bar
          onReset={() => setTheme(config.theme)}
        >
          <s-stack direction="block" gap="large">
            {/* ---- LOOK ---- */}
            <div style={panel("look")}>
            <s-section heading="Look">
              <s-stack direction="block" gap="large">
                <Group title="Colours">
                  <s-select label="Theme mode" name="mode" value={theme.mode} details="System follows the shopper's light/dark; custom lets you set exact colours.">
                    <s-option value="system">System (auto light/dark)</s-option>
                    <s-option value="light">Light</s-option>
                    <s-option value="dark">Dark</s-option>
                    <s-option value="custom">Custom colours</s-option>
                  </s-select>
                  <div style={{ display: isCustom ? "block" : "none" }}>
                    <s-stack direction="inline" gap="base">
                      <s-color-field label="Background" name="colorBg" value={config.theme.colorBg} />
                      <s-color-field label="Text" name="colorText" value={config.theme.colorText} />
                    </s-stack>
                  </div>
                </Group>

                <Group title="Accent colour per event" hint="The coloured stripe on each toast — one per shopper action.">
                  <s-stack direction="inline" gap="base">
                    {EVENT_META.map((ev) => (
                      <s-color-field key={ev.key} label={ev.title} name={`accent_${ev.key}`} value={config.theme.accent[ev.key]} />
                    ))}
                  </s-stack>
                </Group>

                <Group title="Shape & motion">
                  <s-stack direction="inline" gap="base">
                    <s-number-field label="Corner radius" name="cornerRadius" value={String(config.theme.cornerRadius)} min={0} max={32} details="Roundness of the corners, in pixels (0 = square)." />
                    <s-number-field label="Toast width" name="width" value={String(config.theme.width)} min={240} max={480} details="How wide each toast is, in pixels." />
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-select label="Shadow" name="shadow" value={theme.shadow}>
                      <s-option value="none">None</s-option>
                      <s-option value="sm">Small</s-option>
                      <s-option value="md">Medium</s-option>
                      <s-option value="lg">Large</s-option>
                    </s-select>
                    <s-select label="Density" name="density" value={theme.density}>
                      <s-option value="comfortable">Comfortable</s-option>
                      <s-option value="compact">Compact</s-option>
                    </s-select>
                    <s-select label="Entry animation" name="animationIn" value={theme.animationIn}>
                      <s-option value="slide">Slide</s-option>
                      <s-option value="fade">Fade</s-option>
                      <s-option value="pop">Pop</s-option>
                      <s-option value="slide-scale">Slide + scale</s-option>
                    </s-select>
                  </s-stack>
                </Group>

                <Group title="Show / hide" hint="Pick what appears inside each toast. Product image = the item’s thumbnail; Quantity change = the “+N” badge; Event icon = a small coloured mark; Border/Backdrop blur = the frame around it.">
                  <s-stack direction="inline" gap="base">
                    {TOGGLES.map(([key, label]) => (
                      <s-switch key={key} label={label} name={key} value="on" checked={Boolean(config.theme[key])} />
                    ))}
                  </s-stack>
                </Group>
              </s-stack>
            </s-section>
            </div>

            {/* ---- PLACEMENT ---- */}
            <div style={panel("placement")}>
            <s-section heading="Placement">
              <s-stack direction="block" gap="large">
                <Group title="Where on screen" hint="Click a corner to place your toasts.">
                  <PositionField name="position" defaultValue={g.position} />
                </Group>
                <Group title="Spacing & stacking">
                  <s-stack direction="inline" gap="base">
                    <s-number-field label="Offset from top/bottom" name="offsetTop" value={String(g.offsetTop)} min={0} max={400} details="Gap from the screen edge, in pixels." />
                    <s-number-field label="Offset from side" name="offsetInline" value={String(g.offsetInline)} min={0} max={400} details="Gap from the screen edge, in pixels." />
                    <s-number-field label="Max visible at once" name="maxVisible" value={String(g.maxVisible)} min={1} max={6} details="Extra toasts collapse or queue." />
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    <s-select label="Stack order" name="stackDirection" value={g.stackDirection} details="When several toasts show at once, should the newest sit at the top of the pile or the bottom?">
                      <s-option value="newest-top">Newest on top</s-option>
                      <s-option value="newest-bottom">Newest on bottom</s-option>
                    </s-select>
                    <s-select label="When too many" name="overflowStrategy" value={g.overflowStrategy} details="Collapse shows “+N more”; queue waits its turn.">
                      <s-option value="collapse">Collapse (+N more)</s-option>
                      <s-option value="queue">Queue</s-option>
                    </s-select>
                  </s-stack>
                </Group>
              </s-stack>
            </s-section>
            </div>

            {/* ---- TIMING & INTERACTION ---- */}
            <div style={panel("timing")}>
            <s-section heading="Timing & interaction">
              <s-stack direction="block" gap="base">
                <s-number-field label="Stay on screen for" name="durationSec" value={String(g.durationMs / 1000)} min={1} max={60} step={0.5} details="Seconds each toast stays before it fades out." />
                <s-select label="Click a toast to…" name="clickAction" value={g.clickAction} details="What happens when a shopper clicks the toast.">
                  <s-option value="open-cart">Open the cart</s-option>
                  <s-option value="go-to-product">Go to the product</s-option>
                  <s-option value="none">Do nothing</s-option>
                </s-select>
                <s-switch label="Auto-dismiss after the duration" name="autoDismiss" value="on" checked={g.autoDismiss} />
                <s-switch label="Pause auto-dismiss on hover" name="pauseOnHover" value="on" checked={g.pauseOnHover} />
                <s-switch label="Show a close (×) button" name="closeable" value="on" checked={g.closeable} />
              </s-stack>
            </s-section>
            </div>

            {/* ---- ANTI-SPAM (grouping [Pro] + frequency) ---- */}
            <div style={panel("rules")}>
            {/* ---- GROUPING (Pro) ---- */}
            <s-section heading="Grouping & anti-spam">
              <ProFrame locked={!isPro}>
              <s-stack direction="block" gap="base">
                <s-badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Pro — basic grouping on Free"}</s-badge>
                <s-select label="Group rapid changes" name="grouping_mode" value={g.grouping.mode} details="When a shopper quickly changes the cart several times, show one combined toast instead of many — less spam. Choose what counts as “the same thing”." disabled={!isPro}>
                  <s-option value="by-product">By product</s-option>
                  <s-option value="by-variant">By variant</s-option>
                  <s-option value="by-type">By event type</s-option>
                  <s-option value="off">Off</s-option>
                </s-select>
                <s-stack direction="inline" gap="base">
                  <s-number-field label="Merge changes within" name="burstWindowSec" value={String(g.grouping.burstWindowMs / 1000)} min={0} max={5} step={0.1} disabled={!isPro} details="Cart changes this many seconds apart merge into one toast." />
                  <s-number-field label="Ignore repeats within" name="dedupeWindowSec" value={String(g.grouping.dedupeWindowMs / 1000)} min={0} max={10} step={0.1} disabled={!isPro} details="Identical toasts within this many seconds are skipped." />
                  <s-number-field label="Max toasts per minute" name="rateLimitPerMin" value={String(g.grouping.rateLimitPerMin)} min={0} max={240} disabled={!isPro} details="Hard cap on how many toasts show each minute. 0 = no cap." />
                </s-stack>
                <s-switch label="Merge quantity changes into one “+N”" name="mergeDeltas" value="on" checked={g.grouping.mergeDeltas} disabled={!isPro} />
              </s-stack>
              </ProFrame>
            </s-section>

            {/* ---- FREQUENCY ---- */}
            <s-section heading="Frequency & quiet mode">
              <s-stack direction="block" gap="base">
                <s-text color="subdued">Protects shoppers from spam. 0 means no limit.</s-text>
                <s-number-field label="Max toasts per session" name="maxPerSession" value={String(g.frequency.maxPerSession)} min={0} max={100} details="0 = unlimited. Caps how many a single visitor sees." />
                <s-number-field label="Wait between repeats" name="cooldownSec" value={String(g.frequency.cooldownMs / 1000)} min={0} max={3600} step={1} details="Seconds to wait before showing the same type again. 0 = no wait." />
                <s-number-field label="Hide a dismissed toast for" name="suppressAfterDismissMin" value={String(Math.round(g.frequency.suppressAfterDismissMs / 60000))} min={0} max={1440} step={1} details="Minutes to keep a dismissed toast hidden. 0 = it can show again right away." />
                <s-switch label="Quiet mode — mute all toasts" name="quietMode" value="on" checked={g.frequency.quietMode} details="A master off switch: turns every toast off for all shoppers without losing your settings. Handy during a sale or a busy period." />
              </s-stack>
            </s-section>
            </div>

            {/* ---- LANGUAGES (locale-as-data) ---- */}
            <div style={panel("languages")}>
            <s-section heading="Languages">
              <s-stack direction="block" gap="base">
                <s-text color="subdued">
                  Pick the languages your storefront copy is written in. Shoppers
                  see the string for their language, falling back to your default.
                  Your plan includes <s-text type="strong">{String(langLimit)}</s-text>{" "}
                  languages{isPro ? "" : " — upgrade to Pro for more"}.
                </s-text>
                <s-stack direction="inline" gap="base">
                  {COMMON_LOCALES.map((l) => (
                    <s-checkbox
                      key={l.code}
                      label={l.label}
                      name={`lang_${l.code}`}
                      value="on"
                      checked={loc.enabledLocales.includes(l.code)}
                    />
                  ))}
                </s-stack>
                <s-text-field
                  label="Other languages"
                  name="lang_custom"
                  value={loc.enabledLocales
                    .filter((c) => !COMMON_LOCALES.some((l) => l.code === c))
                    .join(", ")}
                  placeholder="pt-pt, sv, da"
                  details="Any code works, e.g. de, pt-BR, zh-Hant. Extras beyond your plan limit are dropped on save."
                />
                <s-select label="Default (fallback) language" name="default_locale" value={loc.defaultLocale}>
                  {[...new Set([loc.defaultLocale, ...loc.enabledLocales, "en"])].map((c) => (
                    <s-option key={c} value={c}>{languageName(c)}</s-option>
                  ))}
                </s-select>
              </s-stack>
            </s-section>
            </div>

            {/* ---- ADVANCED (Custom CSS [Pro] + History below) ---- */}
            <div style={panel("advanced")}>
            {/* ---- CUSTOM CSS (Pro) — go wild ---- */}
            <s-section heading="Custom CSS">
              <ProFrame locked={!isPro}>
                <s-stack direction="block" gap="base">
                  <s-badge tone={isPro ? "success" : "info"}>
                    {isPro ? "Pro" : "Pro — upgrade to enable"}
                  </s-badge>
                  <s-text color="subdued">
                    Go wild — inject your own CSS into the toast (rainbow borders,
                    a mascot, whatever). It applies only inside the toast, never
                    the rest of your storefront. Stable hooks that won’t change
                    between versions:
                  </s-text>
                  <s-unordered-list>
                    <s-list-item><s-text type="strong">[data-won-toast]</s-text> — each toast card</s-list-item>
                    <s-list-item><s-text type="strong">{'[data-type="added"]'}</s-text> (removed / increased / …) — style per event</s-list-item>
                    <s-list-item><s-text type="strong">{'[data-won-type="countdown"]'}</s-text> (cart / announcement / …) — style one toast type</s-list-item>
                    <s-list-item><s-text type="strong">[data-won-toast-region]</s-text> — the container</s-list-item>
                    <s-list-item>vars <s-text type="strong">--won-bg / --won-text / --won-radius / --won-shadow</s-text></s-list-item>
                  </s-unordered-list>
                  <s-text-area
                    label="Custom CSS (max 4000 chars)"
                    name="customCss"
                    rows={8}
                    value={config.theme.customCss ?? ""}
                    disabled={!isPro}
                    placeholder={
                      "[data-won-toast]{\n" +
                      "  border:3px solid transparent;\n" +
                      "  background:linear-gradient(var(--won-bg),var(--won-bg)) padding-box,\n" +
                      "    linear-gradient(90deg,red,orange,yellow,green,blue,violet) border-box;\n" +
                      "  animation:won-rainbow 3s linear infinite;\n" +
                      "}\n@keyframes won-rainbow{to{filter:hue-rotate(360deg)}}"
                    }
                  />
                </s-stack>
              </ProFrame>
            </s-section>
            </div>
          </s-stack>
        </Form>

        {/* Sticky live preview — same render tokens as the storefront. On the
            Placement segment we show the SCHEMATIC storefront (so position/offset/
            max-visible have a visible effect — "what is 40px" is now on-screen);
            elsewhere the close-up stack shows the look, with Animate for timing. */}
        <div style={{ position: "sticky", top: 12 }}>
          {seg === "placement" ? (
            <StorefrontPreview
              theme={theme}
              position={live.position}
              offsetTop={live.offsetTop}
              offsetInline={live.offsetInline}
              maxVisible={live.maxVisible}
              stackDirection={live.stackDirection}
              closeable={live.closeable}
              customCss={isPro ? theme.customCss : undefined}
            />
          ) : (
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text type="strong">Preview</s-text>
                <s-switch
                  label="Animate"
                  checked={animate}
                  onChange={(e) =>
                    setAnimate((e.currentTarget as unknown as { checked: boolean }).checked)
                  }
                />
              </s-stack>
              {animate ? (
                <AnimatedToastPreview
                  theme={theme}
                  durationMs={live.durationMs}
                  stackDirection={live.stackDirection}
                  maxVisible={live.maxVisible}
                  closeable={live.closeable}
                  customCss={isPro ? theme.customCss : undefined}
                />
              ) : (
                <ToastPreview theme={theme} closeable={live.closeable} customCss={isPro ? theme.customCss : undefined} />
              )}
            </s-stack>
          )}
        </div>
      </div>

      {/* Auto version history — lives in the Advanced segment. Its own restore
          mini-forms stay outside the main Form (no nested forms). Snapshot per
          save; one-click rollback (replaces raw-JSON backup, doctrine §4b). */}
      {seg === "advanced" ? (
      <s-section heading="History">
        {versions.length === 0 ? (
          <s-paragraph>
            Every time you save, a snapshot is kept here so you can roll back.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {versions.map((v, i) => (
              <s-stack key={v.id} direction="inline" gap="base" alignItems="center">
                <s-text>{new Date(v.createdAt).toLocaleString()}</s-text>
                {i === 0 ? <s-badge tone="success">Current</s-badge> : null}
                {i !== 0 ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="restore" />
                    <input type="hidden" name="versionId" value={v.id} />
                    <s-button type="submit">Restore</s-button>
                  </Form>
                ) : null}
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>
      ) : null}
    </s-page>
  );
}
