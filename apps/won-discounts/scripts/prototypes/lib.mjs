// Shared plumbing for the MVP 0 platform-risk prototypes (C1–C4) and the
// MVP 1 transport prototype C7 (app-owned shop metafield).
//
// Every prototype script follows the same contract:
//   node scripts/prototypes/cN-*.mjs          dry-run: prints the plan and every
//                                             GraphQL document + variables it
//                                             would send; touches nothing
//   node --env-file=apps/won-discounts/.env \
//        apps/won-discounts/scripts/prototypes/cN-*.mjs --live
//                                             executes against the dev store,
//                                             writes evidence JSON, and ALWAYS
//                                             deletes what it created
//   … --live --confirm-store-wide             required on top of --live when the
//                                             experiment puts an AUTOMATIC node in a
//                                             mode that discounts every cart line
//                                             (percent_all, campaign_window, echo on
//                                             automatic): every other app's E2E on
//                                             the shared dev store sees that discount
//                                             while it exists (audit P3-3)
//
// Safety (audit P3-2):
//   - cleanup always finishes: SIGINT/SIGTERM is deferred until the cleanup
//     (registered nodes + metafields, then a sweep) has completed; repeated
//     signals only print a notice. Admin calls are spawned in their own process
//     group, so Ctrl+C in the terminal does not kill a delete half-way.
//   - a create is never repeated blindly: after a transport failure the node is
//     looked up by its exact title first and only re-created when absent.
//   - the sweep pages through ALL discount nodes and deletes only app discounts
//     of THIS app's function (appKey = client_id, functionId) with the WON-PROTO
//     title prefix, plus our $app:won_discounts.product metafield on every
//     won-e2e-* product. Anything else with the prefix is reported, never deleted.
//
// Admin API: `shopify app execute` as the app (no admin token). Storefront:
// Playwright, password page unlocked with SHOPIFY_E2E_STOREFRONT_PASSWORD
// (never printed). Every GraphQL document below was validated with the Shopify
// dev MCP (api "admin", version 2026-04) before it was run.

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { WON_E2E_PRODUCT_LIST } from "@won/testing/e2e-products";

const execFileP = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(HERE, "../..");
export const REPO_ROOT = path.resolve(APP_DIR, "../..");
export const STORE = "b2b-b2c-store-development.myshopify.com";
export const API_VERSION = "2026-04";
export const FUNCTION_HANDLE = "won-discounts-engine";
export const TITLE_PREFIX = "WON-PROTO";
export const PRODUCT_HANDLE = "won-e2e-simple-a";
export const NO_CAMPAIGN = "1970-01-01T00:00:00";
export const CONFIG_NAMESPACE = "$app:won_discounts";
export const CONFIG_KEY = "function_config";
export const PRODUCT_KEY = "product";
/** This app's client_id (public, from shopify.app.toml): `appDiscountType.appKey` of our nodes. */
export const APP_CLIENT_ID = readClientId();
/** Shared E2E catalog (packages/testing): the only products a prototype may write a metafield on. */
export const E2E_PRODUCT_HANDLES = WON_E2E_PRODUCT_LIST.map((product) => product.handle).filter((handle) =>
  handle.startsWith("won-e2e-"),
);
/** Discount node types an app function provides (the only kind the sweep may delete). */
const APP_DISCOUNT_TYPES = new Set(["DiscountAutomaticApp", "DiscountCodeApp"]);

function readClientId() {
  const toml = fs.readFileSync(path.join(APP_DIR, "shopify.app.toml"), "utf8");
  const match = /^client_id\s*=\s*"([^"]+)"/m.exec(toml);
  if (!match) throw new Error("client_id not found in shopify.app.toml");
  return match[1];
}
/** Evidence + temp files. Override with WON_PROTO_OUT (e.g. a scratchpad dir). */
export const OUT_DIR = process.env.WON_PROTO_OUT ?? path.join(os.tmpdir(), "won-discounts-prototypes");
const FUNCTION_LOG_DIR = path.join(APP_DIR, ".shopify", "logs");
/** Optional: the `shopify app dev` output file, read-only, tailed for function lines. */
const APP_DEV_LOG = process.env.WON_PROTO_APP_DEV_LOG ?? null;

// ---------------------------------------------------------------------------
// GraphQL documents (validated: shopify-dev MCP, api admin, 2026-04)
// ---------------------------------------------------------------------------

