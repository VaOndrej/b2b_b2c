// Minimum scope (audit MVP 1 native F5): a rule's minimum is measured either on
// the whole cart („minimum košíku“, the spec default for rules made in Won) or
// on the rule's ENTITLED lines only (Shopify's semantics for a product /
// collection discount's minimum, which a migrated native keeps). Sanitizer →
// payload → engine → describe/explain.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "../../src/discounts/config.ts";
import { describeRule } from "../../src/discounts/describe.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, line, lineOf, orderPct, outcome, payloadOf, pct } from "./engine-fixtures.ts";

const NBSP = "\u00a0";
const texts = (plan: ReturnType<typeof planCart>, locale: "cs" | "en") => explainPlan(plan, locale).map((i) => i.text);

test("sanitizer: a minimum is measured on the cart unless it says `entitled`; junk scope is reported and read as cart", () => {
  const rules = configOf([
    pct("A", 10, { minimum: { subtotal: { CZK: 1000_00 } } }),
    pct("B", 10, { minimum: { subtotal: { CZK: 1000_00 }, scope: "entitled" } }),
  ]).modules.codes.rules;
  assert.equal(rules[0].minimum?.scope, "cart");
  assert.equal(rules[1].minimum?.scope, "entitled");

  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [pct("C", 10, { minimum: { quantity: 2, scope: "products" } })] } },
  });
  assert.equal(config.modules.codes.rules[0].minimum?.scope, "cart");
  assert.deepEqual(
    issues.map((i) => [i.path, i.code]),
    [["modules.codes.rules[0].minimum.scope", "invalid_enum"]],
  );
});

test("payload: only an entitled minimum ships its scope (absent = the whole cart, fewer bytes)", () => {
  const payload = payloadOf([
    pct("A", 10, { minimum: { subtotal: { CZK: 1000_00 } } }),
    pct("B", 10, { minimum: { subtotal: { CZK: 1000_00 }, scope: "entitled" } }),
    pct("C", 10, { minimum: { scope: "entitled" } }),
  ]);
  const [a, b, c] = payload.modules.codes.rules;
  assert.deepEqual(a.minimum, { subtotal: { CZK: 1000_00 } });
  assert.deepEqual(b.minimum, { subtotal: { CZK: 1000_00 }, scope: "entitled" });
  assert.equal(c.minimum, undefined, "a scope without any minimum ships nothing");
});

test("engine: an entitled minimum counts only the rule's targeted non-gift lines, pre-discount, outlet included", () => {
  const cart = [
    line("L1", 600_00, 1, ["A", "E"]),
    line("L2", 300_00),
    line("L3", 100_00, 1, ["A", "E"], { outlet: true }),
    line("G", 900_00, 1, ["A", "E"], { giftTierId: "g" }),
  ];
  const rules = [
    pct("A", 10, { minimum: { subtotal: { CZK: 1000_00 }, quantity: 3 } }),
    pct("E", 5, { minimum: { subtotal: { CZK: 1000_00 }, quantity: 3, scope: "entitled" } }),
  ];
  const plan = planCart(cartOf(cart), payloadOf(rules));
  // Cart scope: 600 + 300 + 100 = 1 000, 3 items → applies.
  assert.equal(outcome(plan, "A").state, "applied");
  // Entitled scope: 600 + 100 (outlet counts, the gift never does) = 700, 2 items.
  assert.equal(outcome(plan, "E").state, "below_minimum");
  assert.deepEqual(outcome(plan, "E").missing, {
    subtotal: 300_00,
    minimumSubtotal: 1000_00,
    quantity: 1,
    minimumQuantity: 3,
    scope: "entitled",
  });

  const enough = planCart(cartOf([line("L1", 1000_00, 3, ["E"]), line("L2", 1_00)]), payloadOf(rules));
  assert.equal(outcome(enough, "E").state, "applied");
  assert.equal(lineOf(enough, "L1").product?.amount, 150_00);
});

test("engine: an order or shipping rule's entitled lines are the whole cart", () => {
  const rules = [orderPct("O", 10, { minimum: { subtotal: { CZK: 500_00 }, scope: "entitled" } })];
  const plan = planCart(cartOf([line("L1", 300_00), line("L2", 300_00)]), payloadOf(rules));
  assert.equal(outcome(plan, "O").state, "applied");
});

