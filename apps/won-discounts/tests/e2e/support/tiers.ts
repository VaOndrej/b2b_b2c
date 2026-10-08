import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";
import { planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";

import type { Cart, CartItem } from "./cart.ts";
import { expect, REPO_ROOT, THEME_LABEL } from "./fixtures.ts";
import { marginPlanInput, type MarginInputs, type VariantCost } from "./margin.ts";
import { executeAsApp, type ProductRefs } from "./won-plan.ts";

// Quantity tiers E2E support (MVP 3, Task 7):
//   - readTierInputs: everything the block and the function read, as the app,
//     in one query: the shop config (function_config), the storefront config
//     (app-data metafield, K5), each product's metafield (tierRef/marginRefs,
//     K3) and each variant's cost and pdp metafields (K4);
//   - planFor / unitOnPdp: planCart for a cart (real /cart.js or a synthetic
//     one-line cart for the PDP) with the margin fields the function adds;
//   - the block (K8 markup): readBlock, setQuantity, chooseVariant, and the
//     `won-discounts:tiers:update` events.
// Expectations come from planCart and the live metafields, never constants.

// Validated with the Shopify dev MCP (admin 2026-04): read_products; the
// app-data metafield as sync/graphql.ts storefrontConfig reads it.
function inputsQuery(count: number, collections: number): string {
  const vars = [
    ...Array.from({ length: count }, (_, i) => `$h${i}: String!`),
    ...Array.from({ length: collections }, (_, i) => `$c${i}: String!`),
  ].join(", ");
  const fields = [
    ...Array.from({ length: count }, (_, i) => `  p${i}: productByIdentifier(identifier: { handle: $h${i} }) {\n    ...WonTiersProduct\n  }`),
    ...Array.from({ length: collections }, (_, i) => `  c${i}: collectionByIdentifier(identifier: { handle: $c${i} }) {\n    id\n  }`),
  ].join("\n");
  return `query WonE2eTiersInputs(${vars}) {
  shop {
    currencyCode
    ianaTimezone
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      value
    }
  }
  currentAppInstallation {
    id
    metafield(namespace: "won_discounts", key: "storefront_config") {
      value
      updatedAt
    }
  }
${fields}
}

fragment WonTiersProduct on Product {
  id
  handle
  title
  metafield(namespace: "$app:won_discounts", key: "product") {
    value
  }
  variants(first: 20) {
    nodes {
      id
      title
      price
      metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
      pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
        value
      }
    }
  }
}
`;
}

/** The storefront config v1 as the sync wrote it (K5); typed loosely: the spec compares it with the block. */
export interface StorefrontConfigRead {
  v: number;
  cv: string;
  tiers: { global: string | null; sets: Record<string, { count: string; breaks: ({ min: number; pct: number } | { min: number; off: Record<string, number> })[] }> };
  margin: { on: false } | { on: true; max: number; k: string; cur: string; col?: Record<string, number> };
  /** `css`: every element's look as one stylesheet. The changed texts are not here: one metafield a language (`tx_<locale>`). */
  appearance: { preset: string; css?: string };
}

export interface TierVariant {
  id: string;
  numericId: number;
  title: string;
  /** Admin price in the shop currency, minor units. */
  price: number;
  cost: VariantCost | null;
  /** The `pdp` metafield (K4 v2: `f` = floor per item in shop-currency minor units, `k` = margin key) as read; null = none. */
  pdp: { f?: unknown; k?: unknown } | null;
}

export interface TierInputs extends MarginInputs {
  storefrontConfig: StorefrontConfigRead | null;
  storefrontConfigUpdatedAt: string | null;
  appInstallationId: string;
  variantsByHandle: Record<string, TierVariant[]>;
  titleByHandle: Record<string, string>;
}

interface ProductNode {
  id: string;
  handle: string;
  title: string;
  metafield: { value: string } | null;
  variants: { nodes: { id: string; title: string; price: string; metafield: { value: string } | null; pdp: { value: string } | null }[] };
}

const parse = <T>(value: string | null | undefined): T | null => (value ? (JSON.parse(value) as T) : null);
export const numericId = (gid: string) => Number(gid.slice(gid.lastIndexOf("/") + 1));

/** What the block and the function read for `handles` (+ the GIDs of `collectionHandles`), as the app, in one query. */
export async function readTierInputs(handles: readonly string[], collectionHandles: readonly string[] = []): Promise<TierInputs> {
  const data = await executeAsApp<Record<string, unknown> & {
    shop: { currencyCode: string; ianaTimezone: string; metafield: { value: string } | null };
    currentAppInstallation: { id: string; metafield: { value: string; updatedAt: string } | null };
  }>(inputsQuery(handles.length, collectionHandles.length), {
    ...Object.fromEntries(handles.map((h, i) => [`h${i}`, h])),
    ...Object.fromEntries(collectionHandles.map((h, i) => [`c${i}`, h])),
  });
  if (!data.shop.metafield) throw new Error("the shop has no $app:won_discounts.function_config: run the tiers seed first");
  const refsByProductId: Record<string, ProductRefs> = {};
  const productIdByHandle: Record<string, string> = {};
  const costByVariantId: Record<string, VariantCost | null> = {};
  const variantLabel: Record<string, string> = {};
  const variantsByHandle: Record<string, TierVariant[]> = {};
  const titleByHandle: Record<string, string> = {};
  handles.forEach((handle, i) => {
    const product = data[`p${i}`] as ProductNode | null;
    if (!product) throw new Error(`product ${handle} not found`);
    productIdByHandle[handle] = product.id;
    titleByHandle[handle] = product.title;
    refsByProductId[product.id] = parse<ProductRefs>(product.metafield?.value) ?? {};
    variantsByHandle[handle] = product.variants.nodes.map((v) => {
      const cost = parse<VariantCost>(v.metafield?.value);
      costByVariantId[v.id] = cost;
      variantLabel[v.id] = `${handle} · ${v.title}`;
      return { id: v.id, numericId: numericId(v.id), title: v.title, price: Math.round(Number(v.price) * 100), cost, pdp: parse<{ f?: unknown; k?: unknown }>(v.pdp?.value) };
    });
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
    storefrontConfig: parse<StorefrontConfigRead>(data.currentAppInstallation.metafield?.value),
    storefrontConfigUpdatedAt: data.currentAppInstallation.metafield?.updatedAt ?? null,
    appInstallationId: data.currentAppInstallation.id,
    variantsByHandle,
    titleByHandle,
  };
}

export function variantOf(inputs: TierInputs, handle: string, title?: string): TierVariant {
  const list = inputs.variantsByHandle[handle] ?? [];
  const variant = title ? list.find((v) => v.title === title || v.title.split(" / ").includes(title)) : list[0];
  expect(variant, `${handle}: variant ${title ?? "(first)"}`).toBeDefined();
  return variant!;
}

/**
 * planCart for a cart in the shop currency (market cesko, rate 1 — the
 * function's presentmentCurrencyRate when the cart is in the shop currency),
 * with the margin fields and each line's tierRef as the function adapts them.
 */
export function planFor(cart: Cart, inputs: TierInputs, country = "CZ"): CartPlan {
  expect(cart.currency, "a tiers cart in the shop currency (rate 1)").toBe(inputs.shopCurrency);
  const plan = planCart(marginPlanInput(cart, inputs, country, 1), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  return plan;
}

/** A cart of `lines` as /cart.js would report it before any discount (for planCart only). */
export function syntheticCart(inputs: TierInputs, lines: readonly { handle: string; variant: TierVariant; quantity: number; price?: number }[]): Cart {
  // `price`: the item's price in the cart when a price list sets it (cesko: won-e2e-spare 199 Kč), else the Admin price.
  const items: CartItem[] = lines.map(({ handle, variant, quantity, price = variant.price }, index) => ({
    key: `synthetic-${index}`,
    variant_id: variant.numericId,
    product_id: numericId(inputs.productIdByHandle[handle]!),
    quantity,
    original_price: price,
    original_line_price: price * quantity,
    final_line_price: price * quantity,
    line_level_discount_allocations: [],
  }));
  const subtotal = items.reduce((sum, item) => sum + item.original_price * item.quantity, 0);
  return {
    currency: inputs.shopCurrency,
    total_price: subtotal,
    items_subtotal_price: subtotal,
    original_total_price: subtotal,
    total_discount: 0,
    discount_codes: [],
    cart_level_discount_applications: [],
    items,
  };
}

/**
 * What the PDP's live price must say for `quantity` of `variant` with nothing
 * else in the cart: planCart's line discount D → per item `price − ⌊D / q⌋`
 * (the block floors per item, K6), plus the plan itself for the evidence.
 */
export function pdpExpectation(inputs: TierInputs, handle: string, variant: TierVariant, quantity: number) {
  const plan = planFor(syntheticCart(inputs, [{ handle, variant, quantity }]), inputs);
  const line = plan.lines[0]!;
  const discount = line.product?.amount ?? 0;
  return { plan, line, discount, unitCents: variant.price - Math.floor(discount / quantity), totalCents: variant.price * quantity - discount };
}

// --- The block (K8) ----------------------------------------------------------------------------

export interface BlockRow {
  min: number;
  active: boolean;
  hidden: boolean;
  qty: string;
  save: string;
  unit: string;
}

export interface BlockData {
  v: number;
  product: number;
  set: string | null;
  count: string;
  cur: string;
  fmt: string;
  lang: string;
  sel: number;
  breaks: ({ min: number; pct: number } | { min: number; off: Record<string, number> })[];
  cart: { p: number; s: number };
  /** K4 v2: a costed variant carries `f` (its floor), one without a cost `m` (the percent ceiling), neither = no table. */
  variants: { id: number; p: number; c: number; f?: number; m?: number }[];
}

export interface BlockState {
  state: string | null;
  hidden: boolean;
  setId: string | null;
  countMode: string | null;
  preset: string | null;
  heading: string;
  rows: BlockRow[];
  liveUnitCents: number | null;
  liveText: string;
  next: { hidden: boolean; text: string };
  data: BlockData | null;
  /** The app block wrapper Shopify renders around it (id), the F-T3 evidence on the page. */
  wrapperId: string | null;
  wrapperClass: string | null;
}

export const BLOCK = "[data-won-discounts-tiers]";

/** The ONE tiers block of the page (the PDP's main product). */
export function tiersBlock(page: Page): Locator {
  return page.locator(BLOCK);
}

export async function readBlock(page: Page): Promise<BlockState> {
  const block = tiersBlock(page);
  await expect(block, "exactly one quantity tiers block on the PDP").toHaveCount(1);
  return block.evaluate((el) => {
    const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/gu, " ").trim();
    const dataNode = el.querySelector("[data-won-discounts-tiers-data]");
    let data = null;
    try {
      data = dataNode ? JSON.parse(dataNode.textContent ?? "") : null;
    } catch {
      data = null;
    }
    const live = el.querySelector("[data-won-discounts-live-price]");
    const next = el.querySelector("[data-won-discounts-tier-next]");
    const wrapper = el.closest('[id^="shopify-block-"]');
    return {
      state: el.getAttribute("data-state"),
      hidden: (el as HTMLElement).hidden,
      setId: el.getAttribute("data-set-id"),
      countMode: el.getAttribute("data-count-mode"),
      preset: el.getAttribute("data-preset"),
      heading: text(el.querySelector(".won-tiers__heading")),
      rows: [...el.querySelectorAll("[data-won-discounts-tier-row]")].map((row) => ({
        min: Number(row.getAttribute("data-min")),
        active: row.getAttribute("data-active") === "true",
        hidden: (row as HTMLElement).hidden,
        qty: text(row.querySelector(".won-tiers__qty")),
        save: text(row.querySelector(".won-tiers__save")),
        unit: text(row.querySelector(".won-tiers__unit")),
      })),
      liveUnitCents: live?.getAttribute("data-unit-cents") ? Number(live.getAttribute("data-unit-cents")) : null,
      liveText: text(live),
      next: { hidden: next ? (next as HTMLElement).hidden : true, text: text(next) },
      data,
      wrapperId: wrapper?.id ?? null,
      wrapperClass: wrapper?.getAttribute("class") ?? null,
    };
  });
}

/** Record every `won-discounts:tiers:update` event (K8) of the page from its first script on. */
export async function recordTierEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wonTierEvents?: unknown[] };
    w.__wonTierEvents = [];
    document.addEventListener("won-discounts:tiers:update", (event) => {
      w.__wonTierEvents!.push({ at: Date.now(), ...((event as CustomEvent).detail ?? {}) });
    });
  });
}