export const GQL = {
  functions: `query WonProtoFunctions {
  shopifyFunctions(first: 50) {
    nodes {
      id
      handle
      title
      apiType
      app {
        title
      }
    }
  }
  shop {
    ianaTimezone
    timezoneOffset
  }
}`,
  // Paged (100 per page, `after` = previous endCursor) and without a search
  // `query`: the search index lags behind fresh creates, a plain listing does not.
  discountNodes: `query WonProtoDiscountNodes($after: String) {
  discountNodes(first: 100, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticApp { title status appDiscountType { functionId appKey } }
        ... on DiscountCodeApp { title status appDiscountType { functionId appKey } }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
        ... on DiscountAutomaticFreeShipping { title status }
        ... on DiscountCodeBasic { title status }
        ... on DiscountCodeBxgy { title status }
        ... on DiscountCodeFreeShipping { title status }
      }
    }
  }
}`,
  automaticCreate: `mutation WonProtoAutoCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
    automaticAppDiscount {
      discountId
      title
      status
      discountClasses
      startsAt
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  codeCreate: `mutation WonProtoCodeCreate($codeAppDiscount: DiscountCodeAppInput!) {
  discountCodeAppCreate(codeAppDiscount: $codeAppDiscount) {
    codeAppDiscount {
      discountId
      title
      status
      discountClasses
      codes(first: 10) {
        nodes {
          code
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  basicCodeCreate: `mutation WonProtoBasicCodeCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  redeemBulkAdd: `mutation WonProtoRedeemBulkAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
  discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
    bulkCreation {
      id
      done
      codesCount
      importedCount
      failedCount
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  redeemBulkStatus: `query WonProtoBulkStatus($id: ID!) {
  discountRedeemCodeBulkCreation(id: $id) {
    id
    done
    codesCount
    importedCount
    failedCount
    codes(first: 10) {
      nodes {
        code
        errors {
          field
          message
          code
        }
      }
    }
  }
}`,
  metafieldsSet: `mutation WonProtoMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      type
      compareDigest
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  automaticDelete: `mutation WonProtoAutoDelete($id: ID!) {
  discountAutomaticDelete(id: $id) {
    deletedAutomaticDiscountId
    userErrors {
      field
      message
      code
    }
  }
}`,
  codeDelete: `mutation WonProtoCodeDelete($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors {
      field
      message
      code
    }
  }
}`,
  metafieldsDelete: `mutation WonProtoMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields {
      ownerId
      namespace
      key
    }
    userErrors {
      field
      message
    }
  }
}`,
  nodeConfig: `query WonProtoNodeConfig($id: ID!) {
  discountNode(id: $id) {
    id
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      type
      value
      updatedAt
    }
    discount {
      __typename
      ... on DiscountCodeApp {
        title
        status
        codesCount {
          count
        }
        codes(first: 10) {
          nodes {
            code
          }
        }
      }
      ... on DiscountAutomaticApp {
        title
        status
      }
    }
  }
}`,
  // C7: the app-owned SHOP metafield (same namespace/key as the node config).
  shopConfig: `query WonProtoShopConfig {
  shop {
    id
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      namespace
      key
      type
      value
      updatedAt
    }
  }
}`,
  product: `query WonProtoProduct($identifier: ProductIdentifierInput!) {
  productByIdentifier(identifier: $identifier) {
    id
    handle
    metafield(namespace: "$app:won_discounts", key: "product") {
      id
      type
      value
    }
    variants(first: 5) {
      nodes {
        id
        price
      }
    }
  }
}`,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const bytes = (value) => Buffer.byteLength(value, "utf8");
export const now = () => new Date().toISOString();

/** `function_config` with the mandatory top-level campaign keys (query contract). */
export function functionConfig(prototype, extra = {}) {
  return { prototype, campaignStart: NO_CAMPAIGN, campaignEnd: NO_CAMPAIGN, ...extra };
}

/**
 * Serialised config padded with an ignored top-level `_pad` key to exactly
 * `targetBytes` UTF-8 bytes (compact JSON, ASCII padding).
 */
export function paddedConfigValue(config, targetBytes) {
  const empty = JSON.stringify({ ...config, _pad: "" });
  const padLength = targetBytes - bytes(empty);
  if (padLength < 0) throw new Error(`config already ${bytes(empty)} B > ${targetBytes} B`);
  const value = JSON.stringify({ ...config, _pad: "x".repeat(padLength) });
  if (bytes(value) !== targetBytes) throw new Error(`padding miss: ${bytes(value)} != ${targetBytes}`);
  return value;
}

/** Shop-local `YYYY-MM-DDTHH:MM:SS` (DateTimeWithoutTimezone) for `date` in `timeZone`. */
export function shopLocal(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Keep evidence readable: long strings (padded configs) become a byte count + preview. */
function redact(value) {
  if (typeof value === "string") {
    return value.length > 400 ? `<${bytes(value)} B> ${value.slice(0, 160)}…` : value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redact(inner)]));
  }
  return value;
}

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export class Evidence {
  constructor(name, live) {
    this.name = name;
    this.live = live;
    this.file = path.join(OUT_DIR, `${name}.json`);
    /** @type {Record<string, any>} free-form evidence, serialised as-is */
    this.data = {
      experiment: name,
      mode: live ? "live" : "dry-run",
      store: STORE,
      apiVersion: API_VERSION,
      startedAt: now(),
      steps: [],
      observations: [],
      graphql: [],
      functionLogs: [],
      cleanup: { actions: [] },
    };
  }

  step(message, extra) {
    const entry = { at: now(), message, ...(extra ? { extra: redact(extra) } : {}) };
    this.data.steps.push(entry);
    console.log(`\n▶ ${message}`);
    if (extra) console.log(JSON.stringify(redact(extra), null, 2));
  }

  async save() {
    if (!this.live) return;
    this.data.savedAt = now();
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    // Write + rename: a signal-driven exit during a save never leaves a truncated file.
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    await fsp.rename(tmp, this.file);
  }
}

// ---------------------------------------------------------------------------
// Admin API via `shopify app execute`
// ---------------------------------------------------------------------------

let dryCounter = 0;

function dryResponse(name, variables) {
  dryCounter += 1;
  const id = `DRY-RUN-${dryCounter}`;
  switch (name) {
    case "functions":
      return {
        shopifyFunctions: { nodes: [{ id: "<function-id>", handle: FUNCTION_HANDLE, apiType: "discount" }] },
        shop: { ianaTimezone: "America/New_York", timezoneOffset: "-0400" },
      };
    case "discountNodes":
      return { discountNodes: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    case "automaticCreate":
      return {
        discountAutomaticAppCreate: {
          automaticAppDiscount: { discountId: `gid://shopify/DiscountAutomaticNode/${id}`, status: "ACTIVE" },
          userErrors: [],
        },
      };
    case "codeCreate":
      return {
        discountCodeAppCreate: {
          codeAppDiscount: {
            discountId: `gid://shopify/DiscountCodeNode/${id}`,
            status: "ACTIVE",
            codes: { nodes: [{ code: variables.codeAppDiscount.code }] },
          },
          userErrors: [],
        },
      };
    case "basicCodeCreate":
      return { discountCodeBasicCreate: { codeDiscountNode: { id: `gid://shopify/DiscountCodeNode/${id}` }, userErrors: [] } };
    case "redeemBulkAdd":
      return {
        discountRedeemCodeBulkAdd: {
          bulkCreation: { id: `gid://shopify/DiscountRedeemCodeBulkCreation/${id}`, done: false },
          userErrors: [],
        },
      };
    case "redeemBulkStatus":
      return {
        discountRedeemCodeBulkCreation: { done: true, importedCount: 1, failedCount: 0, codes: { nodes: [] } },
      };
    case "metafieldsSet":
      return { metafieldsSet: { metafields: [{ id: `gid://shopify/Metafield/${id}` }], userErrors: [] } };
    case "automaticDelete":
      return { discountAutomaticDelete: { deletedAutomaticDiscountId: variables.id, userErrors: [] } };
    case "codeDelete":
      return { discountCodeDelete: { deletedCodeDiscountId: variables.id, userErrors: [] } };
    case "metafieldsDelete":
      return { metafieldsDelete: { deletedMetafields: variables.metafields, userErrors: [] } };
    case "nodeConfig":
      return { discountNode: { id: variables.id, metafield: { value: "<dry-run>" }, discount: {} } };
    case "shopConfig":
      return { shop: { id: "gid://shopify/Shop/DRY-RUN", metafield: null } };
    case "product":
      return {
        productByIdentifier: {
          id: "gid://shopify/Product/DRY-RUN",
          handle: PRODUCT_HANDLE,
          metafield: null,
          variants: { nodes: [{ id: "gid://shopify/ProductVariant/DRY-RUN", price: "0.00" }] },
        },
      };
    default:
      return {};
  }
}

/**
 * Mode of an AUTOMATIC node's function_config that discounts lines of EVERY
 * cart on the store (no code needed, not limited to won-e2e products), or null.
 * Such a node changes the result of any other app's E2E on the shared dev store
 * while it exists (audit P3-3), so creating it needs --confirm-store-wide.
 * `config` is the config object or the exact JSON string written.
 */
export function storeWideReason(config) {
  let value = config;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null; // unreadable config: the function yields no operations
    }
  }
  const prototype = value && typeof value === "object" ? value.prototype : null;
  if (!prototype || typeof prototype !== "object") return null;
  if (prototype.mode === "percent_all") return "percent_all discounts every line of every cart";
  if (prototype.mode === "shop_config") return "shop_config discounts every line of every cart (percent from the shop metafield)";
  if (prototype.mode === "campaign_window") return "campaign_window discounts every line of every cart while the window is active";
  if (prototype.mode === "echo_codes" && prototype.echoOnAutomatic === true) {
    return "echo_codes with echoOnAutomatic discounts the first line of every cart that carries any discount code";
  }
  return null;
}

