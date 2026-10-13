// The rule of combining by type (combine.ts) and what the admin reads from a stored config (combine-config.ts):
// the shop's discounts, which two meet, where the two sides disagree, what a new discount starts with — and
// the conversion of a shop stored before 13 Oct 2026 on small, readable shops (config/combine-migrate.ts; the
// broad check is combine-migration.test.ts).

import assert from "node:assert/strict";
import { test } from "node:test";

import { addUp, allows, COMBINE_ALL, COMBINE_BIT, COMBINE_TYPES, combineMask, combineTypeOfRule, combineTypesOf, type CombineSide, normalizeCombineTypes } from "../../src/discounts/combine.ts";
import { COMBINE_ENTITY, COMBINE_OFFERED, combineAddUp, combineEntities, combineMeets, combineMismatches, defaultCombineFor } from "../../src/discounts/combine-config.ts";
import { createDefaultConfig, readStoredConfig, sanitizeConfig } from "../../src/discounts/config.ts";
import { migrateCombineV1 } from "../../src/discounts/config/combine-migrate.ts";
import { code, freeShip, orderPct, pct, type RawRule } from "./engine-fixtures.ts";

const side = (id: string, type: keyof typeof COMBINE_BIT, types: string[], except: string[] = [], reward?: CombineSide["reward"]): CombineSide => ({ id, bit: COMBINE_BIT[type], mask: combineMask(types), except, ...(reward ? { reward } : {}) });

test("masks: six types, one bit each; a list is the sum; unknown names are nothing", () => {
  assert.deepEqual(COMBINE_TYPES, ["automatic", "code", "shipping", "tiers", "rewards", "outlet"]);
  assert.equal(combineMask(COMBINE_TYPES), COMBINE_ALL);
  assert.equal(combineMask(["code", "outlet", "bogus"]), 34);
  assert.equal(combineMask(undefined), 0);
  assert.deepEqual(combineTypesOf(34), ["code", "outlet"]);
  assert.deepEqual(normalizeCombineTypes(["outlet", "code", "code", 7, "x"]), ["code", "outlet"]);
  assert.deepEqual(normalizeCombineTypes("all"), []);
});

test("the type of a rule: shipping wins over 'with a code'; an order discount of Milníky is 'rewards'", () => {
  assert.equal(combineTypeOfRule(pct("a", 10) as never), "automatic");
  assert.equal(combineTypeOfRule(orderPct("a", 10) as never), "automatic");
  assert.equal(combineTypeOfRule(pct("a", 10, code(["X"])) as never), "code");
  assert.equal(combineTypeOfRule(freeShip("a") as never), "shipping");
  assert.equal(combineTypeOfRule(freeShip("a", code(["X"])) as never), "shipping");
  // Half off shipping is a shipping discount too.
  assert.equal(combineTypeOfRule(pct("a", 50, { target: { kind: "shipping" } }) as never), "shipping");
  assert.equal(combineTypeOfRule(orderPct("ms-1", 5) as never), "rewards");
  // The prefix alone is not Milníky: another shape is an ordinary discount.
  assert.equal(combineTypeOfRule(pct("ms-1", 5) as never), "automatic");
  assert.equal(combineTypeOfRule(orderPct("ms-1", 5, code(["X"])) as never), "code");
});

test("THE RULE: A allows B by B's type or by naming B; they add up only when both allow", () => {
  const a = side("A", "automatic", ["code"]);
  const k = side("K", "code", ["automatic"]);
  const k2 = side("K2", "code", []);
  assert.equal(allows(a, k), true);
  assert.equal(allows(k2, a), false);
  assert.equal(addUp(a, k), true);
  assert.equal(addUp(a, k2), false);
  // An exception only allows — and only the one that names.
  const named = side("N", "automatic", [], ["K2"]);
  assert.equal(allows(named, k2), true);
  assert.equal(addUp(named, k2), false);
  assert.equal(addUp(named, side("K2", "code", [], ["N"])), true);
  // Two shipping discounts never add up; two order discounts of Milníky neither.
  assert.equal(addUp(side("S1", "shipping", [...COMBINE_TYPES]), side("S2", "shipping", [...COMBINE_TYPES])), false);
  assert.equal(addUp(side("ms-1", "rewards", [...COMBINE_TYPES], [], "discount"), side("ms-2", "rewards", [...COMBINE_TYPES], [], "discount")), false);
  // Two different rewards of Milníky read one thing: the Milníky list's own type.
  assert.equal(addUp(side("gift", "rewards", ["rewards"], [], "gift"), side("ship", "shipping", ["rewards"], [], "shipping")), true);
  assert.equal(addUp(side("gift", "rewards", ["shipping"], [], "gift"), side("ship", "shipping", ["shipping"], [], "shipping")), false);
});

