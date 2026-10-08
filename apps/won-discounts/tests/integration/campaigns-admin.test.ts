// The screens preview storefront looks with the extension's own CSS (`?raw` imports).
import "../ui/support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { ShopPlan } from "@won/core/discounts/plan-gate";

import { loadConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { campaignsAction, loadCampaignsOverview, loadCampaignsScreen } from "../../app/lib/integration/campaigns-admin.server.ts";
import { CAMPAIGN_FIELD as F, CAMPAIGN_INTENT } from "../../app/components/model/campaigns.ts";
import { recordCampaignsFinishing } from "../../app/lib/sync/sync-state.server.ts";
import { FakeShopify } from "../lib/sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { APP_KEY, formOf, quiet } from "./helpers.ts";

/** The real sync with the plan pinned (the sync run itself gates by deps.plan, BILL-1). */
const syncFor = (plan: ShopPlan): ShopCtx["createSync"] => (client, prisma) =>
  createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan, now: () => NOW });

// MVP 6 contract K7: the Kampaně admin module — the form parsed on the server (SEC-1), Pro checked there (BILL-1),
// field errors on the form's own fields (core validateCampaignDraft), every change a config save that syncs, the kill
// switch on any plan, delete only when not running, the Přehled card.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("campaigns-admin");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `campaigns-admin-${seq}.myshopify.com`;
});

// The fake shop's zone is unknown to the admin reads here (readShopContext degrades): the shop time = UTC.
const NOW = new Date("2026-10-02T10:00:00Z");

async function setup(plan: ShopPlan) {
  const fake = new FakeShopify();
  const ctx: ShopCtx = {
    shop,
    db: db.prisma,
    client: fake,
    locale: "cs",
    apiKey: APP_KEY,
    logger: quiet,
    now: () => NOW,
    createSync: syncFor(plan),
  };
  // Two rules: 10 % automatic on products, a disabled fixed 200 Kč order rule.
  const { saveAndSync } = await import("../../app/lib/sync/save-and-sync.server.ts");
  const saved = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    createSync: ctx.createSync,
    now: () => NOW,
    input: {
      modules: {
        codes: {
          rules: [
            { id: "auto", name: "Podzim 10 %", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } },
            { id: "fix", name: "Sleva 200 Kč", method: "automatic", enabled: false, value: { kind: "fixed", amount: { CZK: 20000 } }, target: { kind: "order" } },
          ],
        },
      },
    },
  });
  assert.ok(saved.save.ok, JSON.stringify(saved.save));
  return { fake, ctx };
}

const version = async () => (await loadConfig(db.prisma, shop)).version ?? "";

/** The Black Friday form; `extra` REPLACES a field of the same name (or adds it). */
const saveForm = async (extra: [string, string][] = []) => {
  const base: [string, string][] = [
    ["configVersion", await version()],
    [F.name, "Black Friday"],
    [F.startDate, "2026-11-27"],
    [F.startTime, "00:00"],
    [F.endDate, "2026-11-30"],
    [F.endTime, "23:59"],
    [F.use, "auto"],
    [`${F.percent}auto`, "30"],
    [F.use, "fix"],
    [`${F.enabled}fix`, "on"],
    [`${F.amount}fix.CZK`, "300"],
    [F.intent, CAMPAIGN_INTENT.save],
  ];
  const replaced = new Set(extra.map(([k]) => k));
  return formOf([...base.filter(([k]) => !replaced.has(k) || k === F.use), ...extra]);
};

test("save (Pro): the campaign is stored with its overrides, synced (the payload ships it as the next campaign)", async () => {
  const { fake, ctx } = await setup("pro");
  const r = await campaignsAction(ctx, await saveForm());
  assert.ok(r.ok && "kind" in r && r.kind === "saved", JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config.campaigns;
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]!.window, { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" });
  assert.deepEqual(stored[0]!.overrides, [
    { ruleId: "auto", patch: { value: { kind: "percentage", percent: 30 } } },
    { ruleId: "fix", patch: { enabled: true, value: { kind: "fixed", amount: { CZK: 30000 } } } },
  ]);
  const live = JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null };
  assert.equal(live.campaignId, stored[0]!.id, `the next campaign is selected and shipped`);
});

