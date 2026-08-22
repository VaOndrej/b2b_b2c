// State-at-rest summaries (doctrine §17): the one-line, human-readable answer to
// "what is this section set to right now?", rendered in every section header so a
// merchant reads the current configuration without opening anything (§11d).
//
// These live in the engine, not in a route, for the same reason the Effect Proof
// arithmetic does (§10b / DATA-4): if each admin screen composed its own string,
// the next Won app would rewrite them and the summaries would drift from the
// behaviour they claim to describe. Pure functions — no DOM, no framework — so
// they are covered by `npm run test:packages`.
//
// Copy rules: never emit a raw enum key (§4c), never emit a raw millisecond
// count (§4 — human units), and never claim something the config doesn't say.

import type {
  GlobalSettings,
  ToastAppConfig,
  ToastPosition,
  ToastSemanticType,
  ToastTheme,
  ToastTypeKey,
} from "./config.types.ts";
import type { NotificationRule } from "./notifications.ts";
import { resolveTypeStyle } from "./type-style.ts";

/** The separator every summary uses, so section headers read alike everywhere. */
export const SUMMARY_SEP = " · ";

/** Join summary parts, dropping empties, with the shared separator. */
export function joinSummary(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(SUMMARY_SEP);
}

// ── Human units ───────────────────────────────────────────────────────────────

/**
 * Milliseconds as a human duration: "5 s", "1.5 s", "2 min".
 * Sub-second values keep one decimal; anything from a minute up reads in minutes.
 */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s";
  if (ms >= 60_000) {
    const min = ms / 60_000;
    return `${trimNumber(min)} min`;
  }
  return `${trimNumber(ms / 1000)} s`;
}

/** Drop a trailing ".0" so "5.0 s" reads "5 s", but keep "1.5 s". */
function trimNumber(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ── Position ──────────────────────────────────────────────────────────────────

const ROW_LABEL: Record<string, string> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};
const COL_LABEL: Record<string, string> = {
  left: "left",
  center: "centre",
  right: "right",
};

/**
 * Human name for the position enum — "bottom-right" → "Bottom right".
 * The ONE place the enum becomes words (§4c); the picker and every summary read
 * from here so the wording can't diverge.
 */
export function positionLabel(position: ToastPosition | string): string {
  const [row, col] = String(position).split("-");
  return `${ROW_LABEL[row] ?? row} ${COL_LABEL[col] ?? col}`;
}

// ── Section summaries ─────────────────────────────────────────────────────────

/** "Bottom right · 40 px from the edge · up to 3 at once" */
export function describePlacement(global: GlobalSettings): string {
  const edge = Math.max(global.offsetTop ?? 0, global.offsetInline ?? 0);
  const visible = Math.max(1, Math.round(global.maxVisible ?? 1));
  return joinSummary([
    positionLabel(global.position),
    `${Math.round(edge)} px from the edge`,
    visible === 1 ? "one at a time" : `up to ${visible} at once`,
  ]);
}

/**
 * "Stays 5 s · closeable · pauses on hover", or — when auto-dismiss is off —
 * "Stays until dismissed", because quoting a duration there would be a lie.
 */
export function describeTiming(global: GlobalSettings): string {
  const stay = global.autoDismiss
    ? `Stays ${humanDuration(global.durationMs)}`
    : "Stays until dismissed";
  return joinSummary([
    stay,
    global.closeable ? "closeable" : null,
    global.autoDismiss && global.pauseOnHover ? "pauses on hover" : null,
  ]);
}

const GROUPING_LABEL: Record<string, string> = {
  off: "Not merged",
  "by-product": "Merged by product",
  "by-variant": "Merged by variant",
  "by-type": "Merged by event type",
};

/**
 * "Merged by product · max 8 per session".
 * Quiet mode wins outright — when everything is muted, nothing else about the
 * anti-spam rules is true in practice, so saying it would mislead.
 */
export function describeAntiSpam(global: GlobalSettings): string {
  if (global.frequency?.quietMode) return "Quiet mode — no toasts are showing";
  const cap = global.frequency?.maxPerSession ?? 0;
  return joinSummary([
    GROUPING_LABEL[global.grouping?.mode] ?? GROUPING_LABEL.off,
    cap > 0 ? `max ${cap} per session` : "no session cap",
  ]);
}

const MODE_LABEL: Record<string, string> = {
  system: "Follows the shopper's light/dark",
  light: "Light",
  dark: "Dark",
  custom: "Custom colours",
};
const SHADOW_LABEL: Record<string, string> = {
  none: "no shadow",
  sm: "small shadow",
  md: "medium shadow",
  lg: "large shadow",
};

/** "Light · 12 px corners · medium shadow" */
export function describeLook(theme: ToastTheme): string {
  return joinSummary([
    MODE_LABEL[theme.mode] ?? MODE_LABEL.system,
    `${Math.round(theme.cornerRadius ?? 0)} px corners`,
    SHADOW_LABEL[theme.shadow] ?? SHADOW_LABEL.none,
  ]);
}

/** "3 pages · mobile only · guests only", or the honest "Every page" default. */
export function describeTargeting(
  targeting: ToastAppConfig["targeting"],
  pageLabel: (page: string) => string = (p) => p,
): string {
  const pages = targeting?.pages ?? [];
  const scope =
    pages.length === 0
      ? "Every page"
      : pages.length === 1
        ? pageLabel(pages[0])
        : `${pages.length} page types`;
  const device =
    targeting?.device === "mobile"
      ? "mobile only"
      : targeting?.device === "desktop"
        ? "desktop only"
        : null;
  const customers =
    targeting?.customerState === "guest"
      ? "guests only"
      : targeting?.customerState === "logged-in"
        ? "logged-in only"
        : null;
  return joinSummary([scope, device, customers]);
}

