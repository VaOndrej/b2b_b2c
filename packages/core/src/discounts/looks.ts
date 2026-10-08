// The look of each storefront element (feedback 2026-10-06, bod 13; decided 6 Oct: looks are not shared between
// modules). Five elements: the quantity table, the Milníky ladder, the sale badge, the campaign banner, and the
// cart panel with the top strip.
//
// Stored: storefront.looks[<element>] = { preset?, accent?, blink?, custom? } (ElementLook) — the same for every
// element. `looks` is always present ({} = nothing set), which is how a config is known to be converted.
//
// Converted when read (sanitizeLooks; the stored row is rewritten by the next save):
//   - before the split (no `looks`; one look, one colour, one custom look for every block): the table's look goes
//     to `looks.tiers`, its colours to the ladder too (the only other element that read them), and the rules of
//     the one custom CSS go to the elements their selectors name (splitLegacyCss) — the storefront looks as it did;
//   - after the split, before the table moved in (`looks` without `tiers`; the table still in
//     storefront.appearancePreset / accent / custom): those three become `looks.tiers`, nothing else changes.
//
// On the storefront every look is CSS in the config's one stylesheet (looksCss): a ready-made look is a few
// rules over the element's markup (LOOK_PRESET_CSS — no script, no class to plumb through Liquid; the table's
// ready-made looks are a class its block prints, storefront-config.ts `appearance.preset`), the highlight
// colour is one variable on the element's root, the Pro custom look its variables and the merchant's CSS scoped
// under that root. Free ships no custom look (plan-gate.ts).

import { ACCENT_PRESETS, APPEARANCE_PRESETS, type AccentPreset } from "./config/enums.ts";
import { isRecord, preview, pushIssue } from "./config/sanitize-helpers.ts";
import type { ConfigIssue, ReadonlyDeep, StorefrontSettings } from "./config/types.ts";
import { accentCss, customLookCss, LOOK_ELEMENTS, LOOK_ROOT, sanitizeCustomLook, type CustomLook, type LookElement } from "./custom-look.ts";
import { CUSTOM_CSS_MAX_LENGTH, topLevelRules } from "./scope-css.ts";

/**
 * The ready-made looks of every plan; the first of each is the look the element always had.
 *   tiers       default = a table · highlight = the level in force highlighted · chips · tiles
 *   milestones  track = a track with a mark per step · checklist = every step, the reached ones ticked ·
 *               sentence = one sentence
 *   outlet      badge = the badge · countdown = the badge and the time left · strip = a strip across the block
 *   campaign    countdown = the name and the time left · strip = the name alone · card = a framed card
 *   cart        plain = the theme's own (the panel and the strip have no ready-made variants)
 */
