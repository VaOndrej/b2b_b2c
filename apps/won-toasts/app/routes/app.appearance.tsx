import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { sanitizeTheme } from "@won/core/toasts/config.defaults";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { ToastPreview } from "../components/ToastPreview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const f = await request.formData();
  const patch = sanitizeTheme({
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
      ...patch,
      accent: { ...current.theme.accent, ...(patch.accent ?? {}) },
    },
  });
  return { saved: true };
};

const field = { display: "grid", gap: "6px" } as const;
const control = {
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  font: "inherit",
  padding: "8px 10px",
} as const;
const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "16px",
} as const;

export default function AppearanceRoute() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  // Local state drives the LIVE preview from unsaved form values. On submit the
  // named inputs post these same values, so preview === what gets saved ===
  // what the storefront renders (shared @won/core tokens).
  const [theme, setTheme] = useState(config.theme);
  const set = (patch: Partial<typeof theme>) =>
    setTheme((t) => ({ ...t, ...patch }));
  const setAccent = (key: string, value: string) =>
    setTheme((t) => ({ ...t, accent: { ...t.accent, [key]: value } }));

  return (
    <s-page heading="Appearance">
      <s-section heading="Design studio">
        <s-paragraph>
          Style is configured here; the storefront only renders what you set.
          The preview below uses the exact same render tokens as the storefront.
        </s-paragraph>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) minmax(260px,340px)",
            gap: "28px",
            alignItems: "start",
          }}
        >
          <Form method="post">
            <div style={{ display: "grid", gap: "18px" }}>
              <label style={field}>
                <span>Theme mode</span>
                <select
                  name="mode"
                  value={theme.mode}
                  onChange={(e) => set({ mode: e.target.value as typeof theme.mode })}
                  style={control}
                >
                  <option value="system">system (auto light/dark)</option>
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                  <option value="custom">custom colours</option>
                </select>
              </label>

              {theme.mode === "custom" ? (
                <div style={grid}>
                  <label style={field}>
                    <span>Background</span>
                    <input
                      type="color"
                      name="colorBg"
                      value={theme.colorBg}
                      onChange={(e) => set({ colorBg: e.target.value })}
                    />
                  </label>
                  <label style={field}>
                    <span>Text</span>
                    <input
                      type="color"
                      name="colorText"
                      value={theme.colorText}
                      onChange={(e) => set({ colorText: e.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <input type="hidden" name="colorBg" value={theme.colorBg} />
                  <input type="hidden" name="colorText" value={theme.colorText} />
                </>
              )}

              <fieldset style={{ border: "1px solid #e2e6ea", borderRadius: 10, padding: 14 }}>
                <legend>Accent colours per event</legend>
                <div style={grid}>
                  {(
                    [
                      ["added", "Added"],
                      ["removed", "Removed"],
                      ["increased", "Increased"],
                      ["decreased", "Decreased"],
                      ["gift", "Gift"],
                      ["shipping", "Shipping"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} style={field}>
                      <span>{label}</span>
                      <input
                        type="color"
                        name={`accent_${key}`}
                        value={theme.accent[key]}
                        onChange={(e) => setAccent(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <div style={grid}>
                <label style={field}>
                  <span>Corner radius: {theme.cornerRadius}px</span>
                  <input
                    type="range"
                    name="cornerRadius"
                    min={0}
                    max={32}
                    value={theme.cornerRadius}
                    onChange={(e) => set({ cornerRadius: Number(e.target.value) })}
                  />
                </label>
                <label style={field}>
                  <span>Width: {theme.width}px</span>
                  <input
                    type="range"
                    name="width"
                    min={240}
                    max={480}
                    value={theme.width}
                    onChange={(e) => set({ width: Number(e.target.value) })}
                  />
                </label>
                <label style={field}>
                  <span>Shadow</span>
                  <select
                    name="shadow"
                    value={theme.shadow}
                    onChange={(e) => set({ shadow: e.target.value as typeof theme.shadow })}
                    style={control}
                  >
                    <option value="none">none</option>
                    <option value="sm">small</option>
                    <option value="md">medium</option>
                    <option value="lg">large</option>
                  </select>
                </label>
                <label style={field}>
                  <span>Density</span>
                  <select
                    name="density"
                    value={theme.density}
                    onChange={(e) => set({ density: e.target.value as typeof theme.density })}
                    style={control}
                  >
                    <option value="comfortable">comfortable</option>
                    <option value="compact">compact</option>
                  </select>
                </label>
                <label style={field}>
                  <span>Entry animation</span>
                  <select
                    name="animationIn"
                    value={theme.animationIn}
                    onChange={(e) =>
                      set({ animationIn: e.target.value as typeof theme.animationIn })
                    }
                    style={control}
                  >
                    <option value="slide">slide</option>
                    <option value="fade">fade</option>
                    <option value="pop">pop</option>
                    <option value="slide-scale">slide-scale</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
                {(
                  [
                    ["showImage", "Product image"],
                    ["showDelta", "Delta (+N)"],
                    ["showIcon", "Icon"],
                    ["border", "Border"],
                    ["backdropBlur", "Backdrop blur"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      name={key}
                      checked={Boolean(theme[key])}
                      onChange={(e) => set({ [key]: e.target.checked } as Partial<typeof theme>)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div>
                <button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save appearance"}
                </button>
                {actionData?.saved ? (
                  <span style={{ marginLeft: 12, color: "#1f8f5f" }}>Saved.</span>
                ) : null}
              </div>
            </div>
          </Form>

          <ToastPreview theme={theme} />
        </div>
      </s-section>
    </s-page>
  );
}
