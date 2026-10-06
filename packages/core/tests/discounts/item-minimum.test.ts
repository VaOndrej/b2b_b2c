// Per-item minimum quantity (Pro, plan 2026-10-06 bod 8): a product / collection
// rule may give a selected product or collection its own minimum quantity; each
// item is judged on its own. Sanitizer → product refs (targeting.ts) → engine
// (plan.ts "Per-item minimum") → plan gate → describe / explain.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";
import { describeItemMinimum, describeItemMinimumGap, describeItemMinimumsSummary } from "../../src/discounts/describe.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { explainGate, gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { itemRef, lineTargeting, parseItemRef, parseRuleRef, productRuleIndex } from "../../src/discounts/targeting.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, line, outcome, payloadOf, pct } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const products = (productIds: string[], itemMinimums: unknown[], variantIds: string[] = []) => ({ kind: "products", productIds, variantIds, itemMinimums });
const collections = (ids: string[], itemMinimums: unknown[]) => ({ kind: "collections", ids, itemMinimums });
const discountOf = (plan: ReturnType<typeof planCart>, lineId: string) => plan.lines.find((l) => l.lineId === lineId)?.product?.amount ?? 0;

test("sanitizer: one whole minimum ≥ 1 per targeted item; empty ones vanish, strays and repeats are reported, large ones lowered", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          pct("A", 10, {
            target: products([P(1), P(2), P(3)], [
              { id: P(1), quantity: 3.9 },
              { id: P(2), quantity: 0 },
              { id: P(3), quantity: 20_000 },
              { id: P(1), quantity: 5 },
              { id: P(9), quantity: 2 }, // a product whose variants are selected one by one: allowed
              { id: "gid://shopify/Collection/5", quantity: 2 },
              { id: P(4) },
              "junk",
            ]),
          }),
          pct("B", 10, { target: collections([C(1), C(2)], [{ id: C(1), quantity: 2 }, { id: C(7), quantity: 2 }]) }),
          pct("C", 10, { target: products([P(1)], []) }),
          pct("D", 10, { target: { kind: "order", itemMinimums: [{ id: P(1), quantity: 2 }] } }),
        ],
      },
    },
  });
  const [a, b, c, d] = config.modules.codes.rules;
  assert.deepEqual(a.target, {
    kind: "products",
    productIds: [P(1), P(2), P(3)],
    variantIds: [],
    itemMinimums: [
      { id: P(1), quantity: 3 },
      { id: P(3), quantity: CONFIG_LIMITS.itemMinQty },
      { id: P(9), quantity: 2 },
    ],
  });
  assert.deepEqual(b.target, { kind: "collections", ids: [C(1), C(2)], itemMinimums: [{ id: C(1), quantity: 2 }] });
  assert.deepEqual(c.target, { kind: "products", productIds: [P(1)], variantIds: [] }, "no entry: the key is omitted");
  assert.deepEqual(d.target, { kind: "order" });
  assert.deepEqual(
    issues.map((i) => [i.path, i.code]),
    [
      ["modules.codes.rules[0].target.itemMinimums", "orphan_item_minimum"],
      ["modules.codes.rules[0].target.itemMinimums", "duplicate_item_minimum"],
      ["modules.codes.rules[0].target.itemMinimums", "clamped_item_minimum"],
      ["modules.codes.rules[1].target.itemMinimums", "orphan_item_minimum"],
    ],
  );
  // Bounded: at most CONFIG_LIMITS.listItems entries.
  const many = Array.from({ length: 300 }, (_, i) => ({ id: P(i + 1), quantity: 2 }));
  const big = sanitizeConfig({ modules: { codes: { rules: [pct("A", 10, { target: products([], many) })] } } });
  const target = big.config.modules.codes.rules[0].target;
  assert.equal(target.kind === "products" ? target.itemMinimums?.length : -1, CONFIG_LIMITS.listItems);
  assert.deepEqual(big.issues.map((i) => i.code), ["too_many_items"]);
});

