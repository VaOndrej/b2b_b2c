import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMoney, isRTLLocale } from "../../src/toasts/format.ts";

test("formatMoney renders minor units in the shop currency + locale", () => {
  // 150000 minor units = 1,500.00
  const cs = formatMoney(150000, { currency: "CZK", locale: "cs" });
  assert.ok(cs.includes("1") && cs.includes("500"));
  const en = formatMoney(1999, { currency: "USD", locale: "en" });
  assert.ok(en.includes("19.99"));
});

test("formatMoney is defensive about bad input", () => {
  assert.equal(formatMoney(NaN, { currency: "USD", locale: "en" }), "");
  assert.equal(formatMoney(0, { currency: "USD", locale: "en" }).length > 0, true);
});

test("isRTLLocale detects Arabic/Hebrew/Farsi and not LTR locales", () => {
  assert.equal(isRTLLocale("ar"), true);
  assert.equal(isRTLLocale("he"), true);
  assert.equal(isRTLLocale("fa-IR"), true);
  assert.equal(isRTLLocale("cs"), false);
  assert.equal(isRTLLocale("en-US"), false);
});
