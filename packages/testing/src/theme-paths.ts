import path from "node:path";

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

function resolveOverride(
  repoRoot: string,
  configuredValue: string | undefined,
  fallback: string,
): string {
  const configured = String(configuredValue ?? "").trim();
  if (!configured) {
    return fallback;
  }
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(repoRoot, configured);
}

export function resolveThemePaths({
  repoRoot,
  env = process.env,
}: ResolveThemePathsOptions): ThemePaths {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const themesRoot = path.resolve(
    normalizedRepoRoot,
    "..",
    "b2b_b2c_themes",
  );

  return {
    horizon: resolveOverride(
      normalizedRepoRoot,
      env.SHOPIFY_E2E_THEME_DIR_HORIZON,
      path.join(themesRoot, "Horizon"),
    ),
    dawn: resolveOverride(
      normalizedRepoRoot,
      env.SHOPIFY_E2E_THEME_DIR_DAWN,
      path.join(themesRoot, "Dawn"),
    ),
  };
}
