import { chromium, type Browser } from "@playwright/test";
import { maybeUnlockStorefront } from "./storefront.ts";
import { resolveShopifyE2ERuntimeConfig } from "./runtime.ts";
import { E2E_CATALOG_AUDIENCE_TAG } from "./catalog-context.ts";

/**
 * Primes the dev tunnel / app proxy with ONE real browser navigation per theme
 * BEFORE the parallel/serial workers start.
 *
 * Why: the Margin Guard embed is a no-`defer` <head> script (intentional, for
 * zero-flash hiding). When `/apps/margin-guard/visibility-script` loads slowly
 * over a freshly-(re)started dev tunnel (cold start), it blocks HTML parsing, so
 * every first `page.goto(..., { waitUntil: "domcontentloaded" })` times out. A
 * single warm-up absorbs that cold-start once so the suite runs warm and
 * deterministically; in a stable (CI / deployed) environment it is a fast no-op.
 *
 * Best-effort: any failure here is swallowed — the specs still run (and would
 * surface a genuinely-unreachable storefront themselves).
 */
export async function warmStorefrontTunnel(productHandle?: string): Promise<void> {
  const config = resolveShopifyE2ERuntimeConfig();
  const handle = productHandle ?? "the-videographer-snowboard";
  const previewThemeId = String(
    process.env.SHOPIFY_E2E_PREVIEW_THEME_ID ?? "",
  ).trim();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ baseURL: config.storefrontBaseUrl });
    const prime = async (path: string) => {
      // Generous timeout: the FIRST navigation pays the whole cold-start cost.
      await page
        .goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 })
        .catch(() => {});
    };

    const audience = `mg_e2e_audience=${E2E_CATALOG_AUDIENCE_TAG}`;
    await prime(`/products/${handle}?${audience}`);
    await maybeUnlockStorefront(page, config.storefrontPassword).catch(() => {});
    await prime(`/products/${handle}?${audience}`);
    // Also warm the base context (no override) the `base` matrix projects use.
    await prime(`/products/${handle}`);
    if (previewThemeId) {
      await prime(
        `/products/${handle}?preview_theme_id=${previewThemeId}&${audience}`,
      );
    }
    // Let the no-defer head embed script actually fetch the proxy script so the
    // dev server has JIT-compiled the visibility-script route.
    await page.waitForTimeout(1_500);
  } catch {
    /* best-effort warm-up */
  } finally {
    await browser?.close();
  }
}
