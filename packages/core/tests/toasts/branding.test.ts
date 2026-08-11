import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ICON_EMOJI,
  resolveBackground,
  resolveFontStack,
  resolveIcon,
} from "../../src/toasts/branding.ts";

test("resolveBackground: flat vs gradient", () => {
  assert.equal(
    resolveBackground({ gradient: false, colorBg: "#fff", gradientColor: "#eee" }),
    "#fff",
  );
  assert.equal(
    resolveBackground({ gradient: true, colorBg: "#fff", gradientColor: "#eee" }),
    "linear-gradient(135deg, #fff, #eee)",
  );
});

test("resolveFontStack: system / inherit / custom / blank-custom", () => {
  assert.match(resolveFontStack({ fontMode: "system", fontFamily: "" }) ?? "", /system-ui/);
  assert.equal(resolveFontStack({ fontMode: "inherit-theme", fontFamily: "" }), null);
  assert.equal(
    resolveFontStack({ fontMode: "custom", fontFamily: "Georgia, serif" }),
    "Georgia, serif",
  );
  // custom but blank → falls back to the system stack (never an empty family)
  assert.match(resolveFontStack({ fontMode: "custom", fontFamily: "  " }) ?? "", /system-ui/);
});

test("resolveIcon: none / chip / emoji", () => {
  assert.deepEqual(resolveIcon({ showIcon: false, iconSet: "line" }, "added"), { kind: "none" });
  assert.deepEqual(resolveIcon({ showIcon: true, iconSet: "none" }, "added"), { kind: "none" });
  assert.deepEqual(resolveIcon({ showIcon: true, iconSet: "line" }, "added"), { kind: "chip" });
  assert.deepEqual(resolveIcon({ showIcon: true, iconSet: "emoji" }, "gift"), {
    kind: "emoji",
    glyph: ICON_EMOJI.gift,
  });
});
