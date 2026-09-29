import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { CartPlanInput } from "@won/core/discounts/cart";
import type { PlanConfig } from "@won/core/discounts/plan";

// The discount function's oracle (tests/reference-adapter.js): the same glue the
// Rust function ports, used here to read a LOGGED function input exactly as the
// function read it (adaptInput, decimalNumber) and to recompute its output.
import { adaptInput, decimalNumber, runCartLines } from "../../../extensions/won-discounts-engine/tests/reference-adapter.js";
import type { Cart } from "./cart.ts";
import { APP_DIR } from "./fixtures.ts";
import { executeAsApp, planInputFromCart, type LiveInputs, type ProductRefs } from "./won-plan.ts";

// Margin protection E2E support (MVP 2, Task 5b):
//   - readMarginInputs: what the function reads for a margin cart, as the app —
//     the shop config, each product's refs (a product no rule targets has no
//     metafield: refs {}), and each variant's cost metafield (null = none);
//   - marginPlanInput: planInputFromCart + the margin fields the function adds
//     (unitCost/unitCostCurrency from the variant metafield, marginRefs from the
//     product metafield, shopToCartRate = presentmentCurrencyRate);
//   - function runs: `shopify app dev` streams every run of the dev app's
//     function into apps/won-discounts/.shopify/logs/*.json (input AND output).
//     The presentmentCurrencyRate the plan needs is read from there — never
//     guessed from prices — together with the rest of the run (F-M1, F-M2).

export const FUNCTION_LOG_DIR = path.join(APP_DIR, ".shopify/logs");
export const LINES_TARGET = "cart.lines.discounts.generate.run";

export interface VariantCost {
  cost?: unknown;
  cur?: unknown;
}

export interface MarginInputs extends LiveInputs {
  shopCurrency: string;
  refsByProductId: Record<string, ProductRefs>;
  productIdByHandle: Record<string, string>;
  /** Variant GID → its `$app:won_discounts`/`variant` metafield as read (null = none). */
  costByVariantId: Record<string, VariantCost | null>;
  /** Variant GID → "handle · variant title", for messages. */
  variantLabel: Record<string, string>;
  /** Collection handle → its GID (null = not on the store), for the handles asked for. */
  collectionIdByHandle: Record<string, string | null>;
}

interface ProductNode {
  id: string;
  handle: string;
  metafield: { value: string } | null;
  variants: { nodes: { id: string; title: string; metafield: { value: string } | null }[] };
}

// Validated with the Shopify dev MCP (admin 2026-04, read_products).
function inputsQuery(count: number, collections: number): string {
  const vars = [
    ...Array.from({ length: count }, (_, i) => `$h${i}: String!`),
    ...Array.from({ length: collections }, (_, i) => `$c${i}: String!`),
  ].join(", ");
  const products = [
    ...Array.from({ length: count }, (_, i) => `  p${i}: productByIdentifier(identifier: { handle: $h${i} }) {\n    ...WonMarginProduct\n  }`),
    ...Array.from({ length: collections }, (_, i) => `  c${i}: collectionByIdentifier(identifier: { handle: $c${i} }) {\n    id\n  }`),
  ].join("\n");
  return `query WonE2eMarginInputs(${vars}) {
  shop {
    currencyCode
    ianaTimezone
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      value
    }
  }
${products}
}

fragment WonMarginProduct on Product {
  id
  handle
  metafield(namespace: "$app:won_discounts", key: "product") {
    value
  }
  variants(first: 20) {
    nodes {
      id
      title
      metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
    }
  }
}
`;
}

/** The function's inputs for a margin cart of `handles` (+ the GIDs of `collectionHandles`), read as the app (one query). */
export async function readMarginInputs(handles: readonly string[], collectionHandles: readonly string[] = []): Promise<MarginInputs> {
  const data = await executeAsApp<Record<string, unknown> & {
    shop: { currencyCode: string; ianaTimezone: string; metafield: { value: string } | null };
  }>(inputsQuery(handles.length, collectionHandles.length), {
    ...Object.fromEntries(handles.map((h, i) => [`h${i}`, h])),
    ...Object.fromEntries(collectionHandles.map((h, i) => [`c${i}`, h])),
  });
  if (!data.shop.metafield) throw new Error("the shop has no $app:won_discounts.function_config: run the margin seed first");
  const refsByProductId: Record<string, ProductRefs> = {};
  const productIdByHandle: Record<string, string> = {};
  const costByVariantId: Record<string, VariantCost | null> = {};
  const variantLabel: Record<string, string> = {};
  handles.forEach((handle, i) => {
    const product = data[`p${i}`] as ProductNode | null;
    if (!product) throw new Error(`product ${handle} not found`);
    productIdByHandle[handle] = product.id;
    refsByProductId[product.id] = product.metafield ? (JSON.parse(product.metafield.value) as ProductRefs) : {};
    for (const v of product.variants.nodes) {
      costByVariantId[v.id] = v.metafield ? (JSON.parse(v.metafield.value) as VariantCost) : null;
      variantLabel[v.id] = `${handle} · ${v.title}`;
    }
  });
  const first = data.p0 as ProductNode;
  return {
    config: JSON.parse(data.shop.metafield.value) as PlanConfig,
    productId: first.id,
    productRefs: refsByProductId[first.id]!,
    shopTimezone: data.shop.ianaTimezone,
    shopCurrency: data.shop.currencyCode,
    refsByProductId,
    productIdByHandle,
    costByVariantId,
    variantLabel,
    collectionIdByHandle: Object.fromEntries(collectionHandles.map((h, i) => [h, (data[`c${i}`] as { id: string } | null)?.id ?? null])),
  };
}

