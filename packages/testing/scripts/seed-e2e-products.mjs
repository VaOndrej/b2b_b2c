// Create/refresh the SHARED E2E product catalog in the dev store. Idempotent:
// `productSet` upserts by handle, so re-running enhances existing products
// instead of duplicating them. Also writes each variant's purchase cost
// (`inventoryItem.cost`, catalog field `cost`) idempotently: unchanged cost
// = no mutation, and a variant with no `cost` in the catalog is never
// touched (its cost, if any, is left alone — never cleared).
//
// Two executors:
//
//   Token (default, unchanged): reads the Admin token from the environment
//   only (never printed, never written to disk).
//
//     SHOPIFY_ADMIN_API_TOKEN=<shpat_…> \
//     SHOPIFY_E2E_SHOP_DOMAIN=<shop>.myshopify.com \
//     node packages/testing/scripts/seed-e2e-products.mjs
//
//   The token needs write_products (+ publish to the Online Store).
//
//   --via-app <appDir>: acts as the named app via `shopify app execute`
//   (no admin token needed). Steps this app's scopes cannot perform (e.g.
//   publishing, which needs read_publications/write_publications) are
//   skipped with a clear message instead of failing the run.
//
//     node packages/testing/scripts/seed-e2e-products.mjs --via-app apps/won-discounts
//
// --dry-run prints the plan (product-set/publish steps, and per variant:
// current cost → new cost, or "unchanged") and sends nothing.

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { WON_E2E_PRODUCT_LIST } from "../src/e2e-products.js";

const execFileP = promisify(execFile);

const API_VERSION = "2026-04";
// Default API version for --via-app: the version verified (2026-09-29) to
// read/write inventoryItem.unitCost via `shopify app execute` with this
// app's scopes. Override with --version if needed.
const VIA_APP_DEFAULT_VERSION = "2026-07";

const shop = String(
  process.env.SHOPIFY_E2E_SHOP_DOMAIN ||
    "b2b-b2c-store-development.myshopify.com",
).trim();

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

const PRODUCT_SET = `
  mutation SeedProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product {
        id
        handle
        status
        variants(first: 20) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;

const PUBLICATIONS = `
  query Publications {
    publications(first: 25) { nodes { id name } }
  }
`;

const PUBLISH = `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

// Validated with the Shopify dev MCP (api "admin", version 2026-07).
const PRODUCT_READ = `
  query WonE2EProductRead($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      handle
      status
      variants(first: 20) {
        nodes {
          id
          price
          selectedOptions { name value }
          inventoryItem {
            id
            unitCost { amount currencyCode }
          }
        }
      }
    }
  }
`;

