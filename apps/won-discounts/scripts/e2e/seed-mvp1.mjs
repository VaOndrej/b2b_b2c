#!/usr/bin/env node
/* eslint-env node */
// Seed (and clean up) the MVP 1 checkout E2E rules on the dev store through the
// CANONICAL sync: app/lib/sync/save-and-sync.server.ts `saveAndSync({ client,
// db, shop, input, otherCodes })` with the CLI AdminClient (`shopify app execute`
// as the app) and the app's own DB, so WonNode/SyncRun/ConfigVersion stay the
// app's and the next admin save starts from what is on the store.
//
// Profiles (--profile, default mvp1):
//   mvp1    scripts/e2e/mvp1-fixture.mjs: "E2E auto 10 %" (automatic, 10 % on
//           won-e2e-simple-a) and "E2E kód" (code WONE2E15, 15 % on the order);
//           tests/e2e/checkout.mvp1.spec.ts.
//   shapes  scripts/e2e/shapes-fixture.mjs: a fixed amount per item above
//           won-e2e-simple-b's price (sent as 100 %) and two Pro-stacked
//           percentages on won-e2e-simple-a (sent as one summed percent);
//           tests/e2e/checkout.shapes.spec.ts (matrix with WON_E2E_PROFILE=shapes).
//   margin  scripts/e2e/margin-fixture.mjs (MVP 2): margin protection ON (minimum
//           margin 25 %, maximum discount 30 %), "E2E marže auto 50 %" on
//           won-e2e-simple-a + won-e2e-simple-b and code WONE2EM20 = 20 % on the
//           order; tests/e2e/checkout.margin.spec.ts (WON_E2E_PROFILE=margin).
//           The variant cost metafields are the cost mirror's job, run after the
//           seed: scripts/e2e/margin-costs.mjs (dry-run, then --live); after
//           --cleanup, `margin-costs.mjs --clear` removes them again.
// A seed REPLACES the E2E rules (and the margin settings) of the other profile
// (one backup covers all of them).
//
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs
//       DRY-RUN (default): reads the store + the stored config, prints the seed
//       config and the sync plan (scripts/sync/live-sync.ts dry-run: every
//       mutation printed, none sent). Writes nothing anywhere.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs [--profile shapes] --live
//       backs up the stored config (only when no backup exists yet, so a re-seed
//       never backs up its own seed), saves the seed config and syncs it.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup [--live]
//       restores the backed-up config (no row before → the defaults, i.e. no
//       rules) and syncs it; dry-run by default.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --state
//       read-only: Won nodes of the app's function, the shop function_config
//       metafield and the won-e2e-simple-a / won-e2e-simple-b product metafields.
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
import { MARGIN_CODE, MARGIN_HANDLES, MARGIN_RULE_IDS, marginModule, marginRules } from "./margin-fixture.mjs";
import { SHAPES_HANDLES, SHAPES_PRODUCT_B_HANDLE, SHAPES_RULE_IDS, shapesRules } from "./shapes-fixture.mjs";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const DEV_DB = path.join(APP_DIR, "prisma/dev.sqlite");

