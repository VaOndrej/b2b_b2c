import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, createDefaultConfig, sanitizeConfig } from "@won/core/discounts/config";

import { classifyNative } from "../../../app/lib/native/classify.ts";
import { moveAllPrompt, moveDialogCopy, notMovableReasonText } from "../../../app/lib/native/copy.ts";
import { decimalToMinor, NotMovableError, planMove, ruleIdFor } from "../../../app/lib/native/map.server.ts";
import { normalizeNode } from "../../../app/lib/native/normalize.ts";
import { isShopMidnight, toShopLocalIso } from "../../../app/lib/native/time.ts";
import type { NativeDiscount } from "../../../app/lib/native/types.ts";
import { basicNode, type BasicFixture, freeShippingNode } from "./fake-shopify.ts";

// Spec §2 DiscountRule + §4.1 "Přesun": the Won rule must say exactly what the
// native discount said; what cannot carry over is said BEFORE the click (§14c).

const SHOP = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };
const NOW = new Date("2026-09-28T12:00:00Z");
const ENUM_KEY = /\b[a-z]+_[a-z_]+\b/;

function native(raw: { id: string; discount: unknown }): NativeDiscount {
  const node = normalizeNode(raw, SHOP);
  assert.ok(node && node.movableType, "fixture must be a Basic / Free shipping discount");
  return node.native;
}

function basic(f: BasicFixture): NativeDiscount {
  return native(basicNode(f));
}

test("code discount, % on products: every field maps, codes upper-case, origin linked", () => {
  const n = basic({
    id: "gid://shopify/DiscountCodeNode/123",
    title: "10 % na trička",
    codes: ["tricka10", "TRICKA-VIP"],
    percentage: 0.125,
    items: { products: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variants: ["gid://shopify/ProductVariant/7"] },
    minimum: { quantity: 2 },
    startsAt: "2026-09-30T22:00:00Z",
    endsAt: "2026-10-31T23:00:00Z",
    combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
  });
  const { rule, losses, warnings } = planMove(n, createDefaultConfig(), { now: NOW });
  assert.deepEqual(rule, {
    id: "native-123",
    enabled: true,
    name: "10 % na trička",
    method: "code",
    codes: ["TRICKA10", "TRICKA-VIP"],
    value: { kind: "percentage", percent: 12.5 },
    target: {
      kind: "products",
      productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
      variantIds: ["gid://shopify/ProductVariant/7"],
    },
    // F5 (verified live): a product discount's minimum counts only the entitled items.
    minimum: { quantity: 2, scope: "entitled" },
    // Shop-local dates: the engine reads the day from the string (Prague midnight stays that day).
    schedule: { startsAt: "2026-10-01T00:00:00+02:00", endsAt: "2026-11-01T00:00:00+01:00" },
    origin: { nativeId: "gid://shopify/DiscountCodeNode/123" },
  });
  // Nothing used, nothing lost (F11: "Nic." is reachable; the history never "stays in Shopify").
  assert.deepEqual(losses, []);
  // Native combining equals the A1 defaults for a product discount → nothing to say about it;
  // Won does not tell subscriptions apart (review Minor 3) → that is said.
  assert.deepEqual(warnings, ["Prodáváš-li předplatné: v Shopify na něj sleva neplatila. Won předplatné nerozlišuje, bude platit i na něj."]);
  // The config sanitizer accepts it unchanged (no issues, nothing dropped).
  const config = createDefaultConfig();
  config.modules.codes.rules.push(rule);
  const sanitized = sanitizeConfig(config);
  assert.deepEqual(sanitized.issues, []);
  assert.deepEqual(sanitized.config.modules.codes.rules[0], rule);
});

test("fixed amount in the shop currency only; other market currencies are a warning, never converted", () => {
  const n = basic({ method: "automatic", amount: "150.50", minimum: { subtotal: "1000.00" }, title: "150 Kč" });
  const config = createDefaultConfig();
  config.markets = [
    { handle: "cz", currency: "CZK", enabled: true },
    { handle: "sk", currency: "EUR", enabled: true },
    { handle: "pl", currency: "PLN", enabled: false },
  ];
  const { rule, warnings } = planMove(n, config, { now: NOW });
  assert.deepEqual(rule.value, { kind: "fixed", amount: { CZK: 15050 } });
  assert.deepEqual(rule.target, { kind: "order" });
  assert.deepEqual(rule.minimum, { subtotal: { CZK: 100000 }, scope: "cart" }, "an order discount is entitled to the whole cart");
  assert.equal(rule.method, "automatic");
  assert.equal(rule.codes, undefined);
  assert.equal(rule.limits, undefined);
  assert.ok(
    warnings.includes("Částka je jen v CZK. Doplň ji pro EUR, jinak se tam sleva nenabídne. Won nikdy nepřepočítává kurzem."),
    warnings.join("\n"),
  );

  const unknownMarkets = planMove(n, createDefaultConfig(), { now: NOW, locale: "en" });
  assert.ok(unknownMarkets.warnings.some((w) => w.startsWith("The amount is in CZK only.")));
});

