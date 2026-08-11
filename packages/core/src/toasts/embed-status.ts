// MVP6 — onboarding & activation helpers. Framework-free so both the admin
// loader and its unit tests use the same pure logic. Solves our own
// "installed but not showing" footgun: the app embed must be enabled in the
// merchant's theme before anything renders on the storefront.

export type EmbedStatus = "enabled" | "disabled" | "unknown";

function safeParse(value: string): unknown {
  try {
    let s = value.trim();
    // Shopify's settings_data.json begins with a `/* … */` banner comment,
    // which is not valid JSON — strip it before parsing.
    if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      if (end >= 0) s = s.slice(end + 2).trim();
    }
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Determine whether our app embed block is present and enabled in a theme's
 * `settings_data.json`. Shopify stores app embeds under `current.blocks`, keyed
 * by a random id, each with a `type` like
 * `shopify://apps/<app>/blocks/<blockHandle>/<extensionUuid>` and an optional
 * `disabled` flag.
 *
 * - block present, `disabled !== true` → `"enabled"`
 * - block present, `disabled === true` → `"disabled"`
 * - block absent / unparseable input  → `"unknown"`
 */
export function parseEmbedStatus(
  settingsData: unknown,
  blockHandle: string,
): EmbedStatus {
  const data =
    typeof settingsData === "string" ? safeParse(settingsData) : settingsData;

  const blocks = (data as { current?: { blocks?: unknown } } | null)?.current
    ?.blocks;
  if (!blocks || typeof blocks !== "object") return "unknown";

  for (const block of Object.values(blocks as Record<string, unknown>)) {
    const type = (block as { type?: unknown }).type;
    if (typeof type !== "string") continue;
    if (!type.split("/").includes(blockHandle)) continue;
    const disabled = (block as { disabled?: unknown }).disabled;
    return disabled === true ? "disabled" : "enabled";
  }
  return "unknown";
}

/**
 * Pull the theme app extension UUID out of a settings_data block whose `type`
 * looks like `shopify://apps/<app>/blocks/<blockHandle>/<UUID>`. The UUID is the
 * segment right after the block handle — exactly what the theme-editor deep link
 * needs, so we never hardcode a (per-environment) guess. Returns null if the
 * block isn't present.
 */
export function extractEmbedExtensionUuid(
  settingsData: unknown,
  blockHandle: string,
): string | null {
  const data =
    typeof settingsData === "string" ? safeParse(settingsData) : settingsData;
  const blocks = (data as { current?: { blocks?: unknown } } | null)?.current
    ?.blocks;
  if (!blocks || typeof blocks !== "object") return null;

  for (const block of Object.values(blocks as Record<string, unknown>)) {
    const type = (block as { type?: unknown }).type;
    if (typeof type !== "string") continue;
    const segments = type.split("/");
    const idx = segments.indexOf(blockHandle);
    if (idx >= 0 && idx + 1 < segments.length && segments[idx + 1]) {
      return segments[idx + 1];
    }
  }
  return null;
}

/** One theme's settings as seen by {@link resolveEmbedState}. */
export interface ThemeSettingsInput {
  /** Theme role (MAIN, UNPUBLISHED, DEVELOPMENT, DEMO, …); case-insensitive. */
  role: string;
  /**
   * Contents of the theme's `config/settings_data.json`, or `null` when it
   * couldn't be read — e.g. a locked/purchased/foreign theme whose source
   * Shopify protects (ACCESS_DENIED) regardless of the `read_themes` scope.
   * Such themes are tolerated and skipped instead of aborting the whole scan.
   */
  settings: string | null;
}

/** Resolved embed picture across a shop's themes. */
export interface EmbedState {
  /** Status on the live (MAIN) theme — the authoritative one for "are we live?". */
  embedStatus: EmbedStatus;
  /** Extension UUID for the deep link, discovered on any readable theme (MAIN preferred). */
  embedUuid: string | null;
  /** Embed enabled on a non-live theme but not on the live one. */
  embedOnDraft: boolean;
}

/**
 * Fold a list of (readable-or-not) themes into the embed picture, tolerating
 * any theme whose `settings` is `null`. This is the robustness core: a single
 * unreadable theme (locked/demo/foreign) must never hide the live theme's real
 * status. The loader reads each theme's settings in isolation (so one denial
 * can't throw the batch) and hands the results here.
 */
export function resolveEmbedState(
  themes: readonly ThemeSettingsInput[],
  blockHandle: string,
): EmbedState {
  let embedStatus: EmbedStatus = "unknown";
  let embedUuid: string | null = null;
  let embedOnDraft = false;

  for (const theme of themes) {
    if (theme.settings == null) continue; // unreadable → tolerate & skip
    const isMain = theme.role.toUpperCase() === "MAIN";
    const status = parseEmbedStatus(theme.settings, blockHandle);
    if (isMain) embedStatus = status;
    if (status !== "unknown") {
      const uuid = extractEmbedExtensionUuid(theme.settings, blockHandle);
      // Prefer the live theme's UUID; otherwise take the first one we find.
      if (uuid && (isMain || embedUuid === null)) embedUuid = uuid;
      if (!isMain) embedOnDraft = true;
    }
  }

  return { embedStatus, embedUuid, embedOnDraft };
}

/**
 * Deep link straight to the theme editor with our app embed activated, so the
 * merchant flips it on in one click.
 */
export function buildEmbedDeepLink(opts: {
  shop: string;
  extensionUuid: string;
  blockHandle: string;
  template?: string;
}): string {
  const template = opts.template ?? "index";
  return `https://${opts.shop}/admin/themes/current/editor?context=apps&template=${template}&activateAppId=${opts.extensionUuid}/${opts.blockHandle}`;
}

/**
 * Empty-store (cold-start) detection: a brand-new shop with no orders should be
 * steered toward cold-start-safe notification types, not social proof.
 */
export function isEmptyStore(ordersCount: number): boolean {
  return ordersCount === 0;
}
