import type { Page } from "@playwright/test";

import { expect } from "./fixtures.ts";

// The storefront AJAX cart, paced: Cloudflare answers HTTP 429 to cart writes
// faster than ~1.5 s apart, so every request waits CART_GAP_MS after the
// previous one and backs off on a 429. Shopify's own transient 5xx
// (observed 2026-09-29 on GET /products/<handle>.js through theme dev: 503
// {"errors":[{"code":"SERVICE_UNAVAILABLE","message":"There was a problem
// loading this website. Please try again."}]}) gets the same back-off. Prices
// are only ever read from here (/cart.js), never from theme DOM.

export const CART_GAP_MS = 1_600;
const BACKOFF_MS = [5_000, 10_000, 20_000, 30_000, 45_000];
/** Rate limited (429) or Shopify temporarily unavailable (502/503/504): wait and send again. */
const RETRY_STATUS = new Set([429, 502, 503, 504]);

export interface CartAllocation {
  amount: number;
  discount_application: { title: string; type: string; value: string; value_type: string; total_allocated_amount: number };
}

export interface CartItem {
  key: string;
  variant_id: number;
  product_id: number;
  product_title?: string;
  handle?: string;
  variant_title?: string | null;
  quantity: number;
  original_price: number;
  original_line_price?: number;
  final_line_price: number;
  line_level_discount_allocations: CartAllocation[];
  /** Line properties (MVP 4: a Won gift line carries `_won_gift` + `_gift_progress`). */
  properties?: Record<string, unknown> | null;
}

export interface Cart {
  currency: string;
  total_price: number;
  items_subtotal_price: number;
  original_total_price: number;
  total_discount: number;
  discount_codes: { code: string; applicable: boolean }[];
  cart_level_discount_applications: { title: string; type: string; value: string; value_type: string; total_allocated_amount: number }[];
  items: CartItem[];
  /** Cart attributes (MVP 4: `_won_gift_declined`). */
  attributes?: Record<string, unknown> | null;
}

let lastRequestAt = 0;

async function pace(page: Page): Promise<void> {
  const gap = Date.now() - lastRequestAt;
  if (gap < CART_GAP_MS) await page.waitForTimeout(CART_GAP_MS - gap);
  lastRequestAt = Date.now();
}

/** One storefront AJAX request from the page's origin; expects HTTP 200 and JSON. */
export async function storefrontJson<T>(page: Page, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await pace(page);
    const result = await page.evaluate(
      async ({ method: m, url: u, body: b }) => {
        const response = await fetch(u, {
          method: m,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: b === undefined ? undefined : JSON.stringify(b),
          credentials: "same-origin",
        });
        return { status: response.status, text: await response.text() };
      },
      { method, url, body },
    );
    if (RETRY_STATUS.has(result.status) && attempt < BACKOFF_MS.length) {
      await page.waitForTimeout(BACKOFF_MS[attempt]!);
      continue;
    }
    expect(result.status, `${method} ${url}: ${result.text.slice(0, 200)}`).toBe(200);
    return JSON.parse(result.text) as T;
  }
}

/** Empty cart, then 1× the first variant of `handle` and exactly `codes` in ONE update (no function run sees a stale code set). */
export async function freshCart(page: Page, handle: string, codes: readonly string[]): Promise<Cart> {
  const product = await storefrontJson<{ variants: { id: number }[] }>(page, "GET", `/products/${handle}.js`);
  const variantId = product.variants[0]!.id;
  await storefrontJson(page, "POST", "/cart/clear.js", {});
  await storefrontJson(page, "POST", "/cart/update.js", { updates: { [String(variantId)]: 1 }, discount: codes.join(",") });
  return storefrontJson<Cart>(page, "GET", "/cart.js");
}

/**
 * Like freshCart for several products: empty cart, then the first variant of
 * each handle × its quantity and exactly `codes`, in ONE update. Shopify decides
 * the cart's line order: match lines by product, never by index.
 */
