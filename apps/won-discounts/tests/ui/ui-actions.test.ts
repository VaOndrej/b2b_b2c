import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { codeHash } from "@won/core/discounts/code-hash";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { MAX_ACTIVE_CODE_RULES, SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS } from "../../app/lib/config-guards.server.ts";
import { failureCopy } from "../../app/components/shell/Notice.tsx";
import { translator } from "../../app/i18n/index.ts";
import {
  clearSignalCache,
  codeRuleLimit,
  deleteRule,
  embedStateFromThemes,
  loadAdminSignals,
  moveNative,
  readBackupId,
  readNativeIds,
  readOnboardingForm,
  readMarketNames,
  readShopContext,
  resolvePlan,
  saveOnboarding,
  saveRule,
  uiFailureFromSave,
  undoMove,
  type AdminGraphql,
} from "../../app/lib/ui-actions.server.ts";
import { FIELD } from "../../app/components/model/rule-form.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, testCtx } from "../integration/helpers.ts";

// The admin UI's single server seam (app/lib/ui-actions.server.ts):
//   SEC-1 — the raw form is validated on the server; refused input writes nothing.
//   SEC-2 — every write is scoped to the shop the caller passes (the SESSION shop);
//           a `shop` field in the form is ignored, other shops are never touched.
//   BILL-1 — Pro fields are not writable without server-derived entitlement.
// Writes go through the canonical saveAndSync against a fake Shopify
// (tests/integration/helpers.ts); what reaches Shopify is pinned in
// tests/integration/*.

const SHOP = "ui-actions.myshopify.com";
const OTHER = "other.myshopify.com";
const OPTS = { ruleId: "new", timezone: "Europe/Prague", shopCurrency: "CZK", pro: false };

let db: TestDatabase;
before(() => {
  db = createTestDatabase("ui-actions");
});
after(async () => {
  await db.drop();
});

/** The request context for `shop` (fake Shopify + real sync + this test DB). */
const ctx = (shop: string) => testCtx(db.prisma, shop, new FakeStore());

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

const valid: [string, string][] = [
  [FIELD.name, "Podzimní sleva"],
  [FIELD.enabled, "on"],
  [FIELD.valueKind, "percentage"],
  [FIELD.percent, "10"],
  [FIELD.target, "order"],
  [FIELD.method, "automatic"],
];

test("saveRule creates a rule for the given shop only; a `shop` form field is ignored (SEC-2)", async () => {
  const { result, ruleId } = await saveRule(ctx(SHOP), form([...valid, ["shop", OTHER], ["id", "evil"]]), OPTS);
  assert.equal(result.ok, true);
  assert.ok(ruleId && ruleId !== "evil" && /^r_[a-z0-9]+$/.test(ruleId));

  const mine = (await loadConfig(db.prisma, SHOP)).config.modules.codes.rules;
  assert.deepEqual(mine.map((r) => [r.id, r.name, r.value]), [[ruleId, "Podzimní sleva", { kind: "percentage", percent: 10 }]]);
  const theirs = (await loadConfig(db.prisma, OTHER)).config.modules.codes.rules;
  assert.deepEqual(theirs, [], "the other shop is untouched");
});

test("saveRule refuses invalid input on the server and writes nothing (SEC-1)", async () => {
  const before = (await loadConfig(db.prisma, SHOP)).config.modules.codes.rules.length;
  const bad = valid.map(([k, v]) => [k, k === FIELD.percent ? "500" : k === FIELD.method ? "magic" : v] as [string, string]);
  const { result, ruleId } = await saveRule(ctx(SHOP), form(bad), OPTS);
  assert.equal(ruleId, null);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "invalid");
  assert.deepEqual(
    !result.ok && result.reason === "invalid" ? result.errors.map((e) => e.field).sort() : [],
    ["method", "percent"],
  );
  assert.equal((await loadConfig(db.prisma, SHOP)).config.modules.codes.rules.length, before);
});