// Validated with the Shopify dev MCP (api "admin", version 2026-07).
const COST_UPDATE = `
  mutation WonE2ESetCost($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product { id }
      productVariants {
        id
        inventoryItem { unitCost { amount currencyCode } }
      }
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests — no network)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { dryRun: false, viaApp: null, version: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--via-app") {
      i += 1;
      args.viaApp = argv[i];
      if (!args.viaApp) throw new Error("--via-app requires a path");
    } else if (arg === "--version") {
      i += 1;
      args.version = argv[i];
      if (!args.version) throw new Error("--version requires a value");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function toProductSetInput(product) {
  const input = {
    title: product.title,
    handle: product.handle,
    status: "ACTIVE",
  };
  if (product.options.length > 0) {
    input.productOptions = product.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({ name: value })),
    }));
    input.variants = product.variants.map((variant) => ({
      price: variant.price,
      optionValues: Object.entries(variant.options ?? {}).map(
        ([optionName, name]) => ({ optionName, name }),
      ),
    }));
  } else {
    // No explicit options → Shopify's default "Title / Default Title" option.
    input.productOptions = [
      { name: "Title", values: [{ name: "Default Title" }] },
    ];
    input.variants = product.variants.map((variant) => ({
      price: variant.price,
      optionValues: [{ optionName: "Title", name: "Default Title" }],
    }));
  }
  return input;
}

/** Finds the existing variant node a catalog variant refers to (by option values, or the sole variant when there are none). */
export function matchVariant(existingNodes, catalogVariant, hasOptions) {
  if (!hasOptions) return existingNodes[0] ?? null;
  const wanted = Object.entries(catalogVariant.options ?? {});
  return (
    existingNodes.find((node) => {
      const selected = new Map(
        (node.selectedOptions ?? []).map((o) => [o.name, o.value]),
      );
      return wanted.every(([name, value]) => selected.get(name) === value);
    }) ?? null
  );
}

function sameCost(currentAmount, newCost) {
  if (currentAmount === null || currentAmount === undefined) return false;
  return Number(currentAmount).toFixed(2) === Number(newCost).toFixed(2);
}

/**
 * The cost plan for one catalog product against its current Admin state
 * (or `null` when the product does not exist yet). Only catalog variants
 * that declare a `cost` are included — a variant without one is never
 * planned, so it can never be mutated or cleared.
 */
export function planCostChanges(existingProduct, catalogProduct) {
  const hasOptions = catalogProduct.options.length > 0;
  const existingNodes = existingProduct?.variants?.nodes ?? [];
  const plan = [];
  for (const catalogVariant of catalogProduct.variants) {
    if (!("cost" in catalogVariant) || catalogVariant.cost == null) continue;
    const match = matchVariant(existingNodes, catalogVariant, hasOptions);
    const label =
      Object.entries(catalogVariant.options ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join(", ") || "(default)";
    if (!match) {
      plan.push({
        label,
        variantId: null,
        currentCost: null,
        currentCurrency: null,
        newCost: catalogVariant.cost,
        unchanged: false,
        notFound: true,
      });
      continue;
    }
    const currentAmount = match.inventoryItem?.unitCost?.amount ?? null;
    const currentCurrency = match.inventoryItem?.unitCost?.currencyCode ?? null;
    plan.push({
      label,
      variantId: match.id,
      currentCost: currentAmount,
      currentCurrency,
      newCost: catalogVariant.cost,
      unchanged: sameCost(currentAmount, catalogVariant.cost),
      notFound: false,
    });
  }
  return plan;
}

function printCostPlan(handle, plan) {
  for (const entry of plan) {
    if (entry.notFound) {
      console.log(
        `    ${entry.label}: variant not found yet (product not created) → would set cost ${entry.newCost}`,
      );
      continue;
    }
    const current =
      entry.currentCost === null
        ? "none"
        : `${entry.currentCost} ${entry.currentCurrency ?? ""}`.trim();
    if (entry.unchanged) {
      console.log(`    ${entry.label}: ${current} → unchanged`);
    } else {
      console.log(`    ${entry.label}: ${current} → ${entry.newCost}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

