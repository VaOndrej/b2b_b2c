import {
  createThemeContext,
  type ThemeContext as SharedThemeContext,
  type ThemeName,
  type ThemeSelectors,
} from "@won/testing/playwright";

import type { TestContext } from "./catalog-context.ts";

/**
 * Margin Guard's thin adapter around the app-agnostic Horizon/Dawn context.
 * Generic selectors and theme guards live in @won/testing; only the catalog
 * audience override remains app-owned here.
 */
export interface ThemeContext extends SharedThemeContext {
  context: TestContext;
  audience: string | null;
}

export type { ThemeName, ThemeSelectors };

export function resolveThemeContext(
  name: ThemeName,
  context: TestContext,
  audience: string | null,
): ThemeContext | null {
  const sharedContext = createThemeContext({
    name,
    decorateUrl: (url) => {
      if (context === "catalog" && audience) {
        url.searchParams.set("mg_e2e_audience", audience);
      }
    },
  });

  return sharedContext
    ? {
        ...sharedContext,
        context,
        audience,
      }
    : null;
}