test("save: errors land on the form's fields; Free is refused before anything is written", async () => {
  const pro = await setup("pro");
  const bad = await campaignsAction(pro.ctx, await saveForm([[F.endDate, "2026-11-01"]]));
  assert.ok(!bad.ok && bad.reason === "invalid", JSON.stringify(bad));
  assert.deepEqual((bad as { errors: { field: string; key: string }[] }).errors.map((e) => `${e.field}:${e.key}`), [`${F.endDate}:campaign.error.order`]);
  const wrongValue = await campaignsAction(pro.ctx, await saveForm([[`${F.percent}auto`, "150"]]));
  assert.ok(!wrongValue.ok && (wrongValue as { errors: { key: string }[] }).errors[0]!.key === "campaign.error.value");
  // The error names the discount it is about (`at`), and the refusal returns what the form posted (B14).
  assert.equal((wrongValue as { errors: { at?: string }[] }).errors[0]!.at, "auto");
  assert.deepEqual((wrongValue as { values?: Record<string, string[]> }).values?.[`${F.percent}auto`], ["150"]);
  assert.deepEqual((wrongValue as { values?: Record<string, string[]> }).values?.[F.name], ["Black Friday"]);
  // A time that cannot be read lands on the time control; a missing date on the date.
  const badTime = await campaignsAction(pro.ctx, await saveForm([[F.startTime, "25:00"]]));
  assert.deepEqual((badTime as { errors: { field: string; key: string }[] }).errors[0], { field: F.startTime, key: "campaign.error.time" });
  const noDate = await campaignsAction(pro.ctx, await saveForm([[F.endDate, ""]]));
  assert.deepEqual((noDate as { errors: { field: string; key: string }[] }).errors[0], { field: F.endDate, key: "campaign.error.date" });

  shop = `${shop}-free`;
  const free = await setup("free");
  const refused = await campaignsAction(free.ctx, await saveForm());
  assert.ok(!refused.ok && (refused as { errors: { key: string }[] }).errors[0]!.key === "campaign.error.pro");
  assert.equal((await loadConfig(db.prisma, shop)).config.campaigns.length, 0);
});

test("overlap is refused naming the other campaign (A8); editing keeps the id", async () => {
  const { ctx } = await setup("pro");
  await campaignsAction(ctx, await saveForm());
  const id = (await loadConfig(db.prisma, shop)).config.campaigns[0]!.id;
  const clash = await campaignsAction(ctx, await saveForm([[F.name, "Druhá"]]));
  assert.ok(!clash.ok);
  const err = (clash as { errors: { key: string; params?: Record<string, unknown> }[] }).errors[0]!;
  assert.equal(err.key, "campaign.error.overlap");
  assert.equal(err.params?.other, "Black Friday");
  const edit = await campaignsAction(ctx, await saveForm([[F.id, id], [F.name, "Black Friday 2026"]]));
  assert.ok(edit.ok, JSON.stringify(edit));
  const stored = (await loadConfig(db.prisma, shop)).config.campaigns;
  assert.deepEqual(stored.map((c) => [c.id, c.name]), [[id, "Black Friday 2026"]]);
});

