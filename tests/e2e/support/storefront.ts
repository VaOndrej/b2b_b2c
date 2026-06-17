import { expect, test, type Page } from "@playwright/test";

export interface StorefrontProductFixture {
  handle: string;
  productId: string;
  productUrlPath: string;
}

/**
 * Appends `?mg_e2e_segment=B2C` to a storefront path so serial-tier navigations
 * hit the SAME Shopify edge full-page-cache entry the parallel matrix warms
 * (the matrix always navigates decorated URLs). Bare `/products/X` URLs map to a
 * SEPARATE, cold cache entry whose app-proxy `<head>` embed script can block
 * `domcontentloaded` and time out the navigation.
 *
 * For the serial tier the param is a pure cache-key aligner: the override flag
 * is NOT injected there, so the app ignores `mg_e2e_segment` and still resolves
 * the anonymous B2C segment — identical behavior to a bare URL, minus the hang.
 */
export function decorateStorefrontPath(path: string): string {
  const url = new URL(path, "https://placeholder.local");
  if (!url.searchParams.has("mg_e2e_segment")) {
    url.searchParams.set("mg_e2e_segment", "B2C");
  }
  return `${url.pathname}${url.search}`;
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

  if (await isStorefrontVerificationChallenge(page)) {
    test.skip(
      true,
      "Storefront served a bot/connection-verification challenge to the headless browser (environmental, not unlockable by the harness).",
    );
    return;
  }

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

/**
 * Detects a Shopify/Cloudflare bot/connection-verification interstitial
 * ("Your connection needs to be verified before you can proceed") that the dev
 * storefront can serve to a headless browser. It is NOT unlockable by the
 * harness (unlike the storefront password page), so callers should skip-with-
 * reason rather than false-fail — consistent with the suite's environmental
 * skip philosophy.
 */
export async function isStorefrontVerificationChallenge(page: Page): Promise<boolean> {
  const challenge = page
    .getByText(/connection needs to be verified|needs to be verified before you can proceed/i)
    .first();
  return (await challenge.count()) > 0;
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
