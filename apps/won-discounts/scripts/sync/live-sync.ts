// Run the Won Discounts sync against the dev store from the terminal.
//
// DRY-RUN by default: every READ goes to the dev store (`shopify app execute`
// as the app), every MUTATION is printed with its variables and answered with
// a synthetic response — nothing in Shopify changes. WonNode/SyncRun rows go
// to a throwaway SQLite file (seeded with the real WonNode rows when
// DATABASE_URL is set, read-only), so the plan matches what the app tracks.
//
//   npx tsx apps/won-discounts/scripts/sync/live-sync.ts --config apps/won-discounts/scripts/sync/sample-config.json
//
// LIVE (dev store only — the CLI client refuses mutations elsewhere; needs the
// app's DATABASE_URL so WonNode stays the app's own):
//
//   node --env-file=apps/won-discounts/.env --import tsx \
//     apps/won-discounts/scripts/sync/live-sync.ts --config <file.json> --live
//
// Options: --config <file> | --from-db (the shop's stored config, DATABASE_URL;
//          refused when the row is missing, unreadable or from a newer schema)
//          --shop <domain> (default: the dev store) · --live · --json
//          --markets  read-only: print the shop's Shopify markets and countries
//
// A config that targets a market gets the Shopify countries merged in first
// (the same as saveAndSync does before saving).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sanitizeConfig } from "@won/core/discounts/config";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { createCliAdminClient, DEV_STORE } from "../../app/lib/admin-client-cli.server.ts";
import { loadConfig } from "../../app/lib/config.server.ts";
import { loadShopMarketsWith, targetsMarkets, withShopMarkets } from "../../app/lib/sync/markets.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import type { ConfigView } from "../../app/lib/sync/types.ts";
import { consoleSyncLogger, productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { DryRunClient } from "./dry-run-client.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");

interface Args {
  config: string | null;
  fromDb: boolean;
  shop: string;
  live: boolean;
  json: boolean;
  markets: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { config: null, fromDb: false, shop: DEV_STORE, live: false, json: false, markets: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i] ?? null;
    else if (arg === "--from-db") args.fromDb = true;
    else if (arg === "--shop") args.shop = argv[++i] ?? DEV_STORE;
    else if (arg === "--live") args.live = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--markets") args.markets = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (args.markets) return args;
  if (!args.config && !args.fromDb) throw new Error("pass --config <file.json>, --from-db or --markets");
  if (args.live && args.shop !== DEV_STORE) throw new Error(`--live runs only on the dev store ${DEV_STORE}`);
  return args;
}

/** Throwaway SQLite with every committed migration (same as the tests), seeded with the app's WonNode rows. */
async function dryRunDatabase(shop: string): Promise<{ db: PrismaClient; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "won-sync-dry-run-"));
  const url = `file:${path.join(dir, "dry-run.sqlite")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: APP_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasourceUrl: url });
  if (process.env.DATABASE_URL) {
    const real = new PrismaClient();
    try {
      const rows = await real.wonNode.findMany({ where: { shop } });
      for (const row of rows) await db.wonNode.create({ data: row });
      const products = await real.productTargetIndex.findMany({ where: { shop } });
      for (const row of products) await db.productTargetIndex.create({ data: row });
      console.log(`dry-run: seeded ${rows.length} tracked node(s) and ${products.length} indexed product(s) from the app database (read-only)`);
    } finally {
      await real.$disconnect();
    }
  }
  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.markets) {
    const markets = await loadShopMarketsWith(createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: args.shop }));
    console.log(`# Shopify markets of ${args.shop} (read-only)`);
    for (const m of markets) console.log(`${m.handle}\t${m.active ? "ACTIVE" : "inactive"}\t${m.currency ?? "-"}\t${m.countries.join(",")}`);
    return;
  }
  console.log(`# Won Discounts sync — ${args.live ? `LIVE on ${args.shop}` : `DRY-RUN (reads ${args.shop}, writes nothing; pass --live to execute)`}`);

  let config: ConfigView;
  if (args.config) {
    const { config: sanitized, issues } = sanitizeConfig(JSON.parse(readFileSync(args.config, "utf8")));
    for (const issue of issues) console.log(`config issue: ${issue.path}: ${issue.message}`);
    config = sanitized;
  } else {
    const real = new PrismaClient();
    try {
      const loaded = await loadConfig(real, args.shop);
      // I3: never sync the defaults that stand in for a missing or unreadable row.
      if (!loaded.exists) throw new Error(`no config is saved for ${args.shop}; refusing to sync the defaults`);
      if (loaded.unreadable) throw new Error("the stored config cannot be read; refusing to sync (it would remove every Won discount)");
      if (loaded.readOnly) throw new Error("the stored config belongs to a newer schema; refusing to sync it");
      config = loaded.config;
    } finally {
      await real.$disconnect();
    }
  }
  if (targetsMarkets(config)) {
    const merged = withShopMarkets(config, await loadShopMarketsWith(createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: args.shop })));
    config = merged.config;
    if (merged.missing.length) console.log(`markets not in Shopify: ${merged.missing.join(", ")}`);
  }

  const cli = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: args.shop });
  let db: PrismaClient;
  let cleanup = async () => {};
  let client: AdminClient = cli;
  let dry: DryRunClient | null = null;
  if (args.live) {
    if (!process.env.DATABASE_URL) throw new Error("--live needs the app's DATABASE_URL (node --env-file=apps/won-discounts/.env …)");
    db = new PrismaClient();
    cleanup = () => db.$disconnect();
  } else {
    ({ db, cleanup } = await dryRunDatabase(args.shop));
    dry = new DryRunClient(cli);
    client = dry;
  }

  try {
    const result = await createSync(productionSyncDeps(client, db, consoleSyncLogger)).syncShop(args.shop, config);
    console.log(`\n# result: ${result.ok ? "ok" : "FAILED"}${dry ? ` (dry-run: ${dry.planned.length} mutation(s) planned)` : ""}`);
    for (const step of result.steps) console.log(`${step.ok ? "✔" : "✖"} ${step.step} — ${step.detail}`);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
