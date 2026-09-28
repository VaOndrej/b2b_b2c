#!/usr/bin/env node
/* eslint-env node */
// Seed (and clean up) the MVP 1 checkout E2E rules on the dev store through the
// CANONICAL sync: app/lib/sync/save-and-sync.server.ts `saveAndSync({ client,
// db, shop, input, otherCodes })` with the CLI AdminClient (`shopify app execute`
// as the app) and the app's own DB, so WonNode/SyncRun/ConfigVersion stay the
// app's and the next admin save starts from what is on the store.
//
// Rules (scripts/e2e/mvp1-fixture.mjs): "E2E auto 10 %" (automatic, 10 % on
// won-e2e-simple-a) and "E2E kód" (code WONE2E15, 15 % on the order).
//
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs
//       DRY-RUN (default): reads the store + the stored config, prints the seed
//       config and the sync plan (scripts/sync/live-sync.ts dry-run: every
//       mutation printed, none sent). Writes nothing anywhere.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live
//       backs up the stored config (only when no backup exists yet, so a re-seed
//       never backs up its own seed), saves the seed config and syncs it.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup [--live]
//       restores the backed-up config (no row before → the defaults, i.e. no
//       rules) and syncs it; dry-run by default.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --state
//       read-only: Won nodes of the app's function, the shop function_config
//       metafield and the won-e2e-simple-a product metafield.
//
// Options: --out <dir> (evidence + backup; default $WON_E2E_OUT or
// <tmp>/won-discounts-e2e) · --json (print the whole result).
//
// DB: DATABASE_URL is the dev app's SQLite (apps/won-discounts/prisma/dev.sqlite,
// the file `shopify app dev` uses: its schema-relative `file:./dev.sqlite`). The
// script sets that absolute URL itself, so no .env is read. Only Prisma opens
// the file; the script prints rule ids/names and counts, never the rows.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

import { E2E_AUTO_RULE_ID, E2E_CODE, E2E_PRODUCT_HANDLE, E2E_RULE_IDS, e2eRules } from "./mvp1-fixture.mjs";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const DEV_DB = path.join(APP_DIR, "prisma/dev.sqlite");

// Validated with the Shopify dev MCP (admin 2026-04): read_products, read_discounts.
const STATE_QUERY = `query WonE2eState($after: String, $handle: String!) {
  shop {
    id
    functionConfig: metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      value
      updatedAt
    }
  }
  product: productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    metafield(namespace: "$app:won_discounts", key: "product") {
      id
      value
    }
  }
  discountNodes(first: 100, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticApp { title status discountClasses appDiscountType { functionId appKey } }
        ... on DiscountCodeApp { title status discountClasses codesCount { count } appDiscountType { functionId appKey } }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
        ... on DiscountAutomaticFreeShipping { title status }
        ... on DiscountCodeBasic { title status }
        ... on DiscountCodeBxgy { title status }
        ... on DiscountCodeFreeShipping { title status }
      }
    }
  }
}
`;

// --- Arguments ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const live = flag("--live");
const cleanup = flag("--cleanup");
const stateOnly = flag("--state");
const printJson = flag("--json");
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));
const BACKUP_FILE = path.join(OUT_DIR, "seed-mvp1-backup.json");
for (const arg of argv) {
  if (arg.startsWith("--") && !["--live", "--cleanup", "--state", "--json", "--out"].includes(arg)) {
    throw new Error(`unknown argument ${arg}`);
  }
}

// The app's DB, absolute (never the .env): set before the Prisma client loads.
process.env.DATABASE_URL = `file:${DEV_DB}`;

const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);
const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
const { loadConfig } = await appModule("app/lib/config.server.ts");
const { saveAndSync, loadSyncStatus } = await appModule("app/lib/sync/save-and-sync.server.ts");
const { detectNativeDiscounts } = await appModule("app/lib/native/detect.server.ts");
const { createDefaultConfig } = await import("@won/core/discounts/config");

const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });

