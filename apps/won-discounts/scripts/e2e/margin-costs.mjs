#!/usr/bin/env node
/* eslint-env node */
// The cost mirror for the margin checkout E2E (MVP 2, Task 5b): a thin wrapper
// around the canonical script scripts/sync/live-costs.ts (app/lib/sync/costs.ts
// runCostPass / clearCostMirror, as the app's cost lane runs them) that adds
// what the E2E needs around it: the lane's guard (a pass only while the STORED
// config, gated for the plan, has margin protection on; a clear only while it
// is off), a real dry-run of the clear, and a read-back of the variant
// metafields the function reads.
//
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs
//       DRY-RUN of the full pass: live-costs.ts without --live (reads every
//       variant as the app, prints the metafieldsSet/Delete it would send; the
//       mirror rows go to a throwaway SQLite). Writes nothing.
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
//       the full pass for real (live-costs.ts --live on the app's own DB), then
//       the read-back.
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear
//       DRY-RUN of the "protection switched off" clear: the mirror rows that
//       carry a metafield (app DB, read only) and the value Shopify has for each
//       — exactly what `--clear --live` deletes. Writes nothing.
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear --live
//       the clear for real (live-costs.ts --clear --live), then the read-back.
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --readback
//       read-only: every variant of every won-e2e-* product with its price, its
//       Shopify cost and the `$app:won_discounts`/`variant` metafield value.
//
// Options: --out <dir> (read-back evidence; default $WON_E2E_OUT or
// <tmp>/won-discounts-e2e) · --json (print the read-back).
//
// DB: DATABASE_URL = the dev app's SQLite (apps/won-discounts/prisma/dev.sqlite,
// what `shopify app dev` uses), set here as an absolute URL, so no .env is read.
// Only Prisma opens it; this script prints variant ids and counts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

import { WON_E2E_PRODUCT_LIST } from "@won/testing/e2e-products";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const DEV_DB = path.join(APP_DIR, "prisma/dev.sqlite");
const LIVE_COSTS = path.join(APP_DIR, "scripts/sync/live-costs.ts");
const E2E_HANDLES = WON_E2E_PRODUCT_LIST.map((product) => product.handle);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
for (const [i, arg] of argv.entries()) {
  if (argv[i - 1] === "--out") continue;
  if (!["--live", "--clear", "--readback", "--json", "--out"].includes(arg)) throw new Error(`unknown argument ${arg}`);
}
const live = flag("--live");
const clear = flag("--clear");
const readbackOnly = flag("--readback");
const printJson = flag("--json");
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));

process.env.DATABASE_URL = `file:${DEV_DB}`;

const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);
const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
const { loadConfig } = await appModule("app/lib/config.server.ts");
const { planOf } = await appModule("app/lib/plan.server.ts");
const { gateConfigForPlan } = await import("@won/core/discounts/plan-gate");

const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });

