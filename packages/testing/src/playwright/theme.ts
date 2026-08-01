import type { Page } from "@playwright/test";

export type ThemeName = "horizon" | "dawn";

export interface ThemeSelectors {
  addToCartForm: string;
  quantityInput: string;
  addToCartButton: string;
  productCardLink: (handle: string) => string;
  collectionCardLink: (handle: string) => string;
}

const COLLECTION_CARD_SCOPE =
  ":is([data-collection-card], .collection-card, .collection-list__item, .card, .grid__item, article)";

export const SHARED_THEME_SELECTORS: ThemeSelectors = {
  addToCartForm: "form[action*='/cart/add']",
  quantityInput:
    "form[action*='/cart/add'] input[name='quantity']:not([type='hidden'])",
  addToCartButton:
    "form[action*='/cart/add'] button[type='submit'], form[action*='/cart/add'] input[type='submit']",
  productCardLink: (handle) => `a[href*='/products/${handle}']:visible`,
  collectionCardLink: (handle) =>
    `${COLLECTION_CARD_SCOPE} a[href*='/collections/${handle}']:visible`,
};

export const THEME_SELECTORS: Record<ThemeName, ThemeSelectors> = {
  horizon: { ...SHARED_THEME_SELECTORS },
  dawn: { ...SHARED_THEME_SELECTORS },
};

interface ShopifyThemeGlobal {
  id?: number | string;
  name?: string;
  role?: string;
}

export interface ThemeEnvironment {
  [key: string]: string | undefined;
  SHOPIFY_E2E_THEME_DEV?: string;
  SHOPIFY_E2E_PREVIEW_THEME_ID?: string;
  SHOPIFY_E2E_DAWN_THEME_NAME?: string;
  SHOPIFY_E2E_HORIZON_THEME_NAME?: string;
}

export interface CreateThemeContextOptions {
  name: ThemeName;
  env?: ThemeEnvironment;
  decorateUrl?: (url: URL) => void;
}

export interface ThemeContext {
  name: ThemeName;
  previewThemeId: string | null;
  expectedThemeName: string | null;
  selectors: ThemeSelectors;
  decoratePath: (path: string) => string;
  gotoStorefront: (page: Page, path: string) => Promise<void>;
  verifyActiveTheme: (page: Page) => Promise<void>;
}

function readEnv(
  env: ThemeEnvironment,
  name: keyof ThemeEnvironment,
): string | null {
  const value = String(env[name] ?? "").trim();
  return value || null;
}

const verifiedPages = new WeakSet<Page>();

export function createThemeContext({
  name,
  env = process.env,
  decorateUrl,
}: CreateThemeContextOptions): ThemeContext | null {
  const themeDevMode = readEnv(env, "SHOPIFY_E2E_THEME_DEV") !== null;
  const previewThemeId =
    !themeDevMode && name === "dawn"
      ? readEnv(env, "SHOPIFY_E2E_PREVIEW_THEME_ID")
      : null;

  if (!themeDevMode && name === "dawn" && !previewThemeId) {
    return null;
  }

  const expectedThemeName =
    name === "dawn"
      ? readEnv(env, "SHOPIFY_E2E_DAWN_THEME_NAME")
      : readEnv(env, "SHOPIFY_E2E_HORIZON_THEME_NAME");
  const selectors = THEME_SELECTORS[name];

  const decoratePath = (storefrontPath: string): string => {
    const url = new URL(storefrontPath, "https://placeholder.local");
    if (previewThemeId) {
      url.searchParams.set("preview_theme_id", previewThemeId);
    }
    decorateUrl?.(url);
    return `${url.pathname}${url.search}`;
  };

  const verifyActiveTheme = async (page: Page): Promise<void> => {
    if (themeDevMode || verifiedPages.has(page)) {
      return;
    }

    const theme = await page.evaluate(() => {
      const shopify = (
        window as unknown as {
          Shopify?: { theme?: ShopifyThemeGlobal };
        }
      ).Shopify;
      return shopify?.theme ?? null;
    });

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
    } else {
      const dawnPreviewId = readEnv(env, "SHOPIFY_E2E_PREVIEW_THEME_ID");
      if (dawnPreviewId && actualId === dawnPreviewId) {
        throw new Error(
          `THEME MISMATCH (horizon): storefront served the Dawn preview theme id ${actualId} instead of the live theme. Refusing to test the wrong theme.`,
        );
      }
    }

    if (
      expectedThemeName &&
      !actualName.toLowerCase().includes(expectedThemeName.toLowerCase())
    ) {
      throw new Error(
        `THEME MISMATCH (${name}): expected theme name to contain "${expectedThemeName}" but got "${actualName}".`,
      );
    }

    verifiedPages.add(page);
  };

  const gotoStorefront = async (
    page: Page,
    storefrontPath: string,
  ): Promise<void> => {
    await page.goto(decoratePath(storefrontPath), {
      waitUntil: "domcontentloaded",
    });
    await verifyActiveTheme(page);
  };

  return {
    name,
    previewThemeId,
    expectedThemeName,
    selectors,
    decoratePath,
    gotoStorefront,
    verifyActiveTheme,
  };
}