/** planInputFromCart + the margin fields, exactly as the function adapts them (reference-adapter.js readLine). */
export function marginPlanInput(cart: Cart, inputs: MarginInputs, country: string, rate: number | undefined): CartPlanInput {
  const base = planInputFromCart(cart, inputs, country);
  const lines = base.lines.map((line, index) => {
    const item = cart.items[index]!;
    const refs = inputs.refsByProductId[`gid://shopify/Product/${item.product_id}`] as (ProductRefs & { marginRefs?: string[] }) | undefined;
    const cost = inputs.costByVariantId[line.variantId];
    const out = { ...line };
    if (refs?.marginRefs !== undefined) out.marginRefs = refs.marginRefs;
    if (cost && cost.cost !== undefined) {
      out.unitCost = cost.cost as number;
      if (cost.cur !== undefined && typeof cost.cost === "number" && cost.cost > 0) out.unitCostCurrency = cost.cur as string;
    }
    return out;
  });
  return { ...base, lines, ...(rate !== undefined ? { shopToCartRate: rate } : {}) };
}

// --- Function runs (shopify app dev logs) ---------------------------------------------------------

export interface RateLiteral {
  /** presentmentCurrencyRate exactly as the log carries it (a Decimal is a JSON string). */
  raw: string;
  jsonType: "string" | "number";
  /** What the function reads from it (reference-adapter.js decimalNumber = src/json.rs DecimalNumber). */
  value: number | undefined;
  /** Significant digits of the literal (leading zeros not counted, trailing zeros counted). */
  significantDigits: number;
  /** Digits after the decimal point. */
  decimals: number;
}

export interface FunctionRun {
  file: string;
  logTimestamp: string;
  at: number;
  status: string;
  target: string;
  role: string | null;
  triggeringDiscountCode: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any;
  rate: RateLiteral | null;
}

const LOG_NAME = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})Z_/u;

function fileTime(name: string): number | null {
  const m = LOG_NAME.exec(name);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, +m[7]!) : null;
}

function parseMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function rateLiteral(value: unknown, fileText: string): RateLiteral | null {
  let raw: string;
  let jsonType: RateLiteral["jsonType"];
  if (typeof value === "string") {
    raw = value;
    jsonType = "string";
  } else if (typeof value === "number") {
    // A JSON number: take its literal digits from the file text (JSON.parse may have shortened them).
    const m = /\\?"presentmentCurrencyRate\\?"\s*:\s*(-?[\d.eE+-]+)/u.exec(fileText);
    raw = m ? m[1]! : String(value);
    jsonType = "number";
  } else {
    return null;
  }
  const digits = raw.replace(/[^\d]/gu, "").replace(/^0+/u, "");
  const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
  return { raw, jsonType, value: decimalNumber(value), significantDigits: digits.length, decimals };
}

async function readRun(file: string): Promise<FunctionRun | null> {
  const text = await readFile(file, "utf8");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null; // a file still being written
  }
  const payload = parseMaybe(raw.payload) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return null;
  const inputText = typeof payload.input === "string" ? payload.input : text;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = parseMaybe(payload.input) as any;
  const output = parseMaybe(payload.output);
  const timestamp = String(raw.logTimestamp ?? "");
  return {
    file,
    logTimestamp: timestamp,
    at: Date.parse(timestamp),
    status: String(raw.status ?? ""),
    target: String(payload.target ?? ""),
    role: input?.discount?.vars?.jsonValue?.role ?? null,
    triggeringDiscountCode: input?.triggeringDiscountCode ?? null,
    input,
    output,
    rate: input && typeof input === "object" ? rateLiteral(input.presentmentCurrencyRate, inputText) : null,
  };
}

