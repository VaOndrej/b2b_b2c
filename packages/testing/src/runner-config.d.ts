import type { TemplateOverlay } from "./template-overlays.js";

export const THEME_KEYS: readonly ["horizon", "dawn"];
export type ThemeKey = (typeof THEME_KEYS)[number];
export interface AppE2EConfig {
  appName: string;
  shopDomain: string;
  appProxyProbe: { path: string; bodyMarker: string };
  testCommand: [string, ...string[]];
  themes: Record<
    ThemeKey,
    {
      remoteName: string;
      preferredPort: number;
      /** Whole settings_data.json that replaces the theme copy's (relative to the app). */
      settingsDataOverlay?: string;
      /** App blocks inserted into the theme copy's templates (template-overlays.js). */
      templateOverlays?: TemplateOverlay[];
    }
  >;
  environment?: Record<string, string>;
  appStartHint?: string;
}
export interface RunnerOptions {
  configPath: string | null;
  only: ThemeKey | null;
  bail: boolean;
  skipAppCheck: boolean;
  verbose: boolean;
  dryRun: boolean;
  help: boolean;
  timeoutMs: number;
}
export function validateRunnerConfig(value: unknown): AppE2EConfig;
export function parseRunnerArgs(argv: string[]): RunnerOptions;
export function validateThemeCheckout(label: string, directory: string): string;
export function resolveConfiguredPort(
  label: string,
  environmentKey: string,
  environment: Record<string, string | undefined>,
  fallback: number,
): number;
