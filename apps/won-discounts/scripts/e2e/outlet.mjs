#!/usr/bin/env node
/* eslint-env node */
// Výprodej E2E (MVP 5, contract O11): start / end the fixture's sales on the dev store through the SAME code the
// admin runs (app/lib/integration/outlet.server.ts startOutletRun / endOutletRun) with the CLI AdminClient
// (`shopify app execute` as the app) and the app's own DB (prisma/dev.sqlite, what `shopify app dev` uses), so
// the running app sees the sales, their history and their backups.
//
//   node apps/won-discounts/scripts/e2e/outlet.mjs [--start]          DRY-RUN (default): reads the variants and
//                                                                     the price lists, prints every price the
//                                                                     start would write. Writes nothing.
//   NODE_ENV=development WON_DEV_PLAN=pro node …/outlet.mjs --start --live
//       backs up the current prices to <out>/outlet-backup.json (only when no backup exists yet), then starts each
//       sale (the app backs up again in its own row, write-ahead, before any write).
//   node …/outlet.mjs --end [--live]          ends every fixture sale not ended yet (prices back, flags off).
//   node …/outlet.mjs --verify-restored       read-only: the current prices = <out>/outlet-backup.json, no flag,
//                                             no storefront value; prints 3 records; exit 1 on a mismatch.
//   node …/outlet.mjs --status                read-only: the fixture's sales in the DB (ledger + the last 20 steps)
//                                             + the live prices (the 5b order specs poll <out>/outlet-status.json).
// Options: --out <dir> (default $WON_E2E_OUT or <tmp>/won-discounts-e2e) · --json · --only <handle> (--start: just
// that fixture sale — the 5b quota spec starts the sale it sold out again for the next theme of the matrix).
// Only the shared dev store; the fixture's products only (won-e2e-*), no product is created.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { OUTLET_SALES } from "./outlet-fixture.mjs";

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
  if (arg.startsWith("--") && !["--start", "--end", "--status", "--verify-restored", "--live", "--out", "--json", "--only"].includes(arg)) {
    throw new Error(`unknown argument ${arg}`);
  }
}
const live = flag("--live");
const mode = flag("--end") ? "end" : flag("--status") ? "status" : flag("--verify-restored") ? "verify" : "start";
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));
const BACKUP_FILE = path.join(OUT_DIR, "outlet-backup.json");
fs.mkdirSync(OUT_DIR, { recursive: true });

process.env.DATABASE_URL = `file:${DEV_DB}`;
const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);
const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
const { startOutletRun, endOutletRun } = await appModule("app/lib/integration/outlet.server.ts");
const { GQL } = await appModule("app/lib/sync/graphql.ts");
const { outletPricesFor } = await import("@won/core/discounts/outlet");
const { toMinorUnits } = await import("@won/core/discounts/money");
const { PrismaClient } = await appModule("app/generated/prisma/client.ts");

