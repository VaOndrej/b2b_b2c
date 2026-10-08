import assert from "node:assert/strict";
import { test } from "node:test";

import type { MilestoneStep } from "@won/core/discounts/milestones";

import { amountsText, liveAmounts, milestoneStepView, MS_FIELD as F, readMilestonesForm, rewardText, stepId, stepMissingColumns, stepSummary } from "../../app/components/model/milestones.ts";
import { giftsFromPicked, giftTitle } from "../../app/components/rewards/gift-picker.ts";
import { translator } from "../../app/i18n/index.ts";

// Milníky (feedback 6 Oct 2026, bod 9; dřív Odměny, plan 2026-10-06 dávka 5): the page's state lines say the real
// values and follow the form (P5); the gift is picked at the variant level and the picker's answer is the
// selection — nothing is silently dropped (B6); the form's parser is the server's (SEC-1).

const cs = translator("cs");
const en = translator("en");
const CODES = ["CZK", "EUR"];
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const TITLES = new Map([[V(1), "Ponožky Won — M"], [V(2), "Hrnek"]]);
const view = (step: MilestoneStep) => milestoneStepView(step, TITLES);

test("amounts as the form holds them now: typed amounts win over stored ones, only amounts a save would take", () => {
  const stored = { CZK: 1000_00, EUR: 40_00 };
  assert.deepEqual(liveAmounts(() => null, stored, CODES), stored, "not read yet: what is stored");
  const typed = (map: Record<string, string>) => (c: string) => map[c] ?? "";
  assert.deepEqual(liveAmounts(typed({ CZK: "1500", EUR: "" }), stored, CODES), { CZK: 1500_00 }, "an emptied field = not offered there");
  assert.deepEqual(liveAmounts(typed({ CZK: "1 500,50", EUR: "abc" }), stored, CODES), { CZK: 1500_50 });
  assert.deepEqual(liveAmounts(typed({ CZK: "0", EUR: "-5" }), null, CODES), {});
  assert.equal(amountsText({ EUR: 40_00, CZK: 1500_00 }, CODES, cs), "1 500 Kč / 40 €");
});

test("a step says what the customer gets and from what cart value; what is missing is said", () => {
  const shipping = view({ kind: "shipping", id: "shipping", threshold: { CZK: 1500_00, EUR: 40_00 } });
  assert.equal(stepSummary(shipping, CODES, cs), "Doprava zdarma od 1 500 Kč / 40 €");
  assert.match(stepSummary(shipping, CODES, en), /^Free shipping from /);
  assert.equal(stepSummary({ ...shipping, threshold: {} }, CODES, cs), "Doprava zdarma, chybí částka");
  const gift = view({ kind: "gift", id: "g", threshold: { CZK: 3000_00 }, choices: [V(1), V(2), V(3)] });
  assert.equal(stepSummary(gift, CODES, cs), "Dárek: Ponožky Won — M, Hrnek nebo Varianta už v obchodě není od 3 000 Kč", "a deleted variant is said, never an id");
  assert.equal(rewardText({ ...gift, choices: [] }, CODES, cs), "Dárek není vybraný");
  const percent = view({ kind: "discount", id: "ms-a", threshold: { CZK: 2000_00 }, value: { kind: "percentage", percent: 5 } });
  assert.equal(stepSummary(percent, CODES, cs), "Sleva 5 % od 2 000 Kč");
  assert.equal(rewardText({ ...percent, percent: null }, CODES, cs), "Sleva bez hodnoty");
  const fixed = view({ kind: "discount", id: "ms-b", threshold: { CZK: 5000_00, EUR: 200_00 }, value: { kind: "fixed", amount: { CZK: 500_00, EUR: 20_00 } } });
  assert.equal(stepSummary(fixed, CODES, cs), "Sleva 500 Kč / 20 € od 5 000 Kč / 200 €");
  // The preview is of one market: a fixed discount is worded for that market only.
  assert.equal(rewardText(fixed, CODES, cs, "EUR"), "Sleva 20 €");
  assert.equal(rewardText(fixed, CODES, en, "EUR"), "€20 off");
});

