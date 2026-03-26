import { expect, type Page } from "@playwright/test";

export interface StorefrontProductFixture {
  handle: string;
  productId: string;
  productUrlPath: string;
}

function toProductGid(value: unknown): string {
  const numericId = Number(value);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`Storefront product payload did not contain a valid numeric id: ${value}`);
  }
  return `gid://shopify/Product/${numericId}`;
}

export async function maybeUnlockStorefront(page: Page, storefrontPassword: string | null) {
  await page.waitForLoadState("domcontentloaded");

  const passwordInput = page
    .locator("input[type='password'], input[name='password']")
    .first();

  if ((await passwordInput.count()) === 0) {
    return;
  }

  if (!storefrontPassword) {
    throw new Error(
      "Storefront is protected by a password page. Set SHOPIFY_E2E_STOREFRONT_PASSWORD to allow Playwright smoke tests through.",
    );
  }

  await passwordInput.fill(storefrontPassword);

  const submitButton = page
    .locator("button[type='submit'], input[type='submit']")
    .first();

  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    submitButton.click(),
  ]);
}

function extractHandleFromPathname(pathname: string): string | null {
  const match = String(pathname || "").match(/\/products\/([^/?#]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]).trim() : null;
}

export async function resolveCurrentProductFixtureFromPage(page: Page): Promise<StorefrontProductFixture> {
  const payload = await page.evaluate(() => {
    const globalMeta = (
      window as Window & {
        meta?: {
          product?: {
            handle?: unknown;
            id?: unknown;
          };
        };
      }
    ).meta;
    return {
      handle: String(globalMeta?.product?.handle ?? "").trim(),
      productId: globalMeta?.product?.id ?? null,
      pathname: window.location.pathname,
    };
  });

  const handle = String(payload.handle ?? "").trim() || extractHandleFromPathname(payload.pathname);
  if (!handle) {
    throw new Error("Current storefront page did not expose a product handle via window.meta or URL pathname.");
  }

  let productId = payload.productId;
  if (productId == null) {
    const productJson = await page.evaluate(async (currentHandle) => {
      const response = await fetch(`/products/${encodeURIComponent(currentHandle)}.js`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        return null;
      }
      return response.json();
    }, handle);
    productId = productJson?.id ?? null;
  }

  if (productId == null) {
    throw new Error(`Unable to resolve storefront product id for handle ${handle}.`);
  }

  return {
    handle,
    productId: toProductGid(productId),
    productUrlPath: String(payload.pathname || `/products/${handle}`),
  };
}

export async function waitForMarginGuardBootstrap(page: Page) {
  await expect(
    page.locator("script[data-margin-guard-visibility-script]"),
  ).toHaveCount(1);

  const response = await page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/apps/margin-guard/visibility?") &&
      candidate.request().method() === "GET",
    {
      timeout: 15_000,
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Margin Guard visibility bootstrap returned HTTP ${response.status()} from ${response.url()}.`,
    );
  }

  return response;
}