function shop(rules: RawRule[], modules: Record<string, unknown> = {}, engine: Record<string, unknown> = {}) {
  const { config, issues } = sanitizeConfig({ engine, modules: { ...modules, codes: { rules } } });
  assert.deepEqual(issues, []);
  return config;
}

test("the shop's discounts: every rule, the tiers as one, the gifts as one, the milestone shipping, a sale — each with the list it follows", () => {
  const config = shop(
    [pct("A", 10, { combine: { types: ["code"], rules: ["K"] } }), pct("K", 5, code(["X"])), orderPct("ms-1", 5, { minimum: { subtotal: { CZK: 100 } } }), freeShip("S")],
    {
      tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }], combine: { types: ["shipping"] } },
      rewards: { freeShipping: { threshold: { CZK: 100 } }, gifts: [{ id: "g1", threshold: { CZK: 100 }, choices: ["gid://shopify/ProductVariant/1"] }], combine: { types: ["automatic", "rewards"] } },
      outlet: { combine: { types: ["code"] } },
    },
  );
  assert.deepEqual(
    combineEntities(config).map((e) => [e.id, e.owner, e.type, e.cls, e.types.join("+"), e.rules.join("+"), e.reward ?? ""]),
    [
      ["A", "rule", "automatic", "product", "code", "K", ""],
      ["K", "rule", "code", "product", "", "", ""],
      ["ms-1", "rewards", "rewards", "order", "automatic+rewards", "", "discount"],
      ["S", "rule", "shipping", "shipping", "", "", ""],
      [COMBINE_ENTITY.tiers, "tiers", "tiers", "product", "shipping", "", ""],
      [COMBINE_ENTITY.gift, "rewards", "rewards", "gift", "automatic+rewards", "", "gift"],
      [COMBINE_ENTITY.shipping, "rewards", "shipping", "shipping", "automatic+rewards", "", "shipping"],
      [COMBINE_ENTITY.outlet, "outlet", "outlet", "outlet", "code", "", ""],
    ],
  );
  // A shop with no tier set, gift or milestone shipping has none of those; a sale can always come.
  assert.deepEqual(combineEntities(createDefaultConfig()).map((e) => e.id), [COMBINE_ENTITY.outlet]);
});

test("what never meets is never a pair: two shipping discounts, two rewards of one kind, a sale with shipping or a gift", () => {
  const e = (cls: string, reward?: string) => ({ cls, reward }) as never;
  assert.equal(combineMeets(e("shipping"), e("shipping")), false);
  assert.equal(combineMeets(e("order", "discount"), e("order", "discount")), false);
  assert.equal(combineMeets(e("gift", "gift"), e("shipping", "shipping")), true);
  assert.equal(combineMeets(e("outlet"), e("shipping")), false);
  assert.equal(combineMeets(e("outlet"), e("gift", "gift")), false);
  assert.equal(combineMeets(e("outlet"), e("product")), true);
  assert.equal(combineMeets(e("outlet"), e("order", "discount")), true);
  assert.equal(combineMeets(e("product"), e("product")), true);
  assert.equal(combineMeets(e("product"), e("shipping")), true);
});

test("a mismatch is a pair where exactly one side allows — seen from the config alone, named by who allows and who refuses", () => {
  const config = shop([pct("A", 10, { combine: { types: ["code", "outlet"] } }), pct("K", 5, { ...code(["X"]), combine: { types: [] } }), pct("K2", 5, { ...code(["Y"]), combine: { types: ["automatic"] } })]);
  assert.deepEqual(combineMismatches(config), [
    { allowing: "A", refusing: "K" },
    { allowing: "A", refusing: COMBINE_ENTITY.outlet },
  ]);
  const byId = new Map(combineEntities(config).map((x) => [x.id, x]));
  assert.equal(combineAddUp(byId.get("A")!, byId.get("K2")!), true);
  assert.equal(combineAddUp(byId.get("A")!, byId.get("K")!), false);
  // Agreeing either way is no mismatch; the default shop has none.
  assert.deepEqual(combineMismatches(shop([pct("A", 10, { combine: { types: [] } }), pct("K", 5, { ...code(["X"]), combine: { types: [] } })])), []);
  assert.deepEqual(combineMismatches(createDefaultConfig()), []);
  // An exception on one side only is a mismatch too.
  assert.deepEqual(combineMismatches(shop([pct("A", 10, { combine: { types: [], rules: ["B"] } }), pct("B", 5, { combine: { types: [] } })])), [{ allowing: "A", refusing: "B" }]);
});

