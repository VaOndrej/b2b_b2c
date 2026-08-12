import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeTheme } from "../../src/toasts/config.defaults.ts";

test("keeps valid enums, hex colours and clamped sizes", () => {
  const out = sanitizeTheme({
    mode: "custom",
    colorBg: "#101010",
    accent: { added: "#00ff00", bogus: "#123456", removed: "not-a-color" },
    cornerRadius: 16,
    width: 380,
    shadow: "lg",
    density: "compact",
    animationIn: "pop",
    showImage: false,
  });
  assert.equal(out.mode, "custom");
  assert.equal(out.colorBg, "#101010");
  assert.equal(out.accent?.added, "#00ff00");
  // unknown accent key dropped, invalid colour dropped
  assert.equal("bogus" in (out.accent ?? {}), false);
  assert.equal("removed" in (out.accent ?? {}), false);
  assert.equal(out.cornerRadius, 16);
  assert.equal(out.shadow, "lg");
  assert.equal(out.showImage, false);
});

test("branding: gradient, gradientColor, iconSet, fontMode, fontFamily", () => {
  const out = sanitizeTheme({
    gradient: true,
    gradientColor: "#ABCDEF",
    iconSet: "emoji",
    fontMode: "custom",
    fontFamily: 'Georgia, "Times New Roman", serif',
  });
  assert.equal(out.gradient, true);
  assert.equal(out.gradientColor, "#abcdef"); // canonical lowercase
  assert.equal(out.iconSet, "emoji");
  assert.equal(out.fontMode, "custom");
  assert.equal(out.fontFamily, 'Georgia, "Times New Roman", serif');
});

test("branding: rejects junk (bad enum/hex) and sanitises font family", () => {
  const out = sanitizeTheme({
    gradientColor: "nope",
    iconSet: "sparkles",
    fontMode: "comic",
    fontFamily: 'Evil; } body{display:none} <script>',
  });
  assert.equal("gradientColor" in out, false); // invalid hex dropped
  assert.equal("iconSet" in out, false); // invalid enum dropped
  assert.equal("fontMode" in out, false);
  // CSS-breaking characters stripped from the family
  assert.equal(/[<>{};]/.test(out.fontFamily ?? ""), false);
});

test("rejects invalid hex and out-of-range numbers", () => {
  assert.equal("colorBg" in sanitizeTheme({ colorBg: "red" }), false);
  assert.equal(sanitizeTheme({ cornerRadius: 999 }).cornerRadius, 32);
  assert.equal(sanitizeTheme({ width: 10 }).width, 240);
});

test("normalises hex colours to lowercase (canonical storage)", () => {
  // Admin colour pickers emit UPPERCASE hex; storing them canonically keeps the
  // config diffable and stops spurious per-type overrides on every save.
  const out = sanitizeTheme({
    colorBg: "#FFFFFF",
    colorText: "#1A1F24",
    borderColor: "#E2E6EA",
    accent: { added: "#1F8F5F" },
  });
  assert.equal(out.colorBg, "#ffffff");
  assert.equal(out.colorText, "#1a1f24");
  assert.equal(out.borderColor, "#e2e6ea");
  assert.equal(out.accent?.added, "#1f8f5f");
});

test("drops unknown enums instead of defaulting", () => {
  assert.equal("mode" in sanitizeTheme({ mode: "neon" }), false);
  assert.equal("shadow" in sanitizeTheme({ shadow: "huge" }), false);
});

test("caps custom CSS length (Pro field) and ignores non-objects", () => {
  const long = "a".repeat(9000);
  assert.ok((sanitizeTheme({ customCss: long }).customCss?.length ?? 0) <= 4000);
  assert.deepEqual(sanitizeTheme(null), {});
});

test("neutralizes custom-CSS breakout attempts (SEC-3 defense-in-depth)", () => {
  // The storefront injects customCss as <style> textContent inside a shadow root,
  // so this is belt-and-suspenders — but a dangerous state must be unrepresentable
  // even if a future surface injects it differently. CSS never needs < or >.
  const css = sanitizeTheme({
    customCss: '[data-won-toast]{color:red}</style><script>alert(1)</script>',
  }).customCss!;
  assert.ok(!css.includes("<"), "must strip < (no tag breakout)");
  assert.ok(!css.includes(">"), "must strip >");
  assert.ok(!/script/i.test(css) === false || !css.includes("<script"), "no live <script");
  // The legitimate selector survives.
  assert.ok(css.includes("[data-won-toast]"));

  const js = sanitizeTheme({ customCss: "a{background:url(javascript:alert(1))}" }).customCss!;
  assert.ok(!/javascript:/i.test(js), "must strip javascript: scheme");

  const expr = sanitizeTheme({ customCss: "a{width:expression(alert(1))}" }).customCss!;
  assert.ok(!/expression\s*\(/i.test(expr), "must strip CSS expression()");
});
