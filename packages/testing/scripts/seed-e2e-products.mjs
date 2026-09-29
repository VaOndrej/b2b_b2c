// Create/refresh the SHARED E2E product catalog in the dev store. Idempotent:
// `productSet` upserts by handle, so re-running enhances existing products
// instead of duplicating them. Also writes each variant's purchase cost
// (`inventoryItem.cost`, catalog field `cost`) idempotently: unchanged cost
// = no mutation, and a variant with no `cost` in the catalog is never
// touched (its cost, if any, is left alone — never cleared).
//
// Two executors:
//
//   Token (default): reads the Admin token from the environment only (never
//   printed, never written to disk). Scopes, exactly:
//     - product-set/create: write_products
//     - publish to the Online Store: additionally read_publications/
//       write_publications
//     - reading inventoryItem.unitCost: verified (2026-09-29) to work with
//       read_products alone on this store/token — no read_inventory needed
//       in practice, even though the Admin schema documents that field as
//       requiring read_inventory too
//     - writing inventoryItem.cost (productVariantsBulkUpdate): write_products
//   Whatever a given token actually has, the cost read/write step is
//   scope-tolerant (see below) — it never aborts the whole run.
//
//     SHOPIFY_ADMIN_API_TOKEN=<shpat_…> \
//     SHOPIFY_E2E_SHOP_DOMAIN=<shop>.myshopify.com \
//     node packages/testing/scripts/seed-e2e-products.mjs
//
//   --via-app <appDir>: acts as the named app via `shopify app execute`
//   (no admin token needed).
//
//     node packages/testing/scripts/seed-e2e-products.mjs --via-app apps/won-discounts
//
// Scope tolerance (both executors): publishing and the cost read/write are
// each attempted independently. If a step fails with what looks like an
// access/permission error (missing scope), that one step is skipped for
// that product with a one-line message instead of aborting the run; any
// other error (network, GraphQL validation, a real userError) still fails
// the run. Via-app mode additionally always skips publish up front — this
// app's scopes never include read_publications/write_publications.
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

// The dev store's shop currency (verified 2026-09-29). Catalog `cost` values
// are plain amounts in this currency; a variant whose unitCost is reported
// in a different currency is never "unchanged" even if the amount matches.
const SHOP_CURRENCY = "USD";

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

// Validated with the Shopify dev MCP (api "admin", version 2026-07). No
// inventoryItem field here on purpose: existence checks must never fail
// because of a cost-scope issue.
const PRODUCT_EXISTS = `
  query WonE2EProductExists($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      handle
      status
    }
  }
`;

// Validated with the Shopify dev MCP (api "admin", version 2026-07). Kept
// separate from PRODUCT_EXISTS so an access/scope error reading
// inventoryItem.unitCost only ever skips the cost step, never the
// product-set/publish steps.
const PRODUCT_COST = `
  query WonE2EProductCost($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
      variants(first: 20) {
        nodes {
          id
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

/** A different currency is always a change, never "unchanged", regardless of the amount. */
export function sameCost(currentAmount, currentCurrency, newCost) {
  if (currentAmount === null || currentAmount === undefined) return false;
  if (currentCurrency && currentCurrency !== SHOP_CURRENCY) return false;
  return Number(currentAmount).toFixed(2) === Number(newCost).toFixed(2);
}

/**
 * The cost plan for one catalog product against its current Admin state
 * (or `null` when the product does not exist yet, or the cost read was
 * skipped for scope reasons). Only catalog variants that declare a `cost`
 * are included — a variant without one is never planned, so it can never be
 * mutated or cleared.
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
      unchanged: sameCost(currentAmount, currentCurrency, catalogVariant.cost),
      notFound: false,
    });
  }
  return plan;
}

function printCostPlan(plan) {
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

/**
 * Classifies an error thrown by an executor as an access/permission problem
 * (missing scope) vs. anything else (network, GraphQL validation, a real
 * userError) that must still fail the run. Matches the wording Shopify's
 * Admin API and the `shopify app execute` CLI use for scope/access denials
 * (e.g. GraphQL extensions.code "ACCESS_DENIED", "requires ... access
 * scope", "not approved to access").
 */
export function isAccessError(error) {
  const message = String(error?.message ?? error ?? "");
  return /access[_ ]denied|access scope|not approved|unauthorized|forbidden/i.test(
    message,
  );
}

/**
 * Aggregates one run's successful cost writes into the numbers the summary
 * line reports: total variants written, and how many
 * `productVariantsBulkUpdate` calls that took (one call per product that had
 * at least one variant to update). Kept separate from `main()` so the
 * arithmetic is unit-testable without a store.
 */
export function summarizeCostRun(perCallVariantCounts) {
  const calls = perCallVariantCounts.filter((count) => count > 0).length;
  const variants = perCallVariantCounts.reduce((sum, count) => sum + count, 0);
  return { variants, calls };
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

/** Token-based executor (unchanged transport behaviour): POSTs to the Admin GraphQL endpoint with SHOPIFY_ADMIN_API_TOKEN. */
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

/** `shopify app execute` executor: acts as the named app, no admin token. Cleans up its temp files after every call, success or failure. */
function createViaAppExecutor({ appDir, repoRoot, version }) {
  const outDir = path.join(os.tmpdir(), "won-e2e-seed-via-app");
  let counter = 0;
  return async function gqlViaApp(query, variables) {
    counter += 1;
    await fsp.mkdir(outDir, { recursive: true });
    const stamp = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
    const queryFile = path.join(outDir, `q-${stamp}.graphql`);
    const outputFile = path.join(outDir, `o-${stamp}.json`);
    const variableFile =
      variables !== undefined ? path.join(outDir, `v-${stamp}.json`) : null;
    const cleanup = [queryFile, outputFile, ...(variableFile ? [variableFile] : [])];
    try {
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
      if (variableFile) {
        await fsp.writeFile(variableFile, JSON.stringify(variables));
        args.push("--variable-file", variableFile);
      }
      await execFileP("npx", args, { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
      const raw = JSON.parse(await fsp.readFile(outputFile, "utf8"));
      if (raw.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(raw.errors)}`);
      }
      return raw.data ?? raw;
    } finally {
      await Promise.all(
        cleanup.map((file) => fsp.rm(file, { force: true }).catch(() => {})),
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Scope-tolerant cost step (both executors)
// ---------------------------------------------------------------------------

async function readProductExists(execute, handle) {
  const data = await execute(PRODUCT_EXISTS, { handle });
  return data.productByIdentifier ?? null;
}

/** Reads cost data for one product. Never throws on an access/scope error — returns `{ skipped: true, message }` instead; any other error still throws. */
export async function tryReadCost(execute, handle) {
  try {
    const data = await execute(PRODUCT_COST, { handle });
    return { skipped: false, product: data.productByIdentifier ?? null };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        skipped: true,
        message: `reading inventoryItem.unitCost failed (${String(error.message ?? error).slice(0, 200)})`,
      };
    }
    throw error;
  }
}

