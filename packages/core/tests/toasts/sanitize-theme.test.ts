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

test("rejects invalid hex and out-of-range numbers", () => {
  assert.equal("colorBg" in sanitizeTheme({ colorBg: "red" }), false);
  assert.equal(sanitizeTheme({ cornerRadius: 999 }).cornerRadius, 32);
  assert.equal(sanitizeTheme({ width: 10 }).width, 240);
});

test("drops unknown enums instead of defaulting", () => {
  assert.equal("mode" in sanitizeTheme({ mode: "neon" }), false);
  assert.equal("shadow" in sanitizeTheme({ shadow: "huge" }), false);
});

test("caps custom CSS length (Pro field) and ignores non-objects", () => {
  const long = "a".repeat(9000);
  assert.equal(sanitizeTheme({ customCss: long }).customCss?.length, 4000);
  assert.deepEqual(sanitizeTheme(null), {});
});
