#!/usr/bin/env node
/* eslint-env node */
// The Pro margin E2E's test collection (MVP 2, Task 5b phase B):
// `won-e2e-margin`, a MANUAL collection holding won-e2e-simple-b only (see
// scripts/e2e/margin-fixture.mjs). The seed profile `margin-pro` gives it its
// own margin setting; this script only creates and deletes the collection.
//
//   node apps/won-discounts/scripts/e2e/margin-collection.mjs
//       DRY-RUN: reads the store, prints the collectionCreate it would send.
//   node apps/won-discounts/scripts/e2e/margin-collection.mjs --live
//       creates it (nothing to do when it already exists with exactly that
//       member; refuses when it exists with anything else), then reads it back.
//   node apps/won-discounts/scripts/e2e/margin-collection.mjs --delete [--live]
//       deletes it (dry-run by default). Refuses a collection whose title is not
//       the fixture's or that holds a product outside the won-e2e-* catalog.
//   node apps/won-discounts/scripts/e2e/margin-collection.mjs --state
//       read-only: the collection (or null) and the member product's collections.
//
// Options: --out <dir> (evidence; default $WON_E2E_OUT or <tmp>/won-discounts-e2e).
// Scopes (validated with the Shopify dev MCP, admin 2026-04): collectionCreate
// write_products + read_products, collectionDelete write_products, the reads
// read_products — all granted to the app. Mutations go through the CLI admin
// client, which refuses any store but the dev store.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

import { WON_E2E_PRODUCT_LIST } from "@won/testing/e2e-products";

import { MARGIN_COLLECTION_HANDLE, MARGIN_COLLECTION_MEMBER_HANDLE, MARGIN_COLLECTION_TITLE } from "./margin-fixture.mjs";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const E2E_HANDLES = new Set(WON_E2E_PRODUCT_LIST.map((product) => product.handle));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
for (const [i, arg] of argv.entries()) {
  if (argv[i - 1] === "--out") continue;
  if (!["--live", "--delete", "--state", "--out"].includes(arg)) throw new Error(`unknown argument ${arg}`);
}
const live = flag("--live");
const remove = flag("--delete");
const stateOnly = flag("--state");
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));

const { createCliAdminClient } = await import(pathToFileURL(path.join(APP_DIR, "app/lib/admin-client-cli.server.ts")).href);
const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });

async function call(document, variables) {
  const result = await client.graphql(document, variables);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

// Validated with the Shopify dev MCP (admin 2026-04).
const STATE_QUERY = `query WonE2eMarginCollection($handle: String!, $productHandle: String!) {
  collectionByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    title
    ruleSet {
      rules {
        column
      }
    }
    productsCount {
      count
      precision
    }
    products(first: 10) {
      nodes {
        id
        handle
      }
    }
  }
  product: productByIdentifier(identifier: { handle: $productHandle }) {
    id
    handle
    collections(first: 20) {
      nodes {
        id
        handle
      }
    }
  }
}`;

const CREATE = `mutation WonE2eMarginCollectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection {
      id
      handle
      title
      productsCount {
        count
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const DELETE = `mutation WonE2eMarginCollectionDelete($input: CollectionDeleteInput!) {
  collectionDelete(input: $input) {
    deletedCollectionId
    userErrors {
      field
      message
    }
  }
}`;

async function readState() {
  const data = await call(STATE_QUERY, { handle: MARGIN_COLLECTION_HANDLE, productHandle: MARGIN_COLLECTION_MEMBER_HANDLE });
  const c = data.collectionByIdentifier;
  return {
    checkedAt: new Date().toISOString(),
    collection: c
      ? {
          id: c.id,
          handle: c.handle,
          title: c.title,
          smart: (c.ruleSet?.rules?.length ?? 0) > 0,
          productsCount: c.productsCount,
          products: c.products.nodes.map((p) => p.handle),
        }
      : null,
    member: data.product ? { id: data.product.id, handle: data.product.handle, collections: data.product.collections.nodes.map((n) => n.handle) } : null,
  };
}

function print(state, label) {
  const c = state.collection;
  console.log(
    `# ${label}: collection ${MARGIN_COLLECTION_HANDLE} ${c ? `= ${c.id} "${c.title}" (${c.smart ? "smart" : "manual"}), products [${c.products.join(", ")}]` : "does not exist"}; ` +
      `${MARGIN_COLLECTION_MEMBER_HANDLE} is in [${state.member?.collections.join(", ") ?? "—"}]`,
  );
}