/** A failure of the transport (network, CLI, 502/503), not a GraphQL result: the request may or may not have landed. */
export function isTransportError(error) {
  if (error?.transport === true) return true;
  const output = stripAnsi(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`);
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|\b50[23]\b/i.test(output);
}

/**
 * Creates are the only non-idempotent calls: after a transport failure they
 * are never simply re-sent (the first request may have created the node, and a
 * blind retry would leave an unregistered duplicate). Each entry knows the
 * exact title to look up, the node type it produces, and how to rebuild the
 * mutation's response from a node found by that lookup.
 */
const CREATE_DOCS = {
  automaticCreate: {
    title: (variables) => variables.automaticAppDiscount.title,
    appDiscount: true,
    type: "DiscountAutomaticApp",
    createdId: (data) => data.discountAutomaticAppCreate?.automaticAppDiscount?.discountId ?? null,
    recovered: (node) => ({
      discountAutomaticAppCreate: {
        automaticAppDiscount: { discountId: node.id, title: node.title, status: node.status, recoveredAfterTransportError: true },
        userErrors: [],
      },
    }),
  },
  codeCreate: {
    title: (variables) => variables.codeAppDiscount.title,
    appDiscount: true,
    type: "DiscountCodeApp",
    createdId: (data) => data.discountCodeAppCreate?.codeAppDiscount?.discountId ?? null,
    recovered: (node, variables) => ({
      discountCodeAppCreate: {
        codeAppDiscount: {
          discountId: node.id,
          title: node.title,
          status: node.status,
          codes: { nodes: [{ code: variables.codeAppDiscount.code }] },
          recoveredAfterTransportError: true,
        },
        userErrors: [],
      },
    }),
  },
  basicCodeCreate: {
    title: (variables) => variables.basicCodeDiscount.title,
    appDiscount: false,
    type: "DiscountCodeBasic",
    createdId: (data) => data.discountCodeBasicCreate?.codeDiscountNode?.id ?? null,
    recovered: (node) => ({ discountCodeBasicCreate: { codeDiscountNode: { id: node.id }, userErrors: [] } }),
  },
};

/** Not idempotent and not identifiable by title: never retried. */
const NEVER_RETRY = new Set(["redeemBulkAdd"]);

/**
 * Default executor: one `shopify app execute` as the app (no admin token). The
 * CLI runs in its own process group (`detached`), so a Ctrl+C in the terminal
 * reaches only this script (which defers it until cleanup is done), never a
 * mutation half-way. Rejects with the CLI's stdout/stderr on failure.
 */
export async function shopifyExecute(name, query, variables) {
  const tmp = path.join(OUT_DIR, "gql-tmp");
  await fsp.mkdir(tmp, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queryFile = path.join(tmp, `${name}-${stamp}.graphql`);
  const variableFile = path.join(tmp, `${name}-${stamp}.variables.json`);
  const outputFile = path.join(tmp, `${name}-${stamp}.out.json`);
  await fsp.writeFile(queryFile, query);
  const args = [
    "shopify", "app", "execute",
    "--path", APP_DIR,
    "--store", STORE,
    "--version", API_VERSION,
    "--query-file", queryFile,
    "--output-file", outputFile,
    "--no-color",
  ];
  if (variables) {
    await fsp.writeFile(variableFile, JSON.stringify(variables));
    args.push("--variable-file", variableFile);
  }
  await execFileP("npx", args, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024, detached: true });
  return JSON.parse(await fsp.readFile(outputFile, "utf8"));
}

export class Admin {
  /**
   * @param {Evidence} evidence
   * @param {boolean} live
   * @param {{
   *   execute?: (name: string, query: string, variables: any) => Promise<any>,
   *   confirmStoreWide?: boolean,
   *   retryDelayMs?: number,
   * }} [options] `execute` is injectable so tests can drive every failure mode without a store.
   */
  constructor(evidence, live, { execute = shopifyExecute, confirmStoreWide = false, retryDelayMs = 3000 } = {}) {
    this.evidence = evidence;
    this.live = live;
    this.execute = execute;
    this.confirmStoreWide = confirmStoreWide;
    this.retryDelayMs = retryDelayMs;
    this.printed = new Set();
    /** @type {Set<Promise<unknown>>} */
    this.inflight = new Set();
    /** @type {string | null} set by a stop signal: from then on only cleanup calls go out */
    this.blocked = null;
    /** @type {((id: string, title: string) => void) | null} set by Cleanup: every created node is registered at once */
    this.onCreated = null;
    /** @type {string | null} this app's function id, from functionInfo() */
    this.functionId = null;
    /** @type {Set<string>} ids of won-e2e products read via product(): the only metafield owners allowed */
    this.e2eProductIds = new Set();
    /** @type {string | null} the shop GID, from shopConfig(): the only shop owner a shop metafield is written on */
    this.shopId = null;
  }

  /** Refuse every further non-cleanup call (a stop signal arrived). */
  block(reason) {
    this.blocked = reason;
  }

  /** Resolves once every call already sent has finished (successfully or not). */
  async settled() {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  /**
   * @param {string} name GQL document
   * @param {unknown} [variables]
   * @param {{ cleanup?: boolean }} [options] cleanup calls still run after a stop signal
   */
  async run(name, variables = undefined, { cleanup = false } = {}) {
    const query = GQL[name];
    if (!query) throw new Error(`unknown GraphQL document ${name}`);
    if (this.blocked && !cleanup) {
      throw new Error(`GraphQL ${name} not sent: ${this.blocked} (only cleanup runs now)`);
    }
    if (!this.live) {
      if (!this.printed.has(name)) {
        this.printed.add(name);
        console.log(`\n--- GraphQL ${name} (${API_VERSION}) ---\n${query}`);
      }
      console.log(`--- variables for ${name}: ${JSON.stringify(redact(variables ?? {}), null, 2)}`);
      const data = dryResponse(name, variables);
      this.registerCreated(name, variables, data);
      return data;
    }
    const call = this.runLive(name, query, variables);
    this.inflight.add(call);
    try {
      return await call;
    } finally {
      this.inflight.delete(call);
    }
  }

  registerCreated(name, variables, data) {
    const doc = CREATE_DOCS[name];
    const id = doc ? doc.createdId(data) : null;
    if (id) this.onCreated?.(id, doc.title(variables));
  }

  async runLive(name, query, variables) {
    const entry = { at: now(), name, variables: redact(variables ?? null) };
    const create = CREATE_DOCS[name];
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.execute(name, query, variables);
        entry.response = redact(response);
        this.evidence.data.graphql.push(entry);
        this.registerCreated(name, variables, response);
        return response;
      } catch (error) {
        const output = stripAnsi(`${error.stdout ?? ""}\n${error.stderr ?? ""}`).trim();
        lastError = { attempt, message: String(error.message ?? error).split("\n")[0], output: output.slice(-4000) };
        // A GraphQL error is a result, not a transport failure: never retried.
        if (!isTransportError(error) || NEVER_RETRY.has(name) || attempt === 3) {
          if (attempt === 3 && create && isTransportError(error) && !NEVER_RETRY.has(name)) {
            // The final attempt still failed, so this call reports failure —
            // but a transport error means the request may have landed anyway.
            // Look the node up by its exact title one more time and register
            // it for cleanup, so a create whose response was lost on the last
            // try is never left behind (audit fix4-3).
            const found = await this.findCreatedNode(name, variables);
            if (found) this.onCreated?.(found.id, found.title);
          }
          break;
        }
        await sleep(this.retryDelayMs * attempt);
        if (create) {
          // The first request may have created the node: look it up by its
          // exact title before sending the create again.
          const found = await this.findCreatedNode(name, variables);
          if (found) {
            const response = create.recovered(found, variables);
            entry.response = redact(response);
            entry.recoveredAfterAttempt = attempt;
            this.evidence.data.graphql.push(entry);
            this.registerCreated(name, variables, response);
            return response;
          }
        }
        // A stop signal arrived while waiting to retry: send nothing new.
        if (this.blocked) {
          lastError.output = `${lastError.output}\n(not retried: ${this.blocked})`.trim();
          break;
        }
      }
    }
    entry.error = lastError;
    this.evidence.data.graphql.push(entry);
    const failure = new Error(`GraphQL ${name} failed: ${lastError.output.slice(-800) || lastError.message}`);
    failure.graphqlError = lastError;
    throw failure;
  }

  /** The node a create would have made, found by its exact title (and, for app discounts, our function). */
  async findCreatedNode(name, variables) {
    const doc = CREATE_DOCS[name];
    const title = doc.title(variables);
    const nodes = await this.listDiscountNodes({ cleanup: true });
    const matches = nodes.filter(
      (node) => node.title === title && node.type === doc.type && (!doc.appDiscount || this.isOurAppDiscount(node)),
    );
    if (matches.length > 1) {
      // Every match is registered so cleanup removes them all; report the first.
      for (const node of matches.slice(1)) this.onCreated?.(node.id, node.title);
    }
    return matches[0] ?? null;
  }

  /** Every discount node on the store, all pages. */
  async listDiscountNodes({ cleanup = false } = {}) {
    const out = [];
    let after = null;
    for (let page = 0; page < 100; page += 1) {
      const data = await this.run("discountNodes", after ? { after } : {}, { cleanup });
      const connection = data.discountNodes;
      for (const node of connection.nodes) {
        out.push({
          id: node.id,
          type: node.discount?.__typename ?? null,
          title: node.discount?.title ?? "",
          status: node.discount?.status ?? null,
          functionId: node.discount?.appDiscountType?.functionId ?? null,
          appKey: node.discount?.appDiscountType?.appKey ?? null,
        });
      }
      if (!connection.pageInfo?.hasNextPage) return out;
      after = connection.pageInfo.endCursor;
    }
    throw new Error("discountNodes: more than 100 pages, refusing to continue");
  }

  /** An app discount of THIS app's function (never a native discount or another app's). */
  isOurAppDiscount(node) {
    return (
      APP_DISCOUNT_TYPES.has(node.type) &&
      this.functionId !== null &&
      node.functionId === this.functionId &&
      node.appKey === APP_CLIENT_ID
    );
  }

  async functionInfo() {
    const data = await this.run("functions");
    const fn = data.shopifyFunctions.nodes.find((node) => node.handle === FUNCTION_HANDLE);
    if (!fn) throw new Error(`function ${FUNCTION_HANDLE} not registered on the store`);
    this.functionId = fn.id;
    return { function: fn, shop: data.shop };
  }

  /**
   * WON-PROTO nodes, split into the ones the sweep may delete (app discounts of
   * THIS app's function) and `foreign` ones that only share the prefix (a
   * native code a prototype made, another app's node): reported, never deleted.
   */
  async listProtoNodes({ cleanup = false } = {}) {
    const all = (await this.listDiscountNodes({ cleanup })).filter((node) => node.title.startsWith(TITLE_PREFIX));
    return {
      ours: all.filter((node) => this.isOurAppDiscount(node)),
      foreign: all.filter((node) => !this.isOurAppDiscount(node)),
    };
  }

  async deleteNode(id, { cleanup = false } = {}) {
    if (id.includes("DiscountAutomaticNode")) {
      const data = await this.run("automaticDelete", { id }, { cleanup });
      return data.discountAutomaticDelete;
    }
    const data = await this.run("codeDelete", { id }, { cleanup });
    return data.discountCodeDelete;
  }

  /** Refuse (live) or flag (dry-run) an automatic node config that discounts every cart (audit P3-3). */
  assertNotStoreWide(config, what) {
    const reason = storeWideReason(config);
    if (!reason) return;
    if (!this.live) {
      console.log(`\n⚠ ${what}: ${reason} — a live run needs --confirm-store-wide`);
      return;
    }
    if (!this.confirmStoreWide) {
      throw new Error(
        `${what}: ${reason}. Every other E2E on ${STORE} would see this discount; re-run with --live --confirm-store-wide once no other suite is running.`,
      );
    }
  }

  /** Our $app:won_discounts.product metafield on every won-e2e product (null when absent). */
  async e2eProductMetafields({ cleanup = false } = {}) {
    const out = [];
    for (const handle of E2E_PRODUCT_HANDLES) {
      const data = await this.run("product", { identifier: { handle } }, { cleanup });
      const product = data.productByIdentifier;
      if (!product) continue;
      out.push({ handle, id: product.id, metafield: product.metafield ?? null });
    }
    return out;
  }

  /** @param {{ title: string, config?: unknown, configValue?: string }} args */
  async createAutomatic({ title, config, configValue }) {
    this.assertNotStoreWide(configValue ?? config, `automatic node "${TITLE_PREFIX} ${title}"`);
    const variables = {
      automaticAppDiscount: {
        title: `${TITLE_PREFIX} ${title}`,
        functionHandle: FUNCTION_HANDLE,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        discountClasses: ["PRODUCT"],
        combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
        metafields: [
          { namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: configValue ?? JSON.stringify(config) },
        ],
      },
    };
    const data = await this.run("automaticCreate", variables);
    const result = data.discountAutomaticAppCreate;
    if (result.userErrors.length) throw new Error(`discountAutomaticAppCreate: ${JSON.stringify(result.userErrors)}`);
    return result.automaticAppDiscount;
  }

  /** @param {{ title: string, code: string, config?: unknown, configValue?: string }} args */
  async createCode({ title, code, config, configValue }) {
    const variables = {
      codeAppDiscount: {
        title: `${TITLE_PREFIX} ${title}`,
        code,
        functionHandle: FUNCTION_HANDLE,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        discountClasses: ["PRODUCT"],
        context: { all: "ALL" },
        appliesOncePerCustomer: false,
        combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
        metafields: [
          { namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: configValue ?? JSON.stringify(config) },
        ],
      },
    };
    const data = await this.run("codeCreate", variables);
    const result = data.discountCodeAppCreate;
    if (result.userErrors.length) throw new Error(`discountCodeAppCreate: ${JSON.stringify(result.userErrors)}`);
    return result.codeAppDiscount;
  }

  /** Native (non-app) percentage code on all items: a "foreign" code for the Won function. */
  async createNativeCode({ title, code, percentage }) {
    const variables = {
      basicCodeDiscount: {
        title: `${TITLE_PREFIX} ${title}`,
        code,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        context: { all: "ALL" },
        appliesOncePerCustomer: false,
        customerGets: { value: { percentage }, items: { all: true } },
        combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
      },
    };
    const data = await this.run("basicCodeCreate", variables);
    const result = data.discountCodeBasicCreate;
    if (result.userErrors.length) throw new Error(`discountCodeBasicCreate: ${JSON.stringify(result.userErrors)}`);
    return { discountId: result.codeDiscountNode.id };
  }

  async product(handle) {
    const data = await this.run("product", { identifier: { handle } });
    const product = data.productByIdentifier;
    if (product?.id && E2E_PRODUCT_HANDLES.includes(handle)) this.e2eProductIds.add(product.id);
    return product;
  }

  async setProductMetafield(ownerId, value) {
    if (!this.e2eProductIds.has(ownerId)) {
      throw new Error(`refusing to write ${CONFIG_NAMESPACE}.${PRODUCT_KEY} on ${ownerId}: not a won-e2e-* product read via product()`);
    }
    const data = await this.run("metafieldsSet", {
      metafields: [{ ownerId, namespace: CONFIG_NAMESPACE, key: PRODUCT_KEY, type: "json", value }],
    });
    const result = data.metafieldsSet;
    if (result.userErrors.length) throw new Error(`metafieldsSet (product): ${JSON.stringify(result.userErrors)}`);
    return result.metafields;
  }

  /** Replace the node's function_config (value = exact JSON string written). */
  async setNodeConfig(ownerId, value) {
    if (String(ownerId).includes("DiscountAutomaticNode")) this.assertNotStoreWide(value, `automatic node ${ownerId}`);
    const data = await this.run("metafieldsSet", {
      metafields: [{ ownerId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value }],
    });
    const result = data.metafieldsSet;
    if (result.userErrors.length) throw new Error(`metafieldsSet: ${JSON.stringify(result.userErrors)}`);
    return result.metafields;
  }

  async readNodeConfig(id) {
    const data = await this.run("nodeConfig", { id });
    const value = data.discountNode?.metafield?.value ?? null;
    return {
      node: data.discountNode?.id ?? null,
      discount: data.discountNode?.discount ?? null,
      metafieldId: data.discountNode?.metafield?.id ?? null,
      updatedAt: data.discountNode?.metafield?.updatedAt ?? null,
      storedBytes: typeof value === "string" ? bytes(value) : null,
      storedPreview: typeof value === "string" ? redact(value) : null,
    };
  }

  /** C7: the shop GID + our `$app:won_discounts.function_config` shop metafield (null when absent). */
  async shopConfig({ cleanup = false } = {}) {
    const data = await this.run("shopConfig", undefined, { cleanup });
    const shop = data.shop;
    if (shop?.id) this.shopId = shop.id;
    const metafield = shop?.metafield ?? null;
    return {
      shopId: shop?.id ?? null,
      metafield,
      storedBytes: typeof metafield?.value === "string" ? bytes(metafield.value) : null,
      storedPreview: typeof metafield?.value === "string" ? redact(metafield.value) : null,
    };
  }

  /** C7: replace the shop's function_config (value = exact JSON string written). Owner = the shop read via shopConfig(). */
  async setShopConfig(value) {
    if (!this.shopId) throw new Error("refusing to write the shop metafield: shop id unknown (call shopConfig() first)");
    const data = await this.run("metafieldsSet", {
      metafields: [{ ownerId: this.shopId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value }],
    });
    const result = data.metafieldsSet;
    if (result.userErrors.length) throw new Error(`metafieldsSet (shop): ${JSON.stringify(result.userErrors)}`);
    return result.metafields;
  }
}

// ---------------------------------------------------------------------------
// Cleanup (runs in finally and on SIGINT/SIGTERM)
// ---------------------------------------------------------------------------

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export class Cleanup {
  /**
   * @param {Admin} admin
   * @param {Evidence} evidence
   * @param {{ signals?: { on: Function, off: Function }, exit?: (code: number) => void }} [options]
   *   injectable for tests; default: the real process
   */
  constructor(admin, evidence, { signals = process, exit = (code) => process.exit(code) } = {}) {
    this.admin = admin;
    this.evidence = evidence;
    this.tasks = [];
    /** @type {{ name: string, fn: () => Promise<{ clean: boolean }> }[]} extra read-only checks after the sweep */
    this.finalChecks = [];
    /** @type {Promise<void> | null} the one cleanup run, shared by `finally` and a signal */
    this.running = null;
    this.signalled = null;
    this.signals = signals;
    this.exit = exit;
    // Every node the Admin creates is registered the moment its id is known,
    // so a signal between "created" and the script's own cleanup.node() loses nothing.
    admin.onCreated = (id, title) => this.node(id, title);
    this.onSignal = (signal) => {
      void this.handleSignal(signal);
    };
    signals.on("SIGINT", this.onSignal);
    signals.on("SIGTERM", this.onSignal);
  }

  /**
   * First signal: stop sending anything but cleanup, wait for calls already in
   * flight (a create that lands is registered), run the cleanup to the end, save
   * the evidence, then exit. Further signals are deferred until that is done.
   */
  async handleSignal(signal) {
    if (this.signalled) {
      console.error(`\n${signal}: cleanup is still running — waiting for it to finish (it will exit by itself).`);
      return;
    }
    this.signalled = signal;
    console.error(`\n${signal}: stopping; cleaning up before exit (further signals wait for the cleanup)…`);
    this.admin.block(`${signal} received`);
    try {
      await this.run();
      await this.evidence.save();
    } finally {
      this.dispose();
      this.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    }
  }

  /** Stop listening for signals (after the run is complete). */
  dispose() {
    this.signals.off("SIGINT", this.onSignal);
    this.signals.off("SIGTERM", this.onSignal);
  }

  /** Register a created discount node (idempotent: the Admin registers creates itself). */
  node(id, title) {
    if (this.tasks.some((task) => task.kind === "node" && task.id === id)) return;
    this.tasks.push({ kind: "node", id, title });
  }

  /**
   * Register a read-only check that runs after the post-run sweep (e.g. C7: the
   * shop metafield is gone). Its result lands in cleanup.checks[name]; a check
   * that is not `clean` makes cleanup.ok false.
   * @param {string} name
   * @param {() => Promise<{ clean: boolean }>} fn
   */
  check(name, fn) {
    this.finalChecks.push({ name, fn });
  }

  /** Register a metafield to delete (or restore to `restore` = {type, value}). */
  metafield(identifier, restore = null) {
    this.tasks.push({ kind: "metafield", identifier, restore });
  }

  /**
   * Remove what earlier (crashed) runs left behind: every WON-PROTO app discount
   * of THIS app's function, on every page of discountNodes, and our product
   * metafield on every won-e2e product. Prefix-only matches of anything else
   * are recorded in `cleanup.foreignNodes` and left alone.
   */
  async sweepLeftovers(phase = "pre-run sweep") {
    const { ours, foreign } = await this.admin.listProtoNodes({ cleanup: true });
    if (phase === "pre-run sweep") this.evidence.data.leftoversAtStart = ours;
    if (foreign.length) {
      this.evidence.data.cleanup.foreignNodes = foreign;
      console.error(`\n⚠ ${foreign.length} ${TITLE_PREFIX} node(s) not provided by this app's function were left alone: ${foreign.map((node) => node.id).join(", ")}`);
    }
    for (const node of ours) {
      try {
        const result = await this.admin.deleteNode(node.id, { cleanup: true });
        this.evidence.data.cleanup.actions.push({ at: now(), phase, node, result });
      } catch (error) {
        this.evidence.data.cleanup.actions.push({ at: now(), phase, failed: node, error: String(error.message).slice(0, 800) });
      }
    }
    const products = await this.admin.e2eProductMetafields({ cleanup: true });
    const withMetafield = products.filter((product) => product.metafield);
    if (withMetafield.length) {
      const identifiers = withMetafield.map((product) => ({ ownerId: product.id, namespace: CONFIG_NAMESPACE, key: PRODUCT_KEY }));
      try {
        const data = await this.admin.run("metafieldsDelete", { metafields: identifiers }, { cleanup: true });
        this.evidence.data.cleanup.actions.push({ at: now(), phase, deletedProductMetafields: withMetafield.map((p) => p.handle), result: data.metafieldsDelete });
      } catch (error) {
        this.evidence.data.cleanup.actions.push({ at: now(), phase, failed: identifiers, error: String(error.message).slice(0, 800) });
      }
    }
    return ours;
  }

  /** Run the cleanup once; a second caller (signal + finally) awaits the same run. */
  run() {
    this.running ??= this.runOnce();
    return this.running;
  }

  async runOnce() {
    // Calls already sent (e.g. a create) finish first, so what they created is registered.
    await this.admin.settled();
    for (const task of [...this.tasks].reverse()) {
      try {
        if (task.kind === "node") {
          const result = await this.admin.deleteNode(task.id, { cleanup: true });
          this.evidence.data.cleanup.actions.push({ at: now(), deleted: task, result });
        } else if (task.restore) {
          const data = await this.admin.run(
            "metafieldsSet",
            { metafields: [{ ...task.identifier, type: task.restore.type, value: task.restore.value }] },
            { cleanup: true },
          );
          this.evidence.data.cleanup.actions.push({ at: now(), restored: task.identifier, result: data.metafieldsSet });
        } else {
          const data = await this.admin.run("metafieldsDelete", { metafields: [task.identifier] }, { cleanup: true });
          this.evidence.data.cleanup.actions.push({ at: now(), deleted: task.identifier, result: data.metafieldsDelete });
        }
      } catch (error) {
        this.evidence.data.cleanup.actions.push({ at: now(), failed: task, error: String(error.message).slice(0, 800) });
      }
    }
    try {
      // Anything created but never registered (e.g. a duplicate from a lost
      // response) is caught by the same sweep that runs before each experiment.
      await this.sweepLeftovers("post-run sweep");
      const { ours } = await this.admin.listProtoNodes({ cleanup: true });
      const productMetafields = (await this.admin.e2eProductMetafields({ cleanup: true })).filter((product) => product.metafield);
      this.evidence.data.cleanup.remainingProtoNodes = ours;
      this.evidence.data.cleanup.remainingProductMetafields = productMetafields.map((product) => product.handle);
      let checksClean = true;
      if (this.finalChecks.length) {
        this.evidence.data.cleanup.checks = {};
        for (const { name, fn } of this.finalChecks) {
          try {
            const result = await fn();
            this.evidence.data.cleanup.checks[name] = result;
            if (!result?.clean) checksClean = false;
          } catch (error) {
            this.evidence.data.cleanup.checks[name] = { clean: false, error: String(error.message).slice(0, 800) };
            checksClean = false;
          }
        }
      }
      this.evidence.data.cleanup.ok =
        ours.length === 0 &&
        productMetafields.length === 0 &&
        checksClean &&
        this.evidence.data.cleanup.actions.every((action) => !action.failed);
      console.log(`\n✔ cleanup: remaining ${TITLE_PREFIX} nodes = ${ours.length}, product metafields = ${productMetafields.length}`);
    } catch (error) {
      this.evidence.data.cleanup.ok = false;
      this.evidence.data.cleanup.verifyError = String(error.message).slice(0, 800);
    }
  }
}

