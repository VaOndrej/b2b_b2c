export interface ThemePathEnvironment {
  SHOPIFY_E2E_THEME_DIR_HORIZON?: string;
  SHOPIFY_E2E_THEME_DIR_DAWN?: string;
}

export interface ResolveThemePathsOptions {
  repoRoot: string;
  env?: ThemePathEnvironment;
}

export interface ThemePaths {
  horizon: string;
  dawn: string;
}

export function resolveThemePaths(
  options: ResolveThemePathsOptions,
): ThemePaths;
