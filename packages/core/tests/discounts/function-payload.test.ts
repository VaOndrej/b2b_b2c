// The MVP 1 transport (C7 platí): ONE shared config in a shop metafield + small
// per-node variables (C4 keys always), tied together by the campaign varsVersion.

import assert from "node:assert/strict";
import { test } from "node:test";

import { codeHash } from "../../src/discounts/code-hash.ts";
import { CONFIG_LIMITS, DEFAULT_CONFIG, sanitizeConfig } from "../../src/discounts/config.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES, NO_CAMPAIGN_DATETIME } from "../../src/discounts/function-config.ts";
import {
  buildNodeVars,
  buildShopFunctionConfig,
  buildShopFunctionConfigWorstCase,
  campaignInputFromVars,
  encodeNodeVars,
  findCodeHashCollisions,
  FUNCTION_METAFIELD_LIMIT_BYTES,
  shopLocalDates,
  verifyShopFunctionConfig,
} from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, line, orderPct, pct } from "./engine-fixtures.ts";

const OPTS = { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ };

const CAMPAIGNS = [
  { id: "october", name: "Říjen", window: { start: "2026-10-01T00:00:00", end: "2026-10-31T23:59:59" }, overrides: [] },
  { id: "bf", name: "Black Friday", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" }, overrides: [] },
];

test("the shared config is the function subset, without node variables, target id lists or raw codes", () => {
  const config = configOf(
    [
      pct("p", 10, {
        target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: ["gid://shopify/ProductVariant/2"] },
        limits: { usageLimit: 5 },
        origin: { nativeId: "gid://shopify/DiscountCodeNode/1" },
        codes: ["IGNORED"],
      }),
      orderPct("c", 10, code(["VIP", "Léto"])),
    ],
    { markets: [{ handle: "cz", currency: "CZK", enabled: true }], locales: { cs: { a: "Doprava zdarma" } } },
  );
  const { payload, json } = buildShopFunctionConfig(config, OPTS);
  assert.deepEqual(Object.keys(payload).sort(), [
    "campaignId",
    "campaignVarsVersion",
    "campaigns",
    "engine",
    "marketCountries",
    "modules",
    "schemaVersion",
  ]);
  const [p, c] = payload.modules.codes.rules;
  assert.deepEqual(p.target, { kind: "products" });
  assert.ok(!("codeHashes" in p), "an automatic rule ships no codes");
  assert.deepEqual(c.codeHashes, [codeHash("VIP"), codeHash("LÉTO")]);
  for (const needle of ["gid://", "usageLimit", "origin", "campaignStart", "locales", "Doprava zdarma", "VIP", "LÉTO", "IGNORED"]) {
    assert.ok(!json.includes(needle), `shared config must not contain ${needle}`);
  }
});

// --- required inputs (no silent defaults) ------------------------------------------------------

test("`now` and `shopTimezone` are required and validated", () => {
  const config = configOf([]);
  const call = (opts: unknown) => () => buildShopFunctionConfig(config, opts as never);
  assert.throws(call(undefined), TypeError);
  assert.throws(call({ now: FIXTURE_NOW }), /shopTimezone/);
  assert.throws(call({ shopTimezone: FIXTURE_TZ }), /now/);
  assert.throws(call({ now: "2026-10-01", shopTimezone: FIXTURE_TZ }), /now/);
  assert.throws(call({ now: FIXTURE_NOW, shopTimezone: "Mars/Olympus" }), /shopTimezone/);
  assert.throws(() => buildNodeVars({ kind: "automatic" }, config, undefined as never), /now/);
});

// --- schedules → shop-local dates ----------------------------------------------------------------

