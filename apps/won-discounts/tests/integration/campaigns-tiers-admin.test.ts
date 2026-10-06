import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { CAMPAIGN_FIELD as F, CAMPAIGN_INTENT } from "../../app/components/model/campaigns.ts";
import { loadConfig } from "../../app/lib/config.server.ts";
import { campaignsAction, loadCampaignsScreen } from "../../app/lib/integration/campaigns-admin.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { FakeShopify } from "../lib/sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { APP_KEY, formOf, quiet } from "./helpers.ts";

// MVP 6.1 contract L8: the Kampaně form changes the breaks of quantity tier sets — parsed on the server (SEC-1),
// refused on the set's own field when the campaign would give less than the base (core tierOverrideIssue), stored
// as `{ruleId: <set id>, patch: {breaks}}`, shipped as the campaign's own sets; the screen words them and counts
// what does not apply.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("campaigns-tiers-admin");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `campaigns-tiers-admin-${seq}.myshopify.com`;
});

const NOW = new Date("2026-10-04T10:00:00Z");
const P7 = "gid://shopify/Product/7";

async function setup() {
  const fake = new FakeShopify();
  const ctx: ShopCtx = {
    shop,
    db: db.prisma,
    client: fake,
    locale: "cs",
    apiKey: APP_KEY,
    logger: quiet,
    now: () => NOW,
    createSync: (client, prisma) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "pro", now: () => NOW }),
  };
  const { saveAndSync } = await import("../../app/lib/sync/save-and-sync.server.ts");
  const saved = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    createSync: ctx.createSync,
    now: () => NOW,
    input: {
      modules: {
        codes: { rules: [{ id: "auto", name: "Podzim 10 %", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] },
        tiers: {
          sets: [
            { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 10 }, { minQty: 5, percent: 15 }] },
            { id: "s", scope: { productIds: [P7] }, countAcross: "line", breaks: [{ minQty: 3, amountOff: { CZK: 1000, EUR: 40 } }] },
          ],
        },
        rewards: { gifts: [{ id: "gift", threshold: { CZK: 100000 }, choices: ["gid://shopify/ProductVariant/1"] }] },
      },
    },
  });
  assert.ok(saved.save.ok, JSON.stringify(saved.save));
  return { fake, ctx };
}

const version = async () => (await loadConfig(db.prisma, shop)).version ?? "";
const baseForm = async (extra: [string, string][]): Promise<ReturnType<typeof formOf>> =>
  formOf([
    ["configVersion", await version()],
    [F.name, "Black Friday"],
    [F.startDate, "2026-11-27"],
    [F.startTime, "00:00"],
    [F.endDate, "2026-11-30"],
    [F.endTime, "23:59"],
    [F.intent, CAMPAIGN_INTENT.save],
    ...extra,
  ]);
/** The global set's rows in the campaign: 2 items → `two` %, 5 items → `five` %. */
const globalRows = (two: string, five: string): [string, string][] => [
  [F.tierUse, "g"],
  [`${F.tierQty}g.0`, "2"],
  [`${F.tierPercent}g.0`, two],
  [`${F.tierQty}g.1`, "5"],
  [`${F.tierPercent}g.1`, five],
];

test("save: a campaign with tier breaks only is stored as breaks patches and shipped as the campaign's own sets", async () => {
  const { fake, ctx } = await setup();
  const r = await campaignsAction(ctx, await baseForm([...globalRows("20", "25"), [`${F.tierQty}g.2`, "10"], [`${F.tierPercent}g.2`, "30"], [`${F.tierQty}g.3`, ""], [`${F.tierPercent}g.3`, ""]]));
  assert.ok(r.ok && "kind" in r && r.kind === "saved", JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config.campaigns;
  assert.deepEqual(stored[0]!.overrides, [{ ruleId: "g", patch: { breaks: [{ minQty: 2, percent: 20 }, { minQty: 5, percent: 25 }, { minQty: 10, percent: 30 }] } }]);
  const live = JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaigns: { tiers?: { sets: unknown[] } }[]; modules: { tiers: { sets: unknown[] } } };
  assert.deepEqual(live.campaigns[0]!.tiers!.sets[0], ["g", "line", [], [[2, 20], [5, 25], [10, 30]]]);
  assert.deepEqual(live.modules.tiers.sets[0], ["g", "line", [], [[2, 10], [5, 15]]], "the base sets stay");
});

