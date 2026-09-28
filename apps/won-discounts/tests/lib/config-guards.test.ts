import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { sanitizeConfig } from "@won/core/discounts/config";
import { encodeFunctionConfigWorstCase } from "@won/core/discounts/function-config";

import { saveConfig } from "../../app/lib/config.server.ts";
import {
  activeCodeRules,
  checkActiveCodeRuleLimit,
  checkCodeHashCollisions,
  isActiveCodeRule,
  MAX_ACTIVE_CODE_RULES,
} from "../../app/lib/config-guards.server.ts";
import { createTestDatabase, type TestDatabase } from "./test-db.ts";

// C2 fallback (spec §3 "Admin limit"): every active code rule is its own
// Shopify discount node, and Shopify caps active function discounts per store,
// so saveConfig refuses more active code rules than MAX_ACTIVE_CODE_RULES with
// a human-readable issue — nothing is written.

let db: TestDatabase;
before(() => {
  db = createTestDatabase("config-guards");
});
after(async () => {
  await db.drop();
});

function codeRule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Code rule ${id}`,
    method: "code",
    codes: [`CODE${id.toUpperCase().replace(/[^A-Z0-9]/g, "")}`],
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...overrides,
  };
}

function rules(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => codeRule(`r${i}`, overrides));
}

test("MAX_ACTIVE_CODE_RULES leaves headroom under Shopify's 25 active discount functions (automatic node included)", () => {
  assert.ok(Number.isInteger(MAX_ACTIVE_CODE_RULES));
  assert.ok(MAX_ACTIVE_CODE_RULES + 1 < 25, "Won's automatic node + code nodes must stay under the store limit with headroom");
  assert.ok(MAX_ACTIVE_CODE_RULES >= 10, "a useful number of code rules");
});

test("an active code rule = enabled, method code, at least one code", () => {
  const { config } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          codeRule("on"),
          codeRule("off", { enabled: false }),
          codeRule("nocodes", { codes: [] }),
          { ...codeRule("auto"), method: "automatic", codes: undefined },
        ],
      },
    },
  });
  assert.deepEqual(
    activeCodeRules(config).map((rule) => rule.id),
    ["on"],
  );
  assert.equal(isActiveCodeRule(config.modules.codes.rules[0]!), true);
});

test("checkActiveCodeRuleLimit: at the limit passes, one over fails with a human-readable issue", () => {
  const atLimit = sanitizeConfig({ modules: { codes: { rules: rules(MAX_ACTIVE_CODE_RULES) } } }).config;
  assert.deepEqual(checkActiveCodeRuleLimit(atLimit), { ok: true, count: MAX_ACTIVE_CODE_RULES, limit: MAX_ACTIVE_CODE_RULES });

  const over = sanitizeConfig({ modules: { codes: { rules: rules(MAX_ACTIVE_CODE_RULES + 1) } } }).config;
  const check = checkActiveCodeRuleLimit(over);
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.count, MAX_ACTIVE_CODE_RULES + 1);
  assert.equal(check.issue.code, "too_many_code_rules");
  assert.equal(check.issue.path, "modules.codes.rules");
  assert.match(check.issue.message, new RegExp(`${MAX_ACTIVE_CODE_RULES}`));
  assert.match(check.issue.message, /disable/i);
});

test("saveConfig refuses more active code rules than the limit and writes nothing", async () => {
  const shop = "too-many-codes.myshopify.com";
  const result = await saveConfig(db.prisma, shop, { modules: { codes: { rules: rules(MAX_ACTIVE_CODE_RULES + 1) } } });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "too_many_code_rules");
  if (result.reason !== "too_many_code_rules") return;
  assert.equal(result.count, MAX_ACTIVE_CODE_RULES + 1);
  assert.equal(result.limit, MAX_ACTIVE_CODE_RULES);
  assert.ok(result.issues.some((issue) => issue.code === "too_many_code_rules"));
  assert.equal(await db.prisma.shopConfig.count({ where: { shop } }), 0);
  assert.equal(await db.prisma.configVersion.count({ where: { shop } }), 0);
});

test("saveConfig accepts the limit exactly, and disabled code rules do not count", async () => {
  const shop = "codes-at-limit.myshopify.com";
  const atLimit = await saveConfig(db.prisma, shop, { modules: { codes: { rules: rules(MAX_ACTIVE_CODE_RULES) } } });
  assert.equal(atLimit.ok, true);

  const withDisabled = await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [...rules(MAX_ACTIVE_CODE_RULES), codeRule("extra-off", { enabled: false })],
      },
    },
  });
  assert.equal(withDisabled.ok, true);
});

test("regression (T1 report #6): 300 targeted product ids save fine — the budget is measured on the shop payload", async () => {
  // The legacy encoder counted target id lists that the MVP 1 transport ships
  // in product metafields instead, and refused configs like this one.
  const ids = (from: number) => Array.from({ length: 150 }, (_, i) => `gid://shopify/Product/${9000000000000 + from + i}`);
  const input = {
    modules: {
      codes: {
        rules: [
          { ...codeRule("t1"), target: { kind: "products", productIds: ids(0), variantIds: [] } },
          { ...codeRule("t2"), method: "automatic", codes: undefined, target: { kind: "products", productIds: ids(150), variantIds: [] } },
        ],
      },
    },
  };
  const sanitized = sanitizeConfig(input).config;
  assert.equal(
    sanitized.modules.codes.rules.reduce((n, rule) => n + (rule.target.kind === "products" ? rule.target.productIds.length : 0), 0),
    300,
  );
  assert.equal(encodeFunctionConfigWorstCase(sanitized).fits, false, "the legacy check would refuse it");

  const result = await saveConfig(db.prisma, "targeted-300.myshopify.com", input);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.reason));
  if (!result.ok) return;
  assert.ok(result.functionConfigBytes < 9000);
});

