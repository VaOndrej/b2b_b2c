import { createStorefrontTest, expect } from "@won/testing/playwright";
import { WON_E2E_PRODUCTS } from "@won/testing/e2e-products";
import type { Locator, Page, Response } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Roles for this app's quantity scenarios, mapped onto the SHARED E2E product
// catalog. Every app reuses these products; we never create app-specific ones.
export const QUANTITY_E2E_HANDLES = {
  default: WON_E2E_PRODUCTS.simpleA.handle,
  step: WON_E2E_PRODUCTS.twoVariants.handle,
  maximum: WON_E2E_PRODUCTS.simpleB.handle,
} as const;

interface AppDiagnostics {
  responses: Array<{ status: number; url: string }>;
}

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function storefrontPassword(): string | null {
  const fromProcess = String(
    process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD ?? "",
  ).trim();
  if (fromProcess) return fromProcess;
  const dotenvPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(dotenvPath)) return null;
  return (
    parseDotenv(
      readFileSync(dotenvPath, "utf8"),
    ).SHOPIFY_E2E_STOREFRONT_PASSWORD?.trim() || null
  );
}

function isAppRequest(url: string): boolean {
  return (
    url.includes("/apps/won-quantity/") ||
    /won-quantity\.(?:js|css)(?:\?|$)/u.test(url)
  );
}

const base = createStorefrontTest();

export const test = base.extend<{ appDiagnostics: AppDiagnostics }>({
  appDiagnostics: async ({ page }, use) => {
    const responses: AppDiagnostics["responses"] = [];
    const failedRequests: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on("response", (response) => {
      if (isAppRequest(response.url())) {
        responses.push({ status: response.status(), url: response.url() });
      }
    });
    page.on("requestfailed", (request) => {
      if (isAppRequest(request.url())) {
        failedRequests.push(
          `${request.url()} — ${request.failure()?.errorText ?? "unknown failure"}`,
        );
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /won.?quantity/iu.test(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });

    await use({ responses });

    expect.soft(failedRequests, "failed Won Quantity requests").toEqual([]);
    expect.soft(pageErrors, "page exceptions").toEqual([]);
    expect.soft(consoleErrors, "Won Quantity console errors").toEqual([]);
    expect
      .soft(
        responses.filter((response) => response.status >= 400),
        "Won Quantity HTTP errors",
      )
      .toEqual([]);
  },
});

export async function openProduct(page: Page, handle: string): Promise<void> {
  const pathName = `/products/${encodeURIComponent(handle)}`;
  const response = await page.goto(pathName, {
    waitUntil: "domcontentloaded",
  });
  if (!response) {
    throw new Error(`No storefront response for ${pathName}.`);
  }

  const passwordInput = page.locator(
    "input[type='password'], input[name='password']",
  );
  if ((await passwordInput.count()) > 0) {
    const password = storefrontPassword();
    if (!password) {
      throw new Error(
        "Storefront password page detected. Set SHOPIFY_E2E_STOREFRONT_PASSWORD.",
      );
    }
    await passwordInput.first().fill(password);
    const submit = page.locator("button[type='submit'], input[type='submit']");
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      submit.first().click(),
    ]);
    await page.goto(pathName, { waitUntil: "domcontentloaded" });
  }

  await expect(page).toHaveURL(
    new RegExp(`/products/${handle}(?:[?#]|$)`, "u"),
  );
  await expect(page.locator("[data-won-quantity-embed]")).toHaveCount(1);
}

export async function readyQuantityInput(page: Page): Promise<Locator> {
  // Target the input the embed has finished enhancing, via its own readiness
  // marker. This is theme-agnostic — Dawn wraps the quantity input in a classic
  // <form action="/cart/add">, while Horizon uses a <product-form> web component
  // whose /cart/add form only settles after hydration. The embed sets
  // data-won-quantity-status="ready" once it owns the input in either theme, so
  // waiting on that marker rides out Horizon's timing instead of racing the
  // form-scoped selector the previous version used.
  const input = page
    .locator(
      "input[name='quantity'][data-won-quantity-status='ready']:not([type='hidden'])",
    )
    .first();
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("data-won-quantity-ready", "");
  return input;
}

export function responseMatches(response: Response, pathName: string): boolean {
  return (
    new URL(response.url()).pathname.includes(pathName) &&
    response.request().method() === "POST"
  );
}

export async function clearCart(page: Page): Promise<void> {
  // Use the request context (baseURL-aware) so this works even before the page
  // has navigated — an in-page `fetch("/cart/clear.js")` on about:blank has no
  // origin to resolve the relative URL against.
  const response = await page.request.post("/cart/clear.js", {
    headers: { Accept: "application/json" },
  });
  expect(response.status()).toBeLessThan(400);
}

export function quantityForm(input: Locator): Locator {
  // The /cart/add form that actually contains this resolved quantity input.
  // Filtering `form[action*='/cart/add']` by the absolute `input` locator would
  // require a nested cart form (0 matches), so walk up to the input's nearest
  // /cart/add ancestor form instead.
  return input.locator(
    "xpath=ancestor::form[contains(@action, '/cart/add')][1]",
  );
}

export async function assertAppTransport(
  page: Page,
  diagnostics: AppDiagnostics,
): Promise<void> {
  await expect(page.locator("script[src*='won-quantity.js']")).toHaveCount(1);
  await expect(page.locator("[data-won-quantity-embed] form")).toHaveCount(0);
  expect(
    diagnostics.responses.some(
      (response) =>
        new URL(response.url).pathname.includes("/apps/won-quantity/config") &&
        response.status === 200,
    ),
  ).toBe(true);
}

export async function selectSecondVariant(page: Page): Promise<void> {
  const picker = page
    .locator("main variant-picker, main variant-selects")
    .first();
  await expect(picker).toHaveCount(1);

  const selects = picker.locator("select[name^='options[']:visible");
  if ((await selects.count()) > 0) {
    const select = selects.first();
    const options = select.locator("option:not([disabled])");
    if ((await options.count()) < 2) {
      throw new Error("Variant test product exposes fewer than two options.");
    }
    await select.selectOption({ index: 1 });
    return;
  }

  const radios = picker.locator("input[type='radio']");
  const radioCount = await radios.count();
  if (radioCount < 2) {
    throw new Error(
      "No second variant control is visible on the product page.",
    );
  }
  const second = radios.nth(1);
  const id = await second.getAttribute("id");
  if (id) {
    const label = page.locator(`label[for="${id}"]`);
    if ((await label.count()) === 1) {
      await label.click();
      return;
    }
  }
  const wrappingLabel = picker.locator("label").filter({ has: second });
  if ((await wrappingLabel.count()) === 1) {
    await wrappingLabel.click();
    return;
  }
  await second.check({ force: true });
}

export { expect };
