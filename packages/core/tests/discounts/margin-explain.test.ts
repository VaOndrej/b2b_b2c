// Margin protection in words (§4c: human sentences, never enum keys), Czech and
// English: a capped line (from → to, and why), a lowered order discount, lines
// the order discount leaves out, and a rule that margin protection zeroed. The
// admin ("Vyzkoušet košík") hears the reason with numbers; a shopper never sees
// the cost price or the margin, only that the store set a lowest price.

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeMarginReason, describeMarginSettings } from "../../src/discounts/describe.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, costLine, line, marginPayloadOf, orderPct, pct } from "./engine-fixtures.ts";

const NBSP = "\u00a0";
const admin = (plan: ReturnType<typeof planCart>, locale: "cs" | "en") =>
  explainPlan(plan, locale, { audience: "admin" }).map((i) => i.text);
const shopper = (plan: ReturnType<typeof planCart>, locale: "cs" | "en") => explainPlan(plan, locale).map((i) => i.text);

test("describeMarginReason: cost + minimum margin, cost alone, the % ceiling without a cost, a collection's setting", () => {
  assert.equal(
    describeMarginReason({ basis: "cost", minMarginPercent: 20, source: "global" }, "cs"),
    `cena neklesne pod nákupní cenu s minimální marží 20${NBSP}%`,
  );
  assert.equal(
    describeMarginReason({ basis: "cost", minMarginPercent: 20, source: "global" }, "en"),
    "the price stays above the cost price with a minimum margin of 20%",
  );
  assert.equal(describeMarginReason({ basis: "cost", minMarginPercent: 0, source: "global" }, "cs"), "cena neklesne pod nákupní cenu");
  assert.equal(describeMarginReason({ basis: "cost", minMarginPercent: 0, source: "global" }, "en"), "the price stays above the cost price");
  assert.equal(
    describeMarginReason({ basis: "max_percent", maxDiscountPercent: 30, source: "collection" }, "cs"),
    `položka nemá nákupní cenu, proto je sleva nejvýš 30${NBSP}% (nastavení kolekce)`,
  );
  assert.equal(
    describeMarginReason({ basis: "max_percent", maxDiscountPercent: 30, source: "collection" }, "en"),
    "the item has no cost price, so the discount is at most 30% (collection setting)",
  );
});

test("describeMarginSettings: the module in one line for admin headers", () => {
  const off = { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [] };
  assert.equal(describeMarginSettings(off, "cs"), "Ochrana marže je vypnutá");
  assert.equal(describeMarginSettings(off, "en"), "Margin protection is off");
  const on = {
    enabled: true,
    global: { minMarginPercent: 20, maxDiscountPercent: 40 },
    perCollection: [{ collectionId: "gid://shopify/Collection/1", minMarginPercent: 30 }],
  };
  assert.equal(
    describeMarginSettings(on, "cs"),
    `Min. marže 20${NBSP}% · bez nákupní ceny sleva nejvýš 40${NBSP}% · 1 kolekce s vlastním nastavením`,
  );
  assert.equal(describeMarginSettings(on, "en"), "Minimum margin 20% · without a cost price at most 40% off · 1 collection with its own setting");
  const noMin = { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] };
  assert.equal(describeMarginSettings(noMin, "cs"), `Nikdy pod nákupní cenu · bez nákupní ceny sleva nejvýš 50${NBSP}%`);
  assert.equal(describeMarginSettings(noMin, "en"), "Never below the cost price · without a cost price at most 50% off");
});

test("explain: a capped line says from → to and why (admin), and only that a lowest price applies (shopper)", () => {
  const payload = marginPayloadOf([pct("A", 30, { name: "Podzim" })], { global: { minMarginPercent: 20, maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 700, 1, ["A"])]), payload);
  assert.ok(
    admin(plan, "cs").includes(
      `Sleva na položce je snížená z 300${NBSP}Kč na 125${NBSP}Kč: cena neklesne pod nákupní cenu s minimální marží 20${NBSP}%.`,
    ),
    admin(plan, "cs").join("\n"),
  );
  assert.ok(
    admin(plan, "en").includes("The discount on an item is lowered from CZK 300 to CZK 125: the price stays above the cost price with a minimum margin of 20%."),
    admin(plan, "en").join("\n"),
  );
  assert.ok(
    shopper(plan, "cs").includes(`Sleva na položce je snížená z 300${NBSP}Kč na 125${NBSP}Kč: obchod u ní má nastavenou nejnižší cenu.`),
    shopper(plan, "cs").join("\n"),
  );
  assert.ok(
    shopper(plan, "en").includes("The discount on an item is lowered from CZK 300 to CZK 125: the store has set a lowest price for it."),
    shopper(plan, "en").join("\n"),
  );
  for (const text of [...shopper(plan, "cs"), ...shopper(plan, "en")]) assert.doesNotMatch(text, /nákupní|marž|cost|margin/i);
  const item = explainPlan(plan, "cs", { audience: "admin" }).find((i) => i.text.startsWith("Sleva na položce"));
  assert.deepEqual(item?.lineIds, ["L1"]);
});

