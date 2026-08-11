import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";

import {
  DEFAULT_THEME,
  DEFAULT_TOAST_CONFIG,
  sanitizeGlobalSettings,
  sanitizeTheme,
} from "@won/core/toasts/config.defaults";
import { PRESET_LOOKS, applyLookPreset } from "@won/core/toasts/presets";

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
import { PlanBadge } from "../components/PlanBadge";
import { WON_FONT } from "../lib/tokens";
import { PositionField } from "../components/PositionField";
import { SegmentedNav } from "../components/SegmentedNav";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";
import { EVENT_META } from "../lib/labels";

// Languages the merchant can pick from (open BCP-47; this is just a convenient
// starter set — resolveMessage accepts any code).
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
    gradient: f.get("gradient") === "on",
    gradientColor: f.get("gradientColor"),
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
    borderColor: f.get("borderColor"),
    backdropBlur: f.get("backdropBlur") === "on",
    showImage: f.get("showImage") === "on",
    showDelta: f.get("showDelta") === "on",
    showIcon: f.get("showIcon") === "on",
    iconSet: f.get("iconSet"),
    fontMode: f.get("fontMode"),
    fontFamily: f.get("fontFamily"),
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

  // Reset EVERYTHING (look + timing/placement/grouping/frequency) back to the
  // built-in defaults — the "how do I undo all my tweaks?" escape hatch. Still a
  // normal save, so History keeps a restore point if they change their mind.
  if (intent === "resetAll") {
    return persistConfig(() =>
      updateToastConfig(session.shop, {
        theme: DEFAULT_THEME,
        global: DEFAULT_TOAST_CONFIG.global,
      }),
    );
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

  // Languages moved to Markets (/app/markets) — Design no longer touches
  // locales, so it can't clobber them.
  return persistConfig(() =>
    updateToastConfig(session.shop, {
      theme: {
        ...current.theme,
        ...savedTheme,
        accent: { ...current.theme.accent, ...(savedTheme.accent ?? {}) },
      },
      global: mergedGlobal,
    }),
  );
};

// Border lives in the Branding group (with its colour); backdrop blur + the
// content toggles stay here.
const TOGGLES = [
  ["showImage", "Product image"],
  ["showDelta", "Quantity change (+N)"],
  ["showIcon", "Event icon"],
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
  { key: "advanced", label: "Advanced" },
];

// Tiny "before → after" illustration for the Merge lever, so the setting's effect
// is visible, not just described (a burst of separate toasts becomes one "+N").
const beforeAfter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#5b6472",
  background: "#fff",
  border: "1px solid #e6e9ee",
  borderRadius: 8,
  padding: "8px 10px",
};
const miniT: React.CSSProperties = {
  width: 14,
  height: 12,
  borderRadius: 3,
  background: "#f4a259",
  opacity: 0.5,
  display: "inline-block",
};

// A preset is a look — so its picker should SHOW the look, not just name it
// (doctrine §1 preview-first). Each card renders a tiny to-token toast swatch
// (background from the mode, the accent stripe, the corner radius) plus the
// preset's palette dots, so the merchant compares looks by eye before applying.
function presetSwatch(id: keyof typeof PRESET_LOOKS | "default") {
  const look = id === "default" ? DEFAULT_THEME : PRESET_LOOKS[id];
  const mode = (look as { mode?: string }).mode ?? "system";
  const dark = mode === "dark";
  const bg = dark ? "#12171c" : "#ffffff";
  const text = dark ? "#e7ecf1" : "#1b2027";
  const accents = (look as { accent?: Record<string, string> }).accent ?? DEFAULT_THEME.accent;
  const stripe = accents.added ?? "#4b5bd6";
  const radius = Math.min(14, Number((look as { cornerRadius?: number }).cornerRadius ?? 10));
  const border = (look as { border?: boolean }).border
    ? `1px solid ${(look as { borderColor?: string }).borderColor ?? "#e2e6ea"}`
    : "1px solid transparent";
  return { bg, text, stripe, radius, border, accents };
}

