#!/usr/bin/env node
/* eslint-env node */
// Live check of the native-discount move + undo (MVP 1, T4; spec §4.1, C6).
//
//   node apps/won-discounts/scripts/native/move-live.mjs
//       DRY-RUN (default): the whole flow against an in-memory Shopify store
//       (tests/lib/native/fake-shopify.ts) and a throwaway SQLite DB. Touches
//       no store, no app DB. Proves the script itself before it goes live.
//
//   node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/native/move-live.mjs --live
//       LIVE on the dev store b2b-b2c-store-development.myshopify.com through
//       `shopify app execute` (as the app, no admin token). Needs:
//         - DATABASE_URL of the app's DB (the one `shopify app dev` uses): the
//           move reads/saves the shop's real Won config and WonNode rows, so the
//           sync never overwrites the store with a foreign config;
//         - the sync layer wired: a module (default app/lib/save-and-sync.server.ts,
//           or --sync-module <path relative to the app dir>) exporting
//           createSaveAndSync({ client, db }) → SaveAndSync (app/lib/native/types.ts).
//           Without it the script stops before any write.
//
// Steps: sweep leftovers → create the native test discount WON-TEST-NATIVE
// (10 % on won-e2e-simple-a, code WONTESTNATIVE) → CART: the code applies 10 %
// → detect it → dialog preview → move → verify (native gone, Won rule in the
// config, code on a Won node) → CART: the Won rule gives the same 10 % and the
// code is applicable → undo → verify (native back: same code, 10 %, same
// product; rule gone) → CART: the native applies again → cleanup in `finally`
// (native deleted, rule removed, backup rows of this run deleted, cart cleared).
// Evidence JSON: $WON_NATIVE_OUT or <tmp>/won-discounts-native/.
// Ctrl+C is deferred until the cleanup has finished.
//
// Cart checks: Playwright + the storefront AJAX cart, the same helpers as the
// MVP 0 prototypes (scripts/prototypes/lib.mjs Storefront/observe): password
// page unlocked with SHOPIFY_E2E_STOREFRONT_PASSWORD from the .env (never
// printed), ≥ 1.5 s between cart requests (Cloudflare 429), each verdict = 2
// consecutive fresh carts that match. The dry-run prints the cart plan only.
//
// Every GraphQL document it sends is in app/lib/native/documents.ts (validated
// with the Shopify dev MCP, admin 2026-04) plus PRODUCT_QUERY below (validated).

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const TITLE = "WON-TEST-NATIVE";
const CODE = "WONTESTNATIVE";
const PRODUCT_HANDLE = "won-e2e-simple-a";
const OUT_DIR = process.env.WON_NATIVE_OUT ?? path.join(os.tmpdir(), "won-discounts-native");

const PRODUCT_QUERY = `query WonNativeLiveProduct($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
  }
}
`;

const args = process.argv.slice(2);
const live = args.includes("--live");
const syncModuleArg = args.includes("--sync-module") ? args[args.indexOf("--sync-module") + 1] : null;

const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);

const native = {
  detect: await appModule("app/lib/native/detect.server.ts"),
  move: await appModule("app/lib/native/move.server.ts"),
  request: await appModule("app/lib/native/request.server.ts"),
  normalize: await appModule("app/lib/native/normalize.ts"),
};
const { loadConfig } = await appModule("app/lib/config.server.ts");

