// Shared plumbing for the MVP 0 platform-risk prototypes (C1–C4).
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
  discountNodes: `query WonProtoDiscountNodes {
  discountNodes(first: 100) {
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticApp { title status }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
        ... on DiscountAutomaticFreeShipping { title status }
        ... on DiscountCodeApp { title status }
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
    await fsp.mkdir(OUT_DIR, { recursive: true });
    await fsp.writeFile(this.file, `${JSON.stringify(this.data, null, 2)}\n`);
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
      return { discountNodes: { nodes: [] } };
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

export class Admin {
  /** @param {Evidence} evidence */
  constructor(evidence, live) {
    this.evidence = evidence;
    this.live = live;
    this.printed = new Set();
  }

  async run(name, variables = undefined) {
    const query = GQL[name];
    if (!query) throw new Error(`unknown GraphQL document ${name}`);
    if (!this.live) {
      if (!this.printed.has(name)) {
        this.printed.add(name);
        console.log(`\n--- GraphQL ${name} (${API_VERSION}) ---\n${query}`);
      }
      console.log(`--- variables for ${name}: ${JSON.stringify(redact(variables ?? {}), null, 2)}`);
      return dryResponse(name, variables);
    }

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

    const entry = { at: now(), name, variables: redact(variables ?? null) };
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await fsp.rm(outputFile, { force: true });
        await execFileP("npx", args, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 });
        const response = JSON.parse(await fsp.readFile(outputFile, "utf8"));
        entry.response = redact(response);
        this.evidence.data.graphql.push(entry);
        return response;
      } catch (error) {
        const output = stripAnsi(`${error.stdout ?? ""}\n${error.stderr ?? ""}`).trim();
        lastError = { attempt, message: error.message.split("\n")[0], output: output.slice(-4000) };
        // Only transport failures are retried; a GraphQL error is a result.
        if (!/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|503|502/i.test(output)) break;
        await sleep(3000 * attempt);
      }
    }
    entry.error = lastError;
    this.evidence.data.graphql.push(entry);
    const failure = new Error(`GraphQL ${name} failed: ${lastError.output.slice(-800)}`);
    failure.graphqlError = lastError;
    throw failure;
  }

  async functionInfo() {
    const data = await this.run("functions");
    const fn = data.shopifyFunctions.nodes.find((node) => node.handle === FUNCTION_HANDLE);
    if (!fn) throw new Error(`function ${FUNCTION_HANDLE} not registered on the store`);
    return { function: fn, shop: data.shop };
  }

  async listProtoNodes() {
    const data = await this.run("discountNodes");
    return data.discountNodes.nodes
      .filter((node) => (node.discount?.title ?? "").startsWith(TITLE_PREFIX))
      .map((node) => ({ id: node.id, title: node.discount.title, type: node.discount.__typename, status: node.discount.status }));
  }

  async deleteNode(id) {
    if (id.includes("DiscountAutomaticNode")) {
      const data = await this.run("automaticDelete", { id });
      return data.discountAutomaticDelete;
    }
    const data = await this.run("codeDelete", { id });
    return data.discountCodeDelete;
  }

  async createAutomatic({ title, config, configValue }) {
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
    return data.productByIdentifier;
  }

  async setProductMetafield(ownerId, value) {
    const data = await this.run("metafieldsSet", {
      metafields: [{ ownerId, namespace: CONFIG_NAMESPACE, key: PRODUCT_KEY, type: "json", value }],
    });
    const result = data.metafieldsSet;
    if (result.userErrors.length) throw new Error(`metafieldsSet (product): ${JSON.stringify(result.userErrors)}`);
    return result.metafields;
  }

  /** Replace the node's function_config (value = exact JSON string written). */
  async setNodeConfig(ownerId, value) {
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
      storedBytes: typeof value === "string" ? bytes(value) : null,
      storedPreview: typeof value === "string" ? redact(value) : null,
    };
  }
}

// ---------------------------------------------------------------------------
// Cleanup (runs in finally and on SIGINT/SIGTERM)
// ---------------------------------------------------------------------------

export class Cleanup {
  /** @param {Admin} admin @param {Evidence} evidence */
  constructor(admin, evidence) {
    this.admin = admin;
    this.evidence = evidence;
    this.tasks = [];
    this.ran = false;
    const onSignal = async (signal) => {
      console.error(`\n${signal}: cleaning up before exit…`);
      await this.run();
      await evidence.save();
      process.exit(130);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }

  /** Register a created discount node. */
  node(id, title) {
    this.tasks.push({ kind: "node", id, title });
  }

  /** Register a metafield to delete (or restore to `restore` = {type, value}). */
  metafield(identifier, restore = null) {
    this.tasks.push({ kind: "metafield", identifier, restore });
  }

  /** Remove leftovers of earlier runs before creating anything. */
  async sweepLeftovers() {
    const leftovers = await this.admin.listProtoNodes();
    this.evidence.data.leftoversAtStart = leftovers;
    for (const node of leftovers) {
      const result = await this.admin.deleteNode(node.id);
      this.evidence.data.cleanup.actions.push({ at: now(), phase: "pre-run sweep", node, result });
    }
    return leftovers;
  }

  async run() {
    if (this.ran) return;
    this.ran = true;
    for (const task of [...this.tasks].reverse()) {
      try {
        if (task.kind === "node") {
          const result = await this.admin.deleteNode(task.id);
          this.evidence.data.cleanup.actions.push({ at: now(), deleted: task, result });
        } else if (task.restore) {
          const data = await this.admin.run("metafieldsSet", {
            metafields: [{ ...task.identifier, type: task.restore.type, value: task.restore.value }],
          });
          this.evidence.data.cleanup.actions.push({ at: now(), restored: task.identifier, result: data.metafieldsSet });
        } else {
          const data = await this.admin.run("metafieldsDelete", { metafields: [task.identifier] });
          this.evidence.data.cleanup.actions.push({ at: now(), deleted: task.identifier, result: data.metafieldsDelete });
        }
      } catch (error) {
        this.evidence.data.cleanup.actions.push({ at: now(), failed: task, error: String(error.message).slice(0, 800) });
      }
    }
    try {
      const remaining = await this.admin.listProtoNodes();
      this.evidence.data.cleanup.remainingProtoNodes = remaining;
      this.evidence.data.cleanup.ok =
        remaining.length === 0 && this.evidence.data.cleanup.actions.every((action) => !action.failed);
      console.log(`\n✔ cleanup: remaining ${TITLE_PREFIX} nodes = ${remaining.length}`);
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

export function parseArgs() {
  const live = process.argv.includes("--live");
  return { live };
}

/**
 * Shared skeleton: dry-run/live switch, leftover sweep, evidence file, and a
 * cleanup that runs in `finally` no matter how the experiment ends.
 */
export async function runExperiment(name, plan, body) {
  const { live } = parseArgs();
  const evidence = new Evidence(name, live);
  console.log(`# ${name} — ${live ? "LIVE on " + STORE : "DRY-RUN (nothing is sent; pass --live to execute)"}`);
  console.log(plan);
  evidence.data.plan = plan;
  const admin = new Admin(evidence, live);
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
    if (live) console.log(`\nEvidence: ${evidence.file}`);
  }
  process.exitCode = failed ? 1 : 0;
}