test("saveRule edits by the URL id; an unknown id is not_found; Pro fields need entitlement (BILL-1)", async () => {
  const [rule] = (await loadConfig(db.prisma, SHOP)).config.modules.codes.rules;
  const edited = valid.map(([k, v]) => [k, k === FIELD.name ? "Přejmenovaná" : v] as [string, string]);
  const proFields: [string, string][] = [[FIELD.markets, "cz"]];

  const res = await saveRule(ctx(SHOP), form([...edited, ...proFields]), { ...OPTS, ruleId: rule.id });
  assert.equal(res.result.ok, true);
  const after = (await loadConfig(db.prisma, SHOP)).config.modules.codes.rules;
  assert.equal(after.length, 1);
  assert.equal(after[0].name, "Přejmenovaná");
  assert.equal(after[0].targeting, undefined, "no market targeting without Pro");

  const missing = await saveRule(ctx(SHOP), form(valid), { ...OPTS, ruleId: "r_does_not_exist" });
  assert.deepEqual(missing.result, { ok: false, reason: "not_found" });
});

test("deleteRule removes the rule of this shop only", async () => {
  const other = await saveRule(ctx(OTHER), form(valid), OPTS);
  const [rule] = (await loadConfig(db.prisma, SHOP)).config.modules.codes.rules;
  // The other shop's rule id cannot be deleted through this shop.
  assert.deepEqual(await deleteRule(ctx(SHOP), other.ruleId ?? ""), { ok: false, reason: "not_found" });
  assert.deepEqual(await deleteRule(ctx(SHOP), rule.id), { ok: true, message: "deleted", sync: { ok: true, problems: [], warnings: [] } });
  assert.deepEqual((await loadConfig(db.prisma, SHOP)).config.modules.codes.rules, []);
  assert.equal((await loadConfig(db.prisma, OTHER)).config.modules.codes.rules.length, 1);
});

test("onboarding: only known goals are stored (comma-joined choice list or separate values)", async () => {
  const patch = readOnboardingForm(form([["intent", "goals"], ["goals", "rewards,bogus"], ["goals", "migrate"]]));
  assert.deepEqual(patch, { goals: ["rewards", "migrate"], step: 2 });
  assert.equal(readOnboardingForm(form([["intent", "step"], ["step", "9"]])), null);
  assert.deepEqual(await saveOnboarding({ db: db.prisma, shop: SHOP }, patch ?? {}), { ok: true, message: "saved" });
  const { config } = await loadConfig(db.prisma, SHOP);
  assert.deepEqual(config.onboarding, { goals: ["rewards", "migrate"], step: 2 });
});

test("native seams validate their input before anything reaches Shopify", async () => {
  const store = new FakeStore();
  const c = testCtx(db.prisma, SHOP, store);
  assert.deepEqual(await moveNative(c, []), { ok: false, reason: "nothing_selected" });
  assert.deepEqual(await undoMove(c, null), { ok: false, reason: "bad_request" });
  assert.deepEqual(store.ops, [], "nothing was sent");
  assert.deepEqual(readNativeIds(form([["nativeId", "gid://shopify/DiscountCodeNode/1"], ["nativeId", "gid://evil/1"]])), [
    "gid://shopify/DiscountCodeNode/1",
  ]);
  assert.equal(readBackupId(form([["backupId", "../../etc"]])), null);
});

test("BILL-1: without a verified subscription the plan resolves to Free", async () => {
  assert.deepEqual(await resolvePlan(), { pro: false });
});

// --- Store signals ------------------------------------------------------------------

const settings = (blocks: Record<string, unknown>) =>
  `/* Shopify banner comment */\n${JSON.stringify({ current: { blocks } })}`;
const EMBED = "shopify://apps/won-discounts/blocks/won_discounts_embed/01a0e790-ee4d-733c-ac8e-14c7baa03fff";

// --- Save refusals: each one typed, named and actionable (never "try again") --------------

const codeRule = (id: string, code: string) => ({
  id,
  enabled: true,
  name: `Kód ${code}`,
  method: "code",
  codes: [code],
  value: { kind: "percentage", percent: 5 },
  target: { kind: "order" },
});
const codeForm = (code: string): [string, string][] => [
  ...valid.filter(([k]) => k !== FIELD.method),
  [FIELD.method, "code"],
  [FIELD.codes, code],
];