async function query(document, variables) {
  const result = await client.graphql(document, variables);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// Validated with the Shopify dev MCP (admin 2026-04): read_products.
const READBACK_QUERY = `query WonE2eVariantCosts($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    variants(first: 50) {
      nodes {
        id
        title
        price
        inventoryItem {
          unitCost {
            amount
            currencyCode
          }
        }
        metafield(namespace: "$app:won_discounts", key: "variant") {
          value
        }
      }
    }
  }
}`;

/** Every won-e2e-* variant: price, Shopify cost, the variant metafield (null = none). */
async function readback() {
  const products = [];
  for (const handle of E2E_HANDLES) {
    const product = (await query(READBACK_QUERY, { handle })).productByIdentifier;
    if (!product) {
      products.push({ handle, missing: true });
      continue;
    }
    products.push({
      handle,
      id: product.id,
      variants: product.variants.nodes.map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price,
        unitCost: v.inventoryItem?.unitCost ? `${v.inventoryItem.unitCost.amount} ${v.inventoryItem.unitCost.currencyCode}` : null,
        wonVariantMetafield: v.metafield?.value ?? null,
      })),
    });
  }
  const variants = products.flatMap((p) => p.variants ?? []);
  const result = {
    checkedAt: new Date().toISOString(),
    store: STORE,
    products,
    withMetafield: variants.filter((v) => v.wonVariantMetafield !== null).length,
    withCost: variants.filter((v) => v.unitCost !== null).length,
  };
  console.log(`\n# read-back ${result.checkedAt}: ${variants.length} won-e2e variant(s), ${result.withCost} with a Shopify cost, ${result.withMetafield} with the variant metafield`);
  for (const p of products) {
    for (const v of p.variants ?? []) {
      console.log(`  ${p.handle.padEnd(22)} ${v.title.padEnd(12)} ${v.id}  price ${v.price}  cost ${v.unitCost ?? "—"}  metafield ${v.wonVariantMetafield ?? "—"}`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `margin-costs-readback-${stamp()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Evidence: ${file}`);
  if (printJson) console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Margin protection in the stored config as the shop's plan runs it (the cost lane's own check). */
async function storedMargin(db) {
  const loaded = await loadConfig(db, STORE);
  if (loaded.unreadable || loaded.readOnly) throw new Error("the stored config cannot be read; refusing (nothing was sent)");
  if (!loaded.exists) return { enabled: false, plan: null };
  const plan = await planOf(STORE);
  return { enabled: gateConfigForPlan(loaded.config, plan).config.modules.margin.enabled === true, plan };
}

function runLiveCosts(args) {
  const shown = ["npx", "tsx", path.relative(REPO_ROOT, LIVE_COSTS), ...args].join(" ");
  console.log(`\n$ ${shown}${live ? `   (DATABASE_URL = the app's dev SQLite)` : ""}`);
  const run = spawnSync("npx", ["tsx", LIVE_COSTS, ...args], { cwd: REPO_ROOT, env: process.env, stdio: "inherit" });
  return run.status ?? 1;
}

/** What the clear deletes: the app DB's rows that may carry a metafield, with what Shopify has for each. */
async function planClear(db) {
  const rows = await db.variantCost.findMany({ where: { shop: STORE, mayCarry: true }, select: { variantId: true }, orderBy: { variantId: "asc" } });
  const all = await db.variantCost.count({ where: { shop: STORE } });
  const ids = rows.map((r) => r.variantId);
  const onShopify = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const data = await query(
      `query WonE2eVariantMetafields($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      displayName
      metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
    }
  }
}`,
      { ids: ids.slice(i, i + 100) },
    );
    for (const node of data.nodes) if (node?.id) onShopify.set(node.id, { name: node.displayName, value: node.metafield?.value ?? null });
  }
  console.log(`\n# clear (dry-run): ${all} mirror row(s) in the app DB, ${ids.length} may carry a metafield → metafieldsDelete for these, then every mirror row of the shop goes`);
  for (const id of ids) {
    const s = onShopify.get(id);
    console.log(`  would delete ${id}  ${s?.name ?? "(variant not found)"}  = ${s?.value ?? "(Shopify has none)"}`);
  }
  return { rows: all, carrying: ids.length };
}

async function main() {
  if (readbackOnly) {
    await readback();
    return;
  }
  const { PrismaClient } = await appModule("app/generated/prisma/client.ts");
  const db = new PrismaClient();
  let margin;
  try {
    margin = await storedMargin(db);
    console.log(`# stored config of ${STORE}: margin protection ${margin.enabled ? "ON" : "off"}${margin.plan ? ` (plan ${margin.plan})` : " (no row)"}`);
    if (clear && margin.enabled) throw new Error("margin protection is still ON in the stored config: the app's clear would be skipped (run seed-mvp1.mjs --cleanup first)");
    if (!clear && !margin.enabled) throw new Error("margin protection is off in the stored config: the app's full pass would be skipped (run seed-mvp1.mjs --profile margin --live first)");
    if (clear && !live) {
      await planClear(db);
      console.log("\n(dry-run: nothing written; pass --live)");
      return;
    }
  } finally {
    await db.$disconnect();
  }

  const status = runLiveCosts([...(clear ? ["--clear"] : []), ...(live ? ["--live"] : [])]);
  if (status !== 0) {
    process.exitCode = status;
    return;
  }
  if (!live) {
    console.log("\n(dry-run: nothing written; pass --live)");
    return;
  }
  await readback();
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ ${error?.message ?? error}`);
  process.exitCode = 1;
}