// Validated with the Shopify dev MCP (admin 2026-04): read_products, read_discounts.
const STATE_QUERY = `query WonE2eState($after: String, $handle: String!, $handleB: String!) {
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
  productB: productByIdentifier(identifier: { handle: $handleB }) {
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
  if (arg.startsWith("--") && !["--live", "--cleanup", "--state", "--json", "--out", "--profile"].includes(arg)) {
    throw new Error(`unknown argument ${arg}`);
  }
}

// Seed profiles: the products each one targets and its rules (GIDs by handle).
const PROFILES = {
  mvp1: { handles: [E2E_PRODUCT_HANDLE], rules: (ids) => e2eRules(ids[E2E_PRODUCT_HANDLE]), label: `code ${E2E_CODE}` },
  shapes: { handles: SHAPES_HANDLES, rules: shapesRules, label: "capped fixed per item + Pro stack, no code" },
  margin: {
    handles: MARGIN_HANDLES,
    rules: marginRules,
    margin: marginModule,
    label: `margin protection on (min margin 25 %, max discount 30 %), auto 50 % + code ${MARGIN_CODE}`,
  },
};
const PROFILE = option("--profile") ?? "mvp1";
if (!Object.hasOwn(PROFILES, PROFILE)) throw new Error(`unknown --profile ${PROFILE} (${Object.keys(PROFILES).join(", ")})`);
/** Every E2E rule id of every profile: what a cleanup without a backup removes, and what "the seed is in it" means. */
const ALL_E2E_RULE_IDS = [...E2E_RULE_IDS, ...SHAPES_RULE_IDS, ...MARGIN_RULE_IDS];

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
  let productB = null;
  let after = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await query(STATE_QUERY, { handle: E2E_PRODUCT_HANDLE, handleB: SHAPES_PRODUCT_B_HANDLE, ...(after ? { after } : {}) });
    shop ??= data.shop;
    product ??= data.product;
    productB ??= data.productB;
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
    productB: productB ? { handle: productB.handle, id: productB.id, wonProductMetafield: productB.metafield?.value ?? null } : null,
  };
}

// --- Config helpers ---------------------------------------------------------------------------
function summarize(config) {
  return (config?.modules?.codes?.rules ?? []).map((rule) => ({ id: rule.id, name: rule.name, method: rule.method, enabled: rule.enabled }));
}

/** "margin off" · "margin ON (min margin 25 %, max discount 30 %, 0 collection(s))" — never the raw module. */
function marginText(config) {
  const margin = config?.modules?.margin;
  if (!margin || margin.enabled !== true) return "margin protection off";
  const min = margin.global?.minMarginPercent;
  return `margin protection ON (min margin ${min ?? "—"} %, max discount ${margin.global?.maxDiscountPercent} %, ${margin.perCollection?.length ?? 0} collection setting(s))`;
}

/** The fixture's margin module is what the stored config has (a cleanup without a backup may then switch it off). */
function isFixtureMargin(margin) {
  const fixture = marginModule();
  return (
    margin?.enabled === fixture.enabled &&
    margin?.global?.minMarginPercent === fixture.global.minMarginPercent &&
    margin?.global?.maxDiscountPercent === fixture.global.maxDiscountPercent &&
    (margin?.perCollection?.length ?? 0) === 0
  );
}

function seedConfig(previous, productIds) {
  // Only the profile's E2E rules (no campaigns, default engine switches) so the
  // carts the spec checks are decided by these rules alone; markets are kept.
  const config = createDefaultConfig();
  config.markets = previous.markets ?? [];
  config.modules.codes.rules = PROFILES[PROFILE].rules(productIds);
  if (PROFILES[PROFILE].margin) config.modules.margin = PROFILES[PROFILE].margin();
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
    const hasSeed = loaded.config.modules.codes.rules.some((rule) => ALL_E2E_RULE_IDS.includes(rule.id));
    console.log(
      `# stored config of ${STORE}: ${loaded.exists ? `${loaded.config.modules.codes.rules.length} rule(s)${hasSeed ? " (the E2E seed is in it)" : ""}` : "no row yet"}`,
    );
    for (const rule of summarize(loaded.config)) console.log(`  - ${rule.id} "${rule.name}" ${rule.method} ${rule.enabled ? "enabled" : "disabled"}`);
    console.log(`  ${marginText(loaded.config)}`);

    if (cleanup) {
      const backup = readBackup();
      let target;
      if (backup) {
        target = backup.exists ? backup.config : createDefaultConfig();
        console.log(`\n# cleanup: restore the backup of ${backup.backedUpAt} (${backup.exists ? `${summarize(backup.config).length} rule(s)` : "there was no row: the defaults, no rules"})`);
      } else if (hasSeed) {
        target = { ...loaded.config, modules: { ...loaded.config.modules, codes: { rules: loaded.config.modules.codes.rules.filter((rule) => !ALL_E2E_RULE_IDS.includes(rule.id)) } } };
        // The margin seed's own settings go with its rules (anything else in the module is the merchant's).
        if (isFixtureMargin(loaded.config.modules.margin)) target.modules.margin = createDefaultConfig().modules.margin;
        console.log(`\n# cleanup: no backup in ${OUT_DIR}; removing only the E2E rules (and the margin seed's settings) from the stored config`);
      } else {
        console.log(`\n# cleanup: no backup in ${OUT_DIR} and no E2E rule stored — nothing to do`);
        return;
      }
      console.log(`  after the cleanup: ${summarize(target).length} rule(s), ${marginText(target)}`);
      const marginWasOn = loaded.config.modules.margin?.enabled === true && target.modules?.margin?.enabled !== true;
      if (!live) {
        process.exitCode = dryRunPlan(target, "cleanup");
        if (marginWasOn) console.log("\nnote: margin protection goes off → then clear the cost metafields: node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear [--live]");
        console.log("\n(dry-run: nothing written; pass --live)");
        return;
      }
      const result = await saveAndSync({ client, db, shop: STORE, input: target, otherCodes: await nativeCodes(db) });
      printSync(result);
      const status = await loadSyncStatus(db, STORE);
      const evidence = {
        name: "seed-mvp1-cleanup",
        store: STORE,
        at: new Date().toISOString(),
        restored: summarize(target),
        margin: marginText(target),
        result: syncSummary(result),
        syncRun: status,
      };
      console.log(`\nEvidence: ${writeEvidence("seed-mvp1-cleanup", evidence)}`);
      if (marginWasOn) console.log("next: clear the cost metafields — node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear, then --clear --live");
      if (printJson) console.log(JSON.stringify(evidence, null, 2));
      if (result.save.ok && result.sync?.ok && backup) fs.renameSync(BACKUP_FILE, BACKUP_FILE.replace(/\.json$/, `.restored-${stamp()}.json`));
      process.exitCode = result.save.ok && result.sync?.ok ? 0 : 1;
      return;
    }

    const productIds = {};
    for (const handle of PROFILES[PROFILE].handles) {
      const found = (
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
          { handle },
        )
      ).productByIdentifier;
      if (!found?.id) throw new Error(`product ${handle} not found on ${STORE}`);
      productIds[handle] = found.id;
    }
    const backup = readBackup();
    const previous = backup ? (backup.exists ? backup.config : createDefaultConfig()) : loaded.config;
    const config = seedConfig(previous, productIds);
    console.log(
      `\n# seed (profile ${PROFILE}): ${Object.entries(productIds).map(([handle, id]) => `${handle} = ${id}`).join(", ")}; ${PROFILES[PROFILE].label}`,
    );
    for (const rule of summarize(config)) console.log(`  + ${rule.id} "${rule.name}" ${rule.method}`);
    console.log(`  ${marginText(config)}`);

    if (!live) {
      process.exitCode = dryRunPlan(config, PROFILE === "mvp1" ? "seed" : `seed-${PROFILE}`);
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
    const evidenceName = PROFILE === "mvp1" ? "seed-mvp1" : `seed-mvp1-${PROFILE}`;
    const evidence = {
      name: evidenceName,
      profile: PROFILE,
      store: STORE,
      at: new Date().toISOString(),
      products: Object.entries(productIds).map(([handle, id]) => ({ handle, id })),
      rules: summarize(config),
      margin: marginText(config),
      ...(PROFILE === "mvp1" ? { autoRule: E2E_AUTO_RULE_ID } : {}),
      result: syncSummary(result),
      syncRun: status,
      wonNodes,
    };
    console.log(`\nEvidence: ${writeEvidence(evidenceName, evidence)}`);
    if (printJson) console.log(JSON.stringify(evidence, null, 2));
    if (PROFILES[PROFILE].margin && result.save.ok && result.sync?.ok) {
      console.log("next: mirror the purchase costs — node apps/won-discounts/scripts/e2e/margin-costs.mjs (dry-run), then --live");
    }
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