export async function freshCartWith(page: Page, lines: readonly { handle: string; quantity: number }[], codes: readonly string[]): Promise<Cart> {
  const updates: Record<string, number> = {};
  for (const { handle, quantity } of lines) {
    const product = await storefrontJson<{ variants: { id: number }[] }>(page, "GET", `/products/${handle}.js`);
    updates[String(product.variants[0]!.id)] = quantity;
  }
  await storefrontJson(page, "POST", "/cart/clear.js", {});
  await storefrontJson(page, "POST", "/cart/update.js", { updates, discount: codes.join(",") });
  return storefrontJson<Cart>(page, "GET", "/cart.js");
}

/**
 * The storefront variant id of `handle`: the variant whose options include
 * `option` (e.g. "Small"), else the first variant.
 */
export async function variantIdOf(page: Page, handle: string, option?: string): Promise<number> {
  const product = await storefrontJson<{ variants: { id: number; options?: string[]; title?: string }[] }>(page, "GET", `/products/${handle}.js`);
  const variant = option ? product.variants.find((v) => (v.options ?? []).includes(option) || v.title === option) : product.variants[0];
  expect(variant, `${handle}: a variant ${option ? `with the option "${option}"` : ""}`).toBeDefined();
  return variant!.id;
}

/**
 * Like freshCartWith, choosing the variant per line (`option`, see variantIdOf):
 * empty cart, then every line and exactly `codes` in ONE update.
 */
export async function freshCartOfVariants(
  page: Page,
  lines: readonly { handle: string; quantity: number; option?: string }[],
  codes: readonly string[],
): Promise<Cart> {
  const updates: Record<string, number> = {};
  for (const { handle, quantity, option } of lines) updates[String(await variantIdOf(page, handle, option))] = quantity;
  await storefrontJson(page, "POST", "/cart/clear.js", {});
  await storefrontJson(page, "POST", "/cart/update.js", { updates, discount: codes.join(",") });
  return storefrontJson<Cart>(page, "GET", "/cart.js");
}

/**
 * Switch the storefront's buyer country (and with it the market and the cart's
 * currency): the current page again with `?country=<code>`. The storefront
 * answers with the `localization` and `cart_currency` cookies of that market,
 * and the cart follows (/cart.js in the market's currency).
 *
 * Not the theme's `localization` form: observed 2026-09-30 (Shopify CLI 4.8,
 * final gate phase A), POST /localization through `shopify theme dev` answers
 * 401 and changes nothing. The proxy sends every non-cart path to the store
 * with its own storefront Bearer token, and the store refuses the form with it.
 * Setting the `localization` cookie in the browser does not help either: the
 * next response sets it back. `?country=SK` on a page render switched the
 * theme-dev session to SK / EUR, and it stays there for later pages.
 *
 * Returns the page's HTTP status and what it then reports
 * (window.Shopify.country / currency.active); the caller checks the cart's
 * currency, which is what the function sees.
 */
export async function setStorefrontCountry(page: Page, countryCode: string): Promise<{ status: number; country: string | null; currency: string | null }> {
  await pace(page);
  const url = new URL(page.url());
  url.searchParams.set("country", countryCode);
  const response = await page.goto(url.href, { waitUntil: "load" });
  const status = response?.status() ?? 0;
  const reported = await page.evaluate(() => {
    const shopify = (window as unknown as { Shopify?: { country?: string; currency?: { active?: string } } }).Shopify;
    return { country: shopify?.country ?? null, currency: shopify?.currency?.active ?? null };
  });
  return { status, ...reported };
}

/** Best effort, bounded: no code, no line (one attempt each, never throws). */
export async function clearCartQuietly(page: Page, timeoutMs = 15_000): Promise<void> {
  const run = async () => {
    for (const [url, body] of [
      ["/cart/update.js", { discount: "" }],
      ["/cart/clear.js", {}],
    ] as const) {
      await pace(page);
      await page.evaluate(
        async ({ u, b }) => {
          await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
        },
        { u: url, b: body },
      );
    }
  };
  await Promise.race([run(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]).catch(() => undefined);
}
