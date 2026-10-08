// The look of each storefront element (feedback 2026-10-06, bod 13; decided 6 Oct: looks are not shared between
// modules). Four elements: the quantity table, the Milníky ladder, the sale badge, the campaign banner.
//
// Stored:
//   the table            storefront.appearancePreset / accent / custom — as before the split;
//   the other three      storefront.looks[<element>] = { preset?, accent?, blink?, custom? } (ElementLook).
// A config from before the split has no `looks`: its highlight colours (ready-made and custom) coloured the
// ladder too, so sanitizeLooks copies them to the ladder ONCE — the storefront looks as it did. `looks` is then
// always present ({} = nothing set), which is how a config is known to be converted.
//
// On the storefront every look is CSS in the config's one stylesheet (looksCss): a ready-made look is a few
// rules over the element's markup (LOOK_PRESET_CSS — no script, no class to plumb through Liquid), the highlight
// colour is one variable on the element's root, the Pro custom look its variables and the merchant's CSS scoped
// under that root. Free ships no custom look (plan-gate.ts).

import { ACCENT_PRESETS, APPEARANCE_PRESETS, type AccentPreset } from "./config/enums.ts";
import { isRecord, preview, pushIssue } from "./config/sanitize-helpers.ts";
import type { ConfigIssue, ReadonlyDeep, StorefrontSettings } from "./config/types.ts";
import { accentCss, customLookCss, LOOK_ROOT, sanitizeCustomLook, type CustomLook, type LookElement } from "./custom-look.ts";

/** The elements whose look lives in `storefront.looks` (the table keeps its own fields). */
export const LOOKS_ELEMENTS = ["milestones", "outlet", "campaign"] as const;
export type LooksElement = (typeof LOOKS_ELEMENTS)[number];

/**
 * The ready-made looks of every plan; the first of each is the look the element always had.
 *   milestones  track = a track with a mark per step · checklist = every step, the reached ones ticked ·
 *               sentence = one sentence
 *   outlet      badge = the badge · countdown = the badge and the time left · strip = a strip across the block
 *   campaign    countdown = the name and the time left · strip = the name alone · card = a framed card
 */
export const LOOK_PRESETS = {
  tiers: APPEARANCE_PRESETS,
  milestones: ["track", "checklist", "sentence"],
  outlet: ["badge", "countdown", "strip"],
  campaign: ["countdown", "strip", "card"],
} as const satisfies Record<LookElement, readonly string[]>;

export interface ElementLook {
  /** One of LOOK_PRESETS[element]; absent = the first. */
  preset?: string;
  /** The highlight colour (ACCENT_PRESETS); absent = "theme". */
  accent?: AccentPreset;
  /** Milníky: a short flash on the step the cart has just reached (never with "reduce motion"). */
  blink?: true;
  /** Pro: own colours and CSS, confined to the element. */
  custom?: CustomLook;
}

export type ElementLooks = Partial<Record<LooksElement, ElementLook>>;

export function lookPreset(element: LooksElement, look: ReadonlyDeep<ElementLook> | undefined): string {
  const presets: readonly string[] = LOOK_PRESETS[element];
  return look?.preset !== undefined && presets.includes(look.preset) ? look.preset : presets[0]!;
}

function sanitizeLook(element: LooksElement, raw: unknown, issues: ConfigIssue[]): ElementLook | undefined {
  if (raw === undefined || raw === null) return undefined;
  const path = `storefront.looks.${element}`;
  if (!isRecord(raw)) {
    pushIssue(issues, path, "invalid_look", "The look was not readable; the ready-made one was used.");
    return undefined;
  }
  const out: ElementLook = {};
  const presets: readonly string[] = LOOK_PRESETS[element];
  if (typeof raw.preset === "string" && presets.includes(raw.preset)) {
    if (raw.preset !== presets[0]) out.preset = raw.preset;
  } else if (raw.preset !== undefined && raw.preset !== null) {
    pushIssue(issues, `${path}.preset`, "unknown_look", `Look ${preview(raw.preset, 60)} is not one of ${presets.join(", ")}; "${presets[0]}" was used.`, { value: preview(raw.preset, 60), fallback: presets[0]! });
  }
  if (typeof raw.accent === "string" && raw.accent !== "theme" && (ACCENT_PRESETS as readonly string[]).includes(raw.accent)) out.accent = raw.accent as AccentPreset;
  else if (raw.accent !== undefined && raw.accent !== null && raw.accent !== "theme") {
    pushIssue(issues, `${path}.accent`, "unknown_accent", `Highlight colour ${preview(raw.accent, 60)} is not one of ${ACCENT_PRESETS.join(", ")}; the theme's colour was used.`, { value: preview(raw.accent, 60) });
  }
  if (element === "milestones" && raw.blink === true) out.blink = true;
  const custom = sanitizeCustomLook(raw.custom, issues, `${path}.custom`);
  if (custom) out.custom = custom;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `storefront.looks` as stored. `table` = the table's own fields of the same config: when `raw` is absent (a
 * config from before the split) the colours that used to reach the ladder are copied to it — see the header.
 */