/** Writes a batch of variant costs for one product. Never throws on an access/scope error — returns `{ skipped: true, message }` instead; any other error (transport or a real userError) still throws. */
export async function tryWriteCost(execute, productId, toUpdate) {
  try {
    const result = await execute(COST_UPDATE, {
      productId,
      variants: toUpdate.map((entry) => ({
        id: entry.variantId,
        inventoryItem: { cost: entry.newCost },
      })),
    });
    const costErrors = result.productVariantsBulkUpdate.userErrors;
    if (costErrors.length > 0) {
      throw new Error(`productVariantsBulkUpdate: ${JSON.stringify(costErrors)}`);
    }
    return { skipped: false };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        skipped: true,
        message: `writing inventoryItem.cost failed (${String(error.message ?? error).slice(0, 200)})`,
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

  const costCallCounts = []; // one entry per successful productVariantsBulkUpdate call, value = variants in that call
  let costSkips = 0;

  for (const product of WON_E2E_PRODUCT_LIST) {
    console.log(`\n=== ${product.handle} ===`);

    if (dryRun) {
      const existing = await readProductExists(execute, product.handle);
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
      const costRead = await tryReadCost(execute, product.handle);
      if (costRead.skipped) {
        console.log(`    cost step skipped: ${costRead.message}`);
      } else {
        printCostPlan(planCostChanges(costRead.product, product));
      }
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

    const costRead = await tryReadCost(execute, product.handle);
    if (costRead.skipped) {
      console.log(`    cost step skipped: ${costRead.message}`);
      costSkips += 1;
      continue;
    }

    const plan = planCostChanges(costRead.product, product);
    const toUpdate = plan.filter((entry) => entry.variantId && !entry.unchanged);
    let finalProduct = costRead.product;
    if (toUpdate.length > 0) {
      const writeResult = await tryWriteCost(execute, costRead.product.id, toUpdate);
      if (writeResult.skipped) {
        console.log(`    cost step skipped: ${writeResult.message} — planned, not written:`);
        printCostPlan(plan);
        costSkips += 1;
        continue;
      }
      costCallCounts.push(toUpdate.length);
      // Read back once more so the printed costs reflect what's actually stored.
      const reread = await tryReadCost(execute, product.handle);
      if (reread.skipped) {
        console.log(`    written; read-back skipped (${reread.message}) — costs below are the plan, not a read-back:`);
        printCostPlan(plan);
        continue;
      }
      finalProduct = reread.product;
    }
    printCostPlan(planCostChanges(finalProduct, product));
  }

  const { variants, calls } = summarizeCostRun(costCallCounts);
  console.log(
    `\nSeeded ${WON_E2E_PRODUCT_LIST.length} shared E2E products on ${shop}.` +
      (dryRun
        ? ""
        : ` Cost step: ${variants} variant(s) updated via ${calls} productVariantsBulkUpdate call(s)${
            costSkips > 0 ? `, ${costSkips} product(s) skipped (missing scope)` : ""
          }.`),
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
