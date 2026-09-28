// explainPlan (§4c: human sentences, never enum keys) and describeRule (§17a:
// admin headers) in Czech and English.

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeRule, formatMoney } from "../../src/discounts/describe.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart } from "../../src/discounts/plan.ts";
import {
  cartOf,
  code,
  configOf,
  fixed,
  freeShip,
  line,
  orderFixed,
  orderPct,
  payloadOf,
  pct,
} from "./engine-fixtures.ts";

const NBSP = " ";
const texts = (plan: ReturnType<typeof planCart>, locale: "cs" | "en") => explainPlan(plan, locale).map((i) => i.text);

test("formatMoney: Czech and English, minor units, whole amounts without decimals", () => {
  assert.equal(formatMoney(1234_50, "CZK", "cs"), `1${NBSP}234,50${NBSP}Kč`);
  assert.equal(formatMoney(1000_00, "CZK", "cs"), `1${NBSP}000${NBSP}Kč`);
  assert.equal(formatMoney(60_00, "EUR", "cs"), `60${NBSP}€`);
  assert.equal(formatMoney(1234_50, "CZK", "en"), "CZK 1,234.50");
  assert.equal(formatMoney(60_00, "EUR", "en"), "€60");
  assert.equal(formatMoney(1500, "JPY", "en"), "JPY 1,500");
});

test("a code that loses everywhere: „máš výhodnější slevu“", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD"] }),
    payloadOf([pct("A", 30, { name: "Podzim" }), pct("C", 10, code(["KOD"]))]),
  );
  assert.ok(texts(plan, "cs").includes("Kód KOD se neuplatní: máš výhodnější slevu „Podzim“."));
  assert.ok(texts(plan, "en").includes("Code KOD is not applied: you already have a better discount (“Podzim”)."));
});

test("a code for other products: „kód se na tyto produkty nevztahuje“", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: ["BOTY"] }), payloadOf([pct("C", 10, code(["BOTY"]))]));
  assert.ok(texts(plan, "cs").includes("Kód BOTY se na tyto produkty nevztahuje."));
  assert.ok(texts(plan, "en").includes("Code BOTY does not apply to these products."));
});

test("a code below its minimum says how much is missing", () => {
  const plan = planCart(
    cartOf([line("L1", 850_00)], { enteredCodes: ["VIP"] }),
    payloadOf([orderPct("V", 10, { ...code(["VIP"]), minimum: { subtotal: { CZK: 1000_00 } } })]),
  );
  assert.ok(texts(plan, "cs").includes(`Ke kódu VIP chybí 150${NBSP}Kč do minima 1${NBSP}000${NBSP}Kč.`));
  assert.ok(texts(plan, "en").includes("Code VIP needs CZK 150 more (minimum CZK 1,000)."));
});

test("a code applied tells how much it saves", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: ["VIP"] }), payloadOf([orderPct("V", 10, code(["VIP"]))]));
  assert.deepEqual(explainPlan(plan, "cs")[0], {
    tone: "success",
    text: `Kód VIP: ušetříš 100${NBSP}Kč.`,
    ruleId: "V",
    code: "VIP",
  });
});

test("automatic rules: applied, outranked, below minimum, missing currency", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B"]), line("L2", 500_00, 1, ["A"])], { currency: "EUR" }),
    payloadOf([
      pct("A", 20, { name: "Zimní" }),
      pct("B", 10, { name: "Malá" }),
      orderPct("O", 5, { name: "Velký košík", minimum: { subtotal: { EUR: 2000_00 } } }),
      fixed("F", { CZK: 100_00 }, { name: "Stovka" }),
    ]),
  );
  const cs = texts(plan, "cs");
  assert.ok(cs.includes(`Sleva „Zimní“ ušetří 300${NBSP}€ na 2 položkách.`), cs.join("\n"));
  assert.ok(cs.includes("Sleva „Malá“ se neuplatní: výhodnější je „Zimní“."));
  assert.ok(cs.includes(`Do slevy „Velký košík“ chybí 500${NBSP}€.`));
  assert.ok(cs.includes("Sleva „Stovka“ nemá hodnotu pro měnu EUR, proto se tu nenabízí."));
  const en = texts(plan, "en");
  assert.ok(en.includes("“Zimní” saves €300 on 2 items."), en.join("\n"));
  assert.ok(en.includes("“Malá” is not applied: “Zimní” is better."));
  assert.ok(en.includes("“Velký košík” needs €500 more."));
  assert.ok(en.includes("“Stovka” has no amount for EUR, so it is not offered here."));
});