function evidence(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Evidence: ${file}`);
}

/** Read until `done(state)` (membership of a new collection may lag a moment), at most ~30 s. */
async function readUntil(done) {
  let state = await readState();
  for (let i = 0; i < 10 && !done(state); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    state = await readState();
  }
  return state;
}

const onlyMember = (c) => c !== null && !c.smart && c.products.length === 1 && c.products[0] === MARGIN_COLLECTION_MEMBER_HANDLE;

async function main() {
  const before = await readState();
  print(before, "store");
  if (stateOnly) {
    console.log(JSON.stringify(before, null, 2));
    return;
  }
  if (!before.member) throw new Error(`product ${MARGIN_COLLECTION_MEMBER_HANDLE} not found on ${STORE}`);

  if (remove) {
    const c = before.collection;
    if (!c) {
      console.log("\n# delete: nothing to do (the collection does not exist)");
      return;
    }
    const foreign = c.products.filter((handle) => !E2E_HANDLES.has(handle));
    if (c.title !== MARGIN_COLLECTION_TITLE || foreign.length > 0) {
      throw new Error(`refusing to delete ${c.id}: title "${c.title}" / products outside the E2E catalog [${foreign.join(", ")}] — not the fixture's collection`);
    }
    console.log(`\n--- ${live ? "sending" : "would send"} WonE2eMarginCollectionDelete ---\n${JSON.stringify({ input: { id: c.id } }, null, 2)}`);
    if (!live) {
      console.log("\n(dry-run: nothing written; pass --live)");
      return;
    }
    const data = await call(DELETE, { input: { id: c.id } });
    const errors = data.collectionDelete.userErrors;
    if (errors.length) throw new Error(`collectionDelete: ${errors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`);
    const after = await readUntil((s) => s.collection === null && !(s.member?.collections ?? []).includes(MARGIN_COLLECTION_HANDLE));
    print(after, "read-back");
    evidence("margin-collection-delete", { store: STORE, deleted: data.collectionDelete.deletedCollectionId, before, after });
    process.exitCode = after.collection === null ? 0 : 1;
    return;
  }

  if (before.collection) {
    if (onlyMember(before.collection) && before.collection.title === MARGIN_COLLECTION_TITLE) {
      console.log("\n# create: nothing to do (the collection exists with exactly its member)");
      return;
    }
    throw new Error(`the collection ${MARGIN_COLLECTION_HANDLE} exists but is not the fixture's (${JSON.stringify(before.collection)}); fix it by hand`);
  }
  const input = { title: MARGIN_COLLECTION_TITLE, handle: MARGIN_COLLECTION_HANDLE, products: [before.member.id] };
  console.log(`\n--- ${live ? "sending" : "would send"} WonE2eMarginCollectionCreate ---\n${JSON.stringify({ input }, null, 2)}`);
  if (!live) {
    console.log("\n(dry-run: nothing written; pass --live)");
    return;
  }
  const data = await call(CREATE, { input });
  const errors = data.collectionCreate.userErrors;
  if (errors.length) throw new Error(`collectionCreate: ${errors.map((e) => `${e.field?.join(".")}: ${e.message}`).join("; ")}`);
  const after = await readUntil((s) => onlyMember(s.collection) && (s.member?.collections ?? []).includes(MARGIN_COLLECTION_HANDLE));
  print(after, "read-back");
  evidence("margin-collection-create", { store: STORE, created: data.collectionCreate.collection, before, after });
  process.exitCode = onlyMember(after.collection) ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ ${error?.message ?? error}`);
  process.exitCode = 1;
}