function readClientId() {
  const toml = fs.readFileSync(path.join(APP_DIR, "shopify.app.toml"), "utf8");
  return /^client_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

const proto = await import(pathToFileURL(path.join(APP_DIR, "scripts/prototypes/lib.mjs")).href);

// Shape shared with the prototype helpers (Storefront/observe read `live`, `data`, `save`).
const evidence = {
  live,
  data: { name: "native-move-live", live, store: STORE, startedAt: new Date().toISOString(), steps: [], observations: [], cleanup: [] },
  save: async () => {},
};
function step(name, detail) {
  evidence.data.steps.push({ at: new Date().toISOString(), name, detail });
  console.log(`\n▶ ${name}${detail === undefined ? "" : `\n${JSON.stringify(detail, null, 2)}`}`);
}
function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

/** The code is applicable and some discount on the test line is 10 % (whoever gives it: native or Won). */
function tenPercentWithCode(summary) {
  const code = summary.discount_codes.find((entry) => String(entry.code).toUpperCase() === CODE);
  const line = summary.items[0];
  return Boolean(code?.applicable) && Boolean(line?.line_level_discount_allocations.some((a) => proto.approx(a.percentOfLine ?? 0, 10)));
}

/** Fresh carts (1× won-e2e-simple-a + the code) until 2 in a row give 10 %; the dry-run prints the plan. */
async function checkCart(storefront, label, expectation) {
  const observation = await proto.observe({
    evidence,
    storefront,
    label,
    codes: [CODE],
    expectation,
    expect: tenPercentWithCode,
    timeoutMs: 180_000,
  });
  if (!live) {
    console.log(`  (dry-run: cart "${label}" not checked)`);
    return;
  }
  check(observation.matched, `cart ${label}: ${expectation}`);
}

// --- Signals: never leave the store half-cleaned -----------------------------------------
let stopping = null;
let cleaningUp = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!stopping) stopping = signal;
    console.error(`\n${signal}: ${cleaningUp ? "cleanup is running, waiting for it" : "stopping after the current call, then cleaning up"}`);
  });
}
const guard = () => {
  if (stopping) throw new Error(`stopped by ${stopping}`);
};

// --- Environment: live store + app DB, or fake store + temp DB -------------------------
async function liveEnvironment() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set: run with --env-file=apps/won-discounts/.env (the app's DB), nothing was sent");
  }
  const syncPath = path.resolve(APP_DIR, syncModuleArg ?? "app/lib/save-and-sync.server.ts");
  if (!fs.existsSync(syncPath)) {
    throw new Error(
      `sync layer not wired: ${path.relative(REPO_ROOT, syncPath)} does not exist. Create it (export createSaveAndSync({ client, db })) or pass --sync-module. Nothing was sent.`,
    );
  }
  const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
  const { PrismaClient } = await appModule("app/generated/prisma/client.ts");
  const syncModule = await import(pathToFileURL(syncPath).href);
  if (typeof syncModule.createSaveAndSync !== "function") {
    throw new Error(`${path.relative(REPO_ROOT, syncPath)} does not export createSaveAndSync({ client, db }). Nothing was sent.`);
  }
  const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });
  const db = new PrismaClient();
  const saveAndSync = syncModule.createSaveAndSync({ client, db });
  return { client, db, saveAndSync, ownAppKey: readClientId(), close: () => db.$disconnect(), options: {} };
}

async function dryEnvironment() {
  const { FakeShopify } = await import(pathToFileURL(path.join(APP_DIR, "tests/lib/native/fake-shopify.ts")).href);
  const { createFakeSync, WON_APP_KEY } = await import(pathToFileURL(path.join(APP_DIR, "tests/lib/native/fake-sync.ts")).href);
  const { createTestDatabase } = await import(pathToFileURL(path.join(APP_DIR, "tests/lib/test-db.ts")).href);
  const shopify = new FakeShopify();
  const client = {
    // The fake store has no catalog: answer the product lookup, pass everything else through.
    async graphql(query, variables) {
      if (query.includes("WonNativeLiveProduct")) {
        return { data: { productByIdentifier: { id: "gid://shopify/Product/1000001", handle: variables.handle } } };
      }
      return shopify.graphql(query, variables);
    },
  };
  const testDb = createTestDatabase("native-move-dry");
  const sync = createFakeSync(testDb.prisma, shopify);
  return {
    client,
    db: testDb.prisma,
    saveAndSync: sync.saveAndSync,
    ownAppKey: WON_APP_KEY,
    close: () => testDb.drop(),
    options: { sleep: async () => {} },
  };
}

// --- Store helpers -----------------------------------------------------------------------
async function gql(env, name, variables) {
  const result = await native.request.runGql(env.client, name, variables, env.options);
  if (!result.ok) throw new Error(`${name}: ${result.message}`);
  return result.data;
}

async function codeHolder(env) {
  const data = await gql(env, "codeLookup", { code: CODE });
  const node = data.codeDiscountNodeByCode;
  return node ? { id: node.id, type: node.codeDiscount?.__typename ?? null, title: node.codeDiscount?.title ?? null } : null;
}