// ---------------------------------------------------------------------------
// Function run logs (written by the running `shopify app dev`)
// ---------------------------------------------------------------------------

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const KNOWN_PAYLOAD_KEYS = new Set([
  "export", "input", "inputBytes", "output", "outputBytes", "logs", "functionId", "fuelConsumed", "target",
  "inputQueryVariablesMetafieldValue", "inputQueryVariablesMetafieldNamespace", "inputQueryVariablesMetafieldKey",
  "errorType", "errorMessage",
]);

/** Condense one function run log (`shopify app dev` → .shopify/logs/*.json) into the fields the verdicts need. */
export function summarizeFunctionLog(raw) {
  const payload = parseMaybeJson(raw.payload ?? raw);
  const input = parseMaybeJson(payload?.input);
  const output = parseMaybeJson(payload?.output);
  const metafield = input?.discount?.metafield;
  const shopMetafield = input?.shop?.metafield;
  const operations = output?.operations ?? null;
  const candidates = [];
  for (const operation of operations ?? []) {
    const add = operation.productDiscountsAdd;
    for (const item of add?.candidates ?? []) {
      candidates.push({
        message: item.message,
        percent: item.value?.percentage?.value ?? null,
        lines: (item.targets ?? []).map((target) => target.cartLine?.id),
        selectionStrategy: add.selectionStrategy,
      });
    }
  }
  const variables = payload?.inputQueryVariablesMetafieldValue;
  const unknownPayload = Object.fromEntries(
    Object.entries(payload && typeof payload === "object" ? payload : {}).filter(([key]) => !KNOWN_PAYLOAD_KEYS.has(key)),
  );
  return {
    logTimestamp: raw.logTimestamp ?? raw.log_timestamp ?? null,
    status: raw.status ?? null,
    export: payload?.export ?? null,
    fuelConsumed: payload?.fuelConsumed ?? null,
    inputPresent: input !== undefined && input !== null,
    triggeringDiscountCode: input ? (input.triggeringDiscountCode ?? null) : undefined,
    enteredDiscountCodes: input?.enteredDiscountCodes ?? undefined,
    discountMetafield:
      input == null ? undefined : metafield == null ? null : metafield.jsonValue == null ? "jsonValue:null" : "present",
    configMode: metafield?.jsonValue?.prototype?.mode ?? null,
    configTag: metafield?.jsonValue?.prototype?.tag ?? null,
    // C7: the shop metafield as the function saw it (undefined = no input / older query)
    shopMetafield:
      input == null || !input.shop || !("metafield" in input.shop)
        ? undefined
        : shopMetafield == null
          ? null
          : {
              jsonValueBytes: shopMetafield.jsonValue == null ? null : bytes(JSON.stringify(shopMetafield.jsonValue)),
              percent: shopMetafield.jsonValue?.percent ?? null,
            },
    configJsonBytes: metafield?.jsonValue == null ? null : bytes(JSON.stringify(metafield.jsonValue)),
    localTime: input?.shop?.localTime ?? undefined,
    productMetafields: input?.cart?.lines?.map((line) => ({
      line: line.id,
      variant: line.merchandise?.id ?? null,
      wonProduct: line.merchandise?.product?.wonProduct?.jsonValue ?? null,
    })),
    candidates,
    output: operations === null ? (output ?? null) : undefined,
    functionLogs: payload?.logs ?? null,
    inputQueryVariables:
      variables === undefined
        ? "<absent>"
        : variables === null
          ? null
          : {
              keys: Object.keys(variables),
              campaignStart: variables.campaignStart,
              campaignEnd: variables.campaignEnd,
              bytes: bytes(JSON.stringify(variables)),
            },
    errorType: payload?.errorType ?? null,
    errorMessages: Array.isArray(payload?.errorMessage)
      ? payload.errorMessage.map((error) => `${error.message} [${error.extensions?.code ?? ""}: ${(error.extensions?.problems ?? []).map((problem) => problem.explanation).join("; ")}]`)
      : (payload?.errorMessage ?? null),
    otherPayload: Object.keys(unknownPayload).length ? redact(unknownPayload) : undefined,
    otherTopLevel: redact(
      Object.fromEntries(
        Object.entries(raw).filter(
          ([key]) => !["payload", "shopId", "apiClientId", "logType", "status", "source", "sourceNamespace", "logTimestamp", "localTime", "storeName"].includes(key),
        ),
      ),
    ),
  };
}