test("too_many_code_rules: the 21st active code rule is refused with the limit and why", async () => {
  const shop = "limit.myshopify.com";
  const rules = Array.from({ length: MAX_ACTIVE_CODE_RULES }, (_, i) => codeRule(`c${i}`, `CODE${i}`));
  const seeded = await saveConfig(db.prisma, shop, { ...(await loadConfig(db.prisma, shop)).config, modules: { codes: { rules } } });
  assert.equal(seeded.ok, true);
  assert.deepEqual(codeRuleLimit((await loadConfig(db.prisma, shop)).config), {
    active: MAX_ACTIVE_CODE_RULES,
    limit: MAX_ACTIVE_CODE_RULES,
    shopifyLimit: SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS,
  });

  const { result } = await saveRule(ctx(shop), form(codeForm("ONE-TOO-MANY")), OPTS);
  assert.deepEqual(result, {
    ok: false,
    reason: "too_many_code_rules",
    count: MAX_ACTIVE_CODE_RULES + 1,
    limit: MAX_ACTIVE_CODE_RULES,
    shopifyLimit: SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS,
  });
  const copy = failureCopy(result as never, translator("cs"));
  assert.equal(copy.key, "result.tooManyCodeRules");
  assert.deepEqual(copy.params, { limit: 20, count: 21, shopify: 25 });
  assert.equal(copy.action?.href, "/app/discounts");
  // A switched-off code rule does not count: saving it is fine.
  const off = await saveRule(ctx(shop), form(codeForm("PARKED").filter(([k]) => k !== FIELD.enabled)), OPTS);
  assert.equal(off.result.ok, true);
});

/** Two different codes with the same 8-hex function hash (birthday search, deterministic). */
function collidingCodes(): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const code = `WON${i}`;
    const hash = codeHash(code);
    const other = seen.get(hash);
    if (other) return [other, code];
    seen.set(hash, code);
  }
}

test("code_hash_collision: names the codes the checkout cannot tell apart, fix link to #codes", async () => {
  const shop = "collision.myshopify.com";
  const [a, b] = collidingCodes();
  const first = await saveRule(ctx(shop), form(codeForm(a)), OPTS);
  assert.equal(first.result.ok, true);
  const { result } = await saveRule(ctx(shop), form(codeForm(b)), OPTS);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "code_hash_collision");
  assert.deepEqual(!result.ok && result.reason === "code_hash_collision" ? result.codes.flat().sort() : [], [a, b].sort());
  const copy = failureCopy(result as never, translator("cs"));
  assert.equal(copy.action?.href, "#codes");
  assert.match(String(copy.params?.codes), new RegExp(`${a}|${b}`));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 1, "nothing written");
});

test("every saveConfig refusal maps to its own typed failure with its own copy", () => {
  const cs = translator("cs");
  const cases = [
    [{ ok: false, reason: "function_config_too_large", bytes: 9500, budget: 9000 }, "result.functionTooLarge", "/app/discounts"],
    [{ ok: false, reason: "config_too_large", bytes: 300000, limit: 262144 }, "result.configTooLarge", "/app/discounts"],
    [{ ok: false, reason: "newer_schema", storedSchemaVersion: 2 }, "result.newerSchema", undefined],
    [{ ok: false, reason: "unreadable_config" }, "result.unreadableConfig", undefined],
  ] as const;
  for (const [refusal, key, href] of cases) {
    const failure = uiFailureFromSave({ ...refusal, config: {} as never, issues: [] } as never);
    assert.equal(failure.reason, refusal.reason);
    const copy = failureCopy(failure, cs);
    assert.equal(copy.key, key);
    assert.equal(copy.action?.href, href);
    assert.notEqual(copy.key, "result.error", "a refusal is never a generic 'try again'");
  }
  assert.equal(failureCopy({ ok: false, reason: "newer_schema" }, cs).action?.reload, true);
  assert.equal(failureCopy({ ok: false, reason: "bad_request" }, cs).key, "result.badRequest");
  assert.equal(failureCopy({ ok: false, reason: "nothing_selected" }, cs).key, "result.nothingSelected");
});

test("embed detection: by block handle (no UUID), the live theme decides", () => {
  assert.equal(embedStateFromThemes([{ role: "MAIN", settings: settings({ a: { type: EMBED, disabled: false } }) }]), "on");
  assert.equal(embedStateFromThemes([{ role: "MAIN", settings: settings({ a: { type: EMBED, disabled: true } }) }]), "off");
  assert.equal(embedStateFromThemes([{ role: "MAIN", settings: settings({}) }]), "off", "never activated");
  assert.equal(
    embedStateFromThemes([
      { role: "MAIN", settings: settings({}) },
      { role: "UNPUBLISHED", settings: settings({ a: { type: EMBED } }) },
    ]),
    "draft_only",
  );
  assert.equal(embedStateFromThemes([{ role: "MAIN", settings: null }]), "unknown");
  assert.equal(embedStateFromThemes([]), "unknown");
  // Another app's embed with a similar name is not ours.
  assert.equal(
    embedStateFromThemes([{ role: "MAIN", settings: settings({ a: { type: "shopify://apps/won-toasts/blocks/won_toasts_embed/x" } }) }]),
    "off",
  );
});