/** Token-based executor (unchanged behaviour): POSTs to the Admin GraphQL endpoint with SHOPIFY_ADMIN_API_TOKEN. */
function createTokenExecutor() {
  const token = String(process.env.SHOPIFY_ADMIN_API_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "SHOPIFY_ADMIN_API_TOKEN is required (Admin token with write_products), or pass --via-app <appDir>.",
    );
  }
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  return async function gql(query, variables) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Admin API.`);
    }
    const json = await response.json();
    if (json.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  };
}

/** `shopify app execute` executor: acts as the named app, no admin token. */
function createViaAppExecutor({ appDir, repoRoot, version }) {
  const outDir = path.join(os.tmpdir(), "won-e2e-seed-via-app");
  let counter = 0;
  return async function gqlViaApp(query, variables) {
    counter += 1;
    await fsp.mkdir(outDir, { recursive: true });
    const stamp = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
    const queryFile = path.join(outDir, `q-${stamp}.graphql`);
    const outputFile = path.join(outDir, `o-${stamp}.json`);
    await fsp.writeFile(queryFile, query);
    const args = [
      "shopify",
      "app",
      "execute",
      "--path",
      appDir,
      "--store",
      shop,
      "--version",
      version,
      "--query-file",
      queryFile,
      "--output-file",
      outputFile,
      "--no-color",
    ];
    if (variables !== undefined) {
      const variableFile = path.join(outDir, `v-${stamp}.json`);
      await fsp.writeFile(variableFile, JSON.stringify(variables));
      args.push("--variable-file", variableFile);
    }
    await execFileP("npx", args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
    const raw = JSON.parse(await fsp.readFile(outputFile, "utf8"));
    if (raw.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(raw.errors)}`);
    }
    return raw.data ?? raw;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readProduct(execute, handle) {
  const data = await execute(PRODUCT_READ, { handle });
  return data.productByIdentifier ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const viaApp = Boolean(args.viaApp);
  const dryRun = args.dryRun;

  let execute;
  if (viaApp) {
    const appDir = path.resolve(args.viaApp);
    const repoRoot = path.resolve(appDir, "../..");
    const version = args.version || VIA_APP_DEFAULT_VERSION;
    execute = createViaAppExecutor({ appDir, repoRoot, version });
    console.log(
      `Executor: shopify app execute --path ${appDir} --store ${shop} --version ${version}${dryRun ? " (dry-run: nothing will be sent that mutates)" : ""}`,
    );
    console.log(
      "  ⚠ via-app mode: publishing is skipped (this app's scopes do not include read_publications/write_publications).",
    );
  } else {
    execute = createTokenExecutor();
    console.log(`Executor: Admin token, ${shop} (${API_VERSION})${dryRun ? " (dry-run: nothing will be sent that mutates)" : ""}`);
  }

  let onlineStoreId = null;
  if (!viaApp && !dryRun) {
    const pubs = await execute(PUBLICATIONS);
    const onlineStore = pubs.publications.nodes.find(
      (node) => node.name === "Online Store",
    );
    if (!onlineStore) {
      throw new Error("Online Store publication not found on this shop.");
    }
    onlineStoreId = onlineStore.id;
  }

  let totalCostMutations = 0;

  for (const product of WON_E2E_PRODUCT_LIST) {
    console.log(`\n=== ${product.handle} ===`);
    const existing = await readProduct(execute, product.handle);

    if (dryRun) {
      console.log(
        existing
          ? "  productSet: would upsert (already exists)"
          : "  productSet: would create",
      );
      console.log(
        viaApp
          ? "  publish: skipped in via-app mode (missing scope)"
          : "  publish: would publish to Online Store",
      );
      const plan = planCostChanges(existing, product);
      printCostPlan(product.handle, plan);
      continue;
    }

    const data = await execute(PRODUCT_SET, {
      input: toProductSetInput(product),
      identifier: { handle: product.handle },
    });
    const setErrors = data.productSet.userErrors;
    if (setErrors.length > 0) {
      throw new Error(
        `productSet ${product.handle}: ${JSON.stringify(setErrors)}`,
      );
    }
    const created = data.productSet.product;

    if (!viaApp) {
      const published = await execute(PUBLISH, {
        id: created.id,
        input: [{ publicationId: onlineStoreId }],
      });
      const publishErrors = published.publishablePublish.userErrors;
      if (publishErrors.length > 0) {
        throw new Error(
          `publish ${product.handle}: ${JSON.stringify(publishErrors)}`,
        );
      }
    } else {
      console.log("  publish: skipped in via-app mode (missing scope)");
    }

    console.log(
      `✓ ${product.handle}  (${created.variants.nodes.length} variant(s))`,
    );

    // Re-read for authoritative variant ids + current costs, then plan/apply.
    const refreshed = await readProduct(execute, product.handle);
    const plan = planCostChanges(refreshed, product);
    const toUpdate = plan.filter((entry) => entry.variantId && !entry.unchanged);
    if (toUpdate.length > 0) {
      const result = await execute(COST_UPDATE, {
        productId: refreshed.id,
        variants: toUpdate.map((entry) => ({
          id: entry.variantId,
          inventoryItem: { cost: entry.newCost },
        })),
      });
      const costErrors = result.productVariantsBulkUpdate.userErrors;
      if (costErrors.length > 0) {
        throw new Error(
          `productVariantsBulkUpdate ${product.handle}: ${JSON.stringify(costErrors)}`,
        );
      }
      totalCostMutations += toUpdate.length;
    }
    // Read back once more so the printed costs reflect what's actually stored.
    const final = toUpdate.length > 0 ? await readProduct(execute, product.handle) : refreshed;
    printCostPlan(product.handle, planCostChanges(final, product));
  }

  console.log(
    `\nSeeded ${WON_E2E_PRODUCT_LIST.length} shared E2E products on ${shop}.` +
      (dryRun ? "" : ` Cost mutations applied: ${totalCostMutations}.`),
  );
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