async function deleteTestNative(env, phase) {
  const holder = await codeHolder(env);
  if (!holder) return;
  if (holder.type === "DiscountCodeBasic" && holder.title === TITLE) {
    const data = await gql(env, "codeDelete", { id: holder.id });
    evidence.data.cleanup.push({ phase, deletedNative: holder.id, userErrors: data.discountCodeDelete?.userErrors ?? [] });
    return;
  }
  // Anything else holding the test code (e.g. the Won node of a leftover rule) is
  // released through the config below, never deleted here.
  evidence.data.cleanup.push({ phase, codeHeldBy: holder });
}

async function removeTestRules(env, shop, phase) {
  const loaded = await loadConfig(env.db, shop);
  const rules = loaded.config.modules.codes.rules;
  const leftovers = rules.filter((r) => r.name === TITLE || (r.codes ?? []).includes(CODE));
  if (leftovers.length === 0) return;
  if (loaded.readOnly) throw new Error("the stored config belongs to a newer schema; not touching it");
  const ids = new Set(leftovers.map((r) => r.id));
  const config = { ...loaded.config, modules: { ...loaded.config.modules, codes: { rules: rules.filter((r) => !ids.has(r.id)) } } };
  const result = await env.saveAndSync({ shop, config });
  evidence.data.cleanup.push({ phase, removedRules: [...ids], result });
}