test("save: amounts per currency in major units; rules and sets together; a set that is not ticked is not read", async () => {
  const { ctx } = await setup();
  const r = await campaignsAction(
    ctx,
    await baseForm([
      [F.use, "auto"],
      [`${F.percent}auto`, "30"],
      [F.tierUse, "s"],
      [`${F.tierQty}s.0`, "3"],
      [`${F.tierAmount}s.0.CZK`, "25,50"],
      [`${F.tierAmount}s.0.EUR`, "1"],
      // The global set's fields are in the form too (every set is rendered), but it is not ticked.
      [`${F.tierQty}g.0`, "2"],
      [`${F.tierPercent}g.0`, "1"],
    ]),
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.campaigns[0]!.overrides, [
    { ruleId: "auto", patch: { value: { kind: "percentage", percent: 30 } } },
    { ruleId: "s", patch: { breaks: [{ minQty: 3, amountOff: { CZK: 2550, EUR: 100 } }] } },
  ]);
});

test("a campaign that would give less than the base is refused on the tier field, naming the set, the quantity and the currency; nothing is saved", async () => {
  const { ctx } = await setup();
  const less = await campaignsAction(ctx, await baseForm(globalRows("12", "12")));
  assert.ok(!less.ok && less.reason === "invalid" && "errors" in less, JSON.stringify(less));
  // The error carries the set's id (`at`): the screen shows it at that set, not under the whole list.
  assert.deepEqual(less.errors, [{ field: F.tierUse, key: "campaign.error.tierLess", params: { set: "Celý obchod", qty: 5, currency: "" }, at: "g" }]);
  // B14: the posted rows come back with the refusal.
  assert.deepEqual(less.values?.[F.tierUse], ["g"]);
  assert.equal(less.values?.[`${F.tierQty}g.0`]?.[0] !== undefined, true);
  const eur = await campaignsAction(ctx, await baseForm([[F.tierUse, "s"], [`${F.tierQty}s.0`, "3"], [`${F.tierAmount}s.0.CZK`, "20"], [`${F.tierAmount}s.0.EUR`, ""]]));
  assert.ok(!eur.ok && "errors" in eur, JSON.stringify(eur));
  assert.equal(eur.errors![0]!.key, "campaign.error.tierLess");
  assert.deepEqual({ qty: eur.errors![0]!.params!.qty, currency: eur.errors![0]!.params!.currency }, { qty: 3, currency: " (EUR)" });
  for (const [two, five] of [["abc", "25"], ["20", "12"], ["120", "130"]] as const) {
    const junk = await campaignsAction(ctx, await baseForm(globalRows(two, five)));
    assert.ok(!junk.ok && "errors" in junk, JSON.stringify(junk));
    assert.deepEqual(junk.errors, [{ field: F.tierUse, key: "campaign.error.tierBreaks", params: { set: "Celý obchod" }, at: "g" }], `${two} / ${five}`);
  }
  const empty = await campaignsAction(ctx, await baseForm([[F.tierUse, "g"], [`${F.tierQty}g.0`, "2"], [`${F.tierPercent}g.0`, ""]]));
  assert.ok(!empty.ok && "errors" in empty && empty.errors![0]!.key === "campaign.error.tierEmpty", JSON.stringify(empty));
  assert.equal((await loadConfig(db.prisma, shop)).config.campaigns.length, 0);
});

