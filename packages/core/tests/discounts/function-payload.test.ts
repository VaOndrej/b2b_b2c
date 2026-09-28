// The MVP 1 transport (C7 platí): ONE shared config in a shop metafield + small
// per-node variables (C4 keys always), tied together by the campaign varsVersion.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, DEFAULT_CONFIG, sanitizeConfig } from "../../src/discounts/config.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES, NO_CAMPAIGN_DATETIME } from "../../src/discounts/function-config.ts";
import {
  buildNodeVars,
  buildShopFunctionConfig,
  buildShopFunctionConfigWorstCase,
  campaignInputFromVars,
  encodeNodeVars,
  FUNCTION_METAFIELD_LIMIT_BYTES,
  verifyShopFunctionConfig,
} from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, line, orderPct, pct } from "./engine-fixtures.ts";

const CAMPAIGNS = [
  { id: "october", name: "Říjen", window: { start: "2026-10-01T00:00:00", end: "2026-10-31T23:59:59" }, overrides: [] },
  { id: "bf", name: "Black Friday", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" }, overrides: [] },
];

test("the shared config is the function subset, without node variables and without target id lists", () => {
  const config = configOf(
    [
      pct("p", 10, {
        target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: ["gid://shopify/ProductVariant/2"] },
        limits: { usageLimit: 5 },
        origin: { nativeId: "gid://shopify/DiscountCodeNode/1" },
        codes: ["IGNORED"],
      }),
      orderPct("c", 10, code(["VIP"])),
    ],
    { markets: [{ handle: "cz", currency: "CZK", enabled: true }], locales: { cs: { a: "Doprava zdarma" } } },
  );
  const { payload, json } = buildShopFunctionConfig(config);
  assert.deepEqual(Object.keys(payload).sort(), [
    "campaignId",
    "campaignVarsVersion",
    "campaigns",
    "engine",
    "modules",
    "schemaVersion",
  ]);
  const [p, c] = payload.modules.codes.rules;
  assert.deepEqual(p.target, { kind: "products" });
  assert.ok(!("codes" in p), "an automatic rule ships no codes");
  assert.deepEqual(c.codes, ["VIP"]);
  for (const needle of ["gid://", "usageLimit", "origin", "campaignStart", "locales", "Doprava zdarma", "markets"]) {
    assert.ok(!json.includes(needle), `shared config must not contain ${needle}`);
  }
});

test("bytes are UTF-8 and `fits` is the 9 000 B budget", () => {
  const encoded = buildShopFunctionConfig(DEFAULT_CONFIG);
  assert.equal(encoded.bytes, new TextEncoder().encode(encoded.json).length);
  assert.equal(encoded.fits, encoded.bytes <= FUNCTION_CONFIG_BUDGET_BYTES);
  assert.equal(FUNCTION_CONFIG_BUDGET_BYTES, 9000);
  assert.equal(FUNCTION_METAFIELD_LIMIT_BYTES, 10_000);
});

test("stripping target lists is what lets many targeted rules fit the budget", () => {
  const ids = Array.from({ length: 200 }, (_, i) => `gid://shopify/Product/${1_000_000_000 + i}`);
  const config = configOf(
    Array.from({ length: 5 }, (_, i) => pct(`r${i}`, 10, { target: { kind: "products", productIds: ids, variantIds: [] } })),
  );
  assert.equal(buildShopFunctionConfig(config).fits, true);
});

test("the worst case is the largest payload over every campaign selection (and none)", () => {
  const long = "x".repeat(CONFIG_LIMITS.idLength);
  const config = sanitizeConfig({
    campaigns: [...CAMPAIGNS, { id: long, name: "", window: { start: "2026-12-01T00:00:00", end: "2026-12-02T00:00:00" }, overrides: [] }],
  }).config;
  const worst = buildShopFunctionConfigWorstCase(config);
  assert.equal(worst.campaignId, long);
  for (const id of [null, "october", "bf", long]) {
    assert.ok(buildShopFunctionConfig(config, { campaignId: id }).bytes <= worst.bytes);
  }
});

test("node variables ALWAYS carry campaignStart/campaignEnd (C4), plus role, rule and varsVersion", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  assert.deepEqual(buildNodeVars({ kind: "automatic" }, DEFAULT_CONFIG), {
    role: "automatic",
    campaignId: null,
    campaignStart: NO_CAMPAIGN_DATETIME,
    campaignEnd: NO_CAMPAIGN_DATETIME,
    varsVersion: null,
  });
  const vars = buildNodeVars({ kind: "code", ruleId: "r1" }, config, "2026-11-28T10:00:00");
  assert.deepEqual(
    [vars.role, vars.ruleId, vars.campaignId, vars.campaignStart, vars.campaignEnd],
    ["code", "r1", "bf", "2026-11-27T00:00:00", "2026-11-30T23:59:59"],
  );
  assert.match(String(vars.varsVersion), /^v[0-9a-z]+$/);
  const after = buildNodeVars({ kind: "automatic" }, config, "2027-01-01T00:00:00");
  assert.deepEqual([after.campaignStart, after.campaignEnd, after.campaignId], [NO_CAMPAIGN_DATETIME, NO_CAMPAIGN_DATETIME, null]);
});

