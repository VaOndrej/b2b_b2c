import path from "node:path";

function resolveOverride(repoRoot, configuredValue, fallback) {
  const configured = String(configuredValue ?? "").trim();
  if (!configured) {
    return fallback;
  }
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(repoRoot, configured);
}

export function resolveThemePaths({ repoRoot, env = process.env }) {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const themesRoot = path.resolve(normalizedRepoRoot, "..", "b2b_b2c_themes");

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