// --- The run ---------------------------------------------------------------------------
async function main() {
  console.log(`# native move + undo — ${live ? `LIVE on ${STORE}` : "DRY-RUN against an in-memory store (pass --live to run on the dev store)"}`);
  const env = live ? await liveEnvironment() : await dryEnvironment();
  if (live && !process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD) {
    await env.close();
    throw new Error("SHOPIFY_E2E_STOREFRONT_PASSWORD missing (cart checks): run with --env-file=apps/won-discounts/.env. Nothing was sent.");
  }
  const storefront = new proto.Storefront(evidence, live);
  const shop = STORE;
  const created = new Set();
  let failure = null;
  try {
    step("sweep leftovers of an earlier run");
    await deleteTestNative(env, "pre-run");
    await removeTestRules(env, shop, "pre-run");
    guard();

    const product = (await env.client.graphql(PRODUCT_QUERY, { handle: PRODUCT_HANDLE })).data?.productByIdentifier;
    if (!product?.id) throw new Error(`product ${PRODUCT_HANDLE} not found`);
    step("create the native test discount", { title: TITLE, code: CODE, product: product.id });
    const createdData = await gql(env, "codeBasicCreate", {
      input: {
        title: TITLE,
        code: CODE,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        context: { all: "ALL" },
        customerGets: { value: { percentage: 0.1 }, items: { products: { productsToAdd: [product.id] } } },
        combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true },
      },
    });
    const errors = native.request.userErrorsOf(createdData.discountCodeBasicCreate);
    if (errors.length > 0) throw new Error(`create failed: ${native.request.describeUserErrors(errors)}`);
    const nativeId = createdData.discountCodeBasicCreate.codeDiscountNode.id;
    created.add(nativeId);
    guard();

    await storefront.open();
    await checkCart(storefront, "native before the move", "code WONTESTNATIVE applicable, 10 % on the line (native discount)");
    guard();

    const wonNodeIds = (await env.db.wonNode.findMany({ where: { shop }, select: { discountNodeId: true } })).map((n) => n.discountNodeId);
    const detection = await native.detect.detectNativeDiscounts(env.client, { ...env.options, wonNodeIds, ownAppKey: env.ownAppKey });
    const found = detection.movable.find((n) => n.id === nativeId);
    step("detect", { movable: detection.movable.length, notMovable: detection.notMovable.length, expired: detection.expired.length, found: Boolean(found) });
    check(found, "the test discount is detected as movable");
    check(found.codes.includes(CODE) && found.value?.kind === "percentage" && found.value.percent === 10, "detected as 10 % with its code");
    guard();

    const preview = await native.move.previewMove({ client: env.client, db: env.db, shop, nativeId, ...env.options });
    step("dialog preview", preview.ok ? { losses: preview.plan.losses, warnings: preview.plan.warnings, rule: preview.plan.rule } : preview);
    check(preview.ok, "preview ready");
    guard();

    const moved = await native.move.moveNative({ client: env.client, db: env.db, shop, nativeId, saveAndSync: env.saveAndSync, ...env.options });
    step("move", moved);
    check(moved.ok, "move succeeded");
    const afterMove = await gql(env, "exists", { id: nativeId });
    check(afterMove.discountNode === null, "the native discount is deleted");
    const configAfterMove = (await loadConfig(env.db, shop)).config;
    const rule = configAfterMove.modules.codes.rules.find((r) => r.origin?.nativeId === nativeId);
    check(rule && rule.codes?.includes(CODE) && rule.value.kind === "percentage" && rule.value.percent === 10, "the Won rule is in the config (10 %, same code)");
    const holderAfterMove = await codeHolder(env);
    check(holderAfterMove?.type === "DiscountCodeApp", `the code ${CODE} now lives on a Won node (${holderAfterMove?.id})`);
    await checkCart(storefront, "Won after the move", "code WONTESTNATIVE applicable, the Won rule gives the same 10 %");
    guard();

    const undone = await native.move.undoMove({
      client: env.client,
      db: env.db,
      shop,
      backupId: moved.backupId,
      saveAndSync: env.saveAndSync,
      ...env.options,
    });
    step("undo", undone);
    check(undone.ok && !undone.alreadyRestored, "undo succeeded");
    created.add(undone.nativeId);
    const holderAfterUndo = await codeHolder(env);
    check(holderAfterUndo?.type === "DiscountCodeBasic" && holderAfterUndo.title === TITLE, `the native discount is back with the code ${CODE}`);
    const restored = await gql(env, "one", { id: undone.nativeId, items: 10, codes: 10 });
    const normalized = native.normalize.normalizeNode(restored.discountNode, detection.shop);
    check(
      normalized?.movableType &&
        normalized.native.value?.kind === "percentage" &&
        normalized.native.value.percent === 10 &&
        normalized.native.target?.kind === "products" &&
        normalized.native.target.productIds.includes(product.id),
      "restored with the same value (10 %) and product",
    );
    const configAfterUndo = (await loadConfig(env.db, shop)).config;
    check(!configAfterUndo.modules.codes.rules.some((r) => r.origin?.nativeId === nativeId), "the Won rule is gone from the config");
    await checkCart(storefront, "native after the undo", "code WONTESTNATIVE applicable, the native discount gives 10 % again");
  } catch (error) {
    failure = error;
    evidence.data.error = String(error?.message ?? error).slice(0, 2000);
    console.error(`\n✖ ${evidence.data.error}`);
  } finally {
    cleaningUp = true;
    console.log("\n▶ cleanup");
    for (const [label, run] of [
      ["storefront cart (codes removed, cart cleared)", () => storefront.close()],
      ["test native discount", () => deleteTestNative(env, "cleanup")],
      ["test rule in the config", () => removeTestRules(env, shop, "cleanup")],
      ["test discount again (after the rule released its code)", () => deleteTestNative(env, "cleanup-2")],
      [
        "backup rows of this run",
        async () => {
          const { count } = await env.db.nativeDiscountBackup.deleteMany({ where: { shop, nativeId: { in: [...created] } } });
          evidence.data.cleanup.push({ phase: "cleanup", deletedBackupRows: count });
        },
      ],
    ]) {
      try {
        await run();
        console.log(`  ✓ ${label}`);
      } catch (error) {
        evidence.data.cleanup.push({ phase: "cleanup", failed: label, error: String(error?.message ?? error).slice(0, 500) });
        console.error(`  ✖ ${label}: ${error?.message ?? error}`);
        failure ??= error;
      }
    }
    evidence.data.finishedAt = new Date().toISOString();
    await fsp.mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `native-move-${live ? "live" : "dry"}-${Date.now()}.json`);
    await fsp.writeFile(file, `${JSON.stringify(evidence.data, null, 2)}\n`);
    console.log(`\nEvidence: ${file}`);
    await env.close();
  }
  if (failure) process.exitCode = 1;
  else console.log(`\n✔ native move + undo ${live ? "LIVE" : "dry-run"} passed`);
}

try {
  await main();
} catch (error) {
  // Environment problems (no DB, no sync layer): nothing was sent.
  console.error(`\n✖ ${error?.message ?? error}`);
  process.exitCode = 1;
}