test("a new discount starts without a mismatch: the shop's default list, and its mirror for a shipping discount", () => {
  const config = createDefaultConfig();
  assert.deepEqual(defaultCombineFor(config, "automatic"), ["shipping", "rewards"]);
  assert.deepEqual(defaultCombineFor(config, "code"), ["shipping", "rewards"]);
  // Automatic discounts, codes, tiers and Milníky all name "shipping" by default: a shipping discount names them back.
  assert.deepEqual(defaultCombineFor(config, "shipping"), ["automatic", "code", "tiers", "rewards"]);
  const added = shop([pct("A", 10, { combine: { types: defaultCombineFor(config, "automatic") } }), pct("K", 5, { ...code(["X"]), combine: { types: defaultCombineFor(config, "code") } }), freeShip("S", { combine: { types: defaultCombineFor(config, "shipping") } })], {
    tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] },
    rewards: { freeShipping: { threshold: { CZK: 100 } }, gifts: [{ id: "g1", threshold: { CZK: 100 }, choices: ["gid://shopify/ProductVariant/1"] }] },
  });
  assert.deepEqual(combineMismatches(added), []);
  // A shop whose default list has no shipping: a shipping discount starts without the rule types.
  const strict = shop([], {}, { combineDefault: ["rewards"] });
  assert.deepEqual(defaultCombineFor(strict, "shipping"), ["tiers", "rewards"]);
  // Only what a list can meaningfully name is offered.
  assert.deepEqual(COMBINE_OFFERED.shipping, ["automatic", "code", "tiers", "rewards"]);
  assert.deepEqual(COMBINE_OFFERED.outlet, ["automatic", "code", "tiers", "rewards"]);
  assert.ok(!COMBINE_OFFERED.tiers.includes("tiers"));
});

// --- the conversion on small shops --------------------------------------------------------------------

const V1 = (rules: RawRule[], combination: Record<string, unknown> = {}, modules: Record<string, unknown> = {}) => ({ schemaVersion: 1, engine: { combination }, modules: { ...modules, codes: { rules } } });
const TIERS = { tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } };

test("conversion: a shop with nothing stored becomes the default shop", () => {
  assert.deepEqual(readStoredConfig({}), createDefaultConfig());
  assert.deepEqual(readStoredConfig(undefined), createDefaultConfig());
  assert.deepEqual(migrateCombineV1({}).lost, []);
});

test("conversion: an automatic product discount, a code for the order and free shipping keep adding up; the switches and combinesWith are gone", () => {
  const stored = V1([pct("A", 10), orderPct("K", 5, code(["X"])), freeShip("S")]);
  const config = readStoredConfig(stored);
  const lists = Object.fromEntries(config.modules.codes.rules.map((r) => [r.id, r.combine?.types.join("+")]));
  assert.deepEqual(lists, { A: "code+shipping+rewards", K: "automatic+shipping+rewards", S: "automatic+code+tiers+rewards" });
  assert.deepEqual(config.engine, { combineDefault: ["code", "shipping", "rewards"] });
  assert.deepEqual(migrateCombineV1(stored).lost, []);
  assert.ok(!JSON.stringify(config).includes("combination") && !JSON.stringify(config).includes("combinesWith"));
});

test("conversion: 'product with order' off — the two types stop naming each other, nothing is lost", () => {
  const stored = V1([pct("A", 10), orderPct("K", 5, code(["X"]))], { productWithOrder: false });
  const config = readStoredConfig(stored);
  assert.deepEqual(config.modules.codes.rules.map((r) => r.combine?.types), [["shipping", "rewards"], ["shipping", "rewards"]]);
  assert.deepEqual(migrateCombineV1(stored).lost, []);
});

test("conversion: where the classes cannot be told apart by type, the stricter side wins and the pair is reported", () => {
  // Two automatic product discounts (they never added up) and an automatic order discount (it added up with both).
  const stored = V1([pct("A", 10), pct("B", 5), orderPct("O", 5)]);
  const config = readStoredConfig(stored);
  assert.ok(config.modules.codes.rules.every((r) => !r.combine?.types.includes("automatic")));
  assert.deepEqual(migrateCombineV1(stored).lost, [
    { a: "A", b: "O", exception: false },
    { a: "B", b: "O", exception: false },
  ]);
  assert.deepEqual(combineMismatches(config), []);
});

