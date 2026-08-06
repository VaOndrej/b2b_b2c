import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_TOAST_CONFIG } from "@won/core/toasts/config.defaults";
import type { ToastAppConfig } from "@won/core/toasts/config.types";

import { readTypeOverride } from "../../app/lib/type-override";

// A config whose theme/global are the resolved defaults. The admin's per-type
// fields are pre-filled from exactly these values.
const config: ToastAppConfig = DEFAULT_TOAST_CONFIG;
const t = config.theme;
const g = config.global;

// Build the FormData the admin posts: every `bt_cart_*` field pre-filled from the
// resolved default (i.e. the merchant changed nothing). `withColorCase` decides
// whether colour fields arrive UPPERCASE (as s-color-field emits) or as-is.
function unchangedForm(upperColors: boolean): FormData {
  const f = new FormData();
  const color = (v: string) => (upperColors ? v.toUpperCase() : v);
  f.set("bt_cart_mode", t.mode);
  f.set("bt_cart_colorBg", color(t.colorBg));
  f.set("bt_cart_colorText", color(t.colorText));
  f.set("bt_cart_cornerRadius", String(t.cornerRadius));
  f.set("bt_cart_width", String(t.width));
  f.set("bt_cart_shadow", t.shadow);
  f.set("bt_cart_density", t.density);
  f.set("bt_cart_animationIn", t.animationIn);
  f.set("bt_cart_borderColor", color(t.borderColor));
  // Switches post "on" only when checked; mirror the default booleans.
  if (t.showImage) f.set("bt_cart_showImage", "on");
  if (t.showDelta) f.set("bt_cart_showDelta", "on");
  if (t.border) f.set("bt_cart_border", "on");
  if (t.backdropBlur) f.set("bt_cart_backdropBlur", "on");
  f.set("bt_cart_durationSec", String(g.durationMs / 1000));
  f.set("bt_cart_clickAction", g.clickAction);
  if (g.closeable) f.set("bt_cart_closeable", "on");
  return f;
}

test("no change → null (nothing is stored, config stays clean)", () => {
  assert.equal(readTypeOverride(unchangedForm(false), "cart", config), null);
});

test("UPPERCASE hex from the colour picker is NOT a change (the spurious-override bug)", () => {
  // s-color-field canonicalises to uppercase; a case-sensitive diff would treat
  // every colour as changed and write a bogus override for every type on save.
  assert.equal(readTypeOverride(unchangedForm(true), "cart", config), null);
});

test("a real colour change is stored (and only that field)", () => {
  const f = unchangedForm(false);
  f.set("bt_cart_colorBg", "#123456");
  const ov = readTypeOverride(f, "cart", config);
  assert.deepEqual(ov, { theme: { colorBg: "#123456" } });
});

test("a real behaviour change is stored under behavior", () => {
  const f = unchangedForm(false);
  f.set("bt_cart_durationSec", String(g.durationMs / 1000 + 3));
  const ov = readTypeOverride(f, "cart", config);
  assert.deepEqual(ov, { behavior: { durationMs: g.durationMs + 3000 } });
});
