import { type Page } from "@playwright/test";
import type { TestContext } from "./catalog-context.ts";

/**
 * Per-theme abstraction so the SAME Tier-1 storefront specs run unchanged on
 * both the live Horizon theme and the unpublished Dawn theme (via
 * `?preview_theme_id=`). Theme-rendered selectors live here; the Margin Guard
 * markers (`#margin-guard-*`) are app-injected and theme-independent, so they
 * stay as shared constants in the specs.
 *
 * Both the theme AND the test context are chosen by the Playwright PROJECT
 * (`use: { theme, context, audience }`), never by the spec — see
 * playwright.matrix.config.ts. For the `catalog` context the forced audience tag
 * rides every navigation as `?mg_e2e_audience=` (alongside the Dawn
 * `preview_theme_id`), which the gated app-proxy override turns into the matched
 * catalog so its effects render without a real browser login. The `base` context
 * sends no override and resolves to the default catalog.
 */

export type ThemeName = "horizon" | "dawn";

export interface ThemeSelectors {
  /** PDP add-to-cart form (anchor for quantity + submit). */
  addToCartForm: string;
  /** Visible (non-hidden) quantity input inside the add-to-cart form. */
  quantityInput: string;
  /** Add-to-cart submit control. */
  addToCartButton: string;
  /** Visible product-card link for a handle, used on listing pages. */
  productCardLink: (handle: string) => string;
  /** Visible collection-card link for a handle, scoped to card containers. */
  collectionCardLink: (handle: string) => string;
}

// Card containers only — must NOT match header/footer menu anchors (those stay
// visible by design and would cause false failures on collection hiding).
const COLLECTION_CARD_SCOPE =
  ":is([data-collection-card], .collection-card, .collection-list__item, .card, .grid__item, article)";

const SHARED_SELECTORS: ThemeSelectors = {
  addToCartForm: "form[action*='/cart/add']",
  quantityInput:
    "form[action*='/cart/add'] input[name='quantity']:not([type='hidden'])",
  addToCartButton:
    "form[action*='/cart/add'] button[type='submit'], form[action*='/cart/add'] input[type='submit']",
  productCardLink: (handle) => `a[href*='/products/${handle}']:visible`,
  collectionCardLink: (handle) =>
    `${COLLECTION_CARD_SCOPE} a[href*='/collections/${handle}']:visible`,
};

// Per-theme overrides. Both default to the shared selectors; override only the
// entries that genuinely differ on a theme so the matrix passes everywhere.
const THEME_SELECTORS: Record<ThemeName, ThemeSelectors> = {
  horizon: {
    ...SHARED_SELECTORS,
    // Horizon renders the quantity control as a web component but still exposes
    // an input[name=quantity]; keep the shared selector unless this changes.
  },
  dawn: {
    ...SHARED_SELECTORS,
  },
};

interface ShopifyThemeGlobal {
  id?: number | string;
  name?: string;
  role?: string;
}

export interface ThemeContext {
  name: ThemeName;
  /** Test context for this project: `base` (default catalog) or `catalog` (forced). */
  context: TestContext;
  /** Audience tag forced via mg_e2e_audience for the `catalog` context (else null). */
  audience: string | null;
  previewThemeId: string | null;
  expectedThemeName: string | null;
  selectors: ThemeSelectors;
  /**
   * Builds a storefront path carrying the Dawn `preview_theme_id` (when set) and,
   * for the `catalog` context, the `mg_e2e_audience` forced-audience param.
   */
  decoratePath: (path: string) => string;
  /** Navigates to a storefront path under this theme and verifies it once. */
  gotoStorefront: (page: Page, path: string) => Promise<void>;
  /** Reads window.Shopify.theme and fails LOUDLY on a theme mismatch. */
  verifyActiveTheme: (page: Page) => Promise<void>;
}

function readEnv(name: string): string | null {
  const value = String(process.env[name] ?? "").trim();
  return value || null;
}

// Pages already theme-verified, so we only assert once (the first real
// storefront load, after any password unlock).
const verifiedPages = new WeakSet<Page>();