export const LOOK_PRESETS = {
  tiers: APPEARANCE_PRESETS,
  milestones: ["track", "checklist", "sentence"],
  outlet: ["badge", "countdown", "strip"],
  campaign: ["countdown", "strip", "card"],
  cart: ["plain"],
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

export type ElementLooks = Partial<Record<LookElement, ElementLook>>;

export function lookPreset(element: LookElement, look: ReadonlyDeep<ElementLook> | undefined): string {
  const presets: readonly string[] = LOOK_PRESETS[element];
  return look?.preset !== undefined && presets.includes(look.preset) ? look.preset : presets[0]!;
}

function sanitizeLook(element: LookElement, raw: unknown, issues: ConfigIssue[], path = `storefront.looks.${element}`): ElementLook | undefined {
  if (raw === undefined || raw === null) return undefined;
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

/** The class prefix that says a rule of the one old stylesheet is about an element. */
const LEGACY_CLASS: readonly [LookElement, RegExp][] = [
  ["tiers", /\.won-tiers(?![a-z0-9])/i],
  ["milestones", /\.won-ms(?![a-z0-9])/i],
  ["outlet", /\.won-outlet(?![a-z0-9])/i],
  ["campaign", /\.won-campaign(?![a-z0-9])/i],
  ["cart", /\.won-(?:cart|topbar|progress)(?![a-z0-9])/i],
];

/**
 * The one custom CSS of before the split, divided between the elements: a rule goes to every element whose
 * classes its text names; a rule that names no Won class applied inside every block, so every element gets it.
 * A text that cannot be divided (unbalanced, or over an element's length limit once divided) stays whole with
 * the table, where it was read from.
 */
export function splitLegacyCss(css: string): Partial<Record<LookElement, string>> {
  const rules = css.trim() === "" ? [] : topLevelRules(css);
  if (rules === null) return { tiers: css };
  const out: Partial<Record<LookElement, string>> = {};
  for (const rule of rules) {
    const named = LEGACY_CLASS.filter(([, pattern]) => pattern.test(rule)).map(([element]) => element);
    for (const element of named.length > 0 ? named : LOOK_ELEMENTS) out[element] = out[element] ? `${out[element]}\n${rule}` : rule;
  }
  return Object.values(out).every((text) => text.length <= CUSTOM_CSS_MAX_LENGTH) ? out : { tiers: css };
}

/** The table's look as stored before it moved under `looks` (the three fields of the storefront settings). */
function legacyTableLook(storefront: Record<string, unknown>, issues: ConfigIssue[]): ElementLook | undefined {
  const { appearancePreset: preset, accent, custom } = storefront;
  if (preset === undefined && accent === undefined && custom === undefined) return undefined;
  return sanitizeLook("tiers", { preset, accent, custom }, issues, "storefront");
}

/**
 * `storefront.looks` as stored, converted when it comes from an older shape (see the header). `storefront` = the
 * raw storefront settings the looks are part of.
 */
export function sanitizeLooks(storefront: Record<string, unknown>, issues: ConfigIssue[]): ElementLooks {
  const raw = storefront.looks;
  const table = legacyTableLook(storefront, issues);
  if (raw === undefined) {
    // Before the split: one look for every block.
    const out: ElementLooks = {};
    const css = splitLegacyCss(table?.custom?.css ?? "");
    const colour = table?.custom?.vars.accent;
    for (const element of LOOK_ELEMENTS) {
      const vars = element === "tiers" ? (table?.custom?.vars ?? {}) : element === "milestones" && colour ? { accent: colour } : {};
      const custom = Object.keys(vars).length > 0 || css[element] ? { custom: { vars, css: css[element] ?? "" } } : {};
      const look: ElementLook = {
        ...(element === "tiers" && table?.preset ? { preset: table.preset } : {}),
        ...((element === "tiers" || element === "milestones") && table?.accent ? { accent: table.accent } : {}),
        ...custom,
      };
      if (Object.keys(look).length > 0) out[element] = look;
    }
    return out;
  }
  const rec = isRecord(raw) ? raw : {};
  const out: ElementLooks = {};
  for (const element of LOOK_ELEMENTS) {
    // After the split, before the table moved in: its three fields are its look.
    const look = element === "tiers" && rec.tiers === undefined ? table : sanitizeLook(element, rec[element], issues);
    if (look) out[element] = look;
  }
  return out;
}

// --- The ready-made looks as CSS -----------------------------------------------------------------------
// Rules over the extension's markup (assets/won-discounts.css, won-discounts-outlet.css hold each element's base
// and what a look switches on). Every rule is more specific than the base rule it overrides, so a look wins
// wherever the theme puts the stylesheets — never by their order.

const MS = ".won-ms";
const OUTLET = ".won-outlet";
const CAMPAIGN = ".won-campaign";

export const LOOK_PRESET_CSS: Readonly<Record<LookElement, Readonly<Record<string, string>>>> = {
  // The table's ready-made looks are classes of its block (assets/won-discounts-tiers.css), the cart has none.
  tiers: {},
  cart: {},
  milestones: {
    track: "",
    checklist: `${MS}${MS}--compact .won-ms__list{display:grid}${MS}:not(.won-ms--bar) .won-ms__track{display:none}${MS} .won-ms__list li[data-done]{color:var(--won-tiers-accent,currentColor)}`,
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
export function elementLookCss(element: LookElement, look: ReadonlyDeep<ElementLook> | undefined): string {
  const root = LOOK_ROOT[element];
  return (
    (LOOK_PRESET_CSS[element][lookPreset(element, look)] ?? "") +
    (element === "milestones" && look?.blink ? MILESTONE_BLINK_CSS : "") +
    accentCss(look?.accent, root) +
    customLookCss(look?.custom as CustomLook | undefined, root)
  );
}

/** The storefront's one stylesheet from the GATED storefront settings: every element's look on its own root, the table's first. "" = nothing to add. */
export function looksCss(storefront: ReadonlyDeep<StorefrontSettings>): string {
  return LOOK_ELEMENTS.map((element) => elementLookCss(element, storefront.looks?.[element])).join("");
}