function fakeGraphql(responses: Record<string, unknown>): AdminGraphql {
  return async (query) => {
    const name = /query (\w+)/.exec(query)?.[1] ?? "";
    if (!(name in responses)) throw new Error(`unexpected query ${name}`);
    return responses[name];
  };
}

test("loadAdminSignals: embed read with read_themes, activation deep link, the rest not wired", async () => {
  clearSignalCache();
  const graphql = fakeGraphql({
    WonDiscountsThemes: { data: { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", role: "MAIN" }] } } },
    WonDiscountsThemeSettings: {
      data: { node: { files: { nodes: [{ body: { content: settings({ a: { type: EMBED } }) } }] } } },
    },
  });
  const signals = await loadAdminSignals({ shop: SHOP, scopes: "write_discounts,read_themes", apiKey: "abc123", graphql });
  assert.deepEqual(signals.embed, {
    state: "on",
    activateUrl: `https://${SHOP}/admin/themes/current/editor?context=apps&activateAppId=abc123/won_discounts_embed`,
  });
  assert.deepEqual(signals.sync, { state: "not_wired" });
  assert.deepEqual(signals.native, { state: "not_wired" });
  assert.deepEqual(signals.checkout, { state: "not_wired" });

  const noScope = await loadAdminSignals({ shop: SHOP, scopes: "write_discounts", apiKey: "abc123", graphql });
  assert.equal(noScope.embed.state, "no_scope");
  const outage = await loadAdminSignals({
    shop: "outage.myshopify.com",
    scopes: "read_themes",
    apiKey: "abc123",
    graphql: async () => {
      throw new Error("down");
    },
  });
  assert.equal(outage.embed.state, "unknown");
});

test("theme reads are cached per shop for a short time; drafts are read only when the live theme is off", async () => {
  clearSignalCache();
  const calls: string[] = [];
  const graphql: AdminGraphql = async (query, variables) => {
    const name = /query (\w+)/.exec(query)?.[1] ?? "";
    calls.push(`${name}:${String(variables?.id ?? "")}`);
    if (name === "WonDiscountsThemes") {
      return {
        data: {
          themes: {
            nodes: [
              { id: "gid://shopify/OnlineStoreTheme/1", role: "MAIN" },
              { id: "gid://shopify/OnlineStoreTheme/2", role: "UNPUBLISHED" },
            ],
          },
        },
      };
    }
    return { data: { node: { files: { nodes: [{ body: { content: settings({ a: { type: EMBED } }) } }] } } } };
  };
  const ctx = { shop: "cache.myshopify.com", scopes: "read_themes", apiKey: "k", graphql };
  assert.equal((await loadAdminSignals(ctx)).embed.state, "on");
  assert.deepEqual(calls, ["WonDiscountsThemes:", "WonDiscountsThemeSettings:gid://shopify/OnlineStoreTheme/1"], "live theme on → no draft read");
  await loadAdminSignals(ctx);
  assert.equal(calls.length, 2, "second load within the TTL is served from the cache");
  await loadAdminSignals({ ...ctx, fresh: true });
  assert.equal(calls.length, 4, "fresh (onboarding re-check) bypasses the cache");
});

test("market names come from Shopify (read_markets); a failed read degrades to handles", async () => {
  clearSignalCache();
  const ok = fakeGraphql({ WonDiscountsMarketNames: { data: { markets: { nodes: [{ handle: "cz", name: "Česko" }, { handle: "sk", name: "" }] } } } });
  assert.deepEqual(await readMarketNames(ok, "names.myshopify.com"), { cz: "Česko" });
  assert.deepEqual(
    await readMarketNames(async () => {
      throw new Error("no scope");
    }, "names-failing.myshopify.com"),
    {},
  );
});

test("readShopContext degrades to nulls (REL-1)", async () => {
  const ok = fakeGraphql({ WonDiscountsShopContext: { data: { shop: { currencyCode: "CZK", ianaTimezone: "Europe/Prague" } } } });
  assert.deepEqual(await readShopContext(ok), { currencyCode: "CZK", timezone: "Europe/Prague" });
  assert.deepEqual(await readShopContext(async () => ({ errors: [{}] })), { currencyCode: null, timezone: null });
});
