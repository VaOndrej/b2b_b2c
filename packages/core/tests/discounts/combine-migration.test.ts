// "Before and after" (docs/won-discounts/navrh-kombinace-2026-10-13.md, "Převod stávajících obchodů"): shops
// stored with the four category switches and `combinesWith` (schema 1) are converted to lists of types and
// exceptions, and NO CART GETS MORE than the engine before the change gave it.
//
// The carts and what the old engine gave them are frozen (combine-migration-cases.ts,
// fixtures/combine-before.json). Run with COMBINE_DIFF=1 to print every cart that changed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { combineAddUp, combineEntities, combineMismatches } from "../../src/discounts/combine-config.ts";
import { readStoredConfig, sanitizeConfig } from "../../src/discounts/config.ts";
import { migrateCombineV1 } from "../../src/discounts/config/combine-migrate.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { type CombineResult, combineCases, combineResultOf } from "./combine-migration-cases.ts";

type Frozen = [number[], number, string | null, string[], number];
const BEFORE = JSON.parse(readFileSync(new URL("./fixtures/combine-before.json", import.meta.url), "utf8")) as Frozen[];
const CASES = combineCases();
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" };

function after(index: number): CombineResult {
  const { config, plan, cart } = CASES[index];
  const stored = readStoredConfig(config);
  const payload = buildShopFunctionConfig(gateConfigForPlan(stored, plan).config, OPTS).payload;
  const planned = planCart(cart, payload);
  assert.equal(planned.reason, undefined, `case ${index}: ${planned.reason} ${planned.error ?? ""}`);
  return combineResultOf(planned);
}

test("the frozen results belong to these cases", () => {
  assert.equal(BEFORE.length, CASES.length);
  assert.equal(BEFORE.length, 1200);
});

test("after the conversion no cart pays less than before, gets a gift it did not get, or gets shipping on top of what it had", () => {
  const changed: string[] = [];
  let less = 0;
  let traded = 0;
  const marginMore: number[] = [];
  CASES.forEach(({ config }, i) => {
    const [, , shipping, gifts, total] = BEFORE[i];
    const now = after(i);
    const marginOn = ((config.modules as { margin?: { enabled?: boolean } }).margin?.enabled ?? false) === true;
    if (now.total < total) {
      // Margin protection only: "the better of the two" may now be the order discount ALONE, and protection
      // lets that one use the lines' headroom better than the old sum did. Still above every floor.
      assert.ok(marginOn, `case ${i}: pays ${now.total}, paid ${total} — less, without margin protection`);
      marginMore.push(i);
    }
    for (const gift of now.gifts) assert.ok(gifts.includes(gift), `case ${i}: the gift ${gift} is free now and was not before`);
    if (now.shipping && !shipping) {
      // Shipping instead of a discount it could not go with: allowed only when the cart gave a price discount up for it.
      assert.ok(now.total > total, `case ${i}: a shipping discount on top of everything the cart had before`);
      traded++;
    }
    if (now.total > total || (!now.shipping && shipping) || now.gifts.length < gifts.length) less++;
    if (process.env.COMBINE_DIFF && (now.total !== total || now.shipping !== shipping || now.gifts.length !== gifts.length)) {
      changed.push(`#${i} ${CASES[i].plan}: total ${total} → ${now.total}, shipping ${shipping} → ${now.shipping}, gifts [${gifts}] → [${now.gifts}]`);
    }
  });
  if (process.env.COMBINE_DIFF) console.log(changed.join("\n"));
  console.log(`combine before/after: ${CASES.length} carts, ${less} get less, ${traded} trade a price discount for shipping, ${marginMore.length} get more under margin protection (${marginMore.join(", ")})`);
  // The one known cart (margin protection on): a new one must be looked at, not waved through.
  assert.deepEqual(marginMore, [825]);
});

test("a shop that never touched the switches and has one kind of discount converts exactly", () => {
  let exact = 0;
  CASES.forEach(({ config }, i) => {
    const rules = ((config.modules as { codes: { rules: { id: string; target: { kind: string }; combinesWith?: unknown }[] } }).codes.rules);
    const c = (config.engine as { combination: Record<string, unknown> }).combination;
    const defaults = c.productWithOrder === true && c.productWithShipping === true && c.orderWithShipping === true && c.outletWithAnything === false;
    // No two rules of one class, no Milníky discount: every pair that added up was of two different classes.
    const classes = rules.map((r) => r.target.kind);
    const simple = defaults && new Set(classes).size === classes.length && !rules.some((r) => r.id.startsWith("ms-") || r.combinesWith) && !(config.modules as { tiers?: unknown }).tiers;
    if (!simple) return;
    exact++;
    const [lines, order, shipping, gifts, total] = BEFORE[i];
    assert.deepEqual(after(i), { lines, order, shipping, gifts, total }, `case ${i}`);
  });
  assert.ok(exact > 50, `only ${exact} simple shops among the cases`);
});

test("the converted config has no mismatch, and every pair it adds up added up before", () => {
  const seen = new Set<unknown>();
  for (const { config } of CASES) {
    if (seen.has(config)) continue;
    seen.add(config);
    const stored = readStoredConfig(config);
    assert.deepEqual(combineMismatches(stored), []);
    assert.equal(stored.schemaVersion, 2);
    // Stable: converting is done once, a second read changes nothing.
    assert.deepEqual(readStoredConfig(stored), stored);
    assert.deepEqual(sanitizeConfig(stored).issues, []);
    // `lost` names exactly the pairs of the config's discounts that stopped adding up.
    const { lost, lostCount } = migrateCombineV1(config);
    assert.equal(lost.length, lostCount);
    const entities = combineEntities(stored);
    const byId = new Map(entities.map((e) => [e.id, e]));
    for (const pair of lost) {
      const a = byId.get(pair.a);
      const b = byId.get(pair.b);
      assert.ok(a && b, `lost pair names ${pair.a} / ${pair.b}`);
      // On Pro an exception keeps the pair; without one it is gone on every plan.
      assert.equal(combineAddUp(a, b), pair.exception, `${pair.a} + ${pair.b}`);
    }
  }
});

test("below Pro the exceptions go, so those pairs stop adding up too", () => {
  const { config } = CASES.find(({ config: c }) => migrateCombineV1(c).lost.some((p) => p.exception))!;
  const stored = readStoredConfig(config);
  const pair = migrateCombineV1(config).lost.find((p) => p.exception)!;
  const sides = (plan: "free" | "pro") => {
    const entities = combineEntities(gateConfigForPlan(stored, plan).config);
    return combineAddUp(entities.find((e) => e.id === pair.a)!, entities.find((e) => e.id === pair.b)!);
  };
  assert.equal(sides("pro"), true);
  assert.equal(sides("free"), false);
});
