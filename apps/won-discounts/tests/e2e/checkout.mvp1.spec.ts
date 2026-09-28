import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";
import { createStorefrontTest, expect } from "@won/testing/playwright";

import {
  E2E_AUTO_PERCENT,
  E2E_AUTO_RULE_ID,
  E2E_AUTO_RULE_NAME,
  E2E_CODE,
  E2E_CODE_PERCENT,
  E2E_CODE_RULE_ID,
  E2E_CODE_RULE_NAME,
  E2E_PRODUCT_HANDLE,
} from "../../scripts/e2e/mvp1-fixture.mjs";

// SPEC-DRIVEN (MVP 1, Task 6). Live proof that Won discounts really apply in
// the cart AND in checkout on both shared themes (the matrix runs this file
// against Horizon and Dawn through `shopify theme dev`).
//
// Needs the seed: `node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live`
// ("E2E auto 10 %" on won-e2e-simple-a, code WONE2E15 = 15 % on the order).
//
// The expectation is never hard-coded: it is `planCart` (the TS reference
// engine, the one brain the Rust function ports) run on exactly what the
// discount function reads — the LIVE app-owned shop metafield
// `$app:won_discounts.function_config` and the product metafield
// `$app:won_discounts.product`, read as the app (`shopify app execute`) — and
// on the cart as `/cart.js` reports it. Prices are only ever read from
// `/cart.js` and from the checkout's own price summary, never from theme DOM.
//
// Environment facts this spec works around (observed 2026-09-28, CLI 4.8.0):
//   1. theme dev adopts any `_shopify_essential` cookie a proxied response
//      sets. Shopify's consent banner query (POST /api/unstable/graphql.json)
//      answers 400 with a fresh, unauthenticated `_shopify_essential`, after
//      which every proxied storefront request (cart AJAX included) redirects
//      to /password for the rest of the theme-dev session. So the storefront
//      API calls on the theme-dev origin are aborted (nothing we assert uses them).
//   2. /checkout on the theme-dev origin redirects to the real
//      `*.myshopify.com/checkouts/cn/<token>` in the BROWSER's own session.
//      The storefront password must be unlocked there, and a discount code
//      applied to the cart in the theme-dev session does not travel: codes are
//      bound to the buyer session, not to the cart token (checked: same
//      checkout URL in a second session shows the automatic discount but not
//      the code). The code is then entered in the checkout's own discount
//      field — the checkout function run gets it as an entered code, the same
//      input the cart run had. The last test covers the production path the
//      theme-dev split hides: cart + checkout in ONE real-storefront session,
//      where the cart's code is carried into checkout without re-entering it.

const test = createStorefrontTest({ javaScriptProxyPaths: ["won-discounts.js"] });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const SHOP_DOMAIN = String(process.env.SHOPIFY_E2E_SHOP_DOMAIN ?? "").trim() || "b2b-b2c-store-development.myshopify.com";
const STORE_ORIGIN = `https://${SHOP_DOMAIN}`;
const THEME_LABEL = String(process.env.SHOPIFY_E2E_THEME_LABEL ?? "").trim();
const SCREENSHOT_DIR = String(process.env.WON_DISCOUNTS_E2E_SCREENSHOT_DIR ?? "").trim();
const EVIDENCE_DIR = String(process.env.WON_DISCOUNTS_E2E_EVIDENCE_DIR ?? "").trim();
const CART_GAP_MS = 1_600; // Cloudflare answers 429 to cart writes faster than ~1.5 s
const CHECKOUT_COUNTRY = "CZ"; // market cesko (CZK)

// --- Live function inputs (read as the app) -----------------------------------------------

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

interface LiveInputs {
  config: PlanConfig;
  productId: string;
  productRefs: { ruleIds?: string[]; variantRuleIds?: Record<string, string[]> };
  shopTimezone: string;
}

let liveInputs: LiveInputs | null = null;

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

