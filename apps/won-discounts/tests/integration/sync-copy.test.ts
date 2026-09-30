import assert from "node:assert/strict";
import { test } from "node:test";

import { t } from "../../app/i18n/index.ts";
import { saveWarnings, shopConfigApplied, stepNodeKey, stepProblem, stepWarnings, syncProblems } from "../../app/lib/integration/sync-copy.ts";
import { withinDeadline } from "../../app/lib/integration/deadline.ts";
import { withConfigLock } from "../../app/lib/integration/lock.server.ts";

// What a sync did, in the merchant's words (§4c): every failed step of the sync
// layer (English machine detail) becomes a sentence in cs/en, naming the rule;
// the technical detail stays visible in parentheses. Plus the small
// integration primitives (deadline, lock). The admin language: locale.test.ts.

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

test("margin sync problems have their own sentences with the collection title and the count — never an English detail or a GID (audit P1-1, P3-2)", () => {
  const exact = stepProblem(
    {
      step: "margin.too_large",
      ok: false,
      detail: "the margin setting of gid://shopify/Collection/5 …",
      params: { collectionId: "gid://shopify/Collection/5", collection: "Nízká marže", count: 4_600 },
    },
    names,
  );
  // An EXACT count is at most 10 000 (Shopify counts exactly only up to it): the budget went to the margin collections read first.
  assert.deepEqual(exact, { key: "sync.problem.marginTooLarge", params: { collection: "Nízká marže", count: 4_600, limit: 10_000 } });
  const cs = t("cs", exact.key, exact.params);
  assert.match(cs, /„Nízká marže“ s vlastním nastavením marže \(produktů: 4\u00a0600\) se už nevešla do limitu 10\u00a0000 produktů/, "every number in the admin's format, the limit too");
  assert.match(cs, /spotřebovaly kolekce s nastavením marže, které Won čte dřív/);
  assert.match(cs, /platí přísnější hodnota pro celý obchod/);
  assert.doesNotMatch(cs, /gid:\/\/|the margin setting/);
  const uncounted = stepProblem(
    { step: "margin.too_large", ok: false, detail: "x", params: { collectionId: "gid://shopify/Collection/5", collection: "Nízká marže", count: null } },
    names,
  );
  assert.equal(uncounted.key, "sync.problem.marginTooLargeUncounted");
  assert.match(t("cs", uncounted.key, uncounted.params), /„Nízká marže“ s vlastním nastavením marže má víc než 10\u00a0000 produktů/);
  assert.match(t("en", uncounted.key, uncounted.params), /“Nízká marže”.*more than 10,000 products.*stricter value applies to the whole store/);
  const untitled = stepProblem({ step: "margin.too_large", ok: false, detail: "x", params: { collectionId: "gid://shopify/Collection/5", collection: "", count: null } }, names);
  assert.equal(untitled.key, "sync.problem.marginTooLargeUncountedUntitled");
  assert.match(t("cs", untitled.key, untitled.params), /^Kolekce bez názvu s vlastním nastavením marže/);
  const currency = stepProblem({ step: "shop.currency", ok: false, detail: "Shopify did not say the shop currency" }, names);
  assert.equal(currency.key, "sync.problem.currency");
  assert.match(t("cs", currency.key, currency.params), /měn/);
});

test("audit fix rounds 2 + 3: a rule collection over the limit is named „by title“ in Czech (fallback 'kolekce bez názvu'); a held config says why; refused products are counted, never listed by GID; a failed prune is quiet", () => {
  const tooLarge = (params: Record<string, string | number | null>) =>
    say({ step: "products.too_large:vip", ok: false, detail: '"VIP10" does not apply at checkout to gid://shopify/Collection/9 …', params } as never);
  assert.equal(
    tooLarge({ collection: "Zimní", count: 1 }),
    "Sleva „VIP10“ se v pokladně neuplatní na kolekci „Zimní“: vybrané kolekce mají dohromady víc než 10\u00a0000 produktů, tolik Won při jedné synchronizaci nenačte. Ostatní slevy se propsaly.",
  );
  assert.match(tooLarge({ collection: "Zimní", count: 3 }), /na kolekce „Zimní“ a další \(2\):/);
  assert.match(tooLarge({ collection: "", count: 2 }), /na část svých kolekcí \(kolekce bez názvu\):/);
  for (const text of [tooLarge({ collection: "Zimní", count: 1 }), tooLarge({ collection: "", count: 1 })]) {
    assert.doesNotMatch(text, /gid:\/\/|does not apply|untitled collection/);
  }
  const held = (reason: string) => say({ step: "shop_config.write", ok: false, detail: "held: …", params: { held: reason } } as never);
  assert.match(held("margin_refs"), /nepodařilo zapsat jejich kolekce s nastavením marže\. Platí předchozí nastavení/);
  assert.match(held("rule_refs"), /nepodařilo odebrat slevy, které k nim už nepatří/);
  assert.match(held("products_unread"), /nepodařilo načíst ze Shopify/);
  assert.match(held("products_refused"), /Shopify teď odmítá zápisy cílení u produktů/);
  assert.doesNotMatch(held("margin_refs"), /cleared|held/);
  const refused = say({ step: "products.set", ok: false, detail: "Shopify refused 2 product(s): gid://shopify/Product/1: bad", params: { refused: 2 } } as never);
  assert.equal(refused, "Shopify odmítl zapsat cílení slev u produktů: 2. Ostatní produkty se propsaly, další synchronizace to zkusí znovu.");
  const prune = say({ step: "products.prune", ok: false, detail: "0/3 product(s) finished after the flip; Throttled" } as never);
  assert.match(prune, /Na slevu to vliv nemá \(platí stejná hranice\), další synchronizace to dokončí\.$/);
  assert.doesNotMatch(prune, /Throttled|Cílení na produkty se do Shopify nepropsalo/);
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
