import { existsSync, readFileSync } from "node:fs";
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
  const adjacentThemesRoot = path.resolve(
    normalizedRepoRoot,
    "..",
    "b2b_b2c_themes",
  );
  let themesRoot = adjacentThemesRoot;

  if (!existsSync(adjacentThemesRoot)) {
    const dotGitPath = path.join(normalizedRepoRoot, ".git");
    try {
      const gitFile = readFileSync(dotGitPath, "utf8");
      const gitDirectoryValue = gitFile.match(/^gitdir:\s*(.+)$/mu)?.[1];
      if (gitDirectoryValue) {
        const gitDirectory = path.resolve(
          normalizedRepoRoot,
          gitDirectoryValue,
        );
        const worktreeMarker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const markerIndex = gitDirectory.indexOf(worktreeMarker);
        if (markerIndex >= 0) {
          const primaryCheckout = gitDirectory.slice(0, markerIndex);
          const linkedThemesRoot = path.resolve(
            primaryCheckout,
            "..",
            "b2b_b2c_themes",
          );
          if (existsSync(linkedThemesRoot)) {
            themesRoot = linkedThemesRoot;
          }
        }
      }
    } catch {
      // A normal checkout has a .git directory, not a gitdir pointer file.
    }
  }

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