test("kill switch works on any plan and syncs at once; a running campaign cannot be deleted, a killed one can", async () => {
  const { fake, ctx } = await setup("pro");
  const running = formOf([
    [F.intent, CAMPAIGN_INTENT.save],
    ["configVersion", await version()],
    [F.name, "Teď"],
    [F.startDate, "2026-10-02"],
    [F.startTime, "10:00"],
    [F.endDate, "2026-10-03"],
    [F.endTime, "10:00"],
    [F.use, "auto"],
    [`${F.percent}auto`, "50"],
  ]);
  assert.ok((await campaignsAction(ctx, running)).ok);
  const id = (await loadConfig(db.prisma, shop)).config.campaigns[0]!.id;
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string }).campaignId, id);
  const del = await campaignsAction(ctx, formOf([[F.intent, CAMPAIGN_INTENT.delete], [F.id, id], ["configVersion", await version()]]));
  assert.ok(!del.ok && (del as { errors: { key: string }[] }).errors[0]!.key === "campaign.error.deleteRunning");
  const kill = await campaignsAction(ctx, formOf([[F.intent, CAMPAIGN_INTENT.kill], [F.id, id], ["configVersion", await version()]]));
  assert.ok(kill.ok && "kind" in kill && kill.kind === "killed", JSON.stringify(kill));
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null }).campaignId, null, "off in the live config");
  const gone = await campaignsAction(ctx, formOf([[F.intent, CAMPAIGN_INTENT.delete], [F.id, id], ["configVersion", await version()]]));
  assert.ok(gone.ok, JSON.stringify(gone));
  assert.equal((await loadConfig(db.prisma, shop)).config.campaigns.length, 0);
});

test("screen: campaigns by status with shop-time windows and worded overrides; the rules to choose from; ?edit only for a live one", async () => {
  const { ctx } = await setup("pro");
  await campaignsAction(ctx, await saveForm());
  const id = (await loadConfig(db.prisma, shop)).config.campaigns[0]!.id;
  const screen = await loadCampaignsScreen(ctx, { edit: id });
  assert.equal(screen.campaigns[0]!.status, "scheduled");
  assert.equal(screen.campaigns[0]!.startText.replace(/\s/g, " "), "27. 11. 2026 0:00");
  assert.deepEqual(
    screen.campaigns[0]!.overrides.map((o) => [o.ruleName, o.enabled ?? null, o.valueText?.replace(/\s/g, " ") ?? null]),
    [
      ["Podzim 10 %", null, "30 %"],
      ["Sleva 200 Kč", true, "300 Kč"],
    ],
  );
  assert.equal(screen.campaigns[0]!.tryCartUrl, "/app/try-cart?date=2026-11-27&time=00:01");
  assert.deepEqual(screen.rules.map((r) => [r.id, r.kind, r.currencies]), [["auto", "percentage", []], ["fix", "fixed", ["CZK"]]]);
  assert.equal(screen.editing?.id, id);
  assert.deepEqual(screen.editing?.overrides[1]!.amount, { CZK: "300" });
  assert.equal(screen.today, "2026-10-02");
});

test("Přehled card: the running and the next campaign; on Free a campaign finishing after the downgrade says so", async () => {
  const { ctx } = await setup("pro");
  assert.deepEqual(await loadCampaignsOverview(ctx), { running: null, next: null, finishing: false });
  await campaignsAction(ctx, await saveForm());
  const card = await loadCampaignsOverview(ctx);
  assert.deepEqual(card, { running: null, next: { name: "Black Friday", startText: "27. 11. 2026 0:00" }, finishing: false });
  const free = { ...ctx, createSync: syncFor("free"), now: () => new Date("2026-11-28T10:00:00Z") };
  const id = (await loadConfig(db.prisma, shop)).config.campaigns[0]!.id;
  await recordCampaignsFinishing(db.prisma, shop, [id]);
  assert.deepEqual(await loadCampaignsOverview(free), { running: { name: "Black Friday", endText: "30. 11. 2026 23:59" }, next: null, finishing: true });
});