export interface TierEvent {
  variantId: number | string;
  quantity: number;
  count: number;
  min: number;
  unitCents: number | null;
}

export async function tierEvents(page: Page): Promise<TierEvent[]> {
  return page.evaluate(() => ((window as unknown as { __wonTierEvents?: TierEvent[] }).__wonTierEvents ?? []).slice());
}

/** The quantity input of the PDP's buy form (Dawn: bound with form=…; Horizon: in buy-buttons). */
export function quantityInput(page: Page): Locator {
  return page.locator('input[name="quantity"]:visible').first();
}

/** Type a quantity like a shopper (input + change), then wait until the block's live price shows `unitCents`. */
export async function setQuantity(page: Page, quantity: number, unitCents: number): Promise<void> {
  const input = quantityInput(page);
  await expect(input, "the PDP's quantity input").toBeVisible();
  await input.fill(String(quantity));
  await input.dispatchEvent("change");
  await expect
    .poll(async () => (await readBlock(page)).liveUnitCents, { message: `live price for ${quantity} item(s)`, timeout: 10_000 })
    .toBe(unitCents);
}

/** Pick an option value in the theme's variant picker (buttons: click the radio's label; fallback: check the radio). */
export async function chooseVariant(page: Page, optionValue: string): Promise<void> {
  const radio = page.locator(`input[type="radio"][value="${optionValue}"]`).first();
  await expect(radio, `a variant picker option "${optionValue}"`).toHaveCount(1);
  const id = await radio.getAttribute("id");
  const label = id ? page.locator(`label[for="${id}"]`).first() : null;
  if (label && (await label.count()) > 0 && (await label.isVisible())) await label.click();
  else if (await radio.isVisible()) await radio.click();
  else await radio.check({ force: true });
}

/** Percent as the block prints it in Czech ("14,2"), from a number (never a constant). */
export function pctText(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return String(rounded).replace(".", ",");
}

/** The quantity tiers block in the theme copy's templates/product.json the runner served (F-T3): its type and placement. */
export function workspaceBlock(blockId: string): { file: string; type: string | null; parent: string | null } | null {
  if (!THEME_LABEL) return null;
  const file = path.join(REPO_ROOT, "tmp/e2e-themes/won-discounts", THEME_LABEL.toLowerCase(), "templates/product.json");
  if (!existsSync(file)) return null;
  const template = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/u, "")) as {
    sections: Record<string, { blocks?: Record<string, { type: string; blocks?: Record<string, { type: string }> }> }>;
  };
  for (const [sectionKey, section] of Object.entries(template.sections)) {
    for (const [key, block] of Object.entries(section.blocks ?? {})) {
      if (key === blockId) return { file: path.relative(REPO_ROOT, file), type: block.type, parent: sectionKey };
      const nested = block.blocks?.[blockId];
      if (nested) return { file: path.relative(REPO_ROOT, file), type: nested.type, parent: `${sectionKey}/${key}` };
    }
  }
  return { file: path.relative(REPO_ROOT, file), type: null, parent: null };
}
