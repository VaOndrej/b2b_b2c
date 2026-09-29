import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";

import type { Cart } from "./cart.ts";
import { APP_DIR, expect, REPO_ROOT, SHOP_DOMAIN } from "./fixtures.ts";

// The expectation of a live E2E is never hard-coded: it is `planCart` (the TS
// reference engine the Rust function ports) run on exactly what the discount
// function reads — the LIVE app-owned shop metafield
// `$app:won_discounts.function_config` and the product metafield
// `$app:won_discounts.product`, read as the app (`shopify app execute`) — and on
// the cart as `/cart.js` reports it.

// Validated with the Shopify dev MCP (admin 2026-04, read_products).
const INPUTS_QUERY = `query WonE2eProduct($handle: String!) {
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
}
`;

export interface ProductRefs {
  ruleIds?: string[];
  variantRuleIds?: Record<string, string[]>;
}

export interface LiveInputs {
  config: PlanConfig;
  productId: string;
  productRefs: ProductRefs;
  shopTimezone: string;
  /** Several products (readLiveInputsFor): product GID → its metafield refs; planInputFromCart looks every line up here. */
  refsByProductId?: Record<string, ProductRefs>;
  /** Several products (readLiveInputsFor): handle → product GID. */
  productIdByHandle?: Record<string, string>;
}

export interface Expected {
  plan: CartPlan;
  lineDiscount: number;
  orderDiscount: number;
  subtotalAfterLines: number;
  total: number;
}

const cache = new Map<string, LiveInputs>();

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`npx ${args.slice(0, 3).join(" ")} exited ${code}: ${out.slice(-800)}`))));
  });
}

/**
 * One Admin GraphQL query as the app (`shopify app execute`, API 2026-04) →
 * its `data`. Throws when the CLI wrote no output.
 */
export async function executeAsApp<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "won-e2e-inputs-"));
  try {
    const queryFile = path.join(dir, "q.graphql");
    const variableFile = path.join(dir, "v.json");
    const outputFile = path.join(dir, "out.json");
    await writeFile(queryFile, query);
    await writeFile(variableFile, JSON.stringify(variables));
    const log = await runCli([
      "shopify", "app", "execute",
      "--path", APP_DIR,
      "--store", SHOP_DOMAIN,
      "--version", "2026-04",
      "--query-file", queryFile,
      "--variable-file", variableFile,
      "--output-file", outputFile,
      "--no-color",
    ]);
    if (!existsSync(outputFile)) throw new Error(`shopify app execute wrote no output: ${log.slice(-800)}`);
    return JSON.parse(await readFile(outputFile, "utf8")) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The function's inputs as stored on the store for `handle`'s product (cached per run). */
export async function readLiveInputs(handle: string): Promise<LiveInputs> {
  const hit = cache.get(handle);
  if (hit) return hit;
  const data = await executeAsApp<{
    productByIdentifier: { id: string; metafield: { value: string } | null } | null;
    shop: { ianaTimezone: string; metafield: { value: string } | null };
  }>(INPUTS_QUERY, { handle });
  const product = data.productByIdentifier;
  if (!product) throw new Error(`product ${handle} not found`);
  if (!data.shop.metafield) {
    throw new Error("the shop has no $app:won_discounts.function_config: run `node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live` first");
  }
  if (!product.metafield) throw new Error(`${handle} has no $app:won_discounts.product metafield: run the seed first`);
  const inputs: LiveInputs = {
    config: JSON.parse(data.shop.metafield.value) as PlanConfig,
    productId: product.id,
    productRefs: JSON.parse(product.metafield.value) as LiveInputs["productRefs"],
    shopTimezone: data.shop.ianaTimezone,
  };
  cache.set(handle, inputs);
  return inputs;
}

/**
 * The function's inputs for a cart of several products: the shop config of the
 * first read and every product's metafield refs (each read as the app, cached).
 */
export async function readLiveInputsFor(handles: readonly string[]): Promise<LiveInputs> {
  const all: LiveInputs[] = [];
  for (const handle of handles) all.push(await readLiveInputs(handle));
  const first = all[0]!;
  return {
    ...first,
    refsByProductId: Object.fromEntries(all.map((inputs) => [inputs.productId, inputs.productRefs])),
    productIdByHandle: Object.fromEntries(handles.map((handle, i) => [handle, all[i]!.productId])),
  };
}

export function shopLocalDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The CartPlanInput the function builds for this cart (extensions/won-discounts-engine/src/input.rs). */
export function planInputFromCart(cart: Cart, inputs: LiveInputs, country: string): CartPlanInput {
  const lines: CartLineInput[] = cart.items.map((item, index) => {
    const productGid = `gid://shopify/Product/${item.product_id}`;
    const refs = inputs.refsByProductId ? inputs.refsByProductId[productGid] : productGid === inputs.productId ? inputs.productRefs : undefined;
    return {
      id: `gid://shopify/CartLine/${index}`,
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      productId: "",
      quantity: item.quantity,
      unitPrice: item.original_price,
      ruleIds: refs?.ruleIds ?? [],
      ...(refs?.variantRuleIds ? { variantRuleIds: refs.variantRuleIds } : {}),
    };
  });
  return {
    currency: cart.currency,
    countryCode: country,
    lines,
    enteredCodes: cart.discount_codes.map((c) => c.code),
    campaign: { id: null, active: false, varsVersion: null },
    today: shopLocalDate(inputs.shopTimezone),
    locale: "cs",
  };
}

/** planCart for this cart, reduced to what the cart and the checkout show. */
export function expectedFor(cart: Cart, inputs: LiveInputs, country: string): Expected {
  const plan = planCart(planInputFromCart(cart, inputs, country), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  return {
    plan,
    lineDiscount: plan.lines.reduce((sum, l) => sum + (l.product?.amount ?? 0), 0),
    orderDiscount: plan.order?.amount ?? 0,
    subtotalAfterLines: plan.totals.subtotal - plan.totals.productDiscount,
    total: plan.totals.total,
  };
}
