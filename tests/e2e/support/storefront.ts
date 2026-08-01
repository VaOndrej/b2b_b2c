import { expect, test, type Page } from "@playwright/test";
import { E2E_CATALOG_AUDIENCE_TAG } from "./catalog-context.ts";

export interface StorefrontProductFixture {
  handle: string;
  productId: string;
  productUrlPath: string;
}

/**
 * Appends `?mg_e2e_audience=<e2e catalog tag>` to a serial-tier storefront path.
 * The serial run arms the gated override (see scripts/run-playwright-e2e.mjs), so
 * this forces the dedicated e2e catalog — the SAME catalog the serial specs seed
 * their per-test rules onto, with zero blast radius on default/b2b. It also keeps
 * navigations on a single Shopify edge cache entry (bare `/products/X` URLs map
 * to a separate cold entry whose `<head>` embed can block `domcontentloaded`).
 */
export function decorateStorefrontPath(path: string): string {
  const url = new URL(path, "https://placeholder.local");
  if (!url.searchParams.has("mg_e2e_audience")) {
    url.searchParams.set("mg_e2e_audience", E2E_CATALOG_AUDIENCE_TAG);
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

const BOT_CHALLENGE_SKIP =
  "Storefront served a bot/connection-verification challenge to the headless browser (environmental, not unlockable by the harness).";

/**
 * Navigates to a storefront path with the goto1 → unlock → goto2 pattern (params
 * must survive the password unlock), but RESILIENT to the intermittent Shopify/
 * Cloudflare bot/connection-verification interstitial: each goto is time-bounded
 * and, if it stalls or the challenge page is detected, the test SKIPS (the
 * documented environmental behavior) instead of hanging to a hard timeout.
 *
 * Returns false when it skipped — callers should `return` on false.
 */
/**
 * Human-like think-time before a navigation. Cloudflare's interstitial here is
 * triggered by request VOLUME from this IP, not by the browser fingerprint (measured
 * 2026-07-10: headless shell, full chromium and real headed Chrome all trip it on the
 * same later tests). Pacing the run — a pause before each navigation — keeps the
 * request rate closer to a person browsing. Opt-in via SHOPIFY_E2E_PACING_MS so CI /
 * remote runs can stay fast; the local theme-dev flow sets a sane default.
 */
async function pace(page: Page): Promise<void> {
  const raw = process.env.SHOPIFY_E2E_PACING_MS;
  const fallback = process.env.SHOPIFY_E2E_THEME_DEV === "1" ? 2_500 : 0;
  const ms = raw != null && raw !== "" ? Number(raw) : fallback;
  if (Number.isFinite(ms) && ms > 0) {
    await page.waitForTimeout(ms);
  }
}

export async function gotoStorefrontOrSkip(
  page: Page,
  path: string,
  storefrontPassword: string | null,
): Promise<boolean> {
  for (let pass = 0; pass < 2; pass++) {
    await pace(page);
    try {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      // Navigation stalled — most often the bot challenge holding the response.
      // Fall through to the challenge check below.
    }
    if (await isStorefrontVerificationChallenge(page)) {
      // Give the managed challenge a chance to clear itself before writing the test off.
      if (!(await waitForVerificationChallengeToClear(page))) {
        test.skip(true, BOT_CHALLENGE_SKIP);
        return false;
      }
    }
    if (pass === 0) {
      await maybeUnlockStorefront(page, storefrontPassword);
      if (await isStorefrontVerificationChallenge(page)) {
        if (!(await waitForVerificationChallengeToClear(page))) {
          test.skip(true, BOT_CHALLENGE_SKIP);
          return false;
        }
      }
    }
  }
  return true;
}

export async function maybeUnlockStorefront(page: Page, storefrontPassword: string | null) {
  // Bounded + tolerant: when the page is stuck on the Cloudflare bot challenge it
  // may never reach domcontentloaded — don't hang here (the challenge check below
  // skips). Public-storefront headless runs are the only place this matters; a
  // theme-dev local origin never serves the challenge.
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});

  if (await isStorefrontVerificationChallenge(page)) {
    if (!(await waitForVerificationChallengeToClear(page))) {
      test.skip(true, BOT_CHALLENGE_SKIP);
      return;
    }
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

/**
 * Cloudflare serves a MANAGED challenge here ("Verifying your connection…", `_cf_chl`
 * markers), which clears itself once its JS runs — the page then navigates on to the
 * real storefront. Skipping the moment the interstitial is seen (the old behavior)
 * threw away tests that would have passed a few seconds later.
 *
 * Waits for it to clear. Returns true if the storefront came through, false if the
 * challenge is still up when the budget runs out (then the caller skips, as before).
 */
export async function waitForVerificationChallengeToClear(
  page: Page,
  timeoutMs = 25_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    if (!(await isStorefrontVerificationChallenge(page))) {
      return true;
    }
  }
  return false;
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
