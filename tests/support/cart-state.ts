import { test, expect, type Page } from "@playwright/test";
import {
  EXPECTED_SHOP,
  assertCartBrowserResponse,
  attachEnvironmentEvidence,
  gotoStorefront,
  type EnvironmentClassification,
} from "./storefront-environment";

export type CartSnapshot = {
  item_count: number;
  items: Array<{ variant_id: number; quantity: number }>;
};

type CartDiagnostic = Record<string, unknown>;
const cartDiagnostics = new WeakMap<Page, CartDiagnostic[]>();

function classifyCartPayload(
  status: number,
  body: string,
): EnvironmentClassification | null {
  if (status === 429) return "ENV_429";
  if (status === 401 || status === 403 || /\bunauthori[sz]ed\b/i.test(body))
    return "ENV_AUTH";
  if (
    status >= 500 ||
    /there was a problem loading this website|something went wrong|render\s*502|please try again in a few minutes/i.test(
      body,
    )
  )
    return "ENV_SHOPIFY_ERROR";
  return null;
}

async function cartApiJson(
  page: Page,
  method: "GET" | "POST",
  url: string,
  label: string,
  data?: Record<string, unknown>,
) {
  const response =
    method === "GET"
      ? await page.request.get(url, { headers: { Accept: "application/json" } })
      : await page.request.post(url, {
          data,
          headers: { Accept: "application/json" },
        });
  const body = await response.text();
  const headers = response.headers();
  const classification = classifyCartPayload(response.status(), body);
  const evidence = {
    at: Date.now(),
    label,
    method,
    url: response.url(),
    status: response.status(),
    retryAfter: headers["retry-after"] ?? null,
    contentType: headers["content-type"] ?? null,
    bodyExcerpt: body.slice(0, 1200),
  };
  cartDiagnostics.get(page)?.push(evidence);
  if (classification) {
    await attachEnvironmentEvidence("cart-environment-evidence", {
      classification,
      ...evidence,
    });
    throw new Error(
      `[${classification}] ${label} ${method} ${response.url()} returned HTTP ${response.status()}` +
        (evidence.retryAfter ? ` (Retry-After: ${evidence.retryAfter})` : ""),
    );
  }
  expect(
    response.ok(),
    `${label} must succeed (HTTP ${response.status()})`,
  ).toBeTruthy();
  expect(
    /(?:json|javascript)/i.test(headers["content-type"] ?? ""),
    `${label} must return a JSON-compatible content type, received ${headers["content-type"] ?? "no content type"}`,
  ).toBeTruthy();
  try {
    return JSON.parse(body) as CartSnapshot;
  } catch {
    throw new Error(`${label} returned invalid JSON: ${body.slice(0, 300)}`);
  }
}

/** Install before navigation: cart:refresh is the runtime's committed batch,
 * whereas the stepper's text and hidden state are deliberately optimistic. */
export async function observeCommittedCart(page: Page) {
  const diagnostics: unknown[] = [];
  cartDiagnostics.set(page, diagnostics);
  page.on("response", (response) => {
    if (/cart(?:\/[^/?]+)?\.js|won-cart\.js/.test(response.url())) {
      const headers = response.headers();
      diagnostics.push({
        at: Date.now(),
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        retryAfter: headers["retry-after"] ?? null,
        contentType: headers["content-type"] ?? null,
      });
    }
  });
  page.on("requestfailed", (request) =>
    diagnostics.push({
      at: Date.now(),
      url: request.url(),
      failure: request.failure(),
    }),
  );
  page.on("pageerror", (error) =>
    diagnostics.push({ at: Date.now(), error: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      diagnostics.push({ at: Date.now(), consoleError: message.text() });
  });
  await page.addInitScript(() => {
    (window as any).__wonTestCartCommits = [];
    document.addEventListener("cart:refresh", (event) => {
      const cart = (event as CustomEvent).detail?.cart;
      if (cart)
        (window as any).__wonTestCartCommits.push({
          at: performance.now(),
          item_count: cart.item_count,
          items: cart.items.map((item: any) => ({
            variant_id: item.variant_id,
            quantity: item.quantity,
          })),
        });
    });
  });
}

/** A fresh browser context usually already has an empty cart. Verify that
 * fact instead of spending a Shopify cart write to clear nothing. If setup
 * finds existing items, clear and reload both runtime and toast baseline. */
export async function openEmptyCart(
  page: Page,
  url: string,
  options: { requireStepper?: boolean } = {},
) {
  const { requireStepper = true } = options;
  await gotoStorefront(page, url);
  expect(
    await page.evaluate(() => (window as any).Shopify?.shop),
    "cart mutations are restricted to the b2b development store",
  ).toBe(EXPECTED_SHOP);
  const initialCart = await getCart(page, "initial cart read");
  expect(
    Number.isInteger(initialCart.item_count),
    "initial cart must report an item count",
  ).toBeTruthy();
  if (initialCart.item_count !== 0) {
    await clearCart(page, "cart setup clear");
    await gotoStorefront(page, url);
  }
  if (!requireStepper) return;
  try {
    await expect(page.locator("[data-won-stepper]").first()).toHaveAttribute(
      "data-won-rendered-qty",
      "0",
    );
  } catch (error) {
    await test.info().attach("cart-initialization-diagnostics", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          network: cartDiagnostics.get(page),
          runtime: await page.evaluate(() => ({
            bound: (window as any).__wonCartBound,
            available: Boolean((window as any).WonCart),
            stepper: document.querySelector("[data-won-stepper]")?.outerHTML,
          })),
        },
        null,
        2,
      ),
    });
    throw error;
  }
}

export async function expectCommittedCart(page: Page, count: number) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const commits = (window as any).__wonTestCartCommits;
          return commits?.length
            ? commits[commits.length - 1].item_count
            : null;
        }),
      {
        message: `Won must announce a committed cart containing ${count} items`,
      },
    )
    .toBe(count);
  const cart = await getCart(
    page,
    `independent cart verification for count ${count}`,
  );
  expect(
    cart.item_count,
    "the real Shopify cart must match the committed UI state",
  ).toBe(count);
  return cart;
}

export async function getCart(page: Page, label = "cart read") {
  return cartApiJson(page, "GET", "/cart.js", label);
}

export async function clearCart(page: Page, label = "cart clear") {
  const cart = await cartApiJson(page, "POST", "/cart/clear.js", label);
  expect(cart.item_count, `${label} must leave an empty cart`).toBe(0);
  return cart;
}

export { assertCartBrowserResponse };

export async function attachCartDiagnostics(page: Page) {
  const network = cartDiagnostics.get(page);
  if (!network || test.info().status === test.info().expectedStatus) return;
  await test.info().attach("cart-request-diagnostics", {
    contentType: "application/json",
    body: JSON.stringify(network, null, 2),
  });
}