// Codes reach the function as 8-hex FNV-1a hashes (T1 code-hash.ts): two codes
// with the same hash would be indistinguishable there, so saving them is refused.
// WONOC0X / WONS2TA are a real collision (both hash to e9f81789).
test("saveConfig refuses two codes the function could not tell apart (code hash collision)", async () => {
  const shop = "hash-collision.myshopify.com";
  const result = await saveConfig(db.prisma, shop, {
    modules: { codes: { rules: [codeRule("a", { codes: ["WONOC0X"] }), codeRule("b", { codes: ["WONS2TA"] })] } },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "code_hash_collision");
  if (result.reason !== "code_hash_collision") return;
  assert.deepEqual(result.collisions, [["WONOC0X", "WONS2TA"]]);
  const issue = result.issues.find((i) => i.code === "code_hash_collision");
  assert.ok(issue);
  assert.match(issue.message, /WONOC0X/);
  assert.match(issue.message, /WONS2TA/);
  assert.equal(await db.prisma.shopConfig.count({ where: { shop } }), 0);
});

test("a Won code colliding with a known native code is refused; no collision passes", () => {
  const config = sanitizeConfig({ modules: { codes: { rules: [codeRule("a", { codes: ["WONOC0X"] })] } } }).config;
  assert.equal(checkCodeHashCollisions(config).ok, true);
  const withNative = checkCodeHashCollisions(config, ["wons2ta"]);
  assert.equal(withNative.ok, false);
  if (withNative.ok) return;
  assert.match(withNative.issue.message, /WONS2TA/);
  assert.match(withNative.issue.message, /another discount/);
});

test("M4: a campaign that has ENDED (not killed) no longer enables a disabled code rule nor uses a limit slot", () => {
  const override = { ruleId: "bf", patch: { enabled: true } };
  const campaign = (window: { start: string; end: string }) => ({ id: "c1", name: "C", window, overrides: [override], killed: false });
  const rule = codeRule("bf", { enabled: false });
  const live = sanitizeConfig({
    modules: { codes: { rules: [rule] } },
    campaigns: [campaign({ start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" })],
  }).config;
  const ended = sanitizeConfig({
    modules: { codes: { rules: [rule] } },
    campaigns: [campaign({ start: "2026-09-01T00:00:00", end: "2026-09-02T00:00:00" })],
  }).config;
  const ctx = { now: new Date("2026-09-28T12:00:00Z"), shopLocalNow: "2026-09-28T14:00:00" };
  assert.deepEqual(activeCodeRules(live, ctx).map((r) => r.id), ["bf"]);
  assert.deepEqual(activeCodeRules(ended, ctx), []);
  assert.equal(checkActiveCodeRuleLimit(ended, ctx).count, 0);
  // Without the shop's zone a campaign counts as ended only once it ended everywhere (UTC − 12 h).
  const justEnded = sanitizeConfig({
    modules: { codes: { rules: [rule] } },
    campaigns: [campaign({ start: "2026-09-28T00:00:00", end: "2026-09-28T10:00:00" })],
  }).config;
  assert.deepEqual(activeCodeRules(justEnded, { now: new Date("2026-09-28T12:00:00Z") }).map((r) => r.id), ["bf"], "conservative");
  assert.deepEqual(activeCodeRules(justEnded, ctx), [], "with the shop-local time it has ended");
});

test("M6: a code rule whose own schedule already ended is not active and does not count", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const config = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          codeRule("past", { schedule: { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" } }),
          codeRule("future", { schedule: { startsAt: "2026-12-01T00:00:00Z" } }),
        ],
      },
    },
  }).config;
  assert.deepEqual(activeCodeRules(config, { now }).map((r) => r.id), ["future"], "scheduled (future) rules still count");
  assert.equal(checkActiveCodeRuleLimit(config, { now }).count, 1);
});
