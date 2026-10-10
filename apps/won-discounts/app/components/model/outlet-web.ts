import type { Translator } from "../../i18n";
import type { OutletRunView } from "./types";

/** The badge's text as a customer reads it: the sale's own ("{left}" = the pieces left), else the default label. */
export function outletBadgeText(message: string, left: number, fallback: string): string {
  const text = message.trim();
  return text === "" ? fallback : text.replaceAll("{left}", String(Math.max(0, left)));
}

/**
 * What the storefront shows for one running sale RIGHT NOW (feedback 9 Oct 2026, 4th round): how the sale shows
 * is the sale's own setting, the badge is a block of the theme, "Zbývá X ks" needs a piece left — said here as
 * one sentence with the piece that is missing and why, so "it is on, yet I do not see it" has an answer at the
 * sale itself.
 */
export function outletWebLine(
  run: Pick<OutletRunView, "showBadge" | "left" | "display" | "message">,
  badge: "in_theme" | "missing" | "unknown",
  t: Translator["t"],
): { text: string; missing: "block" | null } {
  const { display } = run;
  if (display === "silent") return { text: t("outlet.web.silent"), missing: null };
  const price = t("outlet.web.price");
  if (display === "strike") return { text: price, missing: null };
  if (!run.showBadge) return { text: `${price} · ${t("outlet.web.badgeHidden")}`, missing: null };
  if (badge === "missing") return { text: `${price} · ${t("outlet.web.badgeNoBlock")}`, missing: "block" };
  const own = run.message.trim();
  const shown = t("outlet.web.badgeText", { text: outletBadgeText(own, run.left, t("looks.sample.outlet.badge")) });
  const label = badge === "unknown" ? `${shown} ${t("outlet.web.badgeUnverified")}` : shown;
  // The sale's own text already says the pieces left when it has "{left}".
  if (display !== "strike_badge_left" || own.includes("{left}")) return { text: `${price} · ${label}`, missing: null };
  return { text: `${price} · ${label} · ${run.left > 0 ? t("outlet.web.left", { n: run.left }) : t("outlet.web.leftNone")}`, missing: null };
}
