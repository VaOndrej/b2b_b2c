import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currencyExponent,
  fromMinorUnits,
  moneyFor,
  sanitizeMoneyByCurrency,
  toMinorUnits,
} from "../../src/discounts/money.ts";

test("sanitizeMoneyByCurrency upper-cases valid ISO codes, drops the rest", () => {
  const out = sanitizeMoneyByCurrency({
    czk: 100000,
    EUR: -5,
    XX: 3,
    USD: "12.5",
    GBP: 9.9,
  });
  assert.deepEqual(out, { CZK: 100000, GBP: 9 });
});

test("sanitizeMoneyByCurrency rejects non-object input", () => {
  assert.deepEqual(sanitizeMoneyByCurrency(null), {});
  assert.deepEqual(sanitizeMoneyByCurrency(undefined), {});
  assert.deepEqual(sanitizeMoneyByCurrency("100"), {});
  assert.deepEqual(sanitizeMoneyByCurrency([1, 2, 3]), {});
});

test("sanitizeMoneyByCurrency floors floats to the minor unit", () => {
  assert.deepEqual(sanitizeMoneyByCurrency({ CZK: 1099.9 }), { CZK: 1099 });
});

test("sanitizeMoneyByCurrency clamps to opts.max", () => {
  assert.deepEqual(sanitizeMoneyByCurrency({ CZK: 500000 }, { max: 100000 }), {
    CZK: 100000,
  });
});

test("sanitizeMoneyByCurrency drops NaN and non-finite values", () => {
  assert.deepEqual(sanitizeMoneyByCurrency({ CZK: NaN, EUR: Infinity, USD: 10 }), {
    USD: 10,
  });
});

test("moneyFor returns null for a missing market/currency", () => {
  assert.equal(moneyFor(undefined, "CZK"), null);
  assert.equal(moneyFor({ EUR: 500 }, "CZK"), null);
});

test("moneyFor returns 0, not null, for an explicit zero value", () => {
  assert.equal(moneyFor({ CZK: 0 }, "CZK"), 0);
});

// --- minor units (the function adapter converts Shopify's decimal strings) -------

test("currencyExponent: ISO 4217 minor digits, 2 by default", () => {
  assert.equal(currencyExponent("CZK"), 2);
  assert.equal(currencyExponent("EUR"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(currencyExponent("jpy"), 0);
});

test("toMinorUnits parses Shopify decimal strings exactly (no float drift)", () => {
  assert.equal(toMinorUnits("1234.5", "CZK"), 123450);
  assert.equal(toMinorUnits("0.29", "EUR"), 29);
  assert.equal(toMinorUnits("19.99", "EUR"), 1999);
  assert.equal(toMinorUnits("1500", "JPY"), 1500);
  assert.equal(toMinorUnits("1.2345", "KWD"), 1235);
  assert.equal(toMinorUnits(12.5, "EUR"), 1250);
  assert.equal(toMinorUnits("abc", "EUR"), null);
  assert.equal(toMinorUnits("-1.00", "EUR"), null);
});

test("fromMinorUnits prints the decimal string Shopify expects", () => {
  assert.equal(fromMinorUnits(123450, "CZK"), "1234.50");
  assert.equal(fromMinorUnits(5, "EUR"), "0.05");
  assert.equal(fromMinorUnits(1500, "JPY"), "1500");
  assert.equal(fromMinorUnits(1235, "KWD"), "1.235");
});
