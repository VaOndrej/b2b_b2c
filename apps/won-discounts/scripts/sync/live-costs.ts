// Run the margin cost mirror's full pass (app/lib/sync/costs.ts runCostPass)
// against the dev store from the terminal.
//
// DRY-RUN by default: every READ goes to the store (`shopify app execute` as
// the app), every MUTATION is printed with its variables and answered with a
// synthetic success — nothing in Shopify changes. The VariantCost rows go to a
// throwaway SQLite file built from the committed migrations.
//
//   npx tsx apps/won-discounts/scripts/sync/live-costs.ts
//
// LIVE (dev store only — the CLI client refuses mutations elsewhere; needs the
// app's DATABASE_URL so the mirror rows are the app's own):
//
//   node --env-file=apps/won-discounts/.env --import tsx apps/won-discounts/scripts/sync/live-costs.ts --live
//
// Options: --shop <domain> (default: the dev store) · --live · --clear (the
// "protection switched off" clear instead of the pass) · --json

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient, AdminGraphQLResult } from "../../app/lib/admin-client.server.ts";
import { createCliAdminClient, DEV_STORE, operationKind } from "../../app/lib/admin-client-cli.server.ts";
import { clearCostMirror, runCostPass } from "../../app/lib/sync/costs.ts";
import { operationName } from "../../app/lib/sync/graphql.ts";
import { Transport } from "../../app/lib/sync/transport.ts";
import { consoleSyncLogger } from "../../app/lib/sync/wiring.server.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");

interface Args {
  shop: string;
  live: boolean;
  clear: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { shop: DEV_STORE, live: false, clear: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--shop") args.shop = argv[++i] ?? DEV_STORE;
    else if (arg === "--live") args.live = true;
    else if (arg === "--clear") args.clear = true;
    else if (arg === "--json") args.json = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (args.live && args.shop !== DEV_STORE) throw new Error(`--live runs only on the dev store ${DEV_STORE}`);
  return args;
}

interface Planned {
  op: string;
  set?: { variantId: string; value: string }[];
  delete?: string[];
}

/** Reads pass through; the metafield mutations are printed and answered synthetically. */
class DryRunClient implements AdminClient {
  readonly planned: Planned[] = [];

  constructor(private readonly real: AdminClient) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async graphql(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<any>> {
    const op = operationName(query);
    if (operationKind(query) !== "mutation") return this.real.graphql(query, variables);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (variables ?? {}) as Record<string, any>;
    if (op === "WonSyncMetafieldsSet") {
      const set = (v.metafields as { ownerId: string; value: string }[]).map((mf) => ({ variantId: mf.ownerId, value: mf.value }));
      this.planned.push({ op, set });
      console.log(`--- would send ${op} (${set.length}) ---\n${set.map((s) => `  ${s.variantId} = ${s.value}`).join("\n")}`);
      return { data: { metafieldsSet: { metafields: [], userErrors: [] } } };
    }
    if (op === "WonSyncMetafieldsDelete") {
      const del = (v.metafields as { ownerId: string }[]).map((mf) => mf.ownerId);
      this.planned.push({ op, delete: del });
      console.log(`--- would send ${op} (${del.length}) ---\n${del.map((id) => `  ${id}`).join("\n")}`);
      return { data: { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } };
    }
    throw new Error(`dry-run: no synthetic response for ${op}`);
  }
}

async function dryRunDatabase(): Promise<{ db: PrismaClient; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "won-costs-dry-run-"));
  const url = `file:${path.join(dir, "dry-run.sqlite")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: APP_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasourceUrl: url });
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
  console.log(
    `# Won Discounts cost mirror ${args.clear ? "clear" : "full pass"} — ${args.live ? `LIVE on ${args.shop}` : `DRY-RUN (reads ${args.shop}, writes nothing; pass --live to execute)`}`,
  );
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
    ({ db, cleanup } = await dryRunDatabase());
    dry = new DryRunClient(cli);
    client = dry;
  }
  try {
    const transport = new Transport(client, undefined, undefined, consoleSyncLogger);
    const ctx = { transport, db, shop: args.shop };
    if (args.clear) {
      const result = await clearCostMirror(ctx);
      console.log(`\n# result: ${result.outcome}, ${result.cleared} metafield(s) cleared${result.errors.length ? `; ${result.errors.join("; ")}` : ""}`);
      process.exitCode = result.outcome === "done" ? 0 : 1;
      return;
    }
    const result = await runCostPass({ ...ctx, now: () => new Date(), restart: true });
    const rows = await db.variantCost.findMany({ where: { shop: args.shop }, orderBy: { variantId: "asc" } });
    const withCost = rows.filter((r) => r.cost !== null && Number(r.cost) > 0);
    console.log(
      `\n# result: ${result.outcome} — ${result.read} variant(s) read, ${result.written} metafield(s) ${dry ? "to write" : "written"}, ` +
        `${result.cleared} ${dry ? "to delete" : "deleted"}, ${rows.length} row(s) mirrored, ${withCost.length} with a cost` +
        (result.errors.length ? `; errors: ${result.errors.join("; ")}` : ""),
    );
    for (const row of withCost) console.log(`  ${row.variantId}  ${row.title ?? ""}${row.variantTitle ? ` (${row.variantTitle})` : ""}  price ${row.price}  cost ${row.cost} ${row.currency}`);
    if (args.json) console.log(JSON.stringify({ result, planned: dry?.planned ?? [] }, null, 2));
    process.exitCode = result.outcome === "done" ? 0 : 1;
  } finally {
    await cleanup();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
