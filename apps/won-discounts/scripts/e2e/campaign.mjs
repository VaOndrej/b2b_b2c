#!/usr/bin/env node
/* eslint-env node */
// Kampaně E2E (MVP 6, contract K9): schedule / remove the fixture's campaign on the dev store through the SAME code
// the admin runs (saveAndSync of the stored config with the campaign in it: the sync's 3-phase switch, C4 node vars)
// with the CLI AdminClient (`shopify app execute` as the app) and the app's own DB (prisma/dev.sqlite), so the
// running app (and its scheduler) sees the campaign. The window is computed in the SHOP's time zone.
//
//   node apps/won-discounts/scripts/e2e/campaign.mjs --schedule [--in 2] [--for 4]   DRY-RUN (default): the window
//                                                                                    and what would be saved.
//   NODE_ENV=development WON_DEV_PLAN=pro node …/campaign.mjs --schedule --in 2 --for 4 --live
//       replaces the E2E campaign (id e2e-campaign) with one starting <in> minutes from now (rounded up to the next
//       whole minute) and lasting <for> minutes; writes <out>/campaign-window.json {start, end, startUtc, endUtc}.
//   node …/campaign.mjs --remove [--live]       removes the E2E campaign (the seed's cleanup removes it too).
//   node …/campaign.mjs --status                read-only: the live function_config's campaign + the shop time now.
// Options: --out <dir> (default $WON_E2E_OUT or <tmp>/won-discounts-e2e) · --json. Needs the `campaign` seed
// (seed-mvp1.mjs --profile campaign --live). Only the shared dev store; nothing but the stored config is written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { CAMPAIGN_ID, CAMPAIGN_RULE_ID, e2eCampaign } from "./campaign-fixture.mjs";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const DEV_DB = path.join(APP_DIR, "prisma/dev.sqlite");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
for (const arg of argv) {
  if (arg.startsWith("--") && !["--schedule", "--remove", "--status", "--in", "--for", "--live", "--out", "--json"].includes(arg)) throw new Error(`unknown argument ${arg}`);
}
const live = flag("--live");
const mode = flag("--remove") ? "remove" : flag("--status") ? "status" : "schedule";
const inMinutes = Number(option("--in") ?? 2);
const forMinutes = Number(option("--for") ?? 4);
if (!Number.isInteger(inMinutes) || inMinutes < 1 || !Number.isInteger(forMinutes) || forMinutes < 1) throw new Error("--in / --for: whole minutes ≥ 1");
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));
fs.mkdirSync(OUT_DIR, { recursive: true });

process.env.DATABASE_URL = `file:${DEV_DB}`;
const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);
const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
const { loadConfig } = await appModule("app/lib/config.server.ts");
const { saveAndSync } = await appModule("app/lib/sync/save-and-sync.server.ts");
const { shopLocalDateTime } = await appModule("app/lib/sync/sync.server.ts");
const { addLocalMinutes, shopLocalToUtc } = await import("@won/core/discounts/campaigns");
const { PrismaClient } = await appModule("app/generated/prisma/client.ts");

const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });
// Validated with the Shopify dev MCP (admin 2026-04): read_products (app-owned shop metafield).
const SHOP_QUERY = `query WonE2eCampaignShop { shop { ianaTimezone config: metafield(namespace: "$app:won_discounts", key: "function_config") { value } } }`;

async function readShop() {
  const result = await client.graphql(SHOP_QUERY);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  const shop = result.data.shop;
  let campaign = null;
  try {
    const payload = JSON.parse(shop.config?.value ?? "null");
    const c = payload?.campaigns?.find((x) => x.id === payload.campaignId) ?? null;
    campaign = payload ? { campaignId: payload.campaignId ?? null, campaignVarsVersion: payload.campaignVarsVersion ?? null, window: c?.window ?? null, overrides: c?.overrides ?? [] } : null;
  } catch {
    campaign = null;
  }
  return { timezone: shop.ianaTimezone, now: shopLocalDateTime(new Date(), shop.ianaTimezone), live: campaign };
}

const db = new PrismaClient();
const out = { mode, live, store: STORE };
try {
  const shop = await readShop();
  out.shop = shop;
  if (mode === "status") {
    console.log(`shop time ${shop.now} (${shop.timezone}); live campaign ${shop.live?.campaignId ?? "none"}${shop.live?.window ? ` ${shop.live.window.start} → ${shop.live.window.end}` : ""}`);
  } else {
    const loaded = await loadConfig(db, STORE);
    if (!loaded.exists || !loaded.config.modules.codes.rules.some((r) => r.id === CAMPAIGN_RULE_ID)) throw new Error("no campaign seed: run seed-mvp1.mjs --profile campaign --live first");
    const others = loaded.config.campaigns.filter((c) => c.id !== CAMPAIGN_ID);
    let campaigns = others;
    if (mode === "schedule") {
      // The next whole minute + <in>: the window starts on a minute boundary like the admin's.
      const nextMinute = `${addLocalMinutes(shop.now, 1).slice(0, 16)}:00`;
      const start = addLocalMinutes(nextMinute, inMinutes - 1);
      const end = addLocalMinutes(start, forMinutes);
      campaigns = [...others, e2eCampaign(start, end)];
      out.window = { start, end, startUtc: shopLocalToUtc(start, shop.timezone).toISOString(), endUtc: shopLocalToUtc(end, shop.timezone).toISOString(), timezone: shop.timezone };
      console.log(`shop time ${shop.now} (${shop.timezone}) → campaign ${CAMPAIGN_ID} ${start} → ${end} (UTC ${out.window.startUtc} → ${out.window.endUtc})`);
    } else {
      console.log(`remove campaign ${CAMPAIGN_ID} (${loaded.config.campaigns.some((c) => c.id === CAMPAIGN_ID) ? "stored" : "not stored"})`);
    }
    if (!live) console.log("\n(dry-run: nothing written; pass --live)");
    else {
      const result = await saveAndSync({ client, db, shop: STORE, input: { ...loaded.config, campaigns }, expectedVersion: loaded.version });
      out.save = result.save.ok ? { ok: true } : result.save;
      out.sync = result.sync ? { ok: result.sync.ok, errors: result.sync.errors, pending: result.sync.pending } : null;
      console.log(`save: ${result.save.ok ? "ok" : JSON.stringify(result.save)}; sync: ${result.sync ? (result.sync.ok ? "ok" : `FAILED ${JSON.stringify(result.sync.errors)}`) : "not run"}`);
      if (!result.save.ok || !result.sync?.ok) process.exitCode = 1;
      if (mode === "schedule" && result.save.ok) fs.writeFileSync(path.join(OUT_DIR, "campaign-window.json"), JSON.stringify(out.window, null, 2));
    }
  }
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `campaign-${mode}${live ? "-live" : ""}.json`), JSON.stringify(out, null, 2));
} finally {
  await db.$disconnect();
}