export class FunctionLogs {
  /** @param {string} experiment raw log files are copied to OUT_DIR/function-logs/<experiment>/ */
  constructor(experiment) {
    this.copyDir = path.join(OUT_DIR, "function-logs", experiment);
    this.seen = new Set(walk(FUNCTION_LOG_DIR));
    this.appDevOffset = APP_DEV_LOG && fs.existsSync(APP_DEV_LOG) ? fs.statSync(APP_DEV_LOG).size : 0;
  }

  /**
   * Wait for `shopify app dev` to flush, collect every new run log and assign
   * each run to the observation whose cart window contains its logTimestamp.
   * @param {Evidence} evidence
   */
  async attach(evidence, waitMs = 10_000) {
    await sleep(waitMs);
    const { runs, devLines } = this.collect();
    const unassigned = [];
    for (const run of runs) {
      const at = Date.parse(run.logTimestamp ?? "");
      const target = evidence.data.observations.find(
        (observation) => at >= Date.parse(observation.windowStart) - 1500 && at <= Date.parse(observation.windowEnd) + 3000,
      );
      if (target) target.functionRuns.push(run);
      else unassigned.push(run);
    }
    evidence.data.functionLogs.push({ collectedAt: now(), runs: runs.length, unassigned, appDevLines: devLines });
    await evidence.save();
  }