export function resolveThemeContext(
  name: ThemeName,
  context: TestContext,
  audience: string | null,
): ThemeContext | null {
  // Theme-dev mode (SHOPIFY_E2E_THEME_DEV set by scripts/test-e2e-local.mjs): the
  // storefront is a local `shopify theme dev` origin serving exactly ONE theme — the
  // one its checkout runs from. The suite is theme-agnostic (shared selectors,
  // app-proxy / app-injected assertions), so there is no theme dimension to pin:
  // preview_theme_id (a remote mechanism) is not sent and the theme guard is off
  // (you watch which `shopify theme dev` you started).
  const themeDevMode = readEnv("SHOPIFY_E2E_THEME_DEV") !== null;

  const previewThemeId =
    !themeDevMode && name === "dawn"
      ? readEnv("SHOPIFY_E2E_PREVIEW_THEME_ID")
      : null;

  // Remote mode only: Dawn requires a preview theme id; without it the project is
  // skipped. In theme-dev mode the served theme is chosen by which `shopify theme
  // dev` runs, so Dawn never self-skips here.
  if (!themeDevMode && name === "dawn" && !previewThemeId) {
    return null;
  }

  const expectedThemeName =
    name === "dawn"
      ? readEnv("SHOPIFY_E2E_DAWN_THEME_NAME")
      : readEnv("SHOPIFY_E2E_HORIZON_THEME_NAME");

  const selectors = THEME_SELECTORS[name];

  const decoratePath = (path: string): string => {
    const url = new URL(path, "https://placeholder.local");
    if (previewThemeId) {
      url.searchParams.set("preview_theme_id", previewThemeId);
    }
    // Forced audience for the gated app-proxy override (catalog context only).
    // Harmless when the override flag is not armed (the app simply ignores it).
    // The base context sends nothing: anonymous → default catalog naturally.
    if (context === "catalog" && audience) {
      url.searchParams.set("mg_e2e_audience", audience);
    }
    return `${url.pathname}${url.search}`;
  };

  const verifyActiveTheme = async (page: Page): Promise<void> => {
    // Theme-dev origin serves a single theme chosen by the operator — there is no
    // theme dimension to verify against, so the guard is a no-op here.
    if (themeDevMode) {
      return;
    }
    if (verifiedPages.has(page)) {
      return;
    }
    const theme = await page.evaluate(() => {
      const shopify = (window as unknown as { Shopify?: { theme?: ShopifyThemeGlobal } })
        .Shopify;
      return shopify?.theme ?? null;
    });

    // No Shopify.theme yet (e.g. password page) → defer to the next navigation.
    if (!theme) {
      return;
    }

    const actualId = String(theme.id ?? "");
    const actualName = String(theme.name ?? "");
    const actualRole = String(theme.role ?? "");

    if (name === "dawn") {
      if (previewThemeId && actualId !== previewThemeId) {
        throw new Error(
          `THEME MISMATCH (dawn): expected preview theme id ${previewThemeId} but storefront served theme id ${actualId} (name="${actualName}", role="${actualRole}"). Refusing to test the wrong theme.`,
        );
      }
      if (expectedThemeName && !actualName.toLowerCase().includes(expectedThemeName.toLowerCase())) {
        throw new Error(
          `THEME MISMATCH (dawn): expected theme name to contain "${expectedThemeName}" but got "${actualName}".`,
        );
      }
    } else {
      // Horizon = live theme. It must NOT be the preview theme.
      const dawnPreviewId = readEnv("SHOPIFY_E2E_PREVIEW_THEME_ID");
      if (dawnPreviewId && actualId === dawnPreviewId) {
        throw new Error(
          `THEME MISMATCH (horizon): storefront served the Dawn preview theme id ${actualId} instead of the live theme. Refusing to test the wrong theme.`,
        );
      }
      if (expectedThemeName && !actualName.toLowerCase().includes(expectedThemeName.toLowerCase())) {
        throw new Error(
          `THEME MISMATCH (horizon): expected theme name to contain "${expectedThemeName}" but got "${actualName}".`,
        );
      }
    }

    verifiedPages.add(page);
  };

  const gotoStorefront = async (page: Page, path: string): Promise<void> => {
    await page.goto(decoratePath(path), { waitUntil: "domcontentloaded" });
    await verifyActiveTheme(page);
  };

  return {
    name,
    context,
    audience,
    previewThemeId,
    expectedThemeName,
    selectors,
    decoratePath,
    gotoStorefront,
    verifyActiveTheme,
  };
}
