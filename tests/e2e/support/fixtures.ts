import { test as base, expect } from "@playwright/test";
import { resolveThemeContext, type ThemeContext, type ThemeName } from "./theme.ts";
import type { Segment } from "../../../core/segment/segment.types.ts";

/**
 * Custom test with `theme` + `segment` options (set per Playwright project) and a
 * derived `themeContext` fixture. The matrix runs the SAME Tier-1 specs across the
 * theme × segment grid; each spec asserts the values that match its project's
 * segment. The Dawn project skips gracefully when SHOPIFY_E2E_PREVIEW_THEME_ID is
 * not set; the Horizon project always runs against the live theme.
 */
export interface ThemeOptions {
  theme: ThemeName;
  segment: Segment;
}

interface ThemeFixtures {
  themeContext: ThemeContext;
}

export const test = base.extend<ThemeOptions & ThemeFixtures>({
  theme: ["horizon", { option: true }],
  segment: ["B2C", { option: true }],
  themeContext: async ({ theme, segment }, use) => {
    const context = resolveThemeContext(theme, segment);
    if (!context) {
      test.skip(
        true,
        `Theme project "${theme}" skipped: SHOPIFY_E2E_PREVIEW_THEME_ID is not set.`,
      );
      return;
    }
    await use(context);
  },
});

export { expect };
