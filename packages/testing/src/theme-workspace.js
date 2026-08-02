import { copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { validateThemeCheckout } from "./runner-config.js";

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function requireSafeSegment(value, label) {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(value)) {
    throw new Error(`${label} is not a safe workspace segment: ${value}`);
  }
}

export function resolveThemeWorkspace({ repoRoot, workspace, themeKey }) {
  requireSafeSegment(workspace, "workspace");
  requireSafeSegment(themeKey, "themeKey");
  const baseDirectory = path.resolve(repoRoot, "tmp/e2e-themes");
  const workspaceDirectory = path.resolve(baseDirectory, workspace, themeKey);
  if (!isWithin(baseDirectory, workspaceDirectory)) {
    throw new Error(`Refusing unsafe theme workspace: ${workspaceDirectory}`);
  }
  return workspaceDirectory;
}

export function resolveSettingsDataOverlay({ appRoot, settingsDataOverlay }) {
  if (!settingsDataOverlay) {
    return null;
  }
  if (path.isAbsolute(settingsDataOverlay)) {
    throw new Error(
      "settingsDataOverlay must be relative to the app workspace.",
    );
  }
  const normalizedAppRoot = path.resolve(appRoot);
  const overlayPath = path.resolve(normalizedAppRoot, settingsDataOverlay);
  if (!isWithin(normalizedAppRoot, overlayPath)) {
    throw new Error(
      `settingsDataOverlay escapes the app workspace: ${settingsDataOverlay}`,
    );
  }
  return overlayPath;
}

async function validateSettingsDataOverlay(overlayPath) {
  if (!overlayPath) {
    return;
  }
  let parsed;
  try {
    const content = await readFile(overlayPath, "utf8");
    const withoutGeneratedHeader = content.replace(
      /^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/u,
      "",
    );
    parsed = JSON.parse(withoutGeneratedHeader);
  } catch (error) {
    throw new Error(
      `Invalid or missing settings_data overlay ${overlayPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !parsed.current ||
    typeof parsed.current !== "object" ||
    Array.isArray(parsed.current)
  ) {
    throw new Error(
      `settings_data overlay must contain an object-valued current key: ${overlayPath}`,
    );
  }
}

export async function inspectThemeWorkspace({
  repoRoot,
  appRoot,
  workspace,
  themeKey,
  sourceDirectory,
  settingsDataOverlay,
}) {
  const canonicalDirectory = validateThemeCheckout(themeKey, sourceDirectory);
  const workspaceDirectory = resolveThemeWorkspace({
    repoRoot,
    workspace,
    themeKey,
  });
  const overlayPath = resolveSettingsDataOverlay({
    appRoot,
    settingsDataOverlay,
  });
  await validateSettingsDataOverlay(overlayPath);
  return { canonicalDirectory, workspaceDirectory, overlayPath };
}

export async function prepareThemeWorkspace(options) {
  const { canonicalDirectory, workspaceDirectory, overlayPath } =
    await inspectThemeWorkspace(options);

  await rm(workspaceDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(workspaceDirectory), { recursive: true });
  await cp(canonicalDirectory, workspaceDirectory, {
    recursive: true,
    filter(source) {
      const name = path.basename(source);
      return name !== ".git" && name !== "node_modules";
    },
  });
  if (overlayPath) {
    await copyFile(
      overlayPath,
      path.join(workspaceDirectory, "config/settings_data.json"),
    );
  }
  return validateThemeCheckout(options.themeKey, workspaceDirectory);
}