test("order, shipping and outlet sentences", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00), line("L2", 300_00, 1, [], { outlet: true })]),
    payloadOf([orderFixed("O", { CZK: 100_00 }, { name: "Stovka dolů" }), freeShip("S", { name: "Doprava" })]),
  );
  const cs = texts(plan, "cs");
  assert.ok(cs.includes(`Sleva „Stovka dolů“ ušetří 100${NBSP}Kč z objednávky.`), cs.join("\n"));
  assert.ok(cs.includes("Doprava zdarma díky slevě „Doprava“."));
  assert.ok(cs.includes("1 položka ve výprodeji se s dalšími slevami nekombinuje."));
  const en = texts(plan, "en");
  assert.ok(en.includes("“Stovka dolů” saves CZK 100 on the order."), en.join("\n"));
  assert.ok(en.includes("Free shipping thanks to “Doprava”."));
  assert.ok(en.includes("1 item on sale does not combine with other discounts."));
});

test("Czech plurals: 1 položka, 2-4 položky, 5+ položek", () => {
  const plan = (n: number) =>
    planCart(
      cartOf(Array.from({ length: n }, (_, i) => line(`L${i}`, 100_00, 1, ["A"]))),
      payloadOf([pct("A", 10, { name: "X" })]),
    );
  assert.ok(texts(plan(1), "cs").includes(`Sleva „X“ ušetří 10${NBSP}Kč na 1 položce.`));
  assert.ok(texts(plan(3), "cs").includes(`Sleva „X“ ušetří 30${NBSP}Kč na 3 položkách.`));
  assert.ok(texts(plan(5), "cs").includes(`Sleva „X“ ušetří 50${NBSP}Kč na 5 položkách.`));
  assert.ok(texts(plan(1), "en").includes("“X” saves CZK 10 on 1 item."));
});

test("explanations never show internal keys", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD", "CIZI"], currency: "EUR" }),
    payloadOf([
      pct("A", 30, { schedule: { startsAt: "2027-01-01T00:00:00+01:00" } }),
      pct("C", 10, code(["KOD"])),
      orderPct("O", 5, { targeting: { markets: ["cz"] } }),
      freeShip("S", { enabled: false }),
    ]),
  );
  for (const locale of ["cs", "en"] as const) {
    for (const item of explainPlan(plan, locale)) {
      assert.doesNotMatch(item.text, /\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z]\w*\b|undefined|NaN|null/, item.text);
    }
  }
});

test("describeRule: admin headers, Czech and English", () => {
  const [a, b, c, d] = configOf([
    orderPct("a", 10, { ...code(["LETO", "ZIMA", "JARO"]), minimum: { subtotal: { CZK: 1000_00 } } }),
    fixed("b", { CZK: 200_00 }, { minimum: { quantity: 3 } }),
    freeShip("c"),
    pct("d", 15, { target: { kind: "collections", ids: [] } }),
  ]).modules.codes.rules;
  assert.equal(describeRule(a, "cs", "CZK"), `10${NBSP}% z objednávky · kódy LETO, ZIMA, JARO · od 1${NBSP}000${NBSP}Kč`);
  assert.equal(describeRule(a, "en", "CZK"), "10% off the order · codes LETO, ZIMA, JARO · orders from CZK 1,000");
  assert.equal(describeRule(b, "cs", "CZK"), `200${NBSP}Kč z každého kusu vybraných produktů · automaticky · od 3 ks`);
  assert.equal(describeRule(b, "en", "CZK"), "CZK 200 off each selected item · automatic · from 3 items");
  assert.equal(describeRule(b, "cs", "EUR"), "Pevná sleva (pro EUR bez hodnoty) · automaticky · od 3 ks");
  assert.equal(describeRule(c, "cs", "CZK"), "Doprava zdarma · automaticky");
  assert.equal(describeRule(d, "en", "CZK"), "15% off selected collections · automatic");
  assert.equal(describeRule(a, "cs", "CZK", { short: true }), `10${NBSP}% z objednávky`);
});