  /** New function run logs since the last call (files + app dev output lines). */
  collect() {
    const files = walk(FUNCTION_LOG_DIR).filter((file) => !this.seen.has(file)).sort();
    const runs = [];
    for (const file of files) {
      this.seen.add(file);
      try {
        const text = fs.readFileSync(file, "utf8");
        fs.mkdirSync(this.copyDir, { recursive: true });
        const copy = path.join(this.copyDir, path.basename(file));
        fs.writeFileSync(copy, text);
        const raw = JSON.parse(text);
        runs.push({ file: copy, ...summarizeFunctionLog(raw) });
      } catch (error) {
        runs.push({ file: path.relative(APP_DIR, file), unreadable: String(error.message) });
      }
    }
    let devLines = [];
    if (APP_DEV_LOG && fs.existsSync(APP_DEV_LOG)) {
      const size = fs.statSync(APP_DEV_LOG).size;
      if (size > this.appDevOffset) {
        const fd = fs.openSync(APP_DEV_LOG, "r");
        const buffer = Buffer.alloc(size - this.appDevOffset);
        fs.readSync(fd, buffer, 0, buffer.length, this.appDevOffset);
        fs.closeSync(fd);
        this.appDevOffset = size;
        devLines = stripAnsi(buffer.toString("utf8"))
          .split(/\r?\n/)
          .filter((line) => /won-discounts-engine|function|Function|error|Error/.test(line))
          .map((line) => line.trim().slice(0, 400))
          .filter(Boolean);
      }
    }
    return { runs, devLines };
  }
}