test("where a step is not offered (MKT-1): no cart value there, or a fixed discount without its amount there", () => {
  const step = (threshold: Record<string, number>, off?: Record<string, number>) =>
    view(off ? { kind: "discount", id: "ms-a", threshold, value: { kind: "fixed", amount: off } } : { kind: "shipping", id: "shipping", threshold });
  assert.deepEqual(stepMissingColumns(step({ CZK: 1000_00, EUR: 40_00 }), CODES), []);
  assert.deepEqual(stepMissingColumns(step({ CZK: 1000_00 }), CODES), ["EUR"]);
  assert.deepEqual(stepMissingColumns(step({}), CODES), [], "an untouched row is not 'missing' everywhere");
  assert.deepEqual(stepMissingColumns(step({ CZK: 1000_00, EUR: 40_00 }, { CZK: 100_00 }), CODES), ["EUR"], "the cart value is there, the discount amount is not");
});

test("the id a row is stored under follows its kind; a stored gift keeps its id (the cart's gift lines name it)", () => {
  const none = new Set<string>();
  assert.equal(stepId("new-abc12345", "gift", none), "gift-abc12345");
  assert.equal(stepId("new-abc12345", "discount", none), "ms-abc12345");
  assert.equal(stepId("new-abc12345", "shipping", none), "shipping");
  assert.equal(stepId("gift-socks", "gift", none), "gift-socks");
  assert.equal(stepId("g1", "gift", none), "g1", "an id stored before Milníky stays");
  assert.equal(stepId("ms-five", "discount", none), "ms-five");
  // A row that changed its kind: an id of the new kind, never one that is taken.
  assert.equal(stepId("ms-five", "gift", none), "gift-five");
  assert.equal(stepId("gift-socks", "discount", none), "ms-socks");
  assert.equal(stepId("shipping", "gift", none), "gift-shipping");
  assert.equal(stepId("ms-five", "gift", new Set(["gift-five"])), "gift-five-2");
  assert.equal(stepId("ms-five", "gift", new Set(["gift-five", "gift-five-2"])), "gift-five-3");
});

test("the form's parser: a kind per row, amounts per column, stored amounts of a switched-off market kept, ids kept apart", () => {
  const form = new FormData();
  const add = (name: string, value: string) => form.append(name, value);
  add(F.step, "gift-a");
  add(F.kind("gift-a"), "discount");
  add(F.percent("gift-a"), "7,5");
  add(F.amount("gift-a", "CZK"), "2 000");
  add(F.step, "shipping");
  add(F.kind("shipping"), "shipping");
  add(F.amount("shipping", "CZK"), "1000");
  add(F.step, "ms-a");
  add(F.kept, "ms-a");
  add(F.step, "bad id!");
  add(F.other, "1");
  const stored = new Map<string, MilestoneStep>([
    ["gift-a", { kind: "gift", id: "gift-a", threshold: { CZK: 500_00 }, choices: [V(1)] }],
    ["shipping", { kind: "shipping", id: "shipping", threshold: { CZK: 900_00, HUF: 9000_00 } }],
    ["ms-a", { kind: "discount", id: "ms-a", threshold: { CZK: 3000_00 }, value: { kind: "percentage", percent: 10 } }],
  ]);
  const read = readMilestonesForm(form, { columns: CODES, stored, plan: "pro" });
  assert.deepEqual(read.errors, []);
  assert.equal(read.countOther, true);
  assert.deepEqual(read.steps, [
    { kind: "discount", id: "ms-a-2", threshold: { CZK: 2000_00 }, value: { kind: "percentage", percent: 7.5 } },
    { kind: "shipping", id: "shipping", threshold: { HUF: 9000_00, CZK: 1000_00 } },
    { kind: "discount", id: "ms-a", threshold: { CZK: 3000_00 }, value: { kind: "percentage", percent: 10 } },
  ]);
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
  assert.equal(giftsFromPicked(picked, 1).length, 1);
});
