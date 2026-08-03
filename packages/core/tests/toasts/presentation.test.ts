import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_TOAST_CONFIG } from "../../src/toasts/config.defaults.ts";
import {
  accentFor,
  resolveToastPresentation,
  styleTokensFor,
} from "../../src/toasts/presentation.ts";
import type { ToastCartEvent } from "../../src/toasts/cart-events.ts";

function ev(
  type: ToastCartEvent["type"],
  delta: number,
  title = "Widget",
): ToastCartEvent {
  return {
    type,
    key: "k",
    variantId: 1,
    delta,
    quantity: Math.max(0, delta),
    line: { key: "k", variantId: 1, quantity: Math.max(0, delta), title },
  };
}

test("added event presents an accent + positive delta from the theme", () => {
  const p = resolveToastPresentation(ev("added", 2), DEFAULT_TOAST_CONFIG);
  assert.equal(p.type, "added");
  assert.equal(p.detail, "Widget");
  assert.equal(p.delta, "+2");
  assert.equal(p.accent, DEFAULT_TOAST_CONFIG.theme.accent.added);
});

test("removed event has no delta and uses the removed accent", () => {
  const p = resolveToastPresentation(ev("removed", -1), DEFAULT_TOAST_CONFIG);
  assert.equal(p.delta, "");
  assert.equal(p.accent, DEFAULT_TOAST_CONFIG.theme.accent.removed);
});

test("showDelta=false hides the delta everywhere", () => {
  const cfg = {
    theme: { ...DEFAULT_TOAST_CONFIG.theme, showDelta: false },
  };
  assert.equal(resolveToastPresentation(ev("added", 3), cfg).delta, "");
});

test("accentFor falls back to info for unknown types", () => {
  assert.equal(
    accentFor(DEFAULT_TOAST_CONFIG.theme, "info"),
    DEFAULT_TOAST_CONFIG.theme.accent.info,
  );
});

test("styleTokensFor maps theme tokens to CSS custom properties", () => {
  const tokens = styleTokensFor(DEFAULT_TOAST_CONFIG.theme);
  assert.equal(tokens["--won-radius"], "12px");
  assert.equal(tokens["--won-width"], "340px");
  assert.equal(tokens["--won-bg"], "#ffffff");
});

test("dark and custom modes change background/text tokens", () => {
  const dark = styleTokensFor({ ...DEFAULT_TOAST_CONFIG.theme, mode: "dark" });
  assert.notEqual(dark["--won-bg"], "#ffffff");
  const custom = styleTokensFor({
    ...DEFAULT_TOAST_CONFIG.theme,
    mode: "custom",
    colorBg: "#101010",
    colorText: "#fafafa",
  });
  assert.equal(custom["--won-bg"], "#101010");
  assert.equal(custom["--won-text"], "#fafafa");
});