// ---------------------------------------------------------------------------
// Storefront (Playwright + AJAX cart API)
// ---------------------------------------------------------------------------

export function summarizeCart(cart) {
  const items = (cart.items ?? []).map((item) => ({
    variant_id: item.variant_id,
    quantity: item.quantity,
    original_line_price: item.original_line_price,
    final_line_price: item.final_line_price,
    total_discount: item.total_discount,
    line_level_discount_allocations: (item.line_level_discount_allocations ?? []).map((allocation) => ({
      amount: allocation.amount,
      percentOfLine: item.original_line_price
        ? Math.round((allocation.amount / item.original_line_price) * 10000) / 100
        : null,
      title: allocation.discount_application?.title,
      type: allocation.discount_application?.type,
      key: allocation.discount_application?.key,
      value: allocation.discount_application?.value,
      value_type: allocation.discount_application?.value_type,
    })),
  }));
  const original = cart.original_total_price ?? 0;
  return {
    item_count: cart.item_count,
    original_total_price: original,
    total_price: cart.total_price,
    total_discount: cart.total_discount,
    totalDiscountPercent: original ? Math.round((cart.total_discount / original) * 10000) / 100 : null,
    discount_codes: cart.discount_codes ?? [],
    cart_level_discount_applications: (cart.cart_level_discount_applications ?? []).map((entry) => {
      // /cart.js shape: {amount, discount_application:{…}} (older docs: the application itself)
      const application = entry.discount_application ?? entry;
      return {
        amount: entry.amount ?? application.total_allocated_amount,
        type: application.type,
        title: application.title,
        value: application.value,
        value_type: application.value_type,
      };
    }),
    items,
  };
}

/** Compact one-line description of a cart summary for the console/history. */
export function describeCart(summary) {
  const codes = summary.discount_codes.map((code) => `${code.code}:${code.applicable ? "applicable" : "NOT-applicable"}`);
  const allocations = summary.items.flatMap((item, index) =>
    item.line_level_discount_allocations.map((allocation) => `L${index}:${allocation.title}=${allocation.percentOfLine}%`),
  );
  const order = summary.cart_level_discount_applications.map((application) => `${application.title}=${application.amount}`);
  return `discount ${summary.total_discount}/${summary.original_total_price} (${summary.totalDiscountPercent}%) codes[${codes.join(" ")}] allocations[${allocations.join(" ")}]${order.length ? ` order[${order.join(" ")}]` : ""}`;
}

export class Storefront {
  /** @param {Evidence} evidence */
  constructor(evidence, live) {
    this.evidence = evidence;
    this.live = live;
    this.browser = null;
    this.page = null;
    this.variant = null;
  }

  async open() {
    if (!this.live) {
      console.log(`\n--- storefront: Playwright chromium → https://${STORE}/password (unlock), GET /products/${PRODUCT_HANDLE}.js`);
      this.variant = { id: "<variant-id>", price: 0 };
      return;
    }
    const password = process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD;
    if (!password) throw new Error("SHOPIFY_E2E_STOREFRONT_PASSWORD missing: run with node --env-file=apps/won-discounts/.env");
    const require = createRequire(path.join(REPO_ROOT, "package.json"));
    const { chromium } = require("@playwright/test");
    this.browser = await chromium.launch();
    this.page = await this.browser.newPage();
    await this.page.goto(`https://${STORE}/password`, { waitUntil: "domcontentloaded" });
    if (this.page.url().includes("/password")) {
      const input = this.page.locator("input[type='password']").first();
      await input.waitFor({ timeout: 20000 });
      await input.fill(password);
      await Promise.all([this.page.waitForLoadState("domcontentloaded"), input.press("Enter")]);
      await this.page.waitForTimeout(2500);
    }
    for (let i = 0; i < 30 && (await this.page.title()).includes("Just a moment"); i += 1) {
      await this.page.waitForTimeout(2000);
    }
    await this.page.goto(`https://${STORE}/products/${PRODUCT_HANDLE}`, { waitUntil: "domcontentloaded" });
    if (this.page.url().includes("/password")) throw new Error("storefront still locked after password");
    const product = await this.ajax("GET", `/products/${PRODUCT_HANDLE}.js`);
    if (!product.json?.variants) {
      throw new Error(`storefront blocked (status ${product.status}, bot challenge / rate limit?): ${product.text ?? ""}`);
    }
    const variant = product.json.variants[0];
    this.variant = { id: variant.id, price: variant.price };
    this.evidence.data.storefrontVariant = this.variant;
  }

  async ajax(method, url, body) {
    // Storefront AJAX endpoints sit behind a bot/rate limiter that answers bursts
    // with HTTP 429 + a challenge page: pace every request and back off on 429.
    for (let attempt = 0; ; attempt += 1) {
      const gap = Date.now() - (this.lastRequestAt ?? 0);
      if (gap < 1500) await sleep(1500 - gap);
      this.lastRequestAt = Date.now();
      this.requests = (this.requests ?? 0) + 1;
      const result = await this.page.evaluate(
        async ({ method: m, url: u, body: b }) => {
          const response = await fetch(u, {
            method: m,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: b === undefined ? undefined : JSON.stringify(b),
            credentials: "same-origin",
          });
          const text = await response.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          return { status: response.status, json, text: json ? null : text.slice(0, 300) };
        },
        { method, url, body },
      );
      if (result.status !== 429 || attempt >= 6) return result;
      this.rateLimited = (this.rateLimited ?? 0) + 1;
      const waitMs = [5000, 10000, 20000, 30000, 45000, 60000][attempt];
      console.log(`  (429 on ${method} ${url}, retry in ${waitMs / 1000}s)`);
      await sleep(waitMs);
    }
  }

