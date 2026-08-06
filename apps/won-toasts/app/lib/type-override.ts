// Read a per-type Look/timing override from the `bt_<key>_*` form fields, storing
// ONLY what differs from the global default (default + override; see @won/core
// type-style). Returns null when the type fully inherits.
//
// Pure (FormData + config → override) so it can be unit-tested without the DB.
// Colours are compared case-insensitively: the admin's `s-color-field` emits
// UPPERCASE hex while the stored/default theme is lowercase, so a naive `!==`
// would flag every colour as changed and write a spurious override on every save.

import type {
  ToastAppConfig,
  ToastTheme,
  ToastTypeKey,
  ToastTypeOverride,
} from "@won/core/toasts/config.types";

/** True when two colour strings differ ignoring hex case (and trimming). */
function colorChanged(submitted: string, current: string): boolean {
  return submitted.trim().toLowerCase() !== String(current).trim().toLowerCase();
}

export function readTypeOverride(
  form: FormData,
  key: ToastTypeKey,
  config: ToastAppConfig,
): ToastTypeOverride | null {
  const t = config.theme;
  const g = config.global;
  const str = (n: string) => String(form.get(`bt_${key}_${n}`) ?? "");
  const theme: Partial<ToastTheme> = {};

  const mode = str("mode");
  if (mode && mode !== t.mode) theme.mode = mode as typeof t.mode;
  const bg = str("colorBg");
  if (bg && colorChanged(bg, t.colorBg)) theme.colorBg = bg;
  const text = str("colorText");
  if (text && colorChanged(text, t.colorText)) theme.colorText = text;
  const cr = Number(str("cornerRadius"));
  if (Number.isFinite(cr) && cr !== t.cornerRadius) theme.cornerRadius = cr;
  const width = Number(str("width"));
  if (Number.isFinite(width) && width > 0 && width !== t.width) theme.width = width;
  const shadow = str("shadow");
  if (shadow && shadow !== t.shadow) theme.shadow = shadow as typeof t.shadow;
  const density = str("density");
  if (density && density !== t.density) theme.density = density as typeof t.density;
  const anim = str("animationIn");
  if (anim && anim !== t.animationIn) theme.animationIn = anim as typeof t.animationIn;
  const borderColor = str("borderColor");
  if (borderColor && colorChanged(borderColor, t.borderColor)) theme.borderColor = borderColor;
  // Booleans: a switch posts "on" only when checked; compare to the default.
  const showImage = form.get(`bt_${key}_showImage`) === "on";
  if (showImage !== t.showImage) theme.showImage = showImage;
  const showDelta = form.get(`bt_${key}_showDelta`) === "on";
  if (showDelta !== t.showDelta) theme.showDelta = showDelta;
  const border = form.get(`bt_${key}_border`) === "on";
  if (border !== t.border) theme.border = border;
  const backdropBlur = form.get(`bt_${key}_backdropBlur`) === "on";
  if (backdropBlur !== t.backdropBlur) theme.backdropBlur = backdropBlur;

  const behavior: NonNullable<ToastTypeOverride["behavior"]> = {};
  const durSec = Number(str("durationSec"));
  if (Number.isFinite(durSec)) {
    const durMs = Math.round(durSec * 1000);
    if (durMs !== g.durationMs) behavior.durationMs = durMs;
  }
  const click = str("clickAction");
  if (click && click !== g.clickAction) behavior.clickAction = click as typeof g.clickAction;
  const closeable = form.get(`bt_${key}_closeable`) === "on";
  if (closeable !== g.closeable) behavior.closeable = closeable;

  const out: ToastTypeOverride = {};
  if (Object.keys(theme).length) out.theme = theme;
  if (Object.keys(behavior).length) out.behavior = behavior;
  return out.theme || out.behavior ? out : null;
}
