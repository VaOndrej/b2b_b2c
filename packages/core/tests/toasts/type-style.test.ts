import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_THEME,
  cartEventEnabled,
  resolveToastConfig,
} from "../../src/toasts/config.defaults.ts";
import {
  TOAST_TYPE_KEYS,
  resolveTypeBehavior,
  resolveTypeStyle,
  resolveTypeTheme,
  typeHasOverride,
} from "../../src/toasts/type-style.ts";
import { gateConfigForPlan } from "../../src/toasts/tier.ts";

test("a type with no override inherits the default theme and behaviour", () => {
  const config = resolveToastConfig({ plan: "pro" });
  for (const key of TOAST_TYPE_KEYS) {
    assert.equal(resolveTypeTheme(config, key), config.theme);
    assert.equal(typeHasOverride(config, key), false);
    const b = resolveTypeBehavior(config, key);
    assert.equal(b.durationMs, config.global.durationMs);
    assert.equal(b.closeable, config.global.closeable);
    assert.equal(b.clickAction, config.global.clickAction);
  }
});

test("a type override merges over the default (theme + accent key-by-key)", () => {
  const config = resolveToastConfig({
    plan: "pro",
    byType: {
      countdown: {
        theme: { colorBg: "#101010", accent: { added: "#ff0000" } },
        behavior: { durationMs: 9000, closeable: false },
      },
    },
  });
  const t = resolveTypeTheme(config, "countdown");
  assert.equal(t.colorBg, "#101010"); // overridden
  assert.equal(t.colorText, config.theme.colorText); // inherited
  assert.equal(t.accent.added, "#ff0000"); // overridden
  assert.equal(t.accent.removed, config.theme.accent.removed); // inherited
  // Cart (no override) still gets the default.
  assert.equal(resolveTypeTheme(config, "cart"), config.theme);

  const b = resolveTypeBehavior(config, "countdown");
  assert.equal(b.durationMs, 9000);
  assert.equal(b.closeable, false);
  assert.equal(b.autoDismiss, config.global.autoDismiss); // inherited
  assert.equal(typeHasOverride(config, "countdown"), true);
  assert.equal(typeHasOverride(config, "cart"), false);

  assert.deepEqual(resolveTypeStyle(config, "countdown"), { theme: t, behavior: b });
});

test("byType sanitize drops junk, clamps duration, and keeps it sparse", () => {
  const config = resolveToastConfig({
    plan: "pro",
    byType: {
      // unknown type key dropped
      bogus: { theme: { colorBg: "#fff" } },
      // empty override dropped
      cart: { theme: {}, behavior: {} },
      // duration clamped to >= 800; junk clickAction dropped
      announcement: { behavior: { durationMs: 10, clickAction: "explode" } },
    } as never,
  });
  assert.equal("bogus" in config.byType, false);
  assert.equal("cart" in config.byType, false);
  assert.equal(config.byType.announcement?.behavior?.durationMs, 800);
  assert.equal(config.byType.announcement?.behavior?.clickAction, undefined);
});

test("cart events default on; can be turned off individually; junk ignored", () => {
  const on = resolveToastConfig({});
  assert.equal(cartEventEnabled(on, "added"), true);
  assert.equal(cartEventEnabled(on, "removed"), true);

  const off = resolveToastConfig({
    cartEvents: { removed: false, added: true, bogus: false } as never,
  });
  assert.equal(cartEventEnabled(off, "removed"), false);
  assert.equal(cartEventEnabled(off, "added"), true); // true not stored (default on)
  assert.equal("added" in off.cartEvents, false);
  assert.equal("bogus" in off.cartEvents, false);
});

test("Free plan clears byType (per-type look is a Pro scope)", () => {
  const pro = resolveToastConfig({
    plan: "free",
    byType: { countdown: { theme: { colorBg: "#123456" } } },
  });
  // resolveToastConfig keeps byType regardless of plan; gating is what clears it.
  assert.equal(pro.byType.countdown?.theme?.colorBg, "#123456");
  const gated = gateConfigForPlan(pro);
  assert.deepEqual(gated.byType, {});
  // And every type resolves to the default theme on Free.
  assert.equal(resolveTypeTheme(gated, "countdown"), DEFAULT_THEME);
});