/** "Nothing excluded", or "2 page types · 3 URLs" — the Free half of Targeting. */
export function describeExclusions(
  exclusions: ToastAppConfig["exclusions"],
  pageLabel: (page: string) => string = (p) => p,
): string {
  const pages = exclusions?.pages ?? [];
  const urls = exclusions?.urls ?? [];
  if (pages.length === 0 && urls.length === 0) return "Nothing excluded";
  return joinSummary([
    pages.length === 1
      ? pageLabel(pages[0])
      : pages.length > 1
        ? `${pages.length} page types`
        : null,
    urls.length > 0 ? `${urls.length} ${urls.length === 1 ? "URL" : "URLs"}` : null,
  ]);
}

/**
 * Whether a toast type diverges from the global Design, and how.
 * "Inherits your global design" when untouched (§9d — a collapsed block must
 * state its real state); otherwise names only what actually differs, so the
 * merchant can see at a glance what they overrode.
 */
export function describeTypeStyle(
  config: ToastAppConfig,
  key: ToastTypeKey,
): string {
  const override = config.byType?.[key];
  const hasTheme = Boolean(override?.theme && Object.keys(override.theme).length);
  const hasBehavior = Boolean(
    override?.behavior && Object.keys(override.behavior).length,
  );
  if (!hasTheme && !hasBehavior) return "Inherits your global design";

  const { theme, behavior } = resolveTypeStyle(config, key);
  const parts: string[] = [];
  if (hasTheme) {
    const themeOverride = override?.theme ?? {};
    if (themeOverride.mode) parts.push(MODE_LABEL[theme.mode] ?? theme.mode);
    if (typeof themeOverride.cornerRadius === "number") {
      parts.push(`${Math.round(theme.cornerRadius)} px corners`);
    }
    if (typeof themeOverride.width === "number") parts.push(`${Math.round(theme.width)} px wide`);
    if (themeOverride.shadow) parts.push(SHADOW_LABEL[theme.shadow] ?? theme.shadow);
  }
  if (hasBehavior && typeof override?.behavior?.durationMs === "number") {
    parts.push(`stays ${humanDuration(behavior.durationMs)}`);
  }
  // The override exists but changed only fields we don't name individually —
  // still say it's customised rather than claiming it inherits.
  if (parts.length === 0) return "Customised for this toast";
  return `Custom: ${parts.join(", ")}`;
}

// ── Notification recipes ──────────────────────────────────────────────────────

/**
 * What a notification rule is set to right now, in one line. Off rules say so
 * first — a merchant scanning the page must not have to infer "off" from the
 * absence of a badge (§11d).
 *
 * Each branch reports only what that recipe actually controls, in human units
 * (§4): hours, not milliseconds; "5 or fewer", not a raw threshold field.
 */
export function describeNotificationRule(
  rule: NotificationRule | undefined,
): string {
  if (!rule) return "Not set up yet";
  const state = rule.enabled ? null : "Off";
  switch (rule.type) {
    case "countdown": {
      const window = rule.endsAt
        ? `ends ${rule.endsAt.slice(0, 10)} for everyone`
        : rule.evergreenMs
          ? `${trimNumber(rule.evergreenMs / 3_600_000)} h rolling window per visitor`
          : "no deadline set";
      return joinSummary([state, capitalise(window)]);
    }
    case "stock.low":
      return joinSummary([
        state,
        `Shows when stock is ${Math.max(1, Math.round(rule.threshold))} or fewer`,
      ]);
    case "cart.activity":
      return joinSummary([
        state,
        `Counts adds over the last ${trimNumber(rule.windowHours)} h`,
      ]);
    case "order.summary":
      return joinSummary([
        state,
        `Counts orders over the last ${trimNumber(rule.windowHours)} h`,
      ]);
    case "order.created": {
      const shows = [rule.showName ? "first name" : null, rule.showCity ? "city" : null]
        .filter(Boolean)
        .join(" + ");
      return joinSummary([
        state,
        `Starts after ${Math.max(1, Math.round(rule.minOrders))} real orders`,
        shows ? `shows ${shows}` : "shows the product only",
      ]);
    }
    case "announcement": {
      const variants = rule.variants?.length ?? 0;
      return joinSummary([
        state,
        rule.message?.trim() ? "Your own message" : "No message written yet",
        variants > 1 ? `${variants} A/B variants` : null,
      ]);
    }
    default:
      return joinSummary([state, "Set up"]);
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "4 of 6 cart events on · free shipping at 1 000" — the Cart toasts panel has
 * no single rule to describe, so it reports coverage instead.
 */
export function describeCartEvents(
  config: ToastAppConfig,
  isEnabled: (config: ToastAppConfig, key: ToastSemanticType) => boolean,
): string {
  const events: ToastSemanticType[] = [
    "added",
    "removed",
    "increased",
    "decreased",
  ];
  const on = events.filter((e) => isEnabled(config, e)).length;
  const ship = config.milestones?.find((m) => m.kind === "free_shipping");
  const gift = config.milestones?.find((m) => m.kind === "gift");
  return joinSummary([
    `${on} of ${events.length} cart events on`,
    ship?.enabled ? "announces free shipping" : null,
    gift?.enabled ? "announces a gift" : null,
  ]);
}
