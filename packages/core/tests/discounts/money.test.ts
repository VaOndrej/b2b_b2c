import assert from "node:assert/strict";
import { test } from "node:test";

import { moneyFor, sanitizeMoneyByCurrency } from "../../src/discounts/money.ts";

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