/** The function's inputs as stored on the store: shop config, product refs, shop time zone. */
async function readLiveInputs(): Promise<LiveInputs> {
  if (liveInputs) return liveInputs;
  const dir = await mkdtemp(path.join(tmpdir(), "won-e2e-inputs-"));
  try {
    const queryFile = path.join(dir, "q.graphql");
    const variableFile = path.join(dir, "v.json");
    const outputFile = path.join(dir, "out.json");
    await writeFile(queryFile, INPUTS_QUERY);
    await writeFile(variableFile, JSON.stringify({ handle: E2E_PRODUCT_HANDLE }));
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
    const data = JSON.parse(await readFile(outputFile, "utf8")) as {
      productByIdentifier: { id: string; metafield: { value: string } | null } | null;
      shop: { ianaTimezone: string; metafield: { value: string } | null };
    };
    const product = data.productByIdentifier;
    if (!product) throw new Error(`product ${E2E_PRODUCT_HANDLE} not found`);
    if (!data.shop.metafield) {
      throw new Error("the shop has no $app:won_discounts.function_config: run `node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live` first");
    }
    if (!product.metafield) throw new Error(`${E2E_PRODUCT_HANDLE} has no $app:won_discounts.product metafield: run the seed first`);
    liveInputs = {
      config: JSON.parse(data.shop.metafield.value) as PlanConfig,
      productId: product.id,
      productRefs: JSON.parse(product.metafield.value) as LiveInputs["productRefs"],
      shopTimezone: data.shop.ianaTimezone,
    };
    return liveInputs;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- Storefront AJAX cart (paced) ---------------------------------------------------------

interface CartAllocation {
  amount: number;
  discount_application: { title: string; type: string; value: string; value_type: string; total_allocated_amount: number };
}
interface CartItem {
  key: string;
  variant_id: number;
  product_id: number;
  quantity: number;
  original_price: number;
  final_line_price: number;
  line_level_discount_allocations: CartAllocation[];
}
interface Cart {
  currency: string;
  total_price: number;
  items_subtotal_price: number;
  original_total_price: number;
  total_discount: number;
  discount_codes: { code: string; applicable: boolean }[];
  cart_level_discount_applications: { title: string; type: string; value: string; value_type: string; total_allocated_amount: number }[];
  items: CartItem[];
}

let lastCartRequestAt = 0;

async function storefrontJson<T>(page: Page, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const gap = Date.now() - lastCartRequestAt;
    if (gap < CART_GAP_MS) await page.waitForTimeout(CART_GAP_MS - gap);
    lastCartRequestAt = Date.now();
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
    if (result.status === 429 && attempt < 5) {
      await page.waitForTimeout([5_000, 10_000, 20_000, 30_000, 45_000][attempt]!);
      continue;
    }
    expect(result.status, `${method} ${url}: ${result.text.slice(0, 200)}`).toBe(200);
    return JSON.parse(result.text) as T;
  }
}

/** Empty cart, no codes, then 1× the test variant (and the codes, when given). */
async function freshCart(page: Page, codes: string[]): Promise<Cart> {
  const product = await storefrontJson<{ variants: { id: number }[] }>(page, "GET", `/products/${E2E_PRODUCT_HANDLE}.js`);
  const variantId = product.variants[0]!.id;
  await storefrontJson(page, "POST", "/cart/clear.js", {});
  // One atomic update: the line and the codes, so no function run sees a stale code set.
  await storefrontJson(page, "POST", "/cart/update.js", { updates: { [String(variantId)]: 1 }, discount: codes.join(",") });
  return storefrontJson<Cart>(page, "GET", "/cart.js");
}

// --- The expectation: planCart on the function's inputs -----------------------------------

function shopLocalDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The CartPlanInput the function builds for this cart (extensions/won-discounts-engine/src/input.rs). */
function planInputFromCart(cart: Cart, inputs: LiveInputs, country: string): CartPlanInput {
  const lines: CartLineInput[] = cart.items.map((item, index) => {
    const own = `gid://shopify/Product/${item.product_id}` === inputs.productId;
    return {
      id: `gid://shopify/CartLine/${index}`,
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      productId: "",
      quantity: item.quantity,
      unitPrice: item.original_price,
      ruleIds: own ? (inputs.productRefs.ruleIds ?? []) : [],
      ...(own && inputs.productRefs.variantRuleIds ? { variantRuleIds: inputs.productRefs.variantRuleIds } : {}),
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

interface Expected {
  plan: CartPlan;
  lineDiscount: number;
  orderDiscount: number;
  subtotalAfterLines: number;
  total: number;
}

function expectedFor(cart: Cart, inputs: LiveInputs): Expected {
  const plan = planCart(planInputFromCart(cart, inputs, CHECKOUT_COUNTRY), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  const lineDiscount = plan.lines.reduce((sum, l) => sum + (l.product?.amount ?? 0), 0);
  return {
    plan,
    lineDiscount,
    orderDiscount: plan.order?.amount ?? 0,
    subtotalAfterLines: plan.totals.subtotal - plan.totals.productDiscount,
    total: plan.totals.total,
  };
}

// --- Checkout (Shopify's own page, not the theme) ------------------------------------------

function readDotenvValue(key: string): string {
  const file = path.join(APP_DIR, ".env");
  if (!existsSync(file)) return "";
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
  }
  return "";
}

/** The checkout lives on the real domain in the browser's own session: unlock the password there (never logged). */
async function unlockRealStorefront(page: Page) {
  const password = String(process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD ?? "").trim() || readDotenvValue("SHOPIFY_E2E_STOREFRONT_PASSWORD");
  await page.goto(`${STORE_ORIGIN}/password`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 20 && (await page.title()).includes("Just a moment"); i += 1) await page.waitForTimeout(2_000);
  const input = page.locator("input[type='password']").first();
  if (page.url().includes("/password") && (await input.count()) > 0) {
    expect(password, "SHOPIFY_E2E_STOREFRONT_PASSWORD (env or apps/won-discounts/.env) is needed for the checkout on the real domain").not.toBe("");
    await input.fill(password);
    await Promise.all([page.waitForURL((url) => !url.pathname.endsWith("/password"), { timeout: 30_000 }), input.press("Enter")]);
  }
  expect(page.url(), "real storefront still locked").not.toContain("/password");
}

/** Keep the theme-dev session authenticated (fact 1 above). */
async function blockStorefrontApiOnThemeDev(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin === origin && /^\/api\/[^/]+\/graphql\.json$/u.test(url.pathname),
    (route) => route.abort(),
  );
}

/** "1 234,56 Kč" / "− 29,43 Kč" / "CZK 819,77 Kč" → minor units (the currency has 2 digits). */
function minorUnits(text: string): number | null {
  const match = /([\u2212-])?\s*(\d[\d\s\u00a0\u202f.]*[.,]\d{2})(?!\d)/u.exec(text);
  if (!match) return null;
  const digits = match[2]!.replace(/[^\d]/gu, "");
  return Number(digits) * (match[1] ? -1 : 1);
}

interface SummaryRow {
  label: string;
  value: string;
  amount: number | null;
}

/** Rows of the checkout's "price summary" table (role=table labelled by the MoneyLine heading). */
async function priceSummary(page: Page): Promise<SummaryRow[]> {
  const table = page.locator('[role="table"][aria-labelledby^="MoneyLine-Heading"]').first();
  await expect(table).toBeVisible({ timeout: 60_000 });
  return table.locator('[role="row"]').evaluateAll((rows) =>
    rows
      .map((row) => {
        const header = row.querySelector('[role="rowheader"]');
        const cell = row.querySelector('[role="cell"]');
        // The cell repeats the value in an aria-hidden animation copy: read the visible copy (the last text).
        const spans = cell ? [...cell.querySelectorAll("span,strong")].filter((el) => !el.closest('[aria-hidden="true"]')) : [];
        const value = spans.length ? (spans[spans.length - 1]!.textContent ?? "") : (cell?.textContent ?? "");
        return { label: (header?.textContent ?? "").replace(/\s+/gu, " ").trim(), value: value.replace(/\s+/gu, " ").trim() };
      })
      .filter((row) => row.label !== ""),
  ).then((rows) => rows.map((row) => ({ ...row, amount: minorUnits(row.value) })));
}

const SUBTOTAL = /^(Mezisoučet|Subtotal)/iu;
const SHIPPING = /^(Expedice|Doprava|Shipping)/iu;
const TOTAL = /^(Celkem|Total)$/iu;
const TAX = /(Daně|Daň|DPH|Taxes|Tax)/iu;

function rowAmount(rows: SummaryRow[], label: RegExp | string): number | null {
  const row = rows.find((r) => (typeof label === "string" ? r.label.toUpperCase().includes(label.toUpperCase()) : label.test(r.label)));
  return row?.amount ?? null;
}

/** The line's own discount as the checkout shows it next to the product: "E2E AUTO 10 % (-21,80 Kč)". */
async function lineDiscountInSummary(page: Page, ruleName: string): Promise<number | null> {
  // The aside that holds the price summary (a collapsed mobile header aside comes first).
  const summary = page.locator("aside", { has: page.locator('[role="table"][aria-labelledby^="MoneyLine-Heading"]') });
  const text = ((await summary.count()) > 0 ? await summary.last().textContent() : await page.locator("body").textContent()) ?? "";
  const escaped = ruleName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
  const match = new RegExp(`${escaped}\\s*\\(([^)]*)\\)`, "iu").exec(text.replace(/\s+/gu, " "));
  if (!match) console.log(`[checkout.mvp1] no "${ruleName} (…)" in the order summary: ${text.replace(/\s+/gu, " ").slice(0, 600)}`);
  return match ? minorUnits(match[1]!) : null;
}

async function fillCardField(page: Page, frame: string, name: string, value: string) {
  const input = page.frameLocator(`iframe[name^="card-fields-${frame}"]`).locator(`input[name="${name}"]`);
  await input.click();
  await input.pressSequentially(value, { delay: 50 });
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(path.join(SCREENSHOT_DIR, `${name}${THEME_LABEL ? `-${THEME_LABEL.toLowerCase()}` : ""}.png`), body);
}

function saveEvidence(name: string, data: unknown) {
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}${THEME_LABEL ? `-${THEME_LABEL.toLowerCase()}` : ""}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

// --- The spec -------------------------------------------------------------------------------

test.describe(`Won Discounts in cart and checkout (MVP 1)${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await blockStorefrontApiOnThemeDev(page.context(), baseURL!);
  });

  test.afterEach(async ({ page, baseURL }) => {
    // Best effort, one attempt each, bounded: leave no code and no line in the theme-dev cart.
    // Only on the theme-dev origin (a completed checkout has consumed its cart; every test starts from freshCart anyway).
    const origin = new URL(baseURL!).origin;
    if (!page.url().startsWith(origin)) return;
    const cleanup = async () => {
      for (const [url, body] of [["/cart/update.js", { discount: "" }], ["/cart/clear.js", {}]] as const) {
        await page.waitForTimeout(CART_GAP_MS);
        await page.evaluate(
          async ({ u, b }) => {
            await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
          },
          { u: url, b: body },
        );
      }
    };
    await Promise.race([cleanup(), new Promise((resolve) => setTimeout(resolve, 15_000))]).catch(() => undefined);
  });

  test("cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const inputs = await readLiveInputs();
    const rules = inputs.config.modules.codes.rules.map((r) => r.id);
    expect(rules, "the live shop config carries the seeded rules").toEqual(expect.arrayContaining([E2E_AUTO_RULE_ID, E2E_CODE_RULE_ID]));
    expect(inputs.productRefs.ruleIds ?? [], `${E2E_PRODUCT_HANDLE} is targeted by the automatic rule`).toContain(E2E_AUTO_RULE_ID);

    const response = await page.goto(`/products/${E2E_PRODUCT_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    // (a) automatic rule: one line-level allocation, 10 %, titled with the rule name.
    const autoCart = await test.step("(a) add won-e2e-simple-a → /cart.js line allocation", async () => {
      const cart = await freshCart(page, []);
      const expected = expectedFor(cart, inputs);
      const item = cart.items[0]!;
      expect(cart.items).toHaveLength(1);
      expect(cart.discount_codes).toEqual([]);
      expect(item.line_level_discount_allocations).toHaveLength(1);
      const allocation = item.line_level_discount_allocations[0]!;
      expect(allocation.discount_application.title).toBe(E2E_AUTO_RULE_NAME);
      expect(allocation.discount_application.value_type).toBe("percentage");
      expect(Number(allocation.discount_application.value)).toBe(E2E_AUTO_PERCENT);
      expect(allocation.amount, "line discount = planCart").toBe(expected.lineDiscount);
      expect(allocation.amount, "10 % of the line").toBe(Math.round((item.original_price * item.quantity * E2E_AUTO_PERCENT) / 100));
      expect(cart.cart_level_discount_applications).toEqual([]);
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);
      return { cart, expected };
    });

    // (b) code: applicable, order-level 15 % on the subtotal after the line discount.
    const codeCart = await test.step("(b) /cart/update.js {discount: WONE2E15} → applicable, order-level 15 %", async () => {
      await storefrontJson(page, "POST", "/cart/update.js", { discount: E2E_CODE });
      const cart = await storefrontJson<Cart>(page, "GET", "/cart.js");
      const expected = expectedFor(cart, inputs);
      expect(cart.discount_codes[0]?.code.toUpperCase()).toBe(E2E_CODE);
      expect(cart.discount_codes[0]?.applicable).toBe(true);
      expect(expected.plan.codes[0]?.state, "planCart: the code applies").toBe("applied");
      expect(cart.items[0]!.line_level_discount_allocations.map((a) => [a.discount_application.title, a.amount])).toEqual([
        [E2E_AUTO_RULE_NAME, expected.lineDiscount],
      ]);
      expect(cart.cart_level_discount_applications).toHaveLength(1);
      const order = cart.cart_level_discount_applications[0]!;
      expect(order.value_type).toBe("percentage");
      expect(Number(order.value)).toBe(E2E_CODE_PERCENT);
      expect(cart.items_subtotal_price, "subtotal after the line discount = planCart").toBe(expected.subtotalAfterLines);
      expect(order.total_allocated_amount, "order discount = planCart (15 % of the discounted subtotal)").toBe(expected.orderDiscount);
      expect(order.total_allocated_amount).toBe(Math.round((expected.subtotalAfterLines * E2E_CODE_PERCENT) / 100));
      expect(expected.plan.order?.message).toBe(E2E_CODE_RULE_NAME);
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);
      return { cart, expected };
    });

    saveEvidence("cart-mvp1", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      currency: codeCart.cart.currency,
      auto: {
        total_price: autoCart.cart.total_price,
        allocations: autoCart.cart.items[0]!.line_level_discount_allocations.map((a) => ({ title: a.discount_application.title, amount: a.amount })),
        planTotals: autoCart.expected.plan.totals,
      },
      code: {
        discount_codes: codeCart.cart.discount_codes,
        items_subtotal_price: codeCart.cart.items_subtotal_price,
        cart_level: codeCart.cart.cart_level_discount_applications.map((a) => ({ title: a.title, amount: a.total_allocated_amount, value: a.value })),
        total_price: codeCart.cart.total_price,
        planTotals: codeCart.expected.plan.totals,
        planOrder: codeCart.expected.plan.order ? { amount: codeCart.expected.plan.order.amount, base: codeCart.expected.plan.order.base, message: codeCart.expected.plan.order.message } : null,
      },
    });
    await testInfo.attach("cart-mvp1.json", { body: JSON.stringify(codeCart.cart, null, 2), contentType: "application/json" });
  });

  test("checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const inputs = await readLiveInputs();
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${E2E_PRODUCT_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    // The cart right before checkout (theme-dev session) and its plan.
    const cart = await freshCart(page, [E2E_CODE]);
    const expected = expectedFor(cart, inputs);
    expect(cart.discount_codes[0]).toEqual({ code: E2E_CODE, applicable: true });
    expect(cart.total_price, "cart total = planCart").toBe(expected.total);
    expect(expected.lineDiscount).toBeGreaterThan(0);
    expect(expected.orderDiscount).toBeGreaterThan(0);

    let codeCarriedIntoCheckout = true;
    await test.step("open checkout; the price summary equals the cart", async () => {
      await page.goto("/checkout", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#email")).toBeVisible({ timeout: 90_000 });
      expect(new URL(page.url()).pathname).toMatch(/^\/checkouts\//u);
      let rows = await priceSummary(page);
      if (rowAmount(rows, E2E_CODE) === null) {
        // Fact 2: the code stayed in the theme-dev session; enter it where a buyer would.
        codeCarriedIntoCheckout = false;
        const field = page.locator('input[name="reductions"]').first();
        await field.fill(E2E_CODE);
        await page.locator('form:has(input[name="reductions"]) button[type="submit"]').first().click();
        await expect.poll(async () => rowAmount(await priceSummary(page), E2E_CODE), { timeout: 60_000 }).not.toBeNull();
        rows = await priceSummary(page);
      }
      console.log(`[checkout.mvp1] ${THEME_LABEL || "theme"}: code ${codeCarriedIntoCheckout ? "carried from the cart" : "re-entered in checkout"}`);
      expect(await lineDiscountInSummary(page, E2E_AUTO_RULE_NAME), "line discount in checkout = planCart").toBe(-expected.lineDiscount);
      expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(rowAmount(rows, E2E_CODE), "checkout order discount = planCart").toBe(-expected.orderDiscount);
      expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
    });

    await test.step("contact, CZ address, first shipping rate", async () => {
      await page.locator("#email").fill("won-e2e+mvp1@example.com");
      await page.locator('select[name="countryCode"]').selectOption(CHECKOUT_COUNTRY);
      await page.locator('input[name="firstName"]:visible').first().fill("Won");
      await page.locator('input[name="lastName"]:visible').first().fill("Tester");
      await page.locator('input[name="address1"]:visible').first().fill("Václavské náměstí 1");
      await page.locator('input[name="postalCode"]:visible').first().fill("110 00");
      await page.locator('input[name="city"]:visible').first().fill("Praha");
      await page.locator('input[name="city"]:visible').first().press("Tab");
      // Several rates → radios, pick the first; one rate is preselected. Either way the summary gets a shipping amount.
      const radios = page.locator('#shippingMethod ~ * input[type="radio"], input[type="radio"][name^="shipping"]');
      await expect.poll(async () => (await radios.count()) > 0 || rowAmount(await priceSummary(page), SHIPPING) !== null, { timeout: 60_000 }).toBe(true);
      if ((await radios.count()) > 0) await radios.first().check();
      await expect.poll(async () => rowAmount(await priceSummary(page), SHIPPING), { timeout: 60_000 }).not.toBeNull();
    });

    await test.step("pay with the Bogus gateway (card 1)", async () => {
      await fillCardField(page, "number", "number", "1");
      await fillCardField(page, "expiry", "expiry", "1230");
      await fillCardField(page, "verification_value", "verification_value", "111");
      await fillCardField(page, "name", "name", "Bogus Gateway");
      await page.locator("#checkout-pay-button").click();
      await page.waitForURL(/thank[-_]you/u, { timeout: 150_000 });
    });

    const thankYou = await test.step("thank-you page: discounts and total = planCart / cart", async () => {
      const rows = await priceSummary(page);
      const shipping = rowAmount(rows, SHIPPING);
      const tax = rows.filter((r) => TAX.test(r.label)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
      const observed = {
        lineDiscount: await lineDiscountInSummary(page, E2E_AUTO_RULE_NAME),
        subtotal: rowAmount(rows, SUBTOTAL),
        orderDiscount: rowAmount(rows, E2E_CODE),
        shipping,
        tax,
        total: rowAmount(rows, TOTAL),
      };
      expect(observed.lineDiscount, "thank-you line discount = planCart").toBe(-expected.lineDiscount);
      expect(observed.subtotal, "thank-you subtotal = cart items_subtotal_price = planCart").toBe(expected.subtotalAfterLines);
      expect(observed.orderDiscount, "thank-you order discount (WONE2E15) = planCart").toBe(-expected.orderDiscount);
      expect(shipping, "shipping amount").not.toBeNull();
      expect(observed.total, "thank-you total = cart total (= planCart) + shipping + tax").toBe(expected.total + (shipping ?? 0) + tax);
      return { rows, observed };
    });

    await saveScreenshot(page, testInfo, "thankyou-mvp1-1440");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    // On a phone the order summary is collapsed: open it so the screenshot shows the discount lines.
    const toggle = page.getByRole("button", { name: /Shrnutí objednávky|order summary/iu }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(1_000);
    }
    await saveScreenshot(page, testInfo, "thankyou-mvp1-390");

    const evidence = {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      checkoutPath: new URL(page.url()).pathname.replace(/\/cn\/[^/]+/u, "/cn/<token>"),
      codeCarriedIntoCheckout,
      cart: {
        currency: cart.currency,
        original_total_price: cart.original_total_price,
        items_subtotal_price: cart.items_subtotal_price,
        total_price: cart.total_price,
        discount_codes: cart.discount_codes,
      },
      expected: {
        lineDiscount: expected.lineDiscount,
        orderDiscount: expected.orderDiscount,
        subtotalAfterLines: expected.subtotalAfterLines,
        total: expected.total,
        planTotals: expected.plan.totals,
        rules: expected.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount })),
      },
      thankYou: thankYou.observed,
      thankYouSummaryRows: thankYou.rows,
    };
    saveEvidence("checkout-mvp1", evidence);
    await testInfo.attach("checkout-mvp1.json", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });

  test("one buyer session on the real storefront: the code applied in the cart is carried into checkout", async ({ page }, testInfo) => {
    // The production path fact 2 cannot show through theme dev: cart and checkout
    // in ONE session. No payment here (the Bogus order is the test above).
    test.setTimeout(240_000);
    const inputs = await readLiveInputs();
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    expect(new URL(page.url()).origin).toBe(STORE_ORIGIN);

    const cart = await freshCart(page, [E2E_CODE]);
    const expected = expectedFor(cart, inputs);
    try {
      expect(cart.discount_codes[0]).toEqual({ code: E2E_CODE, applicable: true });
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);

      await page.goto(`${STORE_ORIGIN}/checkout`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#email")).toBeVisible({ timeout: 90_000 });
      const rows = await priceSummary(page);
      const observed = {
        lineDiscount: await lineDiscountInSummary(page, E2E_AUTO_RULE_NAME),
        subtotal: rowAmount(rows, SUBTOTAL),
        orderDiscount: rowAmount(rows, E2E_CODE),
        total: rowAmount(rows, TOTAL),
      };
      expect(observed.orderDiscount, "the cart's code is in checkout without re-entering it (= planCart)").toBe(-expected.orderDiscount);
      expect(observed.lineDiscount, "line discount in checkout = planCart").toBe(-expected.lineDiscount);
      expect(observed.subtotal, "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(observed.total, "checkout total before shipping = cart total = planCart").toBe(expected.total);
      saveEvidence("checkout-carry-mvp1", { at: new Date().toISOString(), theme: THEME_LABEL || null, cartTotal: cart.total_price, expected: { lineDiscount: expected.lineDiscount, orderDiscount: expected.orderDiscount, total: expected.total }, observed, rows });
      await testInfo.attach("checkout-carry-mvp1.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    } finally {
      // The real-domain cart: no code, no line (best effort).
      await page.goto(`${STORE_ORIGIN}/`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await storefrontJson(page, "POST", "/cart/update.js", { discount: "" }).catch(() => undefined);
      await storefrontJson(page, "POST", "/cart/clear.js", {}).catch(() => undefined);
    }
  });
});