/** Every run logged at or after `sinceMs` (by the log file name, then logTimestamp), oldest first. */
export async function readFunctionRuns(sinceMs: number): Promise<FunctionRun[]> {
  if (!existsSync(FUNCTION_LOG_DIR)) return [];
  const names = (await readdir(FUNCTION_LOG_DIR)).filter((n) => n.endsWith(".json") && (fileTime(n) ?? 0) >= sinceMs - 1_000).sort();
  const runs: FunctionRun[] = [];
  for (const name of names) {
    const run = await readRun(path.join(FUNCTION_LOG_DIR, name));
    if (run && run.at >= sinceMs) runs.push(run);
  }
  return runs;
}

/** The run's cart: currency, variant GIDs (sorted), entered codes (upper-case). */
export function runCart(run: FunctionRun): { currency: string; variantIds: string[]; codes: string[] } {
  const cart = run.input?.cart;
  return {
    currency: String(cart?.cost?.subtotalAmount?.currencyCode ?? ""),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variantIds: ((cart?.lines ?? []) as any[]).map((l) => String(l?.merchandise?.id ?? "")).sort(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codes: ((run.input?.enteredDiscountCodes ?? []) as any[]).map((e) => String(e?.code ?? "").toUpperCase()),
  };
}

export interface RunFilter {
  sinceMs: number;
  /** Variant GIDs of the cart (any order). */
  variantIds: readonly string[];
  currency: string;
  /** The code that must be entered. */
  code: string;
}

/** The lines-target runs of exactly this cart with the code entered, oldest first. */
export async function matchingRuns(filter: RunFilter): Promise<FunctionRun[]> {
  const want = [...filter.variantIds].sort().join(",");
  return (await readFunctionRuns(filter.sinceMs)).filter((run) => {
    if (run.target !== LINES_TARGET || run.status !== "success") return false;
    const cart = runCart(run);
    return cart.currency === filter.currency && cart.variantIds.join(",") === want && cart.codes.includes(filter.code.toUpperCase());
  });
}

/**
 * Wait (polling the log directory) until both Won nodes ran for this cart: the
 * automatic node and the code node triggered by `code`. Then keep collecting
 * until no new matching run appears for `settleMs` (late log deliveries).
 */
export async function waitForRuns(filter: RunFilter, opts: { timeoutMs?: number; settleMs?: number } = {}): Promise<FunctionRun[]> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const settle = opts.settleMs ?? 6_000;
  const complete = (runs: FunctionRun[]) =>
    runs.some((r) => r.role === "automatic") && runs.some((r) => r.role === "code" && String(r.triggeringDiscountCode ?? "").toUpperCase() === filter.code.toUpperCase());
  let runs = await matchingRuns(filter);
  while (!complete(runs) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    runs = await matchingRuns(filter);
  }
  if (!complete(runs)) {
    throw new Error(
      `no automatic + ${filter.code} code-node run of this cart in ${FUNCTION_LOG_DIR} since ${new Date(filter.sinceMs).toISOString()} (found ${runs.length} matching run(s)); is \`shopify app dev\` running?`,
    );
  }
  let count = runs.length;
  let stableSince = Date.now();
  while (Date.now() - stableSince < settle && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    runs = await matchingRuns(filter);
    if (runs.length !== count) {
      count = runs.length;
      stableSince = Date.now();
    }
  }
  return runs;
}

/** The oracle's plan and output for a logged input (what the function must have computed). */
export function oracleFor(run: FunctionRun) {
  const adapted = adaptInput(run.input);
  return { adapted, output: runCartLines(run.input) };
}

/** A logged run for the evidence: no config blob, the lines with what the function read for margin. */
export function runSummary(run: FunctionRun) {
  const input = run.input ?? {};
  return {
    file: path.basename(run.file),
    logTimestamp: run.logTimestamp,
    status: run.status,
    target: run.target,
    role: run.role,
    triggeringDiscountCode: run.triggeringDiscountCode,
    enteredDiscountCodes: input.enteredDiscountCodes ?? null,
    presentmentCurrencyRate: run.rate,
    currency: input.cart?.cost?.subtotalAmount?.currencyCode ?? null,
    country: input.localization?.country?.isoCode ?? null,
    configMargin: input.shop?.config?.jsonValue?.modules?.margin ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: ((input.cart?.lines ?? []) as any[]).map((l) => ({
      id: l.id,
      quantity: l.quantity,
      amountPerQuantity: l.cost?.amountPerQuantity?.amount ?? null,
      variant: l.merchandise?.id ?? null,
      wonVariant: l.merchandise?.wonVariant === undefined ? "<not in input>" : (l.merchandise?.wonVariant ?? null),
      wonProduct: l.merchandise?.product?.wonProduct?.jsonValue ?? null,
    })),
    output: run.output,
  };
}

/** ceil(x − 1e-6), margin.ts ceilTol — restated here so the invariant does not trust the engine. */
export function ceilTol(x: number): number {
  const up = Math.ceil(x - 1e-6);
  return up === 0 ? 0 : up;
}
