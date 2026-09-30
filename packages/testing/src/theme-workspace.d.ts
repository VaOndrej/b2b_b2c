import type { TemplateOverlay, TemplateOverlayResult } from "./template-overlays.d.ts";

export interface ResolveThemeWorkspaceOptions {
  repoRoot: string;
  workspace: string;
  themeKey: string;
}

export function resolveThemeWorkspace(
  options: ResolveThemeWorkspaceOptions,
): string;

export interface ResolveSettingsDataOverlayOptions {
  appRoot: string;
  settingsDataOverlay?: string | null;
}

export function resolveSettingsDataOverlay(
  options: ResolveSettingsDataOverlayOptions,
): string | null;

export interface InspectThemeWorkspaceOptions {
  repoRoot: string;
  appRoot: string;
  workspace: string;
  themeKey: string;
  sourceDirectory: string;
  settingsDataOverlay?: string | null;
  /**
   * Declarative block insertions to apply on top of the theme checkout,
   * e.g. placing an app block into the main product section of
   * templates/product.json. Applied generically across theme checkouts
   * whose main product section type it matches (see
   * MAIN_PRODUCT_SECTION_TYPES in ./template-overlays).
   */
  templateOverlays?: TemplateOverlay[];
}

export interface ThemeWorkspaceInspection {
  canonicalDirectory: string;
  workspaceDirectory: string;
  overlayPath: string | null;
  /** What each templateOverlay would do against the canonical checkout ("--check"-style report). */
  templateOverlayPlans: TemplateOverlayResult[];
}

export function inspectThemeWorkspace(
  options: InspectThemeWorkspaceOptions,
): Promise<ThemeWorkspaceInspection>;

export function prepareThemeWorkspace(
  options: InspectThemeWorkspaceOptions,
): Promise<string>;