test("a plan without a usable config says so in one plain sentence", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)]), null);
  assert.deepEqual(texts(plan, "cs"), ["Nastavení slev se nepodařilo načíst, žádná sleva se teď neuplatní."]);
  assert.deepEqual(texts(plan, "en"), ["The discount settings could not be loaded; no discount applies right now."]);
});

// --- fix round 1 -------------------------------------------------------------------------------

test("shopper-facing text never brands the app, even for a code the app does not manage", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: ["CIZI"] }), payloadOf([]));
  for (const locale of ["cs", "en"] as const) {
    const all = texts(plan, locale).join("\n");
    assert.doesNotMatch(all, /won/i, all);
  }
  assert.ok(texts(plan, "cs").includes("Kód CIZI je jiná sleva obchodu, tady se nepočítá."));
  assert.ok(texts(plan, "en").includes("Code CIZI is another store discount and is not counted here."));
});

test("an echoed code is capped at 64 characters (customer input, rendered as text only)", () => {
  const long = "X".repeat(200);
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: [long] }), payloadOf([]));
  const [item] = explainPlan(plan, "cs");
  assert.ok(item.text.includes(`${"X".repeat(64)}…`), item.text);
  assert.ok(!item.text.includes("X".repeat(65)));
  assert.equal(item.code, `${"X".repeat(64)}…`);
});

test("two codes in one Pro stack: the one that does not own it says it applied together with the other", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["C1", "C2"])], { enteredCodes: ["JEDNA", "DVA"] }),
    payloadOf([
      pct("C1", 10, { ...code(["JEDNA"]), combinesWith: { ruleIds: ["C2"] } }),
      pct("C2", 5, { ...code(["DVA"]), priority: 4 }),
    ]),
  );
  assert.ok(texts(plan, "cs").includes("Kód JEDNA se uplatnil společně s kódem DVA."), texts(plan, "cs").join("\n"));
  assert.ok(texts(plan, "en").includes("Code JEDNA was applied together with code DVA."));
});

test("an automatic rule stacked into a code says it is included in the code", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD"] }),
    payloadOf([pct("A", 10, { name: "Podzim", priority: 9, combinesWith: { ruleIds: ["C"] } }), pct("C", 5, code(["KOD"]))]),
  );
  assert.ok(texts(plan, "cs").includes("Sleva „Podzim“ je započtená v kódu KOD."), texts(plan, "cs").join("\n"));
  assert.ok(texts(plan, "en").includes("“Podzim” is included in code KOD."));
});

test("a free-shipping code dropped by a Free switch is 'does not combine', never 'you have a better discount'", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])], { enteredCodes: ["DOPRAVA"] }),
    payloadOf([pct("A", 10), freeShip("S", code(["DOPRAVA"])), freeShip("S2")], {
      engine: { combination: { productWithShipping: false } },
    }),
  );
  const cs = texts(plan, "cs").join("\n");
  assert.match(cs, /Kód DOPRAVA se nekombinuje/);
  assert.doesNotMatch(cs, /výhodnější/);
});

test("segment targeting: an honest 'not available yet', for codes and automatic rules", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)], { enteredCodes: ["VIP"] }),
    payloadOf([
      orderPct("V", 10, { ...code(["VIP"]), targeting: { segments: ["gid://shopify/Segment/1"] } }),
      orderPct("A", 5, { name: "Věrní", targeting: { segments: ["gid://shopify/Segment/1"] } }),
    ]),
  );
  assert.ok(texts(plan, "cs").includes("Kód VIP se neuplatní: cílení na segment zatím není k dispozici."), texts(plan, "cs").join("\n"));
  assert.ok(texts(plan, "cs").includes("Sleva „Věrní“ se neuplatní: cílení na segment zatím není k dispozici."));
  assert.ok(texts(plan, "en").includes("Code VIP is not applied: segment targeting is not available yet."));
});
