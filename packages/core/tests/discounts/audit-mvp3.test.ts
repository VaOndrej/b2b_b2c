// MVP 3 audit fixes in core (audit-mvp3.md, audit-fix-core-brief.md):
//   - P3-2: an invalid tier `scope` is an INERT scoped set (empty selection), never "global";
//   - P3-5: margin collections over CONFIG_LIMITS.marginOverrides fold into the global
//     setting (the strictest wins, as plan-gate.ts folds them on Free) — never dropped;
//   - the tier payload cap (controller ruling): `modules.tiers` in the shop config is at most
//     CONFIG_LIMITS.tierPayloadBytes (550 B), the stored AND the Free-gated config; over it
//     the config does not fit (save refuses it, the sync never ships it), with its own figures.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase } from "../../src/discounts/function-payload.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";

const C = (n: number) => `gid://shopify/Collection/${n}`;
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" };
const utf8 = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

// --- P3-2 ------------------------------------------------------------------------------------------

test("P3-2: an invalid tier scope becomes an inert scoped set (no product, no collection) with an issue — never the global set", () => {
  for (const scope of ["everything", 7, null, ["global"], undefined]) {
    const { config, issues } = sanitizeConfig({
      modules: { tiers: { sets: [{ id: "t", scope, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } },
    });
    assert.deepEqual(config.modules.tiers.sets[0].scope, {}, JSON.stringify(scope));
    assert.deepEqual(issues.map((i) => [i.path, i.code, i.params ?? null]), [["modules.tiers.sets[0].scope", "invalid_tier_scope", null]], JSON.stringify(scope));
  }
  // The result is stable (sanitized again: no issue) and no product reaches it.
  const { config } = sanitizeConfig({ modules: { tiers: { sets: [{ id: "t", scope: 7, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } } });
  assert.deepEqual(sanitizeConfig(config).issues, []);
  assert.deepEqual(buildShopFunctionConfig(config, OPTS).payload.modules.tiers, { sets: [] });
});

// --- P3-5 ------------------------------------------------------------------------------------------

test("P3-5: margin collections over the limit fold into the global setting (strictest wins), never dropped", () => {
  const max = CONFIG_LIMITS.marginOverrides;
  const perCollection = [
    ...Array.from({ length: max }, (_, i) => ({ collectionId: C(i), maxDiscountPercent: 40 })),
    { collectionId: C(900), maxDiscountPercent: 15 },
    { collectionId: C(901), minMarginPercent: 30 },
    { collectionId: C(902), maxDiscountPercent: 70, minMarginPercent: 5 },
  ];
  const { config, issues } = sanitizeConfig({
    modules: { margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perCollection } },
  });
  const margin = config.modules.margin;
  assert.equal(margin.perCollection.length, max);
  assert.deepEqual(margin.global, { maxDiscountPercent: 15, minMarginPercent: 30 });
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.margin.perCollection", "margin_overrides_folded", { max, count: 3, maxDiscountPercent: 15, minMarginPercent: 30 }],
  ]);
  // A global minimum that was not set stays unset unless an extra collection sets one.
  const noMin = sanitizeConfig({
    modules: { margin: { global: { maxDiscountPercent: 50 }, perCollection: [...perCollection.slice(0, max), { collectionId: C(903), maxDiscountPercent: 60 }] } },
  });
  assert.deepEqual(noMin.config.modules.margin.global, { maxDiscountPercent: 50 });
  assert.deepEqual(noMin.issues[0].params, { max, count: 1, maxDiscountPercent: 50, minMarginPercent: 0 });
  assert.deepEqual(sanitizeConfig(config).issues, [], "idempotent");
});

// --- the tier payload cap ----------------------------------------------------------------------------

/** Percent sets, each listing one product, to fill `modules.tiers` toward a byte size. */
function percentSets(n: number, countAcross = "product") {
  return Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? "global" : `t_${String(i).padStart(20, "0")}`,
    scope: i === 0 ? "global" : { productIds: [`gid://shopify/Product/${i}`] },
    countAcross,
    breaks: [{ minQty: 2, percent: 5 }, { minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }],
  }));
}

test("CONFIG_LIMITS.tierPayloadBytes is 550 B (controller ruling on the measured function budget)", () => {
  assert.equal(CONFIG_LIMITS.tierPayloadBytes, 550);
});

test("the shop config reports its tier bytes; over the cap it does not fit, whatever room the 9 000 B budget has", () => {
  const fitting = sanitizeConfig({ modules: { tiers: { sets: percentSets(8) } } }).config;
  const encoded = buildShopFunctionConfig(fitting, OPTS);
  assert.equal(encoded.tiers.bytes, utf8(encoded.payload.modules.tiers));
  assert.deepEqual([encoded.tiers.budget, encoded.tiers.fits, encoded.fits], [550, true, true]);
  assert.ok(encoded.tiers.bytes <= 550 && encoded.tiers.bytes > 450, String(encoded.tiers.bytes));

  const over = sanitizeConfig({ modules: { tiers: { sets: percentSets(9) } } }).config;
  const big = buildShopFunctionConfig(over, OPTS);
  assert.ok(big.bytes < 9000, "far under the whole budget");
  assert.ok(big.tiers.bytes > 550);
  assert.deepEqual([big.tiers.fits, big.fits], [false, false]);
  assert.equal(buildShopFunctionConfigWorstCase(over).fits, false, "save refuses it");
});

test("the save-time worst case measures the tiers of the Free-gated config too (its cart → product counting is 3 B longer)", () => {
  // A cart-counting global set, and scoped sets without breaks (Free leaves them as they are), sized 1–3 B under
  // the cap: the stored config fits, the Free-gated one (global set counted per product) does not.
  let config = null as ReturnType<typeof sanitizeConfig>["config"] | null;
  for (let pad = 0; pad < 100 && !config; pad++) {
    const sets = [{ ...percentSets(1, "cart")[0] }, ...percentSets(12, "line").slice(1).map((set) => ({ ...set, breaks: [] }))];
    sets[1] = { ...sets[1], id: `t_${"x".repeat(pad)}` };
    const candidate = sanitizeConfig({ modules: { tiers: { sets } } }).config;
    const bytes = buildShopFunctionConfig(candidate, OPTS).tiers.bytes;
    if (bytes > 547 && bytes <= 550) config = candidate;
  }
  assert.ok(config, "a config 1–3 B under the cap");
  const stored = buildShopFunctionConfig(config!, OPTS);
  const gated = buildShopFunctionConfig(gateConfigForPlan(config!, "free").config, OPTS);
  assert.equal(gated.tiers.bytes, stored.tiers.bytes + 3);
  assert.deepEqual([stored.tiers.fits, gated.tiers.fits], [true, false]);
  const worst = buildShopFunctionConfigWorstCase(config!);
  assert.deepEqual([worst.tiers.bytes, worst.tiers.fits, worst.fits], [gated.tiers.bytes, false, false]);
});