async function query(document, variables) {
  const result = await client.graphql(document, variables);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

function readClientId() {
  const toml = fs.readFileSync(path.join(APP_DIR, "shopify.app.toml"), "utf8");
  return /^client_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
function writeEvidence(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}-${stamp()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

// --- Read-only state -------------------------------------------------------------------------
async function readState() {
  const functions = await query(`query WonSyncFunctions {
  shopifyFunctions(first: 50) {
    nodes {
      id
      handle
      apiType
    }
  }
}`);
  const fn = functions.shopifyFunctions.nodes.find((node) => node.handle === "won-discounts-engine") ?? null;
  const nodes = [];
  let shop = null;
  let product = null;
  let after = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await query(STATE_QUERY, { handle: E2E_PRODUCT_HANDLE, ...(after ? { after } : {}) });
    shop ??= data.shop;
    product ??= data.product;
    nodes.push(...data.discountNodes.nodes);
    if (!data.discountNodes.pageInfo.hasNextPage) break;
    after = data.discountNodes.pageInfo.endCursor;
  }
  const ours = nodes.filter((node) => fn && node.discount?.appDiscountType?.functionId === fn.id);
  let config = null;
  if (shop?.functionConfig?.value) {
    try {
      const parsed = JSON.parse(shop.functionConfig.value);
      config = {
        bytes: Buffer.byteLength(shop.functionConfig.value),
        updatedAt: shop.functionConfig.updatedAt,
        rules: (parsed?.modules?.codes?.rules ?? []).map((rule) => ({ id: rule.id, name: rule.name, method: rule.method, enabled: rule.enabled })),
      };
    } catch {
      config = { bytes: Buffer.byteLength(shop.functionConfig.value), unreadable: true };
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    functionId: fn?.id ?? null,
    wonNodes: ours.map((node) => ({
      id: node.id,
      type: node.discount.__typename,
      title: node.discount.title,
      status: node.discount.status,
      classes: node.discount.discountClasses,
      codes: node.discount.codesCount?.count,
    })),
    otherDiscountNodes: nodes
      .filter((node) => !ours.includes(node))
      .map((node) => ({ id: node.id, type: node.discount?.__typename ?? null, title: node.discount?.title ?? null, status: node.discount?.status ?? null })),
    shopFunctionConfig: config,
    product: product ? { handle: product.handle, id: product.id, wonProductMetafield: product.metafield?.value ?? null } : null,
  };
}

// --- Config helpers ---------------------------------------------------------------------------
function summarize(config) {
  return (config?.modules?.codes?.rules ?? []).map((rule) => ({ id: rule.id, name: rule.name, method: rule.method, enabled: rule.enabled }));
}

function seedConfig(previous, productId) {
  // Only the E2E rules (no campaigns, default engine switches) so the carts the
  // spec checks are decided by these two rules alone; markets are kept.
  const config = createDefaultConfig();
  config.markets = previous.markets ?? [];
  config.modules.codes.rules = e2eRules(productId);
  return config;
}

function readBackup() {
  if (!fs.existsSync(BACKUP_FILE)) return null;
  return JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
}

/** Codes of the shop's native discounts (the canonical detector), for the code-hash collision guard. */
async function nativeCodes(db) {
  const rows = await db.wonNode.findMany({ where: { shop: STORE }, select: { discountNodeId: true } });
  const detection = await detectNativeDiscounts(client, { wonNodeIds: rows.map((row) => row.discountNodeId), ownAppKey: readClientId() });
  return detection.movable.flatMap((node) => node.codes);
}

/** The app's tracked Won nodes for evidence: key, role and the node's live Shopify status only (no raw rows). */
async function trackedNodeSummary(db) {
  const rows = await db.wonNode.findMany({ where: { shop: STORE }, select: { key: true, role: true, discountNodeId: true } });
  let statusById = null;
  try {
    statusById = new Map((await readState()).wonNodes.map((node) => [node.id, node.status]));
  } catch (error) {
    console.log(`(could not read the nodes' Shopify status: ${error?.message ?? error})`);
  }
  return rows.map((row) => ({
    key: row.key,
    role: row.role,
    status: statusById ? (statusById.get(row.discountNodeId) ?? "not on the store") : "unknown",
  }));
}

function syncSummary(result) {
  return {
    save: result.save.ok
      ? { ok: true, versionId: result.save.versionId, functionConfigBytes: result.save.functionConfigBytes, issues: result.save.issues }
      : { ok: false, reason: result.save.reason, issues: result.save.issues },
    sync: result.sync,
    warnings: result.warnings,
  };
}

function printSync(result) {
  console.log(`\n# save: ${result.save.ok ? `ok (version ${result.save.versionId}, ${result.save.functionConfigBytes} B)` : `REFUSED (${result.save.reason})`}`);
  for (const issue of result.save.issues ?? []) console.log(`  issue ${issue.path}: ${issue.message}`);
  if (result.sync) {
    console.log(`# sync: ${result.sync.ok ? "ok" : "FAILED"} (run ${result.sync.runId})`);
    for (const step of result.sync.steps) console.log(`${step.ok ? "✔" : "✖"} ${step.step} — ${step.detail}`);
  }
  for (const warning of result.warnings ?? []) console.log(`warning: ${warning}`);
}

/** The sync plan of `config` without sending a mutation: scripts/sync/live-sync.ts in dry-run. */
function dryRunPlan(config, label) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `seed-mvp1-${label}-config.json`);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\n# sync plan (dry-run, ${path.relative(REPO_ROOT, path.join(APP_DIR, "scripts/sync/live-sync.ts"))} --config ${file})`);
  const run = spawnSync("npx", ["tsx", path.join(APP_DIR, "scripts/sync/live-sync.ts"), "--config", file], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return run.status ?? 1;
}

// --- Modes ------------------------------------------------------------------------------------
async function main() {
  if (stateOnly) {
    const state = await readState();
    console.log(JSON.stringify(state, null, 2));
    console.log(`\nEvidence: ${writeEvidence("state-mvp1", state)}`);
    return;
  }

  const { PrismaClient } = await appModule("app/generated/prisma/client.ts");
  const db = new PrismaClient();
  try {
    const loaded = await loadConfig(db, STORE);
    if (loaded.unreadable) throw new Error("the stored config cannot be read; refusing to touch it (nothing was sent)");
    if (loaded.readOnly) throw new Error("the stored config belongs to a newer schema; refusing to touch it (nothing was sent)");
    const hasSeed = loaded.config.modules.codes.rules.some((rule) => E2E_RULE_IDS.includes(rule.id));
    console.log(
      `# stored config of ${STORE}: ${loaded.exists ? `${loaded.config.modules.codes.rules.length} rule(s)${hasSeed ? " (the E2E seed is in it)" : ""}` : "no row yet"}`,
    );
    for (const rule of summarize(loaded.config)) console.log(`  - ${rule.id} "${rule.name}" ${rule.method} ${rule.enabled ? "enabled" : "disabled"}`);

    if (cleanup) {
      const backup = readBackup();
      let target;
      if (backup) {
        target = backup.exists ? backup.config : createDefaultConfig();
        console.log(`\n# cleanup: restore the backup of ${backup.backedUpAt} (${backup.exists ? `${summarize(backup.config).length} rule(s)` : "there was no row: the defaults, no rules"})`);
      } else if (hasSeed) {
        target = { ...loaded.config, modules: { ...loaded.config.modules, codes: { rules: loaded.config.modules.codes.rules.filter((rule) => !E2E_RULE_IDS.includes(rule.id)) } } };
        console.log(`\n# cleanup: no backup in ${OUT_DIR}; removing only the E2E rules from the stored config`);
      } else {
        console.log(`\n# cleanup: no backup in ${OUT_DIR} and no E2E rule stored — nothing to do`);
        return;
      }
      if (!live) {
        process.exitCode = dryRunPlan(target, "cleanup");
        console.log("\n(dry-run: nothing written; pass --live)");
        return;
      }
      const result = await saveAndSync({ client, db, shop: STORE, input: target, otherCodes: await nativeCodes(db) });
      printSync(result);
      const status = await loadSyncStatus(db, STORE);
      const evidence = { name: "seed-mvp1-cleanup", store: STORE, at: new Date().toISOString(), restored: summarize(target), result: syncSummary(result), syncRun: status };
      console.log(`\nEvidence: ${writeEvidence("seed-mvp1-cleanup", evidence)}`);
      if (printJson) console.log(JSON.stringify(evidence, null, 2));
      if (result.save.ok && result.sync?.ok && backup) fs.renameSync(BACKUP_FILE, BACKUP_FILE.replace(/\.json$/, `.restored-${stamp()}.json`));
      process.exitCode = result.save.ok && result.sync?.ok ? 0 : 1;
      return;
    }

    const product = (
      await query(
        `query WonE2eProduct($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    metafield(namespace: "$app:won_discounts", key: "product") {
      value
    }
  }
  shop {
    ianaTimezone
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      value
    }
  }
}`,
        { handle: E2E_PRODUCT_HANDLE },
      )
    ).productByIdentifier;
    if (!product?.id) throw new Error(`product ${E2E_PRODUCT_HANDLE} not found on ${STORE}`);
    const backup = readBackup();
    const previous = backup ? (backup.exists ? backup.config : createDefaultConfig()) : loaded.config;
    const config = seedConfig(previous, product.id);
    console.log(`\n# seed: ${E2E_PRODUCT_HANDLE} = ${product.id}; code ${E2E_CODE}`);
    for (const rule of summarize(config)) console.log(`  + ${rule.id} "${rule.name}" ${rule.method}`);

    if (!live) {
      process.exitCode = dryRunPlan(config, "seed");
      console.log("\n(dry-run: nothing written; pass --live)");
      return;
    }

    if (!backup) {
      if (hasSeed) throw new Error("the stored config already holds the E2E seed but there is no backup; run --cleanup first");
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(
        BACKUP_FILE,
        `${JSON.stringify({ store: STORE, backedUpAt: new Date().toISOString(), exists: loaded.exists, config: loaded.exists ? loaded.config : null }, null, 2)}\n`,
      );
      console.log(`\n# backup: ${BACKUP_FILE}`);
    } else {
      console.log(`\n# backup kept: ${BACKUP_FILE} (${backup.backedUpAt})`);
    }

    const result = await saveAndSync({ client, db, shop: STORE, input: config, otherCodes: await nativeCodes(db) });
    printSync(result);
    const status = await loadSyncStatus(db, STORE);
    const wonNodes = await trackedNodeSummary(db);
    const evidence = {
      name: "seed-mvp1",
      store: STORE,
      at: new Date().toISOString(),
      product: { handle: E2E_PRODUCT_HANDLE, id: product.id },
      rules: summarize(config),
      autoRule: E2E_AUTO_RULE_ID,
      result: syncSummary(result),
      syncRun: status,
      wonNodes,
    };
    console.log(`\nEvidence: ${writeEvidence("seed-mvp1", evidence)}`);
    if (printJson) console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = result.save.ok && result.sync?.ok ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ ${error?.message ?? error}`);
  process.exitCode = 1;
}