export function sanitizeLooks(raw: unknown, table: Pick<StorefrontSettings, "accent" | "custom">, issues: ConfigIssue[]): ElementLooks {
  if (raw === undefined) {
    const color = table.custom?.vars.accent;
    const inherited: ElementLook = { ...(table.accent ? { accent: table.accent } : {}), ...(color ? { custom: { vars: { accent: color }, css: "" } } : {}) };
    return Object.keys(inherited).length > 0 ? { milestones: inherited } : {};
  }
  const rec = isRecord(raw) ? raw : {};
  const out: ElementLooks = {};
  for (const element of LOOKS_ELEMENTS) {
    const look = sanitizeLook(element, rec[element], issues);
    if (look) out[element] = look;
  }
  return out;
}

// --- The ready-made looks as CSS -----------------------------------------------------------------------
// Rules over the extension's markup (assets/won-discounts.css, won-discounts-outlet.css hold each element's base
// and what a look switches on). The element's class is doubled so a look wins over the base wherever the theme
// puts the stylesheets.

const MS = ".won-ms.won-ms";
const OUTLET = ".won-outlet.won-outlet";
const CAMPAIGN = ".won-campaign.won-campaign";

export const LOOK_PRESET_CSS: Readonly<Record<LooksElement, Readonly<Record<string, string>>>> = {
  milestones: {
    track: "",
    checklist: `${MS}--compact .won-ms__list{display:grid}${MS}:not(.won-ms--bar) .won-ms__track{display:none}${MS} .won-ms__list li[data-done]{color:var(--won-tiers-accent,currentColor)}`,
    sentence: `${MS}:not(.won-ms--bar) .won-ms__track,${MS} .won-ms__list{display:none}`,
  },
  outlet: {
    badge: "",
    countdown: `${OUTLET} .won-outlet__time{display:inline}`,
    strip: `${OUTLET} .won-outlet__row{padding:8px 12px;border-radius:var(--won-tiers-radius,6px);background:var(--won-tiers-tint,color-mix(in srgb,currentColor 8%,transparent))}${OUTLET} .won-outlet__badge{padding:0;border:0}${OUTLET} .won-outlet__time{display:inline}`,
  },
  campaign: {
    countdown: "",
    strip: `${CAMPAIGN} .won-campaign__time{display:none}`,
    card: `:not(.won-topbar)>${CAMPAIGN}{padding:16px;border:1px solid var(--won-tiers-line,color-mix(in srgb,currentColor 20%,transparent));border-radius:var(--won-tiers-radius,8px);background:var(--won-tiers-tint,transparent)}:not(.won-topbar)>${CAMPAIGN} .won-campaign__title{font-size:1.25em}`,
  },
};

/** The flash of a step the cart has just reached (the keyframes and "reduce motion" are the extension's). */
export const MILESTONE_BLINK_CSS = `${MS} [data-new]{animation:won-ms-new .7s ease-out}`;

/** Does the sale badge show the time left (the block then loads the countdown script)? */
export function outletCountdown(looks: ReadonlyDeep<ElementLooks> | undefined): boolean {
  return lookPreset("outlet", looks?.outlet) !== "badge";
}

/** One element's look as the storefront gets it: the ready-made look, the colour, then the Pro custom look over them. */
export function elementLookCss(element: LooksElement, look: ReadonlyDeep<ElementLook> | undefined): string {
  const root = LOOK_ROOT[element];
  return (
    (LOOK_PRESET_CSS[element][lookPreset(element, look)] ?? "") +
    (element === "milestones" && look?.blink ? MILESTONE_BLINK_CSS : "") +
    accentCss(look?.accent, root) +
    customLookCss(look?.custom as CustomLook | undefined, root)
  );
}

/**
 * The storefront's one stylesheet from the GATED storefront settings: the table's colour and custom look on its
 * root, then every other element's look on its own. "" = nothing to add.
 */
export function looksCss(storefront: ReadonlyDeep<StorefrontSettings>): string {
  const table = accentCss(storefront.accent, LOOK_ROOT.tiers) + customLookCss(storefront.custom as CustomLook | undefined, LOOK_ROOT.tiers);
  return table + LOOKS_ELEMENTS.map((element) => elementLookCss(element, storefront.looks?.[element])).join("");
}