test("shopLocalDates: UTC `Z` and offsets become the SHOP's calendar dates, east and west of UTC", () => {
  // Prague (CET +1 in November): local midnight 28 Nov = 27 Nov 23:00 Z.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-11-27T23:00:00Z" }, "Europe/Prague"), { startsOn: "2026-11-28" });
  assert.deepEqual(shopLocalDates({ startsAt: "2026-11-27T22:59:59Z" }, "Europe/Prague"), { startsOn: "2026-11-27" });
  // New York (EST −5): 1 Dec 04:59:59 Z is still 30 Nov there.
  assert.deepEqual(shopLocalDates({ endsAt: "2026-12-01T04:59:59Z" }, "America/New_York"), { endsOn: "2026-11-30" });
  // Tokyo (+9): 27 Nov 15:00 Z is local midnight 28 Nov.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-11-27T15:00:00Z" }, "Asia/Tokyo"), { startsOn: "2026-11-28" });
  // A string written with another offset is converted too: +01:00 midnight is 27 Nov 18:00 in New York.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-11-28T00:00:00+01:00" }, "America/New_York"), { startsOn: "2026-11-27" });
});

test("shopLocalDates: an end at exactly local midnight means the previous day was the last one", () => {
  assert.deepEqual(shopLocalDates({ endsAt: "2026-12-01T05:00:00Z" }, "America/New_York"), { endsOn: "2026-11-30" });
  assert.deepEqual(shopLocalDates({ endsAt: "2026-11-30T23:00:00Z" }, "Europe/Prague"), { endsOn: "2026-11-30" });
  assert.deepEqual(shopLocalDates({ endsAt: "2026-11-30T23:00:01Z" }, "Europe/Prague"), { endsOn: "2026-12-01" });
});

test("shopLocalDates is DST-safe (Prague summer time, and the spring-forward night)", () => {
  // CEST +2: local midnight 1 July = 30 June 22:00 Z.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-06-30T22:00:00Z" }, "Europe/Prague"), { startsOn: "2026-07-01" });
  assert.deepEqual(shopLocalDates({ endsAt: "2026-06-30T22:00:00Z" }, "Europe/Prague"), { endsOn: "2026-06-30" });
  // 29 March 2026 01:30 Z = 03:30 CEST, the same local day.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-03-29T01:30:00Z" }, "Europe/Prague"), { startsOn: "2026-03-29" });
  // New York fall-back night: 1 Nov 2026 05:30 Z = 00:30 EST on 1 Nov.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-11-01T05:30:00Z" }, "America/New_York"), { startsOn: "2026-11-01" });
});

test("the payload ships each rule's schedule as shop-local dates, and the engine gates on them", () => {
  const rule = pct("A", 10, { schedule: { startsAt: "2026-11-27T23:00:00Z", endsAt: "2026-11-30T23:00:00Z" } });
  const { payload } = buildShopFunctionConfig(configOf([rule]), OPTS);
  assert.deepEqual(payload.modules.codes.rules[0].schedule, { startsOn: "2026-11-28", endsOn: "2026-11-30" });
  const state = (today: string) => planCart(cartOf([line("L1", 100_00, 1, ["A"])], { today }), payload).rules[0].state;
  assert.equal(state("2026-11-27"), "not_started", "a UTC start never goes live a day early");
  assert.equal(state("2026-11-28"), "applied");
  assert.equal(state("2026-11-30"), "applied");
  assert.equal(state("2026-12-01"), "ended");
  const ny = buildShopFunctionConfig(configOf([rule]), { now: FIXTURE_NOW, shopTimezone: "America/New_York" }).payload;
  assert.deepEqual(ny.modules.codes.rules[0].schedule, { startsOn: "2026-11-27", endsOn: "2026-11-30" });
});

// --- codes: short stable hashes ----------------------------------------------------------------

test("codeHash: 8 hex chars, case/space-insensitive, stable", () => {
  assert.match(codeHash("VIP10"), /^[0-9a-f]{8}$/);
  assert.equal(codeHash(" vip10 "), codeHash("VIP10"));
  assert.notEqual(codeHash("VIP10"), codeHash("VIP11"));
  assert.equal(codeHash("KOD692739"), codeHash("KOD1029080"), "known FNV-1a collision (used below)");
});

