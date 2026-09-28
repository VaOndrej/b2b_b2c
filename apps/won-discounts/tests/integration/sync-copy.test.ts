import assert from "node:assert/strict";
import { test } from "node:test";

import { t } from "../../app/i18n/index.ts";
import { saveWarnings, shopConfigApplied, stepNodeKey, stepProblem, stepWarnings, syncProblems } from "../../app/lib/integration/sync-copy.ts";
import { withinDeadline } from "../../app/lib/integration/deadline.ts";
import { withConfigLock } from "../../app/lib/integration/lock.server.ts";
import { forgetLocales, requestLocale } from "../../app/lib/integration/locale.server.ts";

// What a sync did, in the merchant's words (§4c): every failed step of the sync
// layer (English machine detail) becomes a sentence in cs/en, naming the rule;
// the technical detail stays visible in parentheses. Plus the small
// integration primitives (deadline, lock, the remembered admin language).

const names = new Map([["vip", "VIP10"]]);
const say = (step: { step: string; ok: boolean; detail: string }, locale: "cs" | "en" = "cs") => {
  const text = stepProblem(step, names);
  return t(locale, text.key, text.params);
};

test("failed steps → sentences that name the rule and keep the detail", () => {
  assert.equal(stepNodeKey("node.create:code:vip"), "code:vip");
  assert.equal(stepNodeKey("codes.remove:code:vip"), "code:vip");
  assert.equal(stepNodeKey("node.update:auto"), "auto");
  assert.equal(stepNodeKey("shop_config.write"), null);

  assert.equal(
    say({ step: "node.create:code:vip", ok: false, detail: '"VIP10": could not create "VIP10": Code must be unique.' }),
    'Kód slevy „VIP10“ už v Shopify používá jiná sleva. Změň kód, nebo tu slevu přesuň do Won ("VIP10": could not create "VIP10": Code must be unique.).',
  );
  assert.equal(
    say({ step: "codes:code:vip", ok: false, detail: "code bulk add job 1 still running" }, "en"),
    "Shopify is still importing the codes of “VIP10”. The next sync checks them.",
  );
  assert.match(say({ step: "node.update:auto", ok: false, detail: "Throttled" }), /^Automatické slevy se do Shopify nepropsaly \(Throttled\)\.$/);
  assert.match(say({ step: "shop_config.write", ok: false, detail: "held: some products could not be cleared" }), /platí předchozí/);
  assert.match(
    say({ step: "shop_config.write", ok: false, detail: "campaign switch held at 'no campaign'" }),
    /Přepnutí kampaně se zatím nedokončilo/,
  );
  assert.match(say({ step: "shop_config.rollback", ok: false, detail: "no valid previous config to restore" }), /Won slevy do další úspěšné synchronizace neplatí/);
  assert.match(say({ step: "products.set", ok: false, detail: "1/2 product(s) updated" }), /Cílení na produkty/);
  assert.match(say({ step: "node.create:code:gone", ok: false, detail: "x" }), /Sleva „gone“ se do Shopify nepropsala/, "an unknown rule is named by its id");
  assert.match(say({ step: "something.new", ok: false, detail: "y".repeat(400) }), /…\)\.$/, "long details are shortened");
});

test("only failed steps become problems (deduplicated); warnings are the sync's `warning` steps and the save's notes", () => {
  const steps = [
    { step: "shop.read", ok: true, detail: "ok" },
    { step: "node.create:code:vip", ok: false, detail: "Throttled" },
    { step: "node.create:code:vip", ok: false, detail: "Throttled" },
    { step: "products.oversized", ok: true, warning: true, detail: "1 product(s) had too many variant-level rules" },
  ];
  assert.equal(syncProblems(steps, names).length, 1);
  assert.deepEqual(stepWarnings(steps).map((w) => w.key), ["sync.warning.oversized"]);
  assert.deepEqual(
    saveWarnings([
      "could not read the shop's time zone (x); campaign windows were judged conservatively",
      "could not read Shopify markets (x); market-targeted rules keep the countries saved in the config",
      "Shopify market countries changed; the config was saved again with them",
    ]).map((w) => w.key),
    ["sync.warning.timezone", "sync.warning.markets", "sync.warning.marketsChanged"],
  );
});

test("the shop config counts as applied only when written (or unchanged) and not failed on verify", () => {
  assert.equal(shopConfigApplied([{ step: "shop_config.write", ok: true, detail: "unchanged (120 B)" }]), true);
  assert.equal(
    shopConfigApplied([
      { step: "shop_config.write", ok: true, detail: "120 B written" },
      { step: "shop_config.verify", ok: true, detail: "read back" },
    ]),
    true,
  );
  assert.equal(
    shopConfigApplied([
      { step: "shop_config.write", ok: true, detail: "120 B written" },
      { step: "shop_config.verify", ok: false, detail: "differs" },
      { step: "shop_config.rollback", ok: true, detail: "restored" },
    ]),
    false,
  );
  assert.equal(shopConfigApplied([{ step: "shop_config.phase1.write", ok: true, detail: "x" }]), false, "phase 1 alone is not the final config");
});

test("withinDeadline: a slow promise is left running (its rejection observed), a fast one returns", async () => {
  assert.deepEqual(await withinDeadline(Promise.resolve(1), 50), { done: true, value: 1 });
  const slow = new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 30));
  assert.deepEqual(await withinDeadline(slow, 5), { done: false });
  await new Promise((resolve) => setTimeout(resolve, 40)); // no unhandled rejection
  const failed = await withinDeadline(Promise.reject(new Error("boom")), 50);
  assert.ok(failed.done && "error" in failed);
});

test("withConfigLock: one config writer at a time per shop, other shops in parallel, a failure does not jam the queue", async () => {
  const order: string[] = [];
  const job = (name: string, ms: number, fail = false) => async () => {
    order.push(`${name}:start`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`${name}:end`);
    if (fail) throw new Error(name);
    return name;
  };
  const a = withConfigLock("s1", job("a", 20, true));
  const b = withConfigLock("s1", job("b", 1));
  const c = withConfigLock("s2", job("c", 1));
  await assert.rejects(a);
  assert.equal(await b, "b");
  assert.equal(await c, "c");
  assert.ok(order.indexOf("a:end") < order.indexOf("b:start"), order.join(" "));
  assert.ok(order.indexOf("c:end") < order.indexOf("a:end"), "another shop does not wait");
});

test("the admin language: ?locale= of a document load is remembered for that staff user's later fetches", () => {
  forgetLocales();
  assert.equal(requestLocale(new Request("https://app.test/app?locale=en-US"), "s.myshopify.com", "user-1"), "en");
  assert.equal(requestLocale(new Request("https://app.test/app/discounts.data"), "s.myshopify.com", "user-1"), "en");
  assert.equal(requestLocale(new Request("https://app.test/app?locale=cs"), "s.myshopify.com", "user-2"), "cs");
  assert.equal(requestLocale(new Request("https://app.test/app.data"), "s.myshopify.com", "user-1"), "en", "per user");
  assert.equal(requestLocale(new Request("https://app.test/app.data"), "other.myshopify.com", "user-9"), "cs", "default");
});
