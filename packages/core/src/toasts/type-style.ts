// Per-type look + behaviour resolution (doctrine: each toast type has its own
// style; the 6 cart events share the "cart" type; anti-spam stays global).
// Model is "default + override": `config.theme`/`config.global` are the defaults,
// `config.byType[key]` overrides only the fields that should differ. Empty
// byType => every type uses the default (full back-compat).

import type {
  ClickAction,
  ToastAppConfig,
  ToastTheme,
  ToastTypeKey,
} from "./config.types.ts";

export const TOAST_TYPE_KEYS: readonly ToastTypeKey[] = [
  "cart",
  "countdown",
  "announcement",
  "stock.low",
  "cart.activity",
  "order.summary",
  "order.created",
];

/** The behaviour actually applied to a type (defaults merged with its override). */
export interface ResolvedTypeBehavior {
  durationMs: number;
  clickAction: ClickAction;
  autoDismiss: boolean;
  pauseOnHover: boolean;
  closeable: boolean;
}

/** The theme applied to a type: the global default theme with the type's theme
 *  override merged on top (accent merged key-by-key). */
export function resolveTypeTheme(config: ToastAppConfig, key: ToastTypeKey): ToastTheme {
  const ov = config.byType?.[key]?.theme;
  if (!ov) return config.theme;
  return {
    ...config.theme,
    ...ov,
    accent: { ...config.theme.accent, ...(ov.accent ?? {}) },
  };
}

/** The behaviour applied to a type: global defaults with the type's override. */
export function resolveTypeBehavior(config: ToastAppConfig, key: ToastTypeKey): ResolvedTypeBehavior {
  const g = config.global;
  const b = config.byType?.[key]?.behavior ?? {};
  return {
    durationMs: typeof b.durationMs === "number" ? b.durationMs : g.durationMs,
    clickAction: b.clickAction ?? g.clickAction,
    autoDismiss: typeof b.autoDismiss === "boolean" ? b.autoDismiss : g.autoDismiss,
    pauseOnHover: typeof b.pauseOnHover === "boolean" ? b.pauseOnHover : g.pauseOnHover,
    closeable: typeof b.closeable === "boolean" ? b.closeable : g.closeable,
  };
}

export function resolveTypeStyle(config: ToastAppConfig, key: ToastTypeKey): {
  theme: ToastTheme;
  behavior: ResolvedTypeBehavior;
} {
  return { theme: resolveTypeTheme(config, key), behavior: resolveTypeBehavior(config, key) };
}

/** Does this type have any override at all (vs. purely inheriting the default)? */
export function typeHasOverride(config: ToastAppConfig, key: ToastTypeKey): boolean {
  const ov = config.byType?.[key];
  return Boolean(ov && (ov.theme || ov.behavior));
}