test("500 codes in one rule fit the 9 000 B budget", () => {
  const codes = Array.from({ length: 500 }, (_, i) => `INFLUENCER-${String(i).padStart(4, "0")}-PODZIM2026`);
  const encoded = buildShopFunctionConfig(configOf([orderPct("r", 10, code(codes))]), OPTS);
  assert.equal(encoded.fits, true, `${encoded.bytes} B`);
  assert.equal(encoded.payload.modules.codes.rules[0].codeHashes?.length, 500);
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: ["influencer-0321-podzim2026"] }), encoded.payload);
  assert.equal(plan.order?.amount, 100_00);
});

test("findCodeHashCollisions: two different codes with one hash are reported (the admin refuses to save)", () => {
  const config = configOf([orderPct("a", 10, code(["KOD692739", "OK"])), orderPct("b", 10, code(["KOD1029080"]))]);
  assert.deepEqual(findCodeHashCollisions(config), [
    {
      hash: codeHash("KOD692739"),
      codes: [
        { code: "KOD692739", ruleId: "a" },
        { code: "KOD1029080", ruleId: "b" },
      ],
    },
  ]);
  assert.deepEqual(findCodeHashCollisions(configOf([orderPct("a", 10, code(["A", "B"]))])), []);
});

test("findCodeHashCollisions also checks the shop's other (native) codes", () => {
  const config = configOf([orderPct("a", 10, code(["KOD692739"]))]);
  assert.deepEqual(findCodeHashCollisions(config, ["kod1029080", "UNRELATED"]), [
    {
      hash: codeHash("KOD692739"),
      codes: [
        { code: "KOD692739", ruleId: "a" },
        { code: "KOD1029080", ruleId: null },
      ],
    },
  ]);
});

// --- markets → countries (Pro targeting without the deprecated market field) --------------------

test("marketCountries ships only enabled markets that some rule targets", () => {
  const config = configOf([orderPct("o", 10, { targeting: { markets: ["eu", "off"] } })], {
    markets: [
      { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
      { handle: "eu", currency: "EUR", enabled: true, countries: ["sk", "AT", "SK", "xx1"] },
      { handle: "off", currency: "EUR", enabled: false, countries: ["DE"] },
    ],
  });
  assert.deepEqual(buildShopFunctionConfig(config, OPTS).payload.marketCountries, { eu: ["SK", "AT"] });
});

// --- campaigns: only the selected one ships ------------------------------------------------------

test("only the selected campaign ships: the current one, else the next; none after the last", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  const at = (now: string) => buildShopFunctionConfig(config, { now, shopTimezone: FIXTURE_TZ }).payload;
  assert.deepEqual(at("2026-09-15T00:00:00").campaigns.map((c) => c.id), ["october"]);
  assert.deepEqual(at("2026-10-15T00:00:00").campaigns.map((c) => c.id), ["october"]);
  assert.deepEqual(at("2026-11-01T00:00:00").campaigns.map((c) => c.id), ["bf"]);
  assert.equal(at("2026-11-01T00:00:00").campaignId, "bf");
  assert.deepEqual(at("2027-01-01T00:00:00").campaigns, []);
  assert.equal(at("2027-01-01T00:00:00").campaignId, null);
});

test("forceNoCampaign: phase 1 of the 3-phase campaign sync ships no campaign and no version", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  const { payload } = buildShopFunctionConfig(config, { ...OPTS, now: "2026-10-15T00:00:00", forceNoCampaign: true });
  assert.equal(payload.campaignId, null);
  assert.equal(payload.campaignVarsVersion, null);
  assert.deepEqual(payload.campaigns, []);
  // Every node, whatever its variables, then plans without a campaign.
  const vars = buildNodeVars({ kind: "automatic" }, config, "2026-10-15T00:00:00");
  const plan = planCart(cartOf([line("L1", 100_00)], { campaign: campaignInputFromVars(vars, "2026-10-15T00:00:00") }), payload);
  assert.equal(plan.campaignId, null);
});