test("screen: the sets to choose from with their base breaks as rows; a campaign's sets worded; editing brings its rows back; unused overrides counted", async () => {
  const { ctx } = await setup();
  const first = await loadCampaignsScreen(ctx);
  assert.deepEqual(
    first.tierSets.map((s) => ({ id: s.id, label: s.label, kind: s.kind, currencies: s.currencies, rows: s.rows })),
    [
      { id: "g", label: "Celý obchod", kind: "percent", currencies: [], rows: [{ qty: "2", percent: "10" }, { qty: "5", percent: "15" }] },
      { id: "s", label: "Vybrané produkty a kolekce (1)", kind: "amount", currencies: ["CZK", "EUR"], rows: [{ qty: "3", amount: { CZK: "10", EUR: "0.40" } }] },
    ],
  );
  assert.match(first.tierSets[0]!.baseText, /od 2 ks −10\s%, od 5 ks −15\s%/);
  assert.ok((await campaignsAction(ctx, await baseForm(globalRows("20", "25")))).ok);
  const id = (await loadConfig(db.prisma, shop)).config.campaigns[0]!.id;
  const screen = await loadCampaignsScreen(ctx, { edit: id });
  const card = screen.campaigns[0]!;
  assert.equal(card.tiers.length, 1);
  assert.equal(card.tiers[0]!.label, "Celý obchod");
  assert.match(card.tiers[0]!.text, /od 2 ks −20\s%, od 5 ks −25\s%/);
  assert.deepEqual(screen.editing!.tiers[0]!.rows, [{ qty: "2", percent: "20" }, { qty: "5", percent: "25" }]);
  assert.equal(card.unused, 0);

  // A stored override that no longer applies (the base became more generous) and a gift tier's: both unused.
  const loaded = await loadConfig(db.prisma, shop);
  const { saveAndSync } = await import("../../app/lib/sync/save-and-sync.server.ts");
  const raised = structuredClone(loaded.config) as typeof loaded.config;
  raised.modules.tiers.sets[0]!.breaks = [{ minQty: 2, percent: 50 }];
  raised.campaigns[0]!.overrides.push({ ruleId: "gift", patch: { threshold: { CZK: 100 } } });
  const saved = await saveAndSync({ client: ctx.client, db: db.prisma, shop, createSync: ctx.createSync, now: () => NOW, input: raised, expectedVersion: loaded.version });
  assert.ok(saved.save.ok, JSON.stringify(saved.save));
  const after = (await loadCampaignsScreen(ctx)).campaigns[0]!;
  assert.equal(after.tiers.length, 0, "a refused override is not worded as in force");
  assert.equal(after.unused, 2);
});

test("editing keeps a stored gift tier override and replaces the tier set overrides with the form's", async () => {
  const { ctx } = await setup();
  assert.ok((await campaignsAction(ctx, await baseForm(globalRows("20", "25")))).ok);
  const loaded = await loadConfig(db.prisma, shop);
  const id = loaded.config.campaigns[0]!.id;
  const { saveAndSync } = await import("../../app/lib/sync/save-and-sync.server.ts");
  const withGift = structuredClone(loaded.config) as typeof loaded.config;
  withGift.campaigns[0]!.overrides.push({ ruleId: "gift", patch: { threshold: { CZK: 100 } } });
  assert.ok((await saveAndSync({ client: ctx.client, db: db.prisma, shop, createSync: ctx.createSync, now: () => NOW, input: withGift, expectedVersion: loaded.version })).save.ok);
  const r = await campaignsAction(ctx, await baseForm([[F.id, id], ...globalRows("30", "40")]));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.campaigns[0]!.overrides, [
    { ruleId: "g", patch: { breaks: [{ minQty: 2, percent: 30 }, { minQty: 5, percent: 40 }] } },
    { ruleId: "gift", patch: { threshold: { CZK: 100 } } },
  ]);
});
