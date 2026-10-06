import assert from "node:assert/strict";
import { test } from "node:test";

import { giftSummary, liveMissingCurrencies, liveThreshold, shippingSummary, thresholdText } from "../../app/components/model/rewards.ts";
import { giftsFromPicked, giftTitle } from "../../app/components/rewards/gift-picker.ts";
import { translator } from "../../app/i18n/index.ts";

// Odměny (plan 2026-10-06, dávka 5): the page's state lines say the real values and follow the form (P5); the gift
// is picked at the variant level and the picker's answer is the selection — nothing is silently dropped (B6).

const cs = translator("cs");
const en = translator("en");
const CODES = ["CZK", "EUR"];

test("a threshold as the form holds it now: typed amounts win over stored ones, only amounts a save would take", () => {
  const stored = { CZK: 1000_00, EUR: 40_00 };
  assert.deepEqual(liveThreshold(() => null, stored, CODES), stored, "not read yet: what is stored");
  const typed = (map: Record<string, string>) => (c: string) => map[c] ?? "";
  assert.deepEqual(liveThreshold(typed({ CZK: "1500", EUR: "" }), stored, CODES), { CZK: 1500_00 }, "an emptied field = not offered there");
  assert.deepEqual(liveThreshold(typed({ CZK: "1 500,50", EUR: "abc" }), stored, CODES), { CZK: 1500_50 });
  assert.deepEqual(liveThreshold(typed({ CZK: "0", EUR: "-5" }), null, CODES), {});
  assert.deepEqual(liveMissingCurrencies(() => null, { CZK: 1 }, CODES), ["EUR"]);
  assert.deepEqual(liveMissingCurrencies(typed({ CZK: "", EUR: "40" }), { CZK: 1 }, CODES), ["CZK"], "the note follows the field, not the stored value");
});

test("free shipping says its real amount: 'Doprava zdarma od 1 500 Kč / 40 €', on without an amount, or off", () => {
  assert.equal(thresholdText({ EUR: 40_00, CZK: 1500_00 }, CODES, cs), "1\u00a0500\u00a0Kč / 40\u00a0€");
  assert.equal(shippingSummary(true, { CZK: 1500_00, EUR: 40_00 }, CODES, cs), "Doprava zdarma od 1\u00a0500\u00a0Kč / 40\u00a0€");
  assert.equal(shippingSummary(true, {}, CODES, cs), "Doprava zdarma je zapnutá, chybí částka");
  assert.equal(shippingSummary(false, { CZK: 1500_00 }, CODES, cs), "Doprava zdarma vypnutá");
  assert.match(shippingSummary(true, { CZK: 1500_00 }, CODES, en), /^Free shipping from /);
});

test("the gift line names the gift and its threshold; a choice is 'A, B nebo C'; what is missing is said", () => {
  const socks = { id: "gid://shopify/ProductVariant/1", title: "Ponožky Won — M" };
  assert.equal(giftSummary([], CODES, cs), "Žádný dárek");
  assert.equal(giftSummary([{ threshold: { CZK: 1500_00 }, choices: [socks] }], CODES, cs), "Ponožky Won — M od 1\u00a0500\u00a0Kč");
  assert.equal(
    giftSummary([{ threshold: { CZK: 3000_00 }, choices: [socks, { id: "2", title: "Hrnek" }, { id: "3", title: "" }] }], CODES, cs),
    "Ponožky Won — M, Hrnek nebo Varianta už v obchodě není od 3\u00a0000\u00a0Kč",
    "a deleted variant is said, never an id",
  );
  assert.equal(giftSummary([{ threshold: {}, choices: [socks] }], CODES, cs), "Ponožky Won — M, chybí částka");
  assert.equal(giftSummary([{ threshold: { CZK: 500_00 }, choices: [] }], CODES, cs), "Dárek není vybraný od 500\u00a0Kč");
  assert.match(giftSummary([{ threshold: { CZK: 1 }, choices: [socks] }, { threshold: { CZK: 2 }, choices: [socks] }], CODES, cs), / · /);
});

test("B6: the variant picker's answer is the selection — variant ids only, each once, named 'Product — Variant', never more than the limit", () => {
  assert.equal(giftTitle({ title: "M", displayName: "Ponožky - M", product: { title: "Ponožky" } }), "Ponožky — M");
  assert.equal(giftTitle({ title: "Default Title", displayName: "Hrnek - Default Title", product: { title: "Hrnek" } }), "Hrnek");
  assert.equal(giftTitle({ title: "Default Title", displayName: "Hrnek - Default Title" }), "Hrnek", "no product in the payload: Shopify's own name");
  const picked = [
    { id: "gid://shopify/ProductVariant/1", title: "M", product: { title: "Ponožky" } },
    { id: "gid://shopify/ProductVariant/1", title: "M", product: { title: "Ponožky" } },
    { id: "gid://shopify/Product/9", title: "A product, not a variant" },
    { id: "gid://shopify/ProductVariant/2", title: "Default Title", product: { title: "Hrnek" } },
    null,
  ];
  assert.deepEqual(giftsFromPicked(picked, 3), [
    { id: "gid://shopify/ProductVariant/1", title: "Ponožky — M" },
    { id: "gid://shopify/ProductVariant/2", title: "Hrnek" },
  ]);
  assert.deepEqual(giftsFromPicked(picked, 1), [{ id: "gid://shopify/ProductVariant/1", title: "Ponožky — M" }], "the first picked, never 'the last one wins'");
});
