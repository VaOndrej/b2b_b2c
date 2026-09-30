// MVP 3: a tier set in words (§17a: describe*() formatters live in core; §4c:
// never an enum key). The admin shows every market currency at once, the
// engine one currency; an amount is per item.

import assert from "node:assert/strict";
import { test } from "node:test";

import { type DescribableTierBreak, describeTierBreak, describeTierSet } from "../../src/discounts/describe.ts";

const NBSP = " ";
const PERCENT_SET = { breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }] };
const AMOUNT_SET: { breaks: DescribableTierBreak[] } = { breaks: [{ minQty: 2, amountOff: { CZK: 50_00, EUR: 2_00 } }, { minQty: 5, amountOff: { CZK: 100_00 } }] };

test("describeTierSet: „Od 3 ks −10 %, od 5 ks −15 %“ / “From 3 items −10%, from 5 items −15%”", () => {
  assert.equal(describeTierSet(PERCENT_SET, { locale: "cs" }), `Od 3 ks −10${NBSP}%, od 5 ks −15${NBSP}%`);
  assert.equal(describeTierSet(PERCENT_SET, { locale: "en" }), "From 3 items −10%, from 5 items −15%");
  assert.equal(describeTierSet({ breaks: [{ minQty: 1, percent: 12.5 }] }, { locale: "en" }), "From 1 item −12.5%");
});

test("describeTierSet sorts the breaks by quantity; an empty set says so", () => {
  const reversed = { breaks: [...PERCENT_SET.breaks].reverse() };
  assert.equal(describeTierSet(reversed, { locale: "cs" }), `Od 3 ks −10${NBSP}%, od 5 ks −15${NBSP}%`);
  assert.equal(describeTierSet({ breaks: [] }, { locale: "cs" }), "Bez množstevních slev");
  assert.equal(describeTierSet({ breaks: [] }, { locale: "en" }), "No quantity tiers");
});

test("amounts are per item: one currency (engine), every listed market currency (admin), missing ones named (MKT-1)", () => {
  assert.equal(
    describeTierSet(AMOUNT_SET, { locale: "cs", currency: "CZK" }),
    `Od 2 ks −50${NBSP}Kč za kus, od 5 ks −100${NBSP}Kč za kus`,
  );
  assert.equal(describeTierSet(AMOUNT_SET, { locale: "en", currency: "EUR" }), "From 2 items −€2 per item, from 5 items (not offered in EUR)");
  assert.equal(
    describeTierSet(AMOUNT_SET, { locale: "cs", currencies: ["CZK", "EUR"] }),
    `Od 2 ks −50${NBSP}Kč / 2${NBSP}€ za kus, od 5 ks −100${NBSP}Kč za kus (v EUR se nenabízí)`,
  );
  assert.equal(
    describeTierSet(AMOUNT_SET, { locale: "en", currencies: ["EUR"] }),
    "From 2 items −€2 per item, from 5 items (not offered in EUR)",
  );
  // Neither: every currency the amount has.
  assert.equal(describeTierBreak(AMOUNT_SET.breaks[0], { locale: "en" }), "From 2 items −CZK 50 / €2 per item");
});

test("describeTierBreak on its own starts with a capital; a percent wins over an amount (the sanitizer's rule)", () => {
  assert.equal(describeTierBreak({ minQty: 3, percent: 10 }, { locale: "cs" }), `Od 3 ks −10${NBSP}%`);
  assert.equal(describeTierBreak({ minQty: 3, percent: 10, amountOff: { CZK: 1 } }, { locale: "en" }), "From 3 items −10%");
  assert.equal(describeTierBreak({ minQty: 4 }, { locale: "cs" }), "Od 4 ks (bez hodnoty)");
  assert.equal(describeTierBreak({ minQty: 4, amountOff: {} }, { locale: "en" }), "From 4 items (no value)");
});

test("never an enum key, never minor units in the text", () => {
  for (const locale of ["cs", "en"] as const) {
    for (const text of [
      describeTierSet(PERCENT_SET, { locale }),
      describeTierSet(AMOUNT_SET, { locale, currency: "CZK" }),
      describeTierSet(AMOUNT_SET, { locale, currencies: ["CZK", "EUR"] }),
    ]) {
      assert.ok(!/[a-z]+_[a-z]+/.test(text), text);
      assert.ok(!/5000|10000|200\b/.test(text), text);
    }
  }
});