test("describe: „košík od …“ for a cart minimum, „nákup od … z vybraných produktů“ for an entitled one", () => {
  const [cart, entitled, coll, order] = configOf([
    pct("A", 10, { minimum: { subtotal: { CZK: 1000_00 }, quantity: 3 } }),
    pct("B", 10, { minimum: { subtotal: { CZK: 1000_00 }, quantity: 3, scope: "entitled" } }),
    pct("C", 10, {
      target: { kind: "collections", ids: ["gid://shopify/Collection/1"] },
      minimum: { subtotal: { CZK: 1000_00 }, scope: "entitled" },
    }),
    orderPct("O", 10, { minimum: { subtotal: { CZK: 1000_00 } } }),
  ]).modules.codes.rules;
  const m = `1${NBSP}000${NBSP}Kč`;
  assert.equal(describeRule(cart, "cs", "CZK"), `10${NBSP}% na vybrané produkty · automaticky · košík od ${m} · košík od 3 ks`);
  assert.equal(
    describeRule(entitled, "cs", "CZK"),
    `10${NBSP}% na vybrané produkty · automaticky · nákup od ${m} z vybraných produktů · od 3 ks z vybraných produktů`,
  );
  assert.equal(describeRule(coll, "cs", "CZK"), `10${NBSP}% na vybrané kolekce · automaticky · nákup od ${m} z vybraných kolekcí`);
  assert.equal(describeRule(order, "cs", "CZK"), `10${NBSP}% z objednávky · automaticky · od ${m}`, "order minimum unchanged");
  assert.equal(describeRule(cart, "en", "CZK"), "10% off selected products · automatic · cart from CZK 1,000 · cart from 3 items");
  assert.equal(
    describeRule(entitled, "en", "CZK"),
    "10% off selected products · automatic · from CZK 1,000 of selected products · from 3 selected items",
  );
  assert.equal(describeRule(coll, "en", "CZK"), "10% off selected collections · automatic · from CZK 1,000 in selected collections");
});

test("explain: what is missing says „z vybraných produktů“ for an entitled minimum", () => {
  const rules = [
    pct("A", 10, { name: "Podzim", minimum: { subtotal: { CZK: 1000_00 }, scope: "entitled" } }),
    pct("K", 10, { ...code(["KOD"]), name: "Kódem", minimum: { subtotal: { CZK: 1000_00 }, quantity: 2, scope: "entitled" } }),
  ];
  const plan = planCart(cartOf([line("L1", 600_00, 1, ["A", "K"]), line("L2", 900_00)], { enteredCodes: ["KOD"] }), payloadOf(rules));
  const cs = texts(plan, "cs");
  assert.ok(cs.includes(`Do slevy „Podzim“ chybí 400${NBSP}Kč z vybraných produktů.`), cs.join("\n"));
  assert.ok(cs.includes(`Ke kódu KOD chybí 400${NBSP}Kč z vybraných produktů do minima 1${NBSP}000${NBSP}Kč.`), cs.join("\n"));
  assert.ok(cs.includes("Ke kódu KOD chybí 1 ks z vybraných produktů do minima 2 ks."), cs.join("\n"));
  const en = texts(plan, "en");
  assert.ok(en.includes("“Podzim” needs CZK 400 more of selected products."), en.join("\n"));
  assert.ok(en.includes("Code KOD needs CZK 400 more of selected products (minimum CZK 1,000)."), en.join("\n"));
  assert.ok(en.includes("Code KOD needs 1 more selected item (minimum 2)."), en.join("\n"));

  // A cart minimum keeps the existing sentence.
  const cartPlan = planCart(cartOf([line("L1", 600_00, 1, ["A"])]), payloadOf([pct("A", 10, { name: "Podzim", minimum: { subtotal: { CZK: 1000_00 } } })]));
  assert.ok(texts(cartPlan, "cs").includes(`Do slevy „Podzim“ chybí 400${NBSP}Kč.`));
});