test("refs: an item with its own minimum is listed as `rule#key:min`; a collection without one plainly; variants take their product's", () => {
  assert.equal(itemRef("A", "42", 3), "A#42:3");
  assert.deepEqual(parseItemRef("A@bf#42:3"), { base: "A@bf", group: "A@bf#42", key: "42", minimum: 3 });
  for (const junk of ["A", "A#", "A#42", "A#:3", "A#42:", "A#42:0", "A#42:-1", "A#42:3.5", "A#42:1234567", "A#42:x", "A#42: 3"]) assert.equal(parseItemRef(junk), null, junk);
  assert.deepEqual(parseItemRef("A#k:1:007"), { base: "A", group: "A#k:1", key: "k:1", minimum: 7 }, "the LAST colon; leading zeros read as the number");
  assert.deepEqual(parseRuleRef("A@bf#42:3"), { ruleId: "A", campaignId: "bf" });
  assert.deepEqual(parseRuleRef("A#42:3"), { ruleId: "A" });

  const config = configOf(
    [
      pct("A", 10, { target: products([P(1), P(2)], [{ id: P(1), quantity: 3 }, { id: P(3), quantity: 4 }], [V(31)]) }),
      pct("B", 10, { target: collections([C(1), C(2), C(3)], [{ id: C(1), quantity: 5 }, { id: C(2), quantity: 2 }]) }),
    ],
    { campaigns: [{ id: "bf", name: "BF", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T00:00:00" }, overrides: [{ ruleId: "B", patch: { target: collections([C(1)], [{ id: C(1), quantity: 9 }]) } }], killed: false }] },
  );
  const index = productRuleIndex(config, [
    { productId: P(1), variantIds: [V(11)], collectionIds: [C(1), C(2)] },
    { productId: P(2), variantIds: [V(21)], collectionIds: [C(3)] },
    { productId: P(3), variantIds: [V(31), V(32)], collectionIds: [C(2), C(3)] },
    { productId: P(4), variantIds: [V(41)], collectionIds: [] },
  ]);
  // Product 1: its own minimum in A; in two collections of B, each with a minimum; the campaign's re-target scoped.
  assert.deepEqual(index.get(P(1))?.ruleIds, ["A#1:3", "B#1:5", "B#2:2", "B@bf#1:9"]);
  // Product 2: no own minimum in A (plain), and B through a collection without one (plain).
  assert.deepEqual(index.get(P(2))?.ruleIds, ["A", "B"]);
  // Product 3: A only through variant 31, with the PRODUCT's minimum; B through one collection with a minimum and one without.
  assert.deepEqual(index.get(P(3)), { ruleIds: ["B", "B#2:2"], variantRuleIds: { "31": ["A#3:4"] } });
  assert.deepEqual(index.get(P(4)), { ruleIds: [], variantRuleIds: {} });

  // The engine's reading: each (rule, group) once, plain refs apart, a campaign's refs only while it re-targets;
  // an item ref's base must name a rule that exists (`known`).
  const refs = ["A#1:3", "B", "B#2:2", "B#2:2", "B@bf#1:9", "C#junk", "D#1:2#x:1", "X#1:2"];
  const known = new Set(["A", "B", "C", "D"]);
  const base = lineTargeting({ ruleIds: refs }, null, new Set(), known);
  assert.deepEqual([...base.ruleIds], ["A", "B", "D"]);
  assert.deepEqual([...base.plain], ["B"]);
  assert.deepEqual(base.items, [
    { ruleId: "A", group: "A#1", key: "1", minimum: 3 },
    { ruleId: "B", group: "B#2", key: "2", minimum: 2 },
    { ruleId: "D", group: "D#1:2#x", key: "1:2#x", minimum: 1 },
  ]);
  const campaign = lineTargeting({ ruleIds: refs }, "bf", new Set(["B"]), known);
  assert.deepEqual(campaign.items.map((i) => i.group), ["A#1", "B@bf#1", "D#1:2#x"]);
  assert.deepEqual([...campaign.plain], []);
  // A text that IS a rule's id names that rule plainly, "#" and all (a hand-made config only).
  const odd = lineTargeting({ ruleIds: ["A#1:3"] }, null, new Set(), new Set(["A", "A#1:3"]));
  assert.deepEqual([[...odd.plain], odd.items], [["A#1:3"], []]);
});

test("the shared function config carries no per-item minimum: 0 B, whatever the list's size", () => {
  const opts = { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" };
  const ids = Array.from({ length: 250 }, (_, i) => P(8_841_234_500_000 + i));
  const without = buildShopFunctionConfig(configOf([pct("A", 10, { target: products(ids, []) })]), opts);
  const withMinimums = buildShopFunctionConfig(configOf([pct("A", 10, { target: products(ids, ids.map((id) => ({ id, quantity: 12 }))) })]), opts);
  assert.equal(withMinimums.bytes, without.bytes);
  assert.equal(withMinimums.json, without.json);
  // What it costs instead: one ref in each product's own metafield.
  const index = productRuleIndex(configOf([pct("r_0123456789abcdef0123", 10, { target: products(ids, ids.map((id) => ({ id, quantity: 12 }))) })]), [
    { productId: ids[0], variantIds: [], collectionIds: [] },
  ]);
  const ref = index.get(ids[0])?.ruleIds[0] ?? "";
  assert.equal(ref, "r_0123456789abcdef0123#8841234500000:12");
  assert.equal(ref.length - "r_0123456789abcdef0123".length, 17, "17 B a product with a 13-digit id and a 2-digit minimum");
});

test("engine: each item is judged on its own — A from 3, B from 4, C follows the common minimum (the owner's example)", () => {
  const rules = [pct("R", 10)];
  const cart = (extra: Record<string, unknown> = {}) =>
    cartOf(
      [
        line("A1", 100_00, 2, ["R#1:3"], { productId: P(1) }),
        line("A2", 100_00, 1, ["R#1:3"], { productId: P(1) }), // another variant of A: they count together
        line("B1", 100_00, 1, ["R#2:4"], { productId: P(2) }),
        line("C1", 100_00, 2, ["R"], { productId: P(3) }),
        line("X", 100_00, 5), // not targeted
      ],
      extra,
    );
  const plan = planCart(cart(), payloadOf(rules));
  assert.deepEqual(
    plan.lines.map((l) => [l.lineId, l.product?.amount ?? 0]),
    [["A1", 20_00], ["A2", 10_00], ["B1", 0], ["C1", 20_00], ["X", 0]],
  );
  const r = outcome(plan, "R");
  assert.equal(r.state, "applied");
  assert.deepEqual(r.lineIds, ["A1", "A2", "C1"]);
  assert.deepEqual(r.items, [
    { key: "1", minimum: 3, count: 3, reached: true, lineIds: ["A1", "A2"] },
    { key: "2", minimum: 4, count: 1, reached: false, lineIds: ["B1"] },
  ]);
  // The same formatter as the admin summary, with and without the item's name.
  assert.deepEqual(explainPlan(plan, "cs", { itemNames: { "2": "Mikina" } }).filter((i) => i.lineIds?.includes("B1")).map((i) => [i.tone, i.text]), [
    ["info", "Produkt Mikina: v košíku 1 ks, sleva platí od 4 ks."],
  ]);
  assert.ok(explainPlan(plan, "en").some((i) => i.text === "Product: 1 item in the cart, the discount applies from 4 items."));

  // A common quantity minimum (the cart: 11 pieces here) decides for C only; A keeps its own.
  const common = (quantity: number, scope?: string) => planCart(cart(), payloadOf([pct("R", 10, { minimum: { quantity, ...(scope ? { scope } : {}) } })]));
  assert.deepEqual([discountOf(common(11), "A1"), discountOf(common(11), "B1"), discountOf(common(11), "C1")], [20_00, 0, 20_00]);
  assert.deepEqual([discountOf(common(12), "A1"), discountOf(common(12), "B1"), discountOf(common(12), "C1")], [20_00, 0, 0]);
  assert.equal(outcome(common(12), "R").state, "applied", "the rule still applies to A");
  // "entitled": the rule's own lines (6 pieces), every one of them, as before.
  assert.equal(discountOf(common(6, "entitled"), "C1"), 20_00);
  assert.equal(discountOf(common(7, "entitled"), "C1"), 0);
  // A subtotal minimum still gates the whole rule.
  const subtotal = planCart(cart(), payloadOf([pct("R", 10, { minimum: { subtotal: { CZK: 2000_00 } } })]));
  assert.equal(outcome(subtotal, "R").state, "below_minimum");
  assert.equal(discountOf(subtotal, "A1"), 0);
  assert.equal(outcome(subtotal, "R").missing?.subtotal, 900_00);
});

test("engine: no item reached → below the minimum, with what is missing; a code rule says it as a warning", () => {
  const lines = [line("A1", 100_00, 2, ["R#1:3"]), line("C1", 100_00, 1, ["R"])];
  const plan = planCart(cartOf(lines), payloadOf([pct("R", 10, { minimum: { quantity: 5 } })]));
  const r = outcome(plan, "R");
  assert.equal(r.state, "below_minimum");
  assert.deepEqual(r.missing, { quantity: 2, minimumQuantity: 5 });
  assert.deepEqual(r.items, [{ key: "1", minimum: 3, count: 2, reached: false, lineIds: ["A1"] }]);
  assert.deepEqual(explainPlan(plan, "cs").map((i) => i.text), [
    "Do slevy „Rule R“ chybí 2 ks.",
    "Produkt: v košíku 2 ks, sleva platí od 3 ks.",
  ]);
  // Only item lines: nothing to say about a common minimum.
  const only = planCart(cartOf([lines[0]]), payloadOf([pct("R", 10, { minimum: { quantity: 5 } })]));
  assert.equal(outcome(only, "R").state, "below_minimum");
  assert.equal(outcome(only, "R").missing, undefined);
  // A code rule: entered → a warning on the item; not entered → silence about items.
  const coded = [pct("K", 10, code(["VIP"]))];
  const entered = planCart(cartOf([line("A1", 100_00, 2, ["K#1:3"])], { enteredCodes: ["vip"] }), payloadOf(coded));
  assert.deepEqual(explainPlan(entered, "cs").map((i) => [i.tone, i.text]), [["warning", "Produkt: v košíku 2 ks, sleva platí od 3 ks."]]);
  const notEntered = planCart(cartOf([line("A1", 100_00, 2, ["K#1:3"])]), payloadOf(coded));
  assert.equal(outcome(notEntered, "K").state, "code_not_entered");
  assert.deepEqual(explainPlan(notEntered, "cs"), []);
});

test("engine: collections — the pieces of the collection count; a product in two targeted collections qualifies through ANY of them", () => {
  const rules = [pct("R", 10)];
  // Collection 1 from 5 pieces, collection 2 from 2; collection 3 has no own minimum.
  const both = ["R#1:5", "R#2:2"];
  const plan = planCart(
    cartOf([
      line("P1", 100_00, 1, both), // in 1 and 2
      line("P2", 100_00, 1, ["R#2:2"]), // in 2 only → collection 2 has 2 pieces
      line("P3", 100_00, 3, ["R#1:5"]), // in 1 only → collection 1 has 4 pieces: not reached
      line("P4", 100_00, 1, ["R", "R#1:5"]), // in 1 and in 3 (no own minimum): the common minimum (none) lets it in
      line("G", 100_00, 9, ["R#1:5"], { giftTierId: "g" }), // a gift line counts toward nothing
      line("O", 100_00, 1, ["R#1:5"], { outlet: true }), // an outlet line counts (5 pieces now) but gets no discount
    ]),
    payloadOf(rules),
  );
  // Collection 1: P1 1 + P3 3 + P4 1 + O 1 = 6 ≥ 5 → reached.
  assert.deepEqual(outcome(plan, "R").items, [
    { key: "1", minimum: 5, count: 6, reached: true, lineIds: ["P1", "P3", "P4", "O"] },
    { key: "2", minimum: 2, count: 2, reached: true, lineIds: ["P1", "P2"] },
  ]);
  assert.deepEqual(plan.lines.map((l) => l.product?.amount ?? 0), [10_00, 10_00, 30_00, 10_00, 0, 0]);

  // Collection 1 with 4 pieces only (P1 1 + P3 3): P3 loses the discount, P1 keeps it through collection 2.
  const fewer = planCart(cartOf([line("P1", 100_00, 1, both), line("P2", 100_00, 1, ["R#2:2"]), line("P3", 100_00, 3, ["R#1:5"])]), payloadOf(rules));
  assert.deepEqual(fewer.lines.map((l) => l.product?.amount ?? 0), [10_00, 10_00, 0]);
  assert.equal(outcome(fewer, "R").state, "applied");
  assert.deepEqual(explainPlan(fewer, "cs", { itemNames: { "1": "Léto" } }).map((i) => i.text).filter((t) => t.startsWith("Kolekce")), []);
});

test("engine: a collection rule names its item 'Kolekce'; the better discount still wins line by line", () => {
  const rules = [pct("R", 30, { target: { kind: "collections", ids: [] } }), pct("S", 10)];
  const plan = planCart(cartOf([line("P1", 100_00, 1, ["R#1:2", "S"]), line("P2", 100_00, 2, ["R#7:2", "S"])]), payloadOf(rules));
  // P1's collection has 1 piece: R does not apply there, S does; P2's has 2: R wins.
  assert.deepEqual(plan.lines.map((l) => [l.product?.ownerRuleId, l.product?.amount]), [["S", 10_00], ["R", 60_00]]);
  assert.ok(explainPlan(plan, "cs", { itemNames: { "1": "Léto" } }).some((i) => i.text === "Kolekce Léto: v košíku 1 ks, sleva platí od 2 ks."));
});

test("engine: an order rule ignores item refs; junk refs name no rule; a campaign's item refs count only while it re-targets", () => {
  const order = planCart(cartOf([line("L", 100_00, 1, ["O#1:5"])]), payloadOf([pct("O", 10, { target: { kind: "order" }, minimum: { quantity: 2 } })]));
  assert.equal(outcome(order, "O").state, "below_minimum", "the common minimum gates an order rule as always");
  assert.equal(outcome(order, "O").items, undefined);
  const junk = planCart(cartOf([line("L", 100_00, 1, ["R#", "R#1", "R#1:0", "R#1:x"])]), payloadOf([pct("R", 10)]));
  assert.equal(outcome(junk, "R").state, "no_target_lines");

  const campaigns = [{ id: "bf", name: "BF", window: { start: "2026-10-01T00:00:00", end: "2026-10-05T00:00:00" }, overrides: [{ ruleId: "R", patch: { target: products([P(1)], [{ id: P(1), quantity: 2 }]) } }], killed: false }];
  const config = configOf([pct("R", 10, { target: products([P(1)], [{ id: P(1), quantity: 5 }]) })], { campaigns });
  const payload = buildShopFunctionConfig(config, { now: "2026-10-02T12:00:00", shopTimezone: FIXTURE_TZ }).payload;
  const lines = [line("L", 100_00, 3, ["R#1:5", "R@bf#1:2"])];
  const live = planCart(cartOf(lines, { campaign: { id: "bf", active: true, varsVersion: payload.campaignVarsVersion } }), payload);
  assert.equal(discountOf(live, "L"), 30_00, "the campaign's minimum (2) applies");
  const idle = planCart(cartOf(lines), payload);
  assert.equal(discountOf(idle, "L"), 0, "the rule's own minimum (5) applies");
  assert.deepEqual(outcome(idle, "R").items, [{ key: "1", minimum: 5, count: 3, reached: false, lineIds: ["L"] }]);
});

test("plan gate: on Free a rule with per-item minimums is off — never the discount without them", () => {
  const config = configOf([
    pct("A", 10, { name: "Akce", target: products([P(1), P(2)], [{ id: P(1), quantity: 3 }]) }),
    pct("B", 10, { enabled: false, target: collections([C(1)], [{ id: C(1), quantity: 3 }]) }),
    pct("C", 10, { target: products([P(1)], []) }),
  ]);
  const pro = gateConfigForPlan(config, "pro");
  assert.deepEqual(pro.config, config);
  const free = gateConfigForPlan(config, "free");
  assert.deepEqual(free.stripped, [{ capability: "item_minimum_quantity", reason: "rule_off", ruleId: "A", name: "Akce" }]);
  const [a, b, c] = free.config.modules.codes.rules;
  assert.equal(a.enabled, false);
  assert.equal(b.enabled, false);
  assert.equal(c.enabled, true);
  assert.equal("itemMinimums" in a.target, false, "the minimums never reach a Free shop's product refs");
  assert.equal("itemMinimums" in b.target, false);
  assert.deepEqual(explainGate(free.stripped, "cs").map((e) => e.text), [
    "Sleva „Akce“ má minimum kusů u jednotlivých produktů nebo kolekcí. To je funkce Pro, ve Free se proto neuplatní vůbec.",
  ]);
  assert.match(explainGate(free.stripped, "en")[0].text, /minimum quantity for individual products or collections/);
  // The stored config is untouched.
  const stored = config.modules.codes.rules[0].target;
  assert.deepEqual(stored.kind === "products" ? stored.itemMinimums : null, [{ id: P(1), quantity: 3 }]);
  // The refs a Free shop gets: plain (and the rule is off, so they give nothing).
  const index = productRuleIndex(free.config, [{ productId: P(1), variantIds: [], collectionIds: [C(1)] }]);
  assert.deepEqual(index.get(P(1))?.ruleIds, ["A", "B", "C"]);

  // A campaign finishing on Free: a re-target with minimums switches its rule off; it cannot switch an off rule on.
  const window = { start: "2026-10-01T00:00:00", end: "2026-10-05T00:00:00" };
  const finishing = configOf([pct("A", 10, { target: products([P(1)], [{ id: P(1), quantity: 3 }]) }), pct("C", 10, { target: products([P(1)], []) })], {
    campaigns: [{ id: "bf", name: "BF", window, killed: false, overrides: [{ ruleId: "A", patch: { enabled: true } }, { ruleId: "C", patch: { target: products([P(2)], [{ id: P(2), quantity: 4 }]) } }] }],
  });
  const gated = gateConfigForPlan(finishing, "free", { now: "2026-10-02T00:00:00", finishing: ["bf"] }).config;
  assert.deepEqual(gated.campaigns[0].overrides, [
    { ruleId: "A", patch: {} },
    { ruleId: "C", patch: { target: { kind: "products", productIds: [P(2)], variantIds: [] }, enabled: false } },
  ]);
});

test("property: Free never gives a line more than the Pro setup (300 random carts)", () => {
  let seed = 20261006;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
  for (let run = 0; run < 300; run += 1) {
    const ids = [P(1), P(2), P(3)];
    const minimums = ids.filter(() => rnd(2) === 0).map((id) => ({ id, quantity: 1 + rnd(4) }));
    const config = configOf([
      pct("A", 5 + rnd(30), { target: products(ids, minimums), ...(rnd(2) ? { minimum: { quantity: 1 + rnd(6), scope: rnd(2) ? "entitled" : "cart" } } : {}) }),
      pct("B", 5 + rnd(10), { target: products(ids, []) }),
    ]);
    const catalog = ids.map((id) => ({ productId: id, variantIds: [], collectionIds: [] }));
    const lines = (cfg: typeof config) => {
      const index = productRuleIndex(cfg, catalog);
      return ids.map((id, i) => line(`L${i}`, 100_00, quantities[i], index.get(id)?.ruleIds ?? [], { productId: id })).filter((l) => l.quantity > 0);
    };
    const quantities = ids.map(() => rnd(6));
    const opts = { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ };
    const free = gateConfigForPlan(config, "free").config;
    const onPro = planCart(cartOf(lines(config)), buildShopFunctionConfig(config, opts).payload);
    const onFree = planCart(cartOf(lines(free)), buildShopFunctionConfig(free, opts).payload);
    for (const l of onFree.lines) assert.ok((l.product?.amount ?? 0) <= discountOf(onPro, l.lineId), `run ${run} line ${l.lineId}`);
  }
});

test("describe: the admin's parts for an item's minimum", () => {
  assert.equal(describeItemMinimum({ kind: "products", minimum: 3, name: "Tričko" }, "cs"), "Produkt Tričko od 3 ks");
  assert.equal(describeItemMinimum({ kind: "collections", minimum: 1 }, "en"), "Collection from 1 item");
  assert.equal(describeItemMinimumsSummary("products", 1, "cs"), "vlastní minimum u 1 produktu");
  assert.equal(describeItemMinimumsSummary("products", 3, "cs"), "vlastní minimum u 3 produktů");
  assert.equal(describeItemMinimumsSummary("collections", 2, "cs"), "vlastní minimum u 2 kolekcí");
  assert.equal(describeItemMinimumsSummary("collections", 1, "en"), "own minimum for 1 collection");
  assert.equal(describeItemMinimumsSummary("products", 0, "cs"), null);
  assert.equal(describeItemMinimumGap({ kind: "products", minimum: 4, count: 1, name: "B" }, "cs"), "Produkt B: v košíku 1 ks, sleva platí od 4 ks.");
});