const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });
async function query(document, variables) {
  const result = await client.graphql(document, variables);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

// Validated with the Shopify dev MCP (admin 2026-04): read_products.
const VARIANTS_QUERY = `query WonE2eOutletVariants($a: String!, $b: String!) {
  a: productByIdentifier(identifier: { handle: $a }) { id handle variants(first: 10) { nodes { id title price compareAtPrice
    flag: metafield(namespace: "$app:won_discounts", key: "outlet") { value } } }
    badge: metafield(namespace: "$app:won_discounts", key: "outlet") { value } }
  b: productByIdentifier(identifier: { handle: $b }) { id handle variants(first: 10) { nodes { id title price compareAtPrice
    flag: metafield(namespace: "$app:won_discounts", key: "outlet") { value } } }
    badge: metafield(namespace: "$app:won_discounts", key: "outlet") { value } }
}`;

async function readState() {
  const data = await query(VARIANTS_QUERY, { a: OUTLET_SALES[0].handle, b: OUTLET_SALES[1].handle });
  const lists = (await query(GQL.outletPriceLists)).priceLists.nodes;
  const sales = [];
  for (const [i, sale] of OUTLET_SALES.entries()) {
    const product = data[i === 0 ? "a" : "b"];
    if (!product) throw new Error(`no product ${sale.handle}`);
    const variant = product.variants.nodes.find((v) => (sale.variant ? v.title === sale.variant : true));
    if (!variant) throw new Error(`no variant ${sale.variant} of ${sale.handle}`);
    const picked = lists.filter((l) => sale.catalogs.includes(l.catalog?.title ?? ""));
    const fixed = [];
    for (const l of picked) {
      const p = await query(GQL.outletPriceListPrices, { id: l.id, query: `product_id:${product.id.split("/").pop()}` });
      const node = p.priceList?.prices?.nodes?.find((n) => n.variant?.id === variant.id) ?? null;
      fixed.push({ id: l.id, title: l.catalog?.title ?? l.name, currency: l.currency, price: node?.price?.amount ?? null, compareAt: node?.compareAtPrice?.amount ?? null });
    }
    sales.push({ ...sale, productId: product.id, variantId: variant.id, price: variant.price, compareAt: variant.compareAtPrice, flag: variant.flag?.value ?? null, badge: product.badge?.value ?? null, lists: fixed });
  }
  return sales;
}

const minor = (amount) => (amount === null || amount === undefined ? null : toMinorUnits(String(amount), "CZK"));
const db = new PrismaClient();
const out = { mode, live, store: STORE, sales: [] };
try {
  const state = await readState();
  if (mode === "status" || mode === "verify") {
    const runs = await db.outletRun.findMany({ where: { shop: STORE, variantId: { in: state.map((s) => s.variantId) } }, orderBy: { createdAt: "desc" } });
    const events = runs.length ? await db.outletEvent.findMany({ where: { shop: STORE, runId: { in: runs.map((r) => r.id) } }, orderBy: { at: "desc" } }) : [];
    out.sales = state.map((s) => ({
      ...s,
      runs: runs
        .filter((r) => r.variantId === s.variantId)
        .map((r) => ({ id: r.id, status: r.status, quota: r.quota, sold: r.sold, returned: r.returned, endReason: r.endReason, error: r.error, events: events.filter((e) => e.runId === r.id).slice(0, 20).map((e) => ({ kind: e.kind, qty: e.qty, at: e.at })) })),
    }));
    if (mode === "verify") {
      const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
      const problems = [];
      for (const s of state) {
        const b = backup.find((x) => x.variantId === s.variantId);
        if (!b) problems.push(`${s.handle}: no backup`);
        else {
          if (s.price !== b.price) problems.push(`${s.handle}: price ${s.price} ≠ backup ${b.price}`);
          if ((s.compareAt ?? null) !== (b.compareAt ?? null)) problems.push(`${s.handle}: compareAt ${s.compareAt} ≠ backup ${b.compareAt}`);
          for (const l of s.lists) {
            const bl = b.lists.find((x) => x.id === l.id);
            if (bl && (l.price !== bl.price || (l.compareAt ?? null) !== (bl.compareAt ?? null))) problems.push(`${s.handle}: list ${l.title} ${l.price}/${l.compareAt} ≠ backup ${bl.price}/${bl.compareAt}`);
          }
        }
        if (s.flag !== null) problems.push(`${s.handle}: the variant still carries the sale flag`);
        if (s.badge !== null) problems.push(`${s.handle}: the product still carries the storefront value`);
      }
      out.problems = problems;
      for (const s of state) console.log(`${s.handle}${s.variant ? ` ${s.variant}` : ""}: price ${s.price}, compareAt ${s.compareAt ?? "—"}, flag ${s.flag ?? "—"}, lists ${s.lists.map((l) => `${l.title} ${l.price}/${l.compareAt ?? "—"}`).join(", ") || "—"}`);
      console.log(problems.length ? `✘ ${problems.join(" | ")}` : "✔ every price = the backup, no flag, no storefront value");
      process.exitCode = problems.length ? 1 : 0;
    }
  } else if (mode === "start") {
    const only = option("--only");
    if (only && !state.some((s) => s.handle === only)) throw new Error(`--only ${only}: not a fixture sale`);
    const picked = only ? state.filter((s) => s.handle === only) : state;
    for (const s of picked) {
      const sale = outletPricesFor({ price: minor(s.price), compareAt: minor(s.compareAt) }, s.percent, "strike_badge");
      const lists = s.lists.map((l) => ({ ...l, sale: l.price === null ? null : outletPricesFor({ price: minor(l.price), compareAt: minor(l.compareAt) }, s.percent, "strike_badge") }));
      out.sales.push({ handle: s.handle, variant: s.variant, before: { price: s.price, compareAt: s.compareAt }, after: sale, lists });
      console.log(`${s.handle}${s.variant ? ` ${s.variant}` : ""}: ${s.price} → ${sale ? sale.price / 100 : "no effect"} (compareAt ${sale ? sale.compareAt / 100 : "—"}), quota ${s.quota}${lists.length ? `; ${lists.map((l) => `${l.title}: ${l.price ?? "no fixed price"} → ${l.sale ? l.sale.price / 100 : "skipped"}`).join(", ")}` : ""}`);
    }
    if (!live) {
      console.log("\n(dry-run: nothing written; pass --live)");
    } else {
      if (process.env.WON_DEV_PLAN !== "pro") throw new Error("a sale needs Pro: run with NODE_ENV=development WON_DEV_PLAN=pro");
      if (!fs.existsSync(BACKUP_FILE)) fs.writeFileSync(BACKUP_FILE, JSON.stringify(state.map((s) => ({ handle: s.handle, variantId: s.variantId, price: s.price, compareAt: s.compareAt, lists: s.lists })), null, 2));
      console.log(`# backup: ${BACKUP_FILE}`);
      const lists = (await query(GQL.outletPriceLists)).priceLists.nodes;
      for (const s of picked) {
        const priceListIds = lists.filter((l) => s.catalogs.includes(l.catalog?.title ?? "")).map((l) => l.id);
        const r = await startOutletRun({ shop: STORE, db, client, plan: async () => "pro" }, { variantId: s.variantId, productId: s.productId, quota: s.quota, percent: s.percent, endsAt: null, priceListIds });
        out.sales.push({ handle: s.handle, result: r });
        console.log(`${s.handle}: ${r.ok ? `started ${r.runId}${r.skippedLists.length ? ` (${r.skippedLists.length} list(s) skipped)` : ""}` : `FAILED ${JSON.stringify(r)}`}`);
        if (!r.ok) process.exitCode = 1;
      }
    }
  } else if (mode === "end") {
    const runs = await db.outletRun.findMany({ where: { shop: STORE, variantId: { in: state.map((s) => s.variantId) }, status: { not: "ended" } } });
    for (const r of runs) console.log(`${r.variantId}: ${r.status} → end${live ? "" : " (dry-run)"}`);
    if (!live) console.log("\n(dry-run: nothing written; pass --live)");
    else {
      for (const r of runs) {
        const ended = await endOutletRun({ shop: STORE, db, client }, r.id, "manual");
        console.log(`${r.id}: ${ended.ok ? "ended, prices back" : `FAILED ${JSON.stringify(ended)}`}`);
        if (!ended.ok) process.exitCode = 1;
      }
    }
  }
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `outlet-${mode}${live ? "-live" : ""}.json`), JSON.stringify(out, null, 2));
} finally {
  await db.$disconnect();
}