test("the worst case is the largest shared config over every campaign selection (and none)", () => {
  const long = "x".repeat(CONFIG_LIMITS.idLength);
  const config = sanitizeConfig({
    campaigns: [...CAMPAIGNS, { id: long, name: "", window: { start: "2026-12-01T00:00:00", end: "2026-12-02T00:00:00" }, overrides: [] }],
  }).config;
  const worst = buildShopFunctionConfigWorstCase(config);
  assert.equal(worst.campaignId, long);
  for (const now of ["2026-09-01T00:00:00", "2026-11-01T00:00:00", "2026-11-30T23:59:59", "2027-01-01T00:00:00"]) {
    assert.ok(buildShopFunctionConfig(config, { now, shopTimezone: FIXTURE_TZ }).bytes <= worst.bytes, now);
  }
});

test("bytes are UTF-8 and `fits` is the 9 000 B budget", () => {
  const encoded = buildShopFunctionConfig(DEFAULT_CONFIG, OPTS);
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
  assert.equal(buildShopFunctionConfig(config, OPTS).fits, true);
});

// --- node variables ------------------------------------------------------------------------------

test("node variables ALWAYS carry campaignStart/campaignEnd (C4), plus role, rule and varsVersion", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;
  assert.deepEqual(buildNodeVars({ kind: "automatic" }, DEFAULT_CONFIG, FIXTURE_NOW), {
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
    const shop = buildShopFunctionConfig(config, { now, shopTimezone: FIXTURE_TZ }).payload;
    const vars = buildNodeVars({ kind: "automatic" }, config, now);
    assert.deepEqual([vars.campaignId, vars.varsVersion], [shop.campaignId, shop.campaignVarsVersion], now);
  }
});

test("an edited window is a new version even with the same campaign id", () => {
  const before = sanitizeConfig({ campaigns: [CAMPAIGNS[1]] }).config;
  const after = sanitizeConfig({ campaigns: [{ ...CAMPAIGNS[1], window: { ...CAMPAIGNS[1].window, end: "2026-12-01T23:59:59" } }] }).config;
  assert.notEqual(
    buildNodeVars({ kind: "automatic" }, before, FIXTURE_NOW).varsVersion,
    buildNodeVars({ kind: "automatic" }, after, FIXTURE_NOW).varsVersion,
  );
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

test("planCart reads the shared config from its JSON exactly as the function will", () => {
  const { json } = buildShopFunctionConfig(configOf([pct("A", 10)]), OPTS);
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), JSON.parse(json));
  assert.equal(plan.lines[0].product?.amount, 100_00);
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
  const { payload, json } = buildShopFunctionConfig(config, OPTS);
  assert.deepEqual(payload.campaigns[0].overrides, [{ ruleId: "A", patch: { target: { kind: "collections" } } }]);
  assert.ok(!json.includes("gid://"));
});

// --- read-back verification for the sync layer ---------------------------------------------

test("verifyShopFunctionConfig: ok for a built payload, with its byte count", () => {
  const { json, bytes } = buildShopFunctionConfig(configOf([pct("A", 10)]), OPTS);
  assert.deepEqual(verifyShopFunctionConfig(json), { ok: true, bytes });
  assert.equal(verifyShopFunctionConfig(JSON.parse(json)).ok, true, "a read-back jsonValue works too");
});

test("verifyShopFunctionConfig: names what is wrong", () => {
  const { payload } = buildShopFunctionConfig(configOf([pct("A", 10)]), OPTS);
  assert.deepEqual(verifyShopFunctionConfig("{nope"), { ok: false, bytes: 5, reason: "not_json" });
  assert.equal((verifyShopFunctionConfig(null) as { reason: string }).reason, "invalid_shape");
  assert.equal((verifyShopFunctionConfig({ modules: {} }) as { reason: string }).reason, "invalid_shape");
  assert.equal((verifyShopFunctionConfig({ ...payload, campaignVarsVersion: 5 }) as { reason: string }).reason, "invalid_shape");
  const base = JSON.stringify(payload).length;
  const padded = { ...payload, pad: "x".repeat(9500 - base) }; // ~9 500 B: readable, but over the 9 000 B budget
  assert.equal((verifyShopFunctionConfig(padded) as { reason: string }).reason, "over_budget");
  const huge = { ...payload, pad: "x".repeat(10_001) };
  assert.equal((verifyShopFunctionConfig(huge) as { reason: string }).reason, "too_large");
});
