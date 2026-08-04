import { useCallback, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import {
  resolveToastConfig,
  sanitizeTheme,
} from "@won/core/toasts/config.defaults";
import { PRESET_LOOKS, applyLookPreset } from "@won/core/toasts/presets";
import { exportConfig, importConfig } from "@won/core/toasts/config-io";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { ToastPreview } from "../components/ToastPreview";
import { useSavedToast } from "../lib/use-saved-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  return { config, exportJson: exportConfig(config) };
};

// Read every named field straight out of the form. Used both by the live
// preview (on input) and — implicitly, via the same names — by the action on
// submit, so preview === what gets saved === what the storefront renders.
function readTheme(form: HTMLFormElement) {
  const f = new FormData(form);
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
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const intent = f.get("intent");

  // MVP7 — one-click preset: merge a named look over the current theme + save.
  if (intent === "applyLook") {
    const current = await getToastConfig(session.shop);
    const theme = applyLookPreset(current.theme, String(f.get("preset") ?? ""));
    await updateToastConfig(session.shop, { theme });
    return { saved: true };
  }

  // MVP7 — import a config JSON. importConfig re-sanitizes every section, so an
  // untrusted file can't produce an unusable config. `enabled` is left alone
  // (install state must not be flipped by an import).
  if (intent === "import") {
    const resolved = resolveToastConfig(importConfig(String(f.get("config") ?? "")));
    await updateToastConfig(session.shop, {
      plan: resolved.plan,
      global: resolved.global,
      theme: resolved.theme,
      messages: resolved.messages,
      milestones: resolved.milestones,
      targeting: resolved.targeting,
    });
    return { saved: true };
  }

  const saved = sanitizeTheme({
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
  });
  const current = await getToastConfig(session.shop);
  await updateToastConfig(session.shop, {
    theme: {
      ...current.theme,
      ...saved,
      accent: { ...current.theme.accent, ...(saved.accent ?? {}) },
    },
  });
  return { saved: true };
};

const ACCENTS = [
  ["added", "Added"],
  ["removed", "Removed"],
  ["increased", "Increased"],
  ["decreased", "Decreased"],
  ["gift", "Gift"],
  ["shipping", "Shipping"],
] as const;

const TOGGLES = [
  ["showImage", "Product image"],
  ["showDelta", "Delta (+N)"],
  ["showIcon", "Icon"],
  ["border", "Border"],
  ["backdropBlur", "Backdrop blur"],
] as const;

const LOOK_PRESETS: { id: keyof typeof PRESET_LOOKS; label: string }[] = [
  { id: "minimal", label: "Minimal" },
  { id: "bold", label: "Bold" },
  { id: "luxury", label: "Luxury" },
  { id: "playful", label: "Playful" },
];