function LookPresetCard({ id, label }: { id: keyof typeof PRESET_LOOKS | "default"; label: string }) {
  const s = presetSwatch(id);
  const dots = ["added", "removed", "shipping", "gift"] as const;
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="applyLook" />
      <input type="hidden" name="preset" value={id} />
      <button
        type="submit"
        style={{
          width: 150,
          textAlign: "left",
          padding: 10,
          borderRadius: 12,
          border: "1px solid #d6dbe1",
          background: "#fff",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "block",
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        }}
      >
        {/* mini toast preview in the preset's own look */}
        <div style={{ background: s.bg === "#ffffff" ? "#f1f4f7" : "#e9edf1", borderRadius: 9, padding: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", background: s.bg, color: s.text, border: s.border, borderLeft: `3px solid ${s.stripe}`, borderRadius: s.radius, padding: "7px 8px", boxShadow: "0 1px 3px rgba(20,28,45,.12)" }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ height: 5, width: "70%", borderRadius: 3, background: s.text, opacity: 0.85 }} />
              <div style={{ height: 4, width: "45%", borderRadius: 3, background: s.text, opacity: 0.4, marginTop: 4 }} />
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, color: s.stripe }}>+1</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1b2027" }}>{label}</span>
          <span style={{ display: "flex", gap: 3 }}>
            {dots.map((d) => (
              <span key={d} style={{ width: 8, height: 8, borderRadius: 999, background: s.accents[d] ?? "#c3cad2" }} />
            ))}
          </span>
        </div>
      </button>
    </Form>
  );
}

// A titled group of controls — gives the page a readable rhythm instead of a
// flat wall of fields (doctrine §8). Reused for every Design section.
// §7/W1 — a section title that clearly OUTRANKS Polaris field labels (which we
// can't restyle). Bolder + a touch larger + darker, so "Theme mode" reads as a
// field UNDER "Colours", not a peer. One line, no extra chrome — hierarchy, not
// more perceived settings.
function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: WON_FONT, fontSize: 14, fontWeight: 700, color: "#1a1f24", letterSpacing: "-0.01em", lineHeight: 1.3 }}>
      {children}
    </div>
  );
}