test("free shipping (code) maps to a shipping rule; combining differences are spelled out", () => {
  const n = native(
    freeShippingNode({
      codes: ["DOPRAVA"],
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    }),
  );
  const { rule, warnings } = planMove(n, createDefaultConfig(), { now: NOW });
  assert.deepEqual(rule.value, { kind: "freeShipping" });
  assert.deepEqual(rule.target, { kind: "shipping" });
  assert.deepEqual(warnings, [
    "Prodáváš-li předplatné: v Shopify na něj sleva neplatila. Won předplatné nerozlišuje, bude platit i na něj.",
    "V Shopify se nekombinovala s produktovými slevami. Ve Won se podle nastavení kombinování kombinuje.",
    "V Shopify se nekombinovala se slevami na objednávku. Ve Won se podle nastavení kombinování kombinuje.",
  ]);
});

test("limits: what is LEFT of the usage limit moves; once-per-customer history is a stated loss", () => {
  const n = basic({ codes: ["NOVY"], usageLimit: 100, used: 40, oncePerCustomer: true });
  const { rule, losses, warnings } = planMove(n, createDefaultConfig(), { now: NOW });
  assert.deepEqual(rule.limits, { usageLimit: 60, oncePerCustomer: true });
  assert.deepEqual(losses, [
    "Počítadlo použití (zatím 40×) se smazáním slevy v Shopify ztratí. Won počítá od nuly. Objednávky kód dál ukazují.",
    "Limit „1× na zákazníka“ začne znovu. Kdo kód už použil, může ho použít ještě jednou.",
  ]);
  assert.ok(
    warnings.includes("Shopify eviduje přibližně 40 z 100 použití (počítá se zpožděním). Ve Won nastavíme limit na zbývajících 60."),
    warnings.join("\n"),
  );
});

test("more codes than a Won rule holds: the first CONFIG_LIMITS.codesPerRule move, the rest is a stated loss", () => {
  const codes = Array.from({ length: CONFIG_LIMITS.codesPerRule + 5 }, (_, i) => `K${i}`);
  const n = basic({ codes });
  const { rule, losses } = planMove(n, createDefaultConfig(), { now: NOW });
  assert.equal(rule.codes?.length, CONFIG_LIMITS.codesPerRule);
  assert.ok(losses.some((l) => l.includes(`Zbylých 5 po přesunu přestane platit`)), losses.join("\n"));
});

test("automatic discount starting later at 14:00 (shop time): Won switches by days, the dialog says so", () => {
  const n = basic({ method: "automatic", startsAt: "2026-10-05T12:00:00Z", endsAt: "2026-10-06T22:00:00Z" });
  const { warnings, rule } = planMove(n, createDefaultConfig(), { now: NOW });
  assert.deepEqual(rule.schedule, { startsAt: "2026-10-05T14:00:00+02:00", endsAt: "2026-10-07T00:00:00+02:00" });
  assert.equal(warnings.filter((w) => w.includes("po celých dnech")).length, 1, warnings.join("\n"));
  assert.ok(warnings.some((w) => w.startsWith("Začíná 5. 10. 2026")), warnings.join("\n"));
});

test("a discount Won cannot express exactly is refused (never widened)", () => {
  const once = basic({ amount: "100.00", appliesOnEachItem: false, items: { collections: ["gid://shopify/Collection/1"] } });
  assert.throws(() => planMove(once, createDefaultConfig()), (error: unknown) => {
    assert.ok(error instanceof NotMovableError);
    assert.equal(error.reason.code, "fixed_once_per_order");
    assert.equal(error.message, "Pevná částka se odečítá jednou za objednávku. Won ji umí jen z každého kusu.");
    return true;
  });
  const capped = native(freeShippingNode({ maxShipping: "99.00" }));
  assert.throws(() => planMove(capped, createDefaultConfig()), NotMovableError);
  const subscriptions = basic({ appliesOnOneTimePurchase: false, appliesOnSubscription: true });
  assert.throws(() => planMove(subscriptions, createDefaultConfig()), NotMovableError);
  const exhausted = basic({ usageLimit: 10, used: 10 });
  assert.throws(() => planMove(exhausted, createDefaultConfig()), /vyčerpaný \(10 z 10\)/);
});