export default function AppearanceRoute() {
  const { config, exportJson } = useLoaderData<typeof loader>();
  useSavedToast();

  const formRef = useRef<HTMLFormElement>(null);

  // The form is uncontrolled (Polaris fields keep their own value; initial
  // values come from config). The live preview is driven by re-reading the
  // whole form on every input/change — native events from the s-* components
  // bubble up to the <form>, so this stays in sync without per-field wiring.
  const [theme, setTheme] = useState(config.theme);
  const sync = useCallback(() => {
    if (!formRef.current) return;
    const patch = readTheme(formRef.current);
    setTheme((prev) => ({
      ...prev,
      ...patch,
      accent: { ...prev.accent, ...(patch.accent ?? {}) },
    }));
  }, []);

  const isCustom = theme.mode === "custom";

  return (
    <s-page heading="Appearance">
      {/* MVP7 — start from a curated look in one click, then fine-tune below. */}
      <s-section heading="Presets">
        <s-paragraph>
          Start from a look, then fine-tune it below. Applying a preset saves
          immediately.
        </s-paragraph>
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

      <s-section heading="Fine-tune (advanced)">
        <s-paragraph>
          Style is configured here; the storefront only renders what you set.
          The preview uses the exact same render tokens as the storefront.
        </s-paragraph>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(260px,340px)",
            gap: "28px",
            alignItems: "start",
          }}
        >
          {/* data-save-bar shows the native Save/Discard bar on any change and
              guards navigation. onInput/onChange drive the live preview from the
              (uncontrolled) fields; onReset resyncs it after a Discard. */}
          <Form
            method="post"
            ref={formRef}
            data-save-bar
            onInput={sync}
            onChange={sync}
            onReset={() => setTheme(config.theme)}
          >
            <s-stack direction="block" gap="large">
              <s-select label="Theme mode" name="mode" value={theme.mode}>
                <s-option value="system">system (auto light/dark)</s-option>
                <s-option value="light">light</s-option>
                <s-option value="dark">dark</s-option>
                <s-option value="custom">custom colours</s-option>
              </s-select>

              {/* Always posted (so the action + preview always read them);
                  only shown when the mode is custom. */}
              <div style={{ display: isCustom ? "block" : "none" }}>
                <s-stack direction="inline" gap="base">
                  <s-color-field
                    label="Background"
                    name="colorBg"
                    value={config.theme.colorBg}
                  />
                  <s-color-field
                    label="Text"
                    name="colorText"
                    value={config.theme.colorText}
                  />
                </s-stack>
              </div>

              <s-section heading="Accent colours per event">
                <s-stack direction="inline" gap="base">
                  {ACCENTS.map(([key, label]) => (
                    <s-color-field
                      key={key}
                      label={label}
                      name={`accent_${key}`}
                      value={config.theme.accent[key]}
                    />
                  ))}
                </s-stack>
              </s-section>

              <s-stack direction="inline" gap="base">
                <s-number-field
                  label="Corner radius (px)"
                  name="cornerRadius"
                  value={String(config.theme.cornerRadius)}
                  min={0}
                  max={32}
                />
                <s-number-field
                  label="Width (px)"
                  name="width"
                  value={String(config.theme.width)}
                  min={240}
                  max={480}
                />
              </s-stack>

              <s-stack direction="inline" gap="base">
                <s-select label="Shadow" name="shadow" value={theme.shadow}>
                  <s-option value="none">none</s-option>
                  <s-option value="sm">small</s-option>
                  <s-option value="md">medium</s-option>
                  <s-option value="lg">large</s-option>
                </s-select>
                <s-select label="Density" name="density" value={theme.density}>
                  <s-option value="comfortable">comfortable</s-option>
                  <s-option value="compact">compact</s-option>
                </s-select>
                <s-select
                  label="Entry animation"
                  name="animationIn"
                  value={theme.animationIn}
                >
                  <s-option value="slide">slide</s-option>
                  <s-option value="fade">fade</s-option>
                  <s-option value="pop">pop</s-option>
                  <s-option value="slide-scale">slide-scale</s-option>
                </s-select>
              </s-stack>

              <s-stack direction="inline" gap="base">
                {TOGGLES.map(([key, label]) => (
                  <s-switch
                    key={key}
                    label={label}
                    name={key}
                    value="on"
                    checked={Boolean(config.theme[key])}
                  />
                ))}
              </s-stack>

            </s-stack>
          </Form>

          <ToastPreview theme={theme} />
        </div>
      </s-section>

      {/* MVP7 — portable backup/restore. Export is a plain snapshot; import
          re-sanitizes every section before saving. */}
      <s-section heading="Backup & restore">
        <s-paragraph>
          Copy the JSON below to back up your settings, or paste a saved config
          to restore it.
        </s-paragraph>
        <s-text-area
          label="Current config (copy to back up)"
          value={exportJson}
          rows={6}
        />
        <Form method="post">
          <input type="hidden" name="intent" value="import" />
          <s-stack direction="block" gap="base">
            <s-text-area
              label="Paste a config to restore"
              name="config"
              rows={6}
              placeholder="{ …exported Won Toasts config… }"
            />
            <s-button type="submit">Import config</s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
