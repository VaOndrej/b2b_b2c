import { test as base, expect } from "./test-base.ts";
import { resolveThemeContext, type ThemeContext, type ThemeName } from "./theme.ts";
import type { TestContext } from "./catalog-context.ts";

/**
 * Custom test with `theme` + `context` (+ `audience`) options (set per Playwright
 * project) and a derived `themeContext` fixture. The matrix runs the SAME Tier-1
 * specs across the theme × context grid; each spec asserts the values that match
 * its project's context (`base` = default catalog, `catalog` = the forced e2e
 * catalog). The Dawn project skips gracefully when SHOPIFY_E2E_PREVIEW_THEME_ID is
 * not set; the Horizon project always runs against the live theme.
 */
export interface ThemeOptions {
  theme: ThemeName;
  // NOTE: named `testContext` (not `context`) — `context` is Playwright's built-in
  // BrowserContext fixture and cannot be redefined as a custom option.
  testContext: TestContext;
  /** Audience tag forced via mg_e2e_audience for the `catalog` context (else null). */
  audience: string | null;
}

interface ThemeFixtures {
  themeContext: ThemeContext;
}

export const test = base.extend<ThemeOptions & ThemeFixtures>({
  theme: ["horizon", { option: true }],
  testContext: ["base", { option: true }],
  audience: [null, { option: true }],
  themeContext: async ({ theme, testContext, audience }, use) => {
    const resolved = resolveThemeContext(theme, testContext, audience);
    if (!resolved) {
      test.skip(
        true,
        `Theme project "${theme}" skipped: SHOPIFY_E2E_PREVIEW_THEME_ID is not set.`,
      );
      return;
    }
    await use(resolved);
  },
});

export { expect };
