import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, DEFAULT_CONFIG, sanitizeConfig } from "../../src/discounts/config.ts";
import type { WonDiscountsConfig } from "../../src/discounts/config.ts";
import {
  encodeFunctionConfig,
  FUNCTION_CONFIG_BUDGET_BYTES,
} from "../../src/discounts/function-config.ts";

test("the default config fits comfortably under the function budget", () => {
  const encoded = encodeFunctionConfig(DEFAULT_CONFIG);
  assert.equal(encoded.fits, true);
  assert.ok(encoded.bytes < FUNCTION_CONFIG_BUDGET_BYTES);
});

function configWithNRules(n: number): WonDiscountsConfig {
  const { config } = sanitizeConfig({
    modules: {
      codes: {
        rules: Array.from({ length: n }, (_, i) => ({
          id: `rule-${i}`,
          enabled: true,
          name: `Discount rule number ${i} with a reasonably descriptive name`,
          method: "automatic",
          value: { kind: "percentage", percent: 10 },
          target: { kind: "order" },
        })),
      },
    },
  });
  return config;
}

test("the rule cap alone does not keep a config under the 9000 B budget (saveConfig must check fits)", () => {
  const encoded = encodeFunctionConfig(configWithNRules(CONFIG_LIMITS.rules));
  assert.equal(encoded.fits, false);
  assert.ok(encoded.bytes > FUNCTION_CONFIG_BUDGET_BYTES);
});

test("bytes are counted as UTF-8, not UTF-16 code units", () => {
  const ascii = configWithNRules(0);
  const withAscii: WonDiscountsConfig = {
    ...ascii,
    modules: {
      ...ascii.modules,
      codes: {
        rules: [
          {
            id: "r1",
            enabled: true,
            name: "Kc",
            method: "automatic",
            value: { kind: "percentage", percent: 10 },
            target: { kind: "order" },
          },
        ],
      },
    },
  };
  const withNonAscii: WonDiscountsConfig = {
    ...withAscii,
    modules: {
      ...withAscii.modules,
      codes: {
        rules: [{ ...withAscii.modules.codes.rules[0], name: "Kč" }],
      },
    },
  };

  const encAscii = encodeFunctionConfig(withAscii);
  const encNonAscii = encodeFunctionConfig(withNonAscii);

  // "Kc" and "Kč" are the same JS string length (2 UTF-16 code units)...
  assert.equal(encAscii.json.length, encNonAscii.json.length);
  // ...but "č" is 2 bytes in UTF-8 vs "c"'s 1 byte, so the byte count must differ.
  assert.equal(encNonAscii.bytes - encAscii.bytes, 1);
});

// --- Audit P1-2: the function payload is the function-relevant subset + C4 keys --------------

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function parsePayload(c: Parameters<typeof encodeFunctionConfig>[0], opts?: Parameters<typeof encodeFunctionConfig>[1]) {
  return JSON.parse(encodeFunctionConfig(c, opts).json) as Record<string, unknown>;
}

test("the payload ALWAYS carries top-level campaignStart/campaignEnd; 1970 for both without a campaign (C4)", () => {
  const payload = parsePayload(DEFAULT_CONFIG);
  assert.equal(payload.campaignStart, "1970-01-01T00:00:00");
  assert.equal(payload.campaignEnd, "1970-01-01T00:00:00");
  assert.equal(payload.campaignId, null);
});