test("conversion: combinesWith becomes an exception on BOTH rules, only between two rules of one class", () => {
  const stored = V1([pct("A", 10, { combinesWith: { ruleIds: ["B", "O", "gone"] } }), pct("B", 5), orderPct("O", 5)], { productWithOrder: false });
  const config = readStoredConfig(stored);
  const [a, b, o] = config.modules.codes.rules;
  assert.deepEqual(a.combine, { types: ["shipping", "rewards"], rules: ["B"] });
  assert.deepEqual(b.combine, { types: ["shipping", "rewards"], rules: ["A"] });
  // A listed O too, but a product and an order discount followed the switch (off): no exception.
  assert.deepEqual(o.combine, { types: ["shipping", "rewards"] });
  assert.deepEqual(migrateCombineV1(stored).lost, [{ a: "A", b: "B", exception: true }]);
});

test("conversion: 'outlet with anything' becomes the sale's list and its type on the price discounts; shipping and gifts never stood in a sale's way", () => {
  const on = readStoredConfig(V1([pct("A", 10), freeShip("S")], { outletWithAnything: true }, TIERS));
  assert.deepEqual(on.modules.outlet.combine.types, ["automatic", "code", "tiers", "rewards"]);
  assert.ok(on.modules.codes.rules[0].combine?.types.includes("outlet"));
  assert.ok(!on.modules.codes.rules[1].combine?.types.includes("outlet"));
  assert.ok(on.modules.tiers.combine.types.includes("outlet"));
  const off = readStoredConfig(V1([pct("A", 10)], {}, TIERS));
  assert.deepEqual(off.modules.outlet.combine.types, []);
  assert.ok(!off.modules.codes.rules[0].combine?.types.includes("outlet"));
});

test("conversion: a quantity tier and a product discount never added up; with an order discount only, the tiers keep adding up with it", () => {
  const withProduct = readStoredConfig(V1([pct("A", 10), orderPct("O", 5)], {}, TIERS));
  assert.ok(!withProduct.modules.tiers.combine.types.includes("automatic"));
  const orderOnly = readStoredConfig(V1([orderPct("O", 5)], {}, TIERS));
  assert.deepEqual(orderOnly.modules.tiers.combine.types, ["automatic", "shipping", "rewards"]);
  assert.deepEqual(orderOnly.modules.codes.rules[0].combine?.types, ["shipping", "tiers", "rewards"]);
});

test("conversion: an order discount of Milníky never added up with another order discount — the Milníky list drops that type, and the gift with it is reported", () => {
  const rewards = { rewards: { gifts: [{ id: "g1", threshold: { CZK: 100 }, choices: ["gid://shopify/ProductVariant/1"] }] } };
  const stored = V1([orderPct("ms-1", 5, { minimum: { subtotal: { CZK: 100 } } }), orderPct("O", 5)], {}, rewards);
  const config = readStoredConfig(stored);
  assert.ok(!config.modules.rewards.combine.types.includes("automatic"));
  assert.equal(config.modules.codes.rules[0].combine, undefined);
  assert.deepEqual(migrateCombineV1(stored).lost, [{ a: "O", b: COMBINE_ENTITY.gift, exception: false }]);
  // Without such a clash the gift goes with everything, as before.
  const calm = readStoredConfig(V1([pct("A", 10)], {}, rewards));
  assert.deepEqual(calm.modules.rewards.combine.types, ["automatic", "code", "shipping", "tiers", "rewards"]);
});

test("conversion: junk never throws and never invents a list that adds something up", () => {
  for (const junk of [null, 7, "x", [], { engine: 5, modules: { codes: { rules: [null, 3, { id: 5 }, { id: "a", combinesWith: "b" }, { id: "b", combinesWith: { ruleIds: [1, null, "a"] } }] } }, campaigns: [null, { overrides: [null, { ruleId: "a", patch: { combinesWith: 5, value: "x" } }] }] }]) {
    const config = readStoredConfig(junk);
    assert.equal(config.schemaVersion, 2);
    assert.deepEqual(combineMismatches(config), []);
  }
});

test("conversion: a campaign that patched combinesWith keeps only the exceptions the campaign's own links allowed", () => {
  const window = { start: "2026-11-27T00:00:00", end: "2026-11-30T00:00:00" };
  const stored = {
    ...V1([pct("A", 10, { combinesWith: { ruleIds: ["B", "C"] } }), pct("B", 5), pct("C", 4)]),
    campaigns: [{ id: "bf", name: "BF", window, overrides: [{ ruleId: "A", patch: { combinesWith: { ruleIds: ["C"] }, enabled: true } }], killed: false }],
  };
  const config = readStoredConfig(stored);
  assert.deepEqual(config.modules.codes.rules[0].combine?.rules, ["B", "C"]);
  assert.deepEqual(config.campaigns[0].overrides[0].patch, { enabled: true, combine: { types: ["shipping", "rewards"], rules: ["C"] } });
});