function Group({
  title,
  hint,
  children,
  collapsible = false,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  // §9: advanced / rarely-touched groups collapse so the page reads calm on first
  // paint (depth is opt-in). Hidden <details> fields still submit and still feed
  // the live preview — collapsing changes visibility only.
  if (collapsible) {
    return (
      <details>
        <summary style={{ cursor: "pointer", padding: "4px 0" }}>
          <GroupTitle>{title}</GroupTitle>
        </summary>
        <div style={{ marginTop: 8 }}>
          <s-stack direction="block" gap="base">
            {hint ? <s-text color="subdued">{hint}</s-text> : null}
            {children}
          </s-stack>
        </div>
      </details>
    );
  }
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small">
        <GroupTitle>{title}</GroupTitle>
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
    <s-page heading="Design" inlineSize="large">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}
      {/* Studio shell (doctrine §7b): same picker + one panel + sticky preview as
          Toasts. Hidden panels still submit (display:none) so one Save Bar covers
          the whole form. */}
      <SegmentedNav items={DESIGN_SEGMENTS} selected={seg} onSelect={setSeg} ariaLabel="Design sections" />

      {/* "Start from a look" belongs to the Look tab only — a preset IS a look —
          so it shows under Look and never bleeds into Placement/Timing/etc. Kept
          outside the main Form: each preset is its own mini-form and forms can't
          nest. */}
      {seg === "look" ? (
        <s-section heading="Start from a look">
          <s-paragraph>Pick a preset, then fine-tune below. Applying a preset saves immediately.</s-paragraph>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {LOOK_PRESETS.map((p) => (
              <LookPresetCard key={p.id} id={p.id} label={p.label} />
            ))}
          </div>
          {/* Clear escape hatch back to defaults (feedback 2): tweaked too much
              and want to start over? One click, and History keeps a restore point. */}
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text color="subdued">Changed too much and want to start over?</s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="resetAll" />
              <s-button type="submit" variant="secondary">Reset to default design</s-button>
            </Form>
          </s-stack>
        </s-section>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(320px,420px)",
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

                <Group title="Accent colour per event" hint="The coloured stripe on each toast — one per shopper action." collapsible>
                  <s-stack direction="inline" gap="base">
                    {EVENT_META.map((ev) => (
                      <s-color-field key={ev.key} label={ev.title} name={`accent_${ev.key}`} value={config.theme.accent[ev.key]} />
                    ))}
                  </s-stack>
                </Group>

                <Group title="Shape & motion" collapsible>
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

                <Group title="Branding" hint="No-code styling between the on/off toggles and Custom CSS — a gradient fill, your own icons, a border, and the font." collapsible>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base" alignItems="end">
                      <s-switch label="Gradient background" name="gradient" value="on" checked={config.theme.gradient} details="Fill the toast with a soft two-colour gradient instead of a flat colour." onChange={() => sync()} />
                      <s-color-field label="Gradient blends to" name="gradientColor" value={config.theme.gradientColor} details="The second colour the background fades into (from the background colour above)." />
                    </s-stack>
                    <s-stack direction="inline" gap="base" alignItems="end">
                      <s-switch label="Border" name="border" value="on" checked={config.theme.border} details="Draw a thin outline around each toast." onChange={() => sync()} />
                      <s-color-field label="Border colour" name="borderColor" value={config.theme.borderColor} />
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-select label="Icon style" name="iconSet" value={theme.iconSet} details="What the small mark on the left looks like. (Turn it off with “Event icon” below.)">
                        <s-option value="line">Colour dot</s-option>
                        <s-option value="emoji">Emoji</s-option>
                        <s-option value="none">No icon</s-option>
                      </s-select>
                      <s-select label="Font" name="fontMode" value={theme.fontMode} details="System = a clean default; Match my theme = your storefront’s font; Custom = your own.">
                        <s-option value="system">System</s-option>
                        <s-option value="inherit-theme">Match my theme</s-option>
                        <s-option value="custom">Custom…</s-option>
                      </s-select>
                    </s-stack>
                    <div style={{ display: theme.fontMode === "custom" ? "block" : "none" }}>
                      <s-text-field label="Custom font family" name="fontFamily" value={config.theme.fontFamily} placeholder='Georgia, "Times New Roman", serif' details="A CSS font-family list. The font must already load on your storefront." />
                    </div>
                  </s-stack>
                </Group>

                <Group title="Show / hide" hint="Pick what appears inside each toast. Product image = the item’s thumbnail; Quantity change = the “+N” badge; Event icon = a small coloured mark; Border/Backdrop blur = the frame around it." collapsible>
                  <s-stack direction="inline" gap="base">
                    {TOGGLES.map(([key, label]) => (
                      <s-switch key={key} label={label} name={key} value="on" checked={Boolean(config.theme[key])} onChange={() => sync()} />
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
                <s-switch label="Auto-dismiss after the duration" name="autoDismiss" value="on" checked={g.autoDismiss} details="On: each toast fades out on its own after the time above. Off: it stays until the shopper closes it." />
                <s-switch label="Pause auto-dismiss on hover" name="pauseOnHover" value="on" checked={g.pauseOnHover} details="While the shopper's cursor is over a toast, the countdown to fade out pauses — so it won't vanish mid-read. It resumes when they move away." />
                <s-switch label="Show a close (×) button" name="closeable" value="on" checked={g.closeable} details="Adds an × in the corner so a shopper can dismiss a toast immediately." onChange={() => sync()} />
              </s-stack>
            </s-section>
            </div>

            {/* ---- ANTI-SPAM — three plain-language levers instead of four
                 overlapping concepts (grouping/anti-spam/frequency/quiet).
                 MERGE bursts · CAP the volume · QUIET everything. Field NAMES are
                 unchanged so the action/sanitizer are untouched; only the framing
                 changed. Governance stays global (per-type anti-spam makes no
                 sense — see per-type-look-behavior decision). ---- */}
            <div style={panel("rules")}>
            <s-section heading="Anti-spam">
              <s-stack direction="block" gap="large">
                <s-text color="subdued">
                  Three levers keep toasts from overwhelming a shopper — <s-text type="strong">merge</s-text> bursts,
                  <s-text type="strong"> cap</s-text> the volume, or <s-text type="strong">quiet</s-text> everything.
                  They apply across your whole store.
                </s-text>

                {/* MERGE (Pro) */}
                <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                  <ProFrame locked={!isPro}>
                    <s-stack direction="block" gap="base">
                      <s-stack direction="inline" gap="small-300" alignItems="center">
                        <s-text type="strong">Merge — group rapid changes</s-text>
                      </s-stack>
                      <s-text color="subdued">
                        When a shopper changes the cart several times fast, show one combined
                        toast instead of many.
                      </s-text>
                      <s-select label="Group by" name="grouping_mode" value={g.grouping.mode} details="What counts as “the same thing” when merging." disabled={!isPro}>
                        <s-option value="by-product">Product</s-option>
                        <s-option value="by-variant">Variant</s-option>
                        <s-option value="by-type">Event type</s-option>
                        <s-option value="off">Don’t merge</s-option>
                      </s-select>
                      <s-number-field label="Merge changes within" name="burstWindowSec" value={String(g.grouping.burstWindowMs / 1000)} min={0} max={5} step={0.1} disabled={!isPro} details="Cart changes this many seconds apart merge into one toast." />
                      <s-switch label="Merge quantity changes into one “+N”" name="mergeDeltas" value="on" checked={g.grouping.mergeDeltas} disabled={!isPro} details="Two quick “+1”s become a single “+2”." />
                      <div style={beforeAfter}>
                        <span>Without</span>
                        <span style={miniT} /><span style={miniT} /><span style={miniT} /><span style={miniT} />
                        <span style={{ color: "#8892a0" }}>→</span>
                        <span>With</span>
                        <span style={{ ...miniT, width: 34, opacity: 0.9 }} />
                        <strong style={{ color: "#2f9e6f" }}>+4</strong>
                      </div>
                    </s-stack>
                  </ProFrame>
                </s-box>

                {/* CAP */}
                <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                  <s-stack direction="block" gap="base">
                    <s-text type="strong">Cap — how much is too much</s-text>
                    <s-text color="subdued">Hard limits so a shopper is never flooded. 0 means no limit.</s-text>
                    <s-stack direction="inline" gap="base">
                      <s-number-field label="Max toasts per session" name="maxPerSession" value={String(g.frequency.maxPerSession)} min={0} max={100} details="Caps how many a single visitor sees the whole visit." />
                      <s-number-field label="Wait between repeats" name="cooldownSec" value={String(g.frequency.cooldownMs / 1000)} min={0} max={3600} step={1} details="Seconds to wait before showing the same type again." />
                      <s-number-field label="Hide a dismissed toast for" name="suppressAfterDismissMin" value={String(Math.round(g.frequency.suppressAfterDismissMs / 60000))} min={0} max={1440} step={1} details="Minutes to keep a toast hidden after a shopper closes it." />
                    </s-stack>
                    <s-stack direction="inline" gap="small-300" alignItems="center">
                      <s-text color="subdued">Advanced caps</s-text>
                      <PlanBadge tier="pro" locked={!isPro} />
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-number-field label="Max toasts per minute" name="rateLimitPerMin" value={String(g.grouping.rateLimitPerMin)} min={0} max={240} disabled={!isPro} details="Hard cap per minute across all shoppers." />
                      <s-number-field label="Ignore repeats within" name="dedupeWindowSec" value={String(g.grouping.dedupeWindowMs / 1000)} min={0} max={10} step={0.1} disabled={!isPro} details="Identical toasts this close together are skipped." />
                    </s-stack>
                  </s-stack>
                </s-box>

                {/* QUIET */}
                <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                  <s-stack direction="block" gap="base">
                    <s-text type="strong">Quiet — mute everything</s-text>
                    <s-text color="subdued">
                      A master off switch: turn every toast off during a sale or a busy
                      period without losing your settings.
                    </s-text>
                    <s-switch label="Quiet mode" name="quietMode" value="on" checked={g.frequency.quietMode} details="Turns all toasts off for every shopper until you switch it back on." />
                  </s-stack>
                </s-box>
              </s-stack>
            </s-section>
            </div>

            {/* ---- ADVANCED (Custom CSS [Pro] + History below) ---- */}
            <div style={panel("advanced")}>
            {/* ---- CUSTOM CSS (Pro) — go wild ---- */}
            <s-section heading="Custom CSS">
              <ProFrame locked={!isPro}>
                <s-stack direction="block" gap="base">
                  <s-text color="subdued">
                    Go wild — inject your own CSS into the toast (rainbow borders,
                    a mascot, whatever). It applies only inside the toast, never
                    the rest of your storefront.
                  </s-text>

                  {/* Answers the #1 question merchants ask here: "how do I make my
                      cart toast look different from my announcements?" — points to
                      the no-code path first (per-type Look & timing), then the CSS
                      hook. (doctrine §4 — meet the merchant's real goal, not just
                      list selectors.) */}
                  <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">Want one toast type to look different?</s-text>
                      <s-text color="subdued">
                        e.g. your <s-text type="strong">cart</s-text> toast styled
                        differently from your <s-text type="strong">announcements</s-text>.
                        You usually don’t need CSS — open a toast on{" "}
                        <s-link href="/app/toasts">Toasts</s-link> and use{" "}
                        <s-text type="strong">“Look &amp; timing for this toast”</s-text>.
                        For finer control, target it by type in the CSS below with{" "}
                        <s-text type="strong">{'[data-won-type="cart"]'}</s-text>.
                      </s-text>
                    </s-stack>
                  </s-box>

                  <s-text type="strong">Stable hooks</s-text>
                  <s-text color="subdued">Two axes: what the shopper did, and which toast type it is.</s-text>
                  <s-unordered-list>
                    <s-list-item><s-text type="strong">[data-won-toast]</s-text> — each toast card</s-list-item>
                    <s-list-item><s-text type="strong">{'[data-type="added"]'}</s-text> (removed / increased / decreased / gift / shipping) — the shopper <s-text type="strong">action</s-text></s-list-item>
                    <s-list-item><s-text type="strong">{'[data-won-type="cart"]'}</s-text> (countdown / announcement / stock.low / …) — the toast <s-text type="strong">type</s-text></s-list-item>
                    <s-list-item><s-text type="strong">[data-won-toasts-region]</s-text> — the container that holds the stack</s-list-item>
                    <s-list-item>vars <s-text type="strong">--won-bg / --won-text / --won-radius / --won-shadow</s-text></s-list-item>
                  </s-unordered-list>
                  <s-text-area
                    label="Custom CSS (max 4000 chars)"
                    name="customCss"
                    rows={8}
                    value={config.theme.customCss ?? ""}
                    disabled={!isPro}
                    placeholder={
                      "/* Give cart toasts a green edge… */\n" +
                      '[data-won-type="cart"]{ border-left:4px solid #16a34a; }\n\n' +
                      "/* …and make announcements stand out differently */\n" +
                      '[data-won-type="announcement"]{ --won-bg:#111; --won-text:#fff; }'
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