  /** Variant of another test product (by handle), for multi-line carts. */
  async variantOf(handle) {
    if (!this.live) return { id: `<variant of ${handle}>`, price: 0 };
    const product = await this.ajax("GET", `/products/${handle}.js`);
    const variant = product.json.variants[0];
    return { id: variant.id, price: variant.price };
  }

  /**
   * Empty cart → add 1× each variant (default: the test variant) in order →
   * set discount codes → read /cart.js.
   */
  async freshCart(codes, variants = null) {
    const discount = codes.join(",");
    const ids = variants ?? [this.variant.id];
    const single = ids.length === 1;
    if (!this.live) {
      console.log(
        single
          ? `--- storefront: POST /cart/clear.js; POST /cart/update.js {updates:{${ids[0]}:1}, discount:${JSON.stringify(discount)}} (response = cart)`
          : `--- storefront: POST /cart/clear.js; POST /cart/update.js {discount:${JSON.stringify(discount)}}; POST /cart/add.js ${ids.map((id) => `{id:${id},quantity:1}`).join(" then ")}; GET /cart.js`,
      );
      return null;
    }
    await this.ajax("POST", "/cart/clear.js", {});
    let cart;
    if (single) {
      // One atomic update: line + codes, so no function run ever sees stale codes.
      cart = await this.ajax("POST", "/cart/update.js", { updates: { [String(ids[0])]: 1 }, discount });
      if (cart.status !== 200) throw new Error(`cart/update.js ${cart.status} ${cart.text ?? JSON.stringify(cart.json)}`);
    } else {
      // Codes first (empty cart), then one add per variant so the line order is the order given.
      const update = await this.ajax("POST", "/cart/update.js", { discount });
      if (update.status !== 200) throw new Error(`cart/update.js ${update.status} ${update.text ?? JSON.stringify(update.json)}`);
      for (const id of ids) {
        const add = await this.ajax("POST", "/cart/add.js", { items: [{ id, quantity: 1 }] });
        if (add.status !== 200) throw new Error(`cart/add.js ${add.status} ${add.text ?? JSON.stringify(add.json)}`);
      }
      cart = await this.ajax("GET", "/cart.js");
    }
    const stored = (cart.json.discount_codes ?? []).map((entry) => entry.code.toUpperCase()).sort().join(",");
    if (stored !== [...codes].map((code) => code.toUpperCase()).sort().join(",")) {
      this.codesResent = (this.codesResent ?? 0) + 1;
      cart = await this.ajax("POST", "/cart/update.js", { discount });
    }
    return { raw: cart.json, summary: summarizeCart(cart.json) };
  }

  async close() {
    if (this.live && this.page) {
      try {
        await this.ajax("POST", "/cart/update.js", { discount: "" });
        await this.ajax("POST", "/cart/clear.js", {});
      } catch {
        // best effort
      }
    }
    await this.browser?.close();
  }
}

/**
 * Poll the storefront until `expect(summary)` holds for 2 consecutive fresh
 * carts or the timeout passes. Every attempt is recorded, so a verdict never
 * rests on a single read.
 */
export async function observe({ evidence, storefront, label, codes = [], variants = null, expectation, expect, timeoutMs = 120_000, intervalMs = 10_000 }) {
  console.log(`\n◆ observe "${label}": codes=[${codes.join(",")}] expect: ${expectation}`);
  if (!evidence.live) {
    await storefront.freshCart(codes, variants);
    console.log(`--- poll every ${intervalMs / 1000}s (max ${timeoutMs / 1000}s) until 2 consecutive carts match`);
    return { label, matched: null, functionRuns: [], finalCart: null };
  }
  const windowStart = now();
  const started = Date.now();
  const history = [];
  let consecutive = 0;
  let last = null;
  let lastRaw = null;
  while (true) {
    const { raw, summary } = await storefront.freshCart(codes, variants);
    last = summary;
    lastRaw = raw;
    const ok = Boolean(expect(summary));
    consecutive = ok ? consecutive + 1 : 0;
    history.push({ at: now(), elapsedMs: Date.now() - started, matched: ok, cart: describeCart(summary) });
    console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${ok ? "✓" : "·"} ${describeCart(summary)}`);
    if (consecutive >= 2) break;
    if (Date.now() - started > timeoutMs) break;
    await sleep(ok ? 6000 : intervalMs);
  }
  const windowEnd = now();
  const observation = {
    label,
    codes,
    expectation,
    matched: consecutive >= 2,
    attempts: history.length,
    elapsedMs: Date.now() - started,
    windowStart,
    windowEnd,
    finalCart: last,
    finalCartRawExcerpt: {
      total_discount: lastRaw?.total_discount,
      discount_codes: lastRaw?.discount_codes,
      cart_level_discount_applications: lastRaw?.cart_level_discount_applications,
      line_level_discount_allocations: lastRaw?.items?.map((item) => item.line_level_discount_allocations),
    },
    history,
    functionRuns: [],
  };
  evidence.data.observations.push(observation);
  await evidence.save();
  await sleep(8000); // gap so the next window never overlaps this one's run logs (and paces the storefront)
  return observation;
}

/** Sum of allocation percents on line `index` (default first) whose allocation matches `predicate`. */
export function linePercent(summary, predicate = () => true, index = 0) {
  const item = summary.items[index];
  if (!item) return 0;
  return item.line_level_discount_allocations
    .filter((allocation) => predicate(allocation))
    .reduce((sum, allocation) => sum + (allocation.percentOfLine ?? 0), 0);
}

export const approx = (value, target, tolerance = 0.6) => Math.abs(value - target) <= tolerance;

export function parseArgs(argv = process.argv) {
  return { live: argv.includes("--live"), confirmStoreWide: argv.includes("--confirm-store-wide") };
}

/**
 * Shared skeleton: dry-run/live switch, leftover sweep, evidence file, and a
 * cleanup that runs in `finally` no matter how the experiment ends.
 */
export async function runExperiment(name, plan, body) {
  const { live, confirmStoreWide } = parseArgs();
  const evidence = new Evidence(name, live);
  console.log(`# ${name} — ${live ? "LIVE on " + STORE : "DRY-RUN (nothing is sent; pass --live to execute)"}`);
  console.log(plan);
  evidence.data.plan = plan;
  evidence.data.confirmStoreWide = confirmStoreWide;
  const admin = new Admin(evidence, live, { confirmStoreWide });
  const cleanup = new Cleanup(admin, evidence);
  const logs = live ? new FunctionLogs(name) : { collect: () => ({ runs: [], devLines: [] }), attach: async () => {} };
  const storefront = new Storefront(evidence, live);
  let failed = null;
  try {
    const info = await admin.functionInfo();
    evidence.data.function = info.function;
    evidence.data.shop = info.shop;
    await cleanup.sweepLeftovers();
    await body({ live, evidence, admin, cleanup, logs, storefront, shop: info.shop });
  } catch (error) {
    failed = error;
    evidence.data.error = { message: String(error.message).slice(0, 2000), graphqlError: error.graphqlError ?? null };
    console.error(`\n✖ ${error.message}`);
  } finally {
    evidence.data.storefrontCodesResent = storefront.codesResent ?? 0;
    evidence.data.storefrontRateLimited = storefront.rateLimited ?? 0;
    evidence.data.storefrontRequests = storefront.requests ?? 0;
    await storefront.close().catch(() => {});
    await cleanup.run();
    evidence.data.finishedAt = now();
    await evidence.save();
    if (!cleanup.signalled) cleanup.dispose();
    if (live) console.log(`\nEvidence: ${evidence.file}`);
  }
  process.exitCode = failed ? 1 : 0;
}