test("node variables and the shop config built at the same `now` carry the same campaign + version", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  for (const now of ["2026-09-01T00:00:00", "2026-11-28T10:00:00", "2027-01-01T00:00:00"]) {
    const shop = buildShopFunctionConfig(config, now).payload;
    const vars = buildNodeVars({ kind: "automatic" }, config, now);
    assert.deepEqual([vars.campaignId, vars.varsVersion], [shop.campaignId, shop.campaignVarsVersion], now);
  }
});

test("an edited window is a new version even with the same campaign id", () => {
  const before = sanitizeConfig({ campaigns: [CAMPAIGNS[1]] }).config;
  const after = sanitizeConfig({ campaigns: [{ ...CAMPAIGNS[1], window: { ...CAMPAIGNS[1].window, end: "2026-12-01T23:59:59" } }] }).config;
  assert.notEqual(buildNodeVars({ kind: "automatic" }, before).varsVersion, buildNodeVars({ kind: "automatic" }, after).varsVersion);
});

test("worst-case node variables (64-char ids) stay small", () => {
  const id = "x".repeat(CONFIG_LIMITS.idLength);
  const config = sanitizeConfig({
    campaigns: [{ id, name: "", window: { start: "2026-10-01T00:00:00", end: "2026-10-31T23:59:59" }, overrides: [] }],
  }).config;
  const vars = buildNodeVars({ kind: "code", ruleId: id }, config, "2026-10-02T00:00:00");
  assert.ok(encodeNodeVars(vars).bytes < 400, String(encodeNodeVars(vars).bytes));
});

test("campaignInputFromVars mirrors dateTimeBetween for the admin simulation", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  const vars = buildNodeVars({ kind: "automatic" }, config, "2026-11-01T00:00:00");
  assert.deepEqual(campaignInputFromVars(vars, "2026-11-26T23:59:59"), { id: "bf", active: false, varsVersion: vars.varsVersion });
  assert.equal(campaignInputFromVars(vars, "2026-11-27T00:00:00").active, true);
  assert.equal(campaignInputFromVars(vars, "2026-11-30T23:59:59").active, false);
});

test("`now` drops campaigns that already ended from the shared config (they can never apply again)", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  const all = buildShopFunctionConfig(config);
  const later = buildShopFunctionConfig(config, "2026-11-01T00:00:00");
  assert.deepEqual(all.payload.campaigns.map((c) => c.id), ["october", "bf"]);
  assert.deepEqual(later.payload.campaigns.map((c) => c.id), ["bf"]);
  assert.ok(later.bytes < all.bytes);
});

test("planCart reads the shared config from its JSON exactly as the function will", () => {
  const { json } = buildShopFunctionConfig(configOf([pct("A", 10)]));
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), JSON.parse(json));
  assert.equal(plan.lines[0].product?.amount, 100_00);
});

// --- read-back verification for the sync layer ---------------------------------------------

test("verifyShopFunctionConfig: ok for a built payload, with its byte count", () => {
  const { json, bytes } = buildShopFunctionConfig(configOf([pct("A", 10)]));
  assert.deepEqual(verifyShopFunctionConfig(json), { ok: true, bytes });
  assert.equal(verifyShopFunctionConfig(JSON.parse(json)).ok, true, "a read-back jsonValue works too");
});

test("verifyShopFunctionConfig: names what is wrong", () => {
  const { payload } = buildShopFunctionConfig(configOf([pct("A", 10)]));
  assert.equal(verifyShopFunctionConfig("{nope").ok, false);
  assert.deepEqual(verifyShopFunctionConfig("{nope"), { ok: false, bytes: 5, reason: "not_json" });
  assert.equal(verifyShopFunctionConfig(null).ok, false);
  assert.equal((verifyShopFunctionConfig(null) as { reason: string }).reason, "invalid_shape");
  assert.equal((verifyShopFunctionConfig({ modules: {} }) as { reason: string }).reason, "invalid_shape");
  assert.equal((verifyShopFunctionConfig({ ...payload, campaignVarsVersion: 5 }) as { reason: string }).reason, "invalid_shape");
  const base = JSON.stringify(payload).length;
  const padded = { ...payload, pad: "x".repeat(9500 - base) }; // ~9 500 B: readable, but over the 9 000 B budget
  assert.equal((verifyShopFunctionConfig(padded) as { reason: string }).reason, "over_budget");
  const huge = { ...payload, pad: "x".repeat(10_001) };
  assert.equal((verifyShopFunctionConfig(huge) as { reason: string }).reason, "too_large");
});

test("a campaign patch that re-targets a rule ships without id lists (lines carry campaign-scoped refs)", () => {
  const config = sanitizeConfig({
    modules: { codes: { rules: [pct("A", 10)] } },
    campaigns: [
      {
        ...CAMPAIGNS[1],
        overrides: [{ ruleId: "A", patch: { target: { kind: "collections", ids: ["gid://shopify/Collection/9"] } } }],
      },
    ],
  }).config;
  const { payload, json } = buildShopFunctionConfig(config);
  assert.deepEqual(payload.campaigns[0].overrides, [{ ruleId: "A", patch: { target: { kind: "collections" } } }]);
  assert.ok(!json.includes("gid://"));
});