test("rule ids are valid config ids and never collide", () => {
  const config = createDefaultConfig();
  assert.equal(ruleIdFor("gid://shopify/DiscountAutomaticNode/42", config), "native-42");
  config.modules.codes.rules.push({ id: "native-42", enabled: true, name: "x", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" } });
  assert.equal(ruleIdFor("gid://shopify/DiscountAutomaticNode/42", config), "native-42-2");
});

test("decimal → minor units per currency precision (no float math)", () => {
  assert.equal(decimalToMinor("10.005", "CZK"), 1001);
  assert.equal(decimalToMinor("0.29", "EUR"), 29);
  assert.equal(decimalToMinor("100", "JPY"), 100);
  assert.equal(decimalToMinor("1.234", "KWD"), 1234);
  assert.equal(decimalToMinor("-1", "CZK"), null);
});

test("shop-local ISO keeps the shop's calendar day across DST", () => {
  assert.equal(toShopLocalIso("2026-10-24T22:00:00Z", "Europe/Prague"), "2026-10-25T00:00:00+02:00");
  assert.equal(toShopLocalIso("2026-10-25T23:00:00Z", "Europe/Prague"), "2026-10-26T00:00:00+01:00");
  assert.equal(toShopLocalIso("2026-10-01T04:00:00Z", "America/New_York"), "2026-10-01T00:00:00-04:00");
  assert.equal(toShopLocalIso("2026-10-01T04:00:00Z", "Not/AZone"), "2026-10-01T04:00:00Z");
  assert.equal(isShopMidnight("2026-10-24T22:00:00Z", "Europe/Prague"), true);
  assert.equal(isShopMidnight("2026-10-24T23:00:00Z", "Europe/Prague"), false);
});

test("§4c: dialog copy in both languages, no enum keys anywhere", () => {
  const n = basic({ codes: ["A"], usageLimit: 5, used: 1, oncePerCustomer: true, amount: "50.00", items: { products: ["gid://shopify/Product/1"] } });
  for (const locale of ["cs", "en"] as const) {
    const plan = planMove(n, createDefaultConfig(), { now: NOW, locale });
    const dialog = moveDialogCopy(n.title, plan, locale);
    const all = [dialog.heading, dialog.intro, dialog.lossesHeading, dialog.warningsHeading, dialog.confirm, dialog.cancel, ...dialog.losses, ...dialog.warnings];
    for (const text of all) assert.doesNotMatch(text, ENUM_KEY, text);
    assert.ok(dialog.losses.length >= 2);
  }
  assert.equal(moveDialogCopy("Léto", { losses: [], warnings: [] }, "cs").heading, "Přesunout „Léto“ do Won?");
  assert.equal(moveAllPrompt(4, "cs").question, "Máš 4 slevy v Shopify. Přesunout do Won?");
  assert.equal(moveAllPrompt(5, "cs").confirm, "Přesunout 5 slev");
  assert.equal(moveAllPrompt(1, "en").question, "You have 1 discount in Shopify. Move it into Won?");
});

test("a code discount with a code longer than 64 characters stays in Shopify (audit round 6)", () => {
  assert.equal(CONFIG_LIMITS.codeLength, 64);
  const long = basic({ id: "gid://shopify/DiscountCodeNode/964", codes: ["LETO10", "x".repeat(65)] });
  assert.deepEqual(classifyNative(long), { code: "code_too_long", max: 64 });
  assert.throws(
    () => planMove(long, createDefaultConfig(), { now: NOW }),
    (error: unknown) => {
      assert.ok(error instanceof NotMovableError);
      assert.equal(error.reason.code, "code_too_long");
      assert.equal(error.message, "Má kód delší než 64 znaků. Tak dlouhý kód Won nepodporuje.");
      return true;
    },
  );
  assert.equal(notMovableReasonText({ code: "code_too_long", max: 64 }, "en"), "It has a code longer than 64 characters. Won does not support codes that long.");
  // Measured as Won stores it (trimmed, upper-cased): 64 characters move, "ß" × 40 is "SS" × 40.
  assert.equal(classifyNative(basic({ codes: [` ${"x".repeat(64)} `] })), null);
  assert.equal(classifyNative(basic({ codes: ["ß".repeat(40)] }))?.code, "code_too_long");
  const plan = planMove(basic({ codes: ["x".repeat(64)] }), createDefaultConfig(), { now: NOW });
  assert.deepEqual(plan.rule.codes, ["X".repeat(64)]);
});