test("explain: a line with no headroom at all, and the rule that margin zeroed everywhere (automatic and code)", () => {
  const payload = marginPayloadOf([pct("A", 30, { name: "Podzim" }), pct("C", 20, code(["KOD"]))], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 1000, 1, ["A", "C"])], { enteredCodes: ["KOD"] }), payload);
  const cs = admin(plan, "cs");
  assert.ok(cs.includes(`Sleva 300${NBSP}Kč na položce se neuplatní: cena neklesne pod nákupní cenu.`), cs.join("\n"));
  assert.ok(cs.includes("Sleva „Podzim“ se neuplatní: ceny položek jsou už na nastaveném minimu."), cs.join("\n"));
  const en = admin(plan, "en");
  assert.ok(en.includes("The CZK 300 discount on an item does not apply: the price stays above the cost price."), en.join("\n"));
  assert.ok(en.includes("“Podzim” is not applied: the item prices are already at the set minimum."), en.join("\n"));
  // C was outranked by A before the floor; with A zeroed its code is outranked (A was better) — a code
  // that had the winning stack and got zeroed says margin:
  const codeOnly = planCart(
    cartOf([costLine("L1", 1000_00, 1000, 1, ["C"])], { enteredCodes: ["KOD"] }),
    marginPayloadOf([pct("C", 20, code(["KOD"]))], { global: { maxDiscountPercent: 50 } }),
  );
  assert.ok(shopper(codeOnly, "cs").includes("Kód KOD tu nic neušetří: ceny položek jsou už na nastaveném minimu."), shopper(codeOnly, "cs").join("\n"));
  assert.ok(shopper(codeOnly, "en").includes("Code KOD saves nothing here: the item prices are already at the set minimum."));
  assert.equal(explainPlan(codeOnly, "cs").find((i) => i.code === "KOD")?.tone, "warning");
});

test("explain: the order discount lowered, and lines it leaves out", () => {
  const lowered = planCart(cartOf([line("L1", 1000_00)]), marginPayloadOf([orderPct("O", 30)], { global: { maxDiscountPercent: 20 } }));
  assert.ok(
    shopper(lowered, "cs").includes(`Sleva z objednávky je snížená z 300${NBSP}Kč na 199,99${NBSP}Kč, aby cena položek neklesla pod nastavené minimum.`),
    shopper(lowered, "cs").join("\n"),
  );
  assert.ok(
    shopper(lowered, "en").includes("The order discount is lowered from CZK 300 to CZK 199.99 so item prices do not drop below the set minimum."),
    shopper(lowered, "en").join("\n"),
  );
  const leftOut = planCart(
    cartOf([line("L1", 1000_00), costLine("L2", 1000_00, 1000), costLine("L3", 500_00, 500)]),
    marginPayloadOf([orderPct("O", 10)], { global: { maxDiscountPercent: 50 } }),
  );
  const cs = explainPlan(leftOut, "cs");
  const item = cs.find((i) => i.text.startsWith("Sleva z objednávky se nevztahuje"));
  assert.equal(item?.text, "Sleva z objednávky se nevztahuje na 2 položky, jejich cena je už na nastaveném minimu.");
  assert.deepEqual(item?.lineIds, ["L2", "L3"]);
  assert.ok(
    explainPlan(leftOut, "en").some((i) => i.text === "The order discount does not apply to 2 items already at their set minimum price."),
  );
  const one = planCart(
    cartOf([line("L1", 1000_00), costLine("L2", 1000_00, 1000)]),
    marginPayloadOf([orderPct("O", 10)], { global: { maxDiscountPercent: 50 } }),
  );
  assert.ok(shopper(one, "cs").includes("Sleva z objednávky se nevztahuje na 1 položku, její cena je už na nastaveném minimu."));
  assert.ok(shopper(one, "en").includes("The order discount does not apply to 1 item already at its set minimum price."));
});

test("explain: an order rule margin zeroed is margin_floor in words, never the enum", () => {
  const plan = planCart(
    cartOf([costLine("L1", 1000_00, 1000)], { enteredCodes: ["LETO"] }),
    marginPayloadOf([orderPct("O", 10, code(["LETO"])), orderPct("Z", 5, { name: "Věrnost" })], { global: { maxDiscountPercent: 50 } }),
  );
  for (const locale of ["cs", "en"] as const) {
    for (const text of [...admin(plan, locale), ...shopper(plan, locale)]) {
      assert.doesNotMatch(text, /\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z]\w*\b|undefined|NaN|null/, text);
    }
  }
  assert.ok(shopper(plan, "cs").includes("Kód LETO tu nic neušetří: ceny položek jsou už na nastaveném minimu."));
});