test("screen: Free shows the form locked in the amber Pro frame (§16b), never red; Pro has the form enabled; no id on screen", async () => {
  const { createElement } = await import("react");
  const { CampaignsScreen } = await import("../../app/components/screens/CampaignsScreen.tsx");
  const { devCampaignsScreen } = await import("../../app/lib/dev-harness.server.ts");
  const { WON_AMBER } = await import("../../app/components/shell/tokens.ts");
  const { renderPage, text } = await import("./helpers.ts");
  const free = await renderPage(createElement(CampaignsScreen, devCampaignsScreen({ plan: "free", state: null, locale: "cs", edit: null })));
  assert.ok(free.includes(WON_AMBER), "amber Pro frame");
  assert.match(free, /<s-button[^>]*type="submit"[^>]*variant="primary"[^>]*disabled/, "save disabled on Free");
  const pro = await renderPage(createElement(CampaignsScreen, devCampaignsScreen({ plan: "pro", state: null, locale: "cs", edit: null })));
  assert.doesNotMatch(pro, /<s-button[^>]*type="submit"[^>]*variant="primary"[^>]*disabled/);
  assert.doesNotMatch(text(pro.replace(/<[^>]+>/g, " ")), /gid:\/\/shopify|dev-fixture/, "never an id on screen (§4c)");
});

test("audit C2: editing a running campaign does not restrict its (past) start date; a new one starts today at the earliest", async () => {
  const { createElement } = await import("react");
  const { CampaignsScreen } = await import("../../app/components/screens/CampaignsScreen.tsx");
  const { devCampaignsScreen } = await import("../../app/lib/dev-harness.server.ts");
  const { renderPage } = await import("./helpers.ts");
  const edit = await renderPage(createElement(CampaignsScreen, devCampaignsScreen({ plan: "pro", state: null, locale: "cs", edit: "weekend" })));
  const startField = /<s-date-field[^>]*name="cp\.startDate"[^>]*>/.exec(edit)![0];
  assert.doesNotMatch(startField, /allow=/, "the running campaign's start (26. 9.) stays valid");
  const fresh = await renderPage(createElement(CampaignsScreen, devCampaignsScreen({ plan: "pro", state: null, locale: "cs", edit: null })));
  assert.match(/<s-date-field[^>]*name="cp\.startDate"[^>]*>/.exec(fresh)![0], /allow="2026-09-28--"/);
});

test("form model: an unticked discount's fields are never read (B7); the times are picked from a list; the form's values are computed for the seed", async () => {
  const { campaignFieldNames, campaignFormValues, campaignTimeOptions, readCampaignForm } = await import("../../app/components/model/campaigns.ts");
  const kinds = new Map([["auto", { kind: "percentage", currencies: [] as string[] }]]);
  // The percent is posted, the box is not ticked: nothing of it reaches the draft (the screen shows the field only when ticked).
  const unticked = readCampaignForm(formOf([[F.name, "X"], [`${F.percent}auto`, "30"]]), kinds);
  assert.deepEqual(unticked.draft.overrides, []);
  const ticked = readCampaignForm(formOf([[F.name, "X"], [F.use, "auto"], [`${F.percent}auto`, "30"]]), kinds);
  assert.deepEqual(ticked.draft.overrides, [{ ruleId: "auto", value: { kind: "percentage", percent: 30 } }]);

  const times = campaignTimeOptions();
  assert.equal(times.length, 24 * 4 + 1);
  assert.deepEqual([times[0], times[1], times.at(-2), times.at(-1)], ["00:00", "00:15", "23:45", "23:59"]);
  assert.ok(campaignTimeOptions("08:07").includes("08:07"), "a stored time off the grid stays selectable");

  const rules = [{ id: "auto", name: "Podzim", kind: "percentage", enabled: true, method: "automatic" as const, valueText: "10 %", currencies: [] }];
  const sets = [{ id: "g", label: "Celý obchod", kind: "percent" as const, currencies: [], baseText: "", rows: [{ qty: "3", percent: "10" }] }];
  assert.deepEqual(campaignFormValues(null, rules, sets), { [F.startTime]: ["00:00"], [F.endTime]: ["23:59"], [`${F.tierQty}g.0`]: ["3"], [`${F.tierPercent}g.0`]: ["10"] });
  const names = campaignFieldNames(rules, sets);
  assert.ok(names.includes(`${F.percent}auto`) && names.includes(`${F.tierQty}g.9`) && names.includes(F.endTime));
});