const CAMPAIGNS = [
  { id: "october", name: "Říjen", window: { start: "2026-10-01T00:00:00", end: "2026-10-31T23:59:59" }, overrides: [], killed: false },
  { id: "bf", name: "Black Friday", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" }, overrides: [], killed: false },
  { id: "xmas", name: "Vánoce", window: { start: "2026-12-20T00:00:00", end: "2026-12-24T12:00:00" }, overrides: [], killed: false },
];

test("campaign keys carry the current-or-next live campaign window in shop-local time", () => {
  const config = sanitizeConfig({ campaigns: CAMPAIGNS }).config;

  const during = parsePayload(config, { now: "2026-11-28T10:00:00" });
  assert.deepEqual([during.campaignStart, during.campaignEnd, during.campaignId], ["2026-11-27T00:00:00", "2026-11-30T23:59:59", "bf"]);

  const between = parsePayload(config, { now: "2026-12-01T00:00:00" });
  assert.equal(between.campaignId, "xmas");

  const afterAll = parsePayload(config, { now: "2027-01-01T00:00:00" });
  assert.deepEqual([afterAll.campaignStart, afterAll.campaignEnd, afterAll.campaignId], ["1970-01-01T00:00:00", "1970-01-01T00:00:00", null]);

  const noNow = parsePayload(config);
  assert.equal(noNow.campaignId, "october", "without `now` the earliest live window is used");
  for (const p of [during, between, afterAll, noNow]) {
    assert.match(String(p.campaignStart), LOCAL_DATETIME);
    assert.match(String(p.campaignEnd), LOCAL_DATETIME);
  }
});

test("a killed campaign is never selected and never shipped to the function", () => {
  const config = sanitizeConfig({
    campaigns: CAMPAIGNS.map((c) => (c.id === "bf" ? { ...c, killed: true } : c)),
  }).config;
  const payload = parsePayload(config, { now: "2026-11-28T10:00:00" });
  assert.equal(payload.campaignId, "xmas");
  assert.deepEqual((payload.campaigns as Array<{ id: string }>).map((c) => c.id), ["october", "xmas"]);
});

test("a hand-built config with a malformed window still yields valid 1970 keys (defence in depth)", () => {
  const config: WonDiscountsConfig = {
    ...sanitizeConfig({}).config,
    campaigns: [{ id: "bad", name: "", window: { start: "garbage", end: "2026-13-45" }, overrides: [], killed: false }],
  };
  const payload = parsePayload(config);
  assert.equal(payload.campaignStart, "1970-01-01T00:00:00");
  assert.equal(payload.campaignEnd, "1970-01-01T00:00:00");
});

test("the payload is only the function subset: no locales, storefront, onboarding or markets", () => {
  const payload = parsePayload(
    sanitizeConfig({
      markets: [{ handle: "cz", currency: "CZK", enabled: true }],
      locales: { cs: { banner: "Doprava zdarma od 1 500 Kč" } },
      storefront: { appearancePreset: "bold" },
      onboarding: { goals: ["aov"], step: 3 },
    }).config,
  );
  assert.deepEqual(Object.keys(payload).sort(), [
    "campaignEnd",
    "campaignId",
    "campaignStart",
    "campaigns",
    "engine",
    "modules",
    "schemaVersion",
  ]);
  assert.deepEqual(Object.keys(payload.modules as object).sort(), ["codes", "margin", "rewards", "tiers"]);
  const json = JSON.stringify(payload);
  for (const needle of ["locales", "storefront", "onboarding", "markets", "Doprava zdarma", "bold"]) {
    assert.ok(!json.includes(needle), `payload must not contain ${needle}`);
  }
});

test("storefront texts never count against the function budget", () => {
  const base = sanitizeConfig({ modules: { codes: { rules: [{ id: "r1", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } } }).config;
  const withTexts = sanitizeConfig({
    ...base,
    locales: Object.fromEntries(
      ["cs", "sk", "en"].map((l) => [l, Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, "x".repeat(400)]))]),
    ),
  }).config;
  assert.equal(encodeFunctionConfig(withTexts).bytes, encodeFunctionConfig(base).bytes);
  assert.equal(encodeFunctionConfig(withTexts).fits, true);
});

test("rules ship without admin-only fields (origin, limits) but keep what the engine reads", () => {
  const config = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          {
            id: "r1",
            name: "VIP",
            method: "code",
            codes: ["VIP"],
            value: { kind: "percentage", percent: 15 },
            target: { kind: "order" },
            minimum: { subtotal: { CZK: 1000_00 } },
            limits: { usageLimit: 100, oncePerCustomer: true },
            origin: { nativeId: "gid://shopify/DiscountCodeNode/1" },
          },
        ],
      },
    },
  }).config;
  const payload = parsePayload(config);
  const [shipped] = (payload.modules as { codes: { rules: Record<string, unknown>[] } }).codes.rules;
  assert.equal(shipped.id, "r1");
  assert.deepEqual(shipped.codes, ["VIP"]);
  assert.deepEqual(shipped.value, { kind: "percentage", percent: 15 });
  assert.deepEqual(shipped.minimum, { subtotal: { CZK: 1000_00 } });
  assert.ok(!("origin" in shipped));
  assert.ok(!("limits" in shipped));
});

test("bytes is the UTF-8 length of json and fits is bytes <= budget", () => {
  for (const config of [DEFAULT_CONFIG, configWithNRules(10), configWithNRules(CONFIG_LIMITS.rules)]) {
    const encoded = encodeFunctionConfig(config);
    assert.equal(encoded.bytes, new TextEncoder().encode(encoded.json).length);
    assert.equal(encoded.fits, encoded.bytes <= FUNCTION_CONFIG_BUDGET_BYTES);
  }
  assert.equal(FUNCTION_CONFIG_BUDGET_BYTES, 9000);
});
