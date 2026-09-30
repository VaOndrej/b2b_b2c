// Pin (MVP 2 drift audit P3-1): the cost the mirror writes into the variant
// metafield is a JSON number the discount function reads exactly like
// JSON.parse does. Shopify's input provider reads numbers with serde_json's fast
// parser, which can land 1 ulp away from JSON.parse for 16–17 significant
// digits or an exponent outside ±22 (extensions/won-discounts-engine/README.md
// "Accepted edge differences") — at a ceilTol boundary a 1-haléř floor shift.
// The mirror writes `Number(unitCost.amount)`: for Shopify's decimal amounts of
// up to 15 significant digits (every cost below 10¹³ with 2 decimals) that
// number prints back as the same decimal, never with more digits.

import assert from "node:assert/strict";
import { test } from "node:test";

import { desiredCostValue } from "../../../app/lib/sync/costs.ts";

/** The significant digits and the decimal exponent of a JSON number's text. */
function digitsOf(text: string): { significant: number; exponent: number } {
  const m = /^-?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  assert.ok(m, `not a JSON number: ${text}`);
  const whole = m[1];
  const fraction = m[2] ?? "";
  const digits = (whole + fraction).replace(/^0+/, "");
  const significant = digits.replace(/0+$/, "").length;
  // Exponent of the first significant digit (scientific notation).
  const firstInWhole = whole.replace(/^0+/, "").length;
  const leadingZeros = fraction.length - fraction.replace(/^0+/, "").length;
  const exponent = Number(m[3] ?? 0) + (firstInWhole > 0 ? firstInWhole - 1 : -(leadingZeros + 1));
  return { significant, exponent };
}

/** The cost text exactly as the mirror writes it into the metafield JSON. */
function writtenCost(amount: string): string {
  const value = desiredCostValue({ amount, currencyCode: "CZK" });
  assert.ok(value, `no value for ${amount}`);
  const m = /"cost":([^,}]+)/.exec(value);
  assert.ok(m, value);
  return m[1];
}

/** mulberry32: tiny deterministic PRNG, so a failure always reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("the cost mirror writes Shopify's decimal cost with at most 15 significant digits, read back exactly", () => {
  const next = rng(20260929);
  const int = (n: number) => Math.floor(next() * n);
  const amounts = ["5", "6", "0.01", "12.5", "12.50", "1000.0", "30.6", "999.07", "0.0000001", "99999999999.99", "9999999999999.9", "123456789012345"];
  for (let n = 0; n < 20_000; n += 1) {
    // A decimal as Shopify writes a Decimal: 1–15 significant digits, 0–4 decimals, trailing zeros kept.
    const decimals = int(5);
    const significant = 1 + int(15);
    let digits = String(1 + int(9));
    for (let i = 1; i < significant; i += 1) digits += String(int(10));
    const places = Math.min(decimals, digits.length);
    const whole = digits.length > places ? digits.slice(0, digits.length - places) : "0";
    const fraction = digits.slice(digits.length - places).padStart(decimals, "0");
    amounts.push(decimals > 0 ? `${whole}.${fraction}${"0".repeat(int(3))}` : whole);
  }
  for (const amount of amounts) {
    const text = writtenCost(amount);
    const { significant, exponent } = digitsOf(text);
    assert.ok(significant <= 15, `${amount} → ${text}: ${significant} significant digits`);
    assert.ok(exponent >= -22 && exponent <= 22, `${amount} → ${text}: exponent ${exponent}`);
    // The value Shopify sent: a decimal of ≤ 15 significant digits survives the f64 round trip.
    assert.equal(JSON.parse(text), Number(amount), amount);
  }
});

test("an amount of ANY length is cut to 15 significant digits, rounded UP (the stricter side: a higher cost), and kept within the exponent range (audit fix round 3)", () => {
  const next = rng(20260930);
  const int = (n: number) => Math.floor(next() * n);
  // Pinned: 18 significant digits round up in the 15th.
  assert.equal(writtenCost("12.3456789012345678"), "12.3456789012346");
  assert.equal(writtenCost("0.1000000000000001"), "0.100000000000001", "a tail beyond 15 digits always rounds up");
  assert.equal(writtenCost("99999.99999999999999"), "100000", "the carry ripples");
  assert.equal(writtenCost("12.3450000000000000000"), "12.345", "trailing zeros are not a tail");
  for (let n = 0; n < 20_000; n += 1) {
    const significant = 16 + int(20); // 16–35 significant digits
    let digits = String(1 + int(9));
    for (let i = 1; i < significant; i += 1) digits += String(int(10));
    const point = 1 + int(Math.min(significant, 13)); // at most 13 integer digits (a cost below 10¹³)
    const amount = `${digits.slice(0, point)}.${digits.slice(point)}`;
    const text = writtenCost(amount);
    const { significant: kept, exponent } = digitsOf(text);
    assert.ok(kept <= 15, `${amount} → ${text}: ${kept} significant digits`);
    assert.ok(exponent >= -22 && exponent <= 22, `${amount} → ${text}: exponent ${exponent}`);
    const written = JSON.parse(text) as number;
    assert.ok(written >= Number(amount), `${amount} → ${text}: rounded up (never a lower cost)`);
    assert.ok((written - Number(amount)) / Number(amount) <= 1e-14, `${amount} → ${text}: within one unit of the 15th digit`);
    assert.equal(JSON.stringify(written), text, "prints back as written");
  }
  // Out of any real range: clamped to what the engine reads the same (every floor saturates the money cap anyway).
  const huge = writtenCost("123456789012345678901234567.5");
  assert.ok(digitsOf(huge).exponent <= 22 && digitsOf(huge).significant <= 15, huge);
  const tiny = writtenCost("0.000000000000000000000000123");
  assert.ok(digitsOf(tiny).exponent >= -22 && JSON.parse(tiny) >= 1.23e-25, tiny);
});
