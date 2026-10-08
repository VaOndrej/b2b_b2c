// The look of each storefront element (feedback 2026-10-06, bod 13): the quantity table, the Milníky ladder, the
// sale badge and the campaign banner. Every module's page carries its element's look (components/looks/
// LookSection, the view comes from lookView here) and posts it to ONE action, /app/looks → looksAction: the
// ready-made look and the highlight colour on every plan, the custom look on Pro only (BILL-1: on Free the stored
// one stays exactly as it is). CSS that cannot be confined to the element is refused on its field (SEC-3); a
// storefront config that would pass Shopify's metafield limit is refused before the save. Saved like every admin
// change (settings.server.ts saveConfigSection: lock, F12, unreadable guard, saveAndSync).
// The table's ready-made look and colour are picked in its preview and saved with its page (tiers.server.ts).

import type { AccentPreset, WonDiscountsConfig } from "@won/core/discounts/config";
import { CUSTOM_LOOK_VARS, customLookCss, customLookIssue, LOOK_ROOT, type LookElement } from "@won/core/discounts/custom-look";
import { lookPreset, LOOK_PRESETS, type ElementLook, type LooksElement } from "@won/core/discounts/looks";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";
import { CUSTOM_CSS_MAX_LENGTH } from "@won/core/discounts/scope-css";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";
import { storefrontTexts } from "@won/core/discounts/storefront-texts";

import { LOOK_FIELD, LOOK_INTENT, readLookForm, type LookForm } from "../../components/model/looks";
import type { FormDataLike } from "../../components/model/rule-form";
import type { AppearancePresetView, LookView, PreviewLookView, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { STOREFRONT_CONFIG_MAX_BYTES } from "../sync/storefront";
import type { ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { ctxPlan } from "./sync-status.server";

/**
 * The class names a custom look can style, per element (the extension's CSS; tests/contracts pin the lists to the
 * files): each starts with its element's root, so a rule written with them stays inside the element.
 */
export const LOOK_CLASSES: Readonly<Record<LookElement, readonly string[]>> = {
  tiers: [".won-tiers", ".won-tiers--default", ".won-tiers--highlight", ".won-tiers--chips", ".won-tiers--tiles", ".won-tiers__heading", ".won-tiers__list", ".won-tiers__row", ".won-tiers__qty", ".won-tiers__save", ".won-tiers__unit", ".won-tiers__live", ".won-tiers__next"],
  milestones: [".won-ms", ".won-ms--bar", ".won-ms--compact", ".won-ms__text", ".won-ms__track", ".won-ms__list"],
  outlet: [".won-outlet", ".won-outlet__row", ".won-outlet__badge", ".won-outlet__variant", ".won-outlet__left", ".won-outlet__time"],
  campaign: [".won-campaign", ".won-campaign--center", ".won-campaign__title", ".won-campaign__time"],
};

/** The extension's other classes: the frames the elements sit in, which carry no look of their own. */
export const FRAME_CLASSES = [".won-cart", ".won-cart-slot", ".won-cart__row", ".won-cart__code", ".won-cart__applied", ".won-cart__warn", ".won-cart__saved", ".won-card-tier", ".won-progress", ".won-progress--center", ".won-topbar"] as const;

const ELEMENT_BRIEF: Readonly<Record<LookElement, string>> = {
  tiers: '.won-tiers is the quantity discount table on the product page; the active row has data-active="true".',
  milestones: ".won-ms is the ladder of rewards by cart value (free shipping, gifts, discounts): a sentence (.won-ms__text), a track with a mark per step (.won-ms__track, its <span> is the filled part, each <i> a step) and the list of steps (.won-ms__list); a reached step has data-done.",
  outlet: ".won-outlet is the sale badge on the product page: one row per variant on sale with the badge, the pieces left and the time left.",
  campaign: ".won-campaign is the campaign banner: the campaign's name and a countdown to its end.",
};

/** The brief a merchant hands to an AI for ONE element (English: the code speaks it); the full page is docs/reference/storefront-contract. */
export function aiPrompt(element: LookElement): string {
  return [
    `Write CSS for one block of the Won Discounts app in my Shopify store: ${ELEMENT_BRIEF[element]}`,
    "CSS only: no HTML, no JavaScript, no url(), no @import, no @font-face, no @keyframes; @media, @supports and @container are allowed.",
    `At most ${CUSTOM_CSS_MAX_LENGTH} characters. Selectors are relative to the block; :root means the block itself. Nothing outside the block can be styled.`,
    `CSS variables you may set on :root: ${Object.values(CUSTOM_LOOK_VARS).join(", ")}.`,
    `Classes: ${LOOK_CLASSES[element].join(", ")}.`,
    "The look I want: <describe it here>.",
  ].join("\n");
}

/**
 * What the stored config adds to the table's faithful preview on this plan (pure): the custom look exactly as the
 * storefront config carries it (BILL-1: the gate removes it on Free) and the texts the merchant changed, per
 * language the plan ships.
 */
export function previewLookOf(stored: WonDiscountsConfig, plan: ShopPlan): PreviewLookView {
  const gated = gateConfigForPlan(stored, plan).config;
  return { customCss: customLookCss(gated.storefront.custom, LOOK_ROOT.tiers) || null, texts: storefrontTexts(gated), ...(gated.storefront.accent ? { accent: gated.storefront.accent } : {}) };
}

/** `config` with the table's ready-made look set (the switcher in its preview), everything else untouched. */
export function withAppearancePreset(config: WonDiscountsConfig, preset: AppearancePresetView): WonDiscountsConfig {
  return { ...config, storefront: { ...config.storefront, appearancePreset: preset } };
}

/** One element's stored look as its section shows it (pure; every module's loader and the dev harness call it). */
export function lookView(config: WonDiscountsConfig, element: LookElement): LookView {
  const stored: ElementLook | undefined = element === "tiers" ? undefined : config.storefront.looks[element];
  const custom = element === "tiers" ? config.storefront.custom : stored?.custom;
  const issue = customLookIssue(custom, LOOK_ROOT[element]);
  return {
    element,
    presets: element === "tiers" ? [] : [...LOOK_PRESETS[element]],
    preset: element === "tiers" ? "" : lookPreset(element, stored),
    accent: stored?.accent ?? "theme",
    blink: stored?.blink === true,
    custom: {
      accent: custom?.vars.accent ?? "",
      line: custom?.vars.line ?? "",
      tint: custom?.vars.tint ?? "",
      radius: custom?.vars.radius === undefined ? "" : String(custom.vars.radius),
      css: custom?.css ?? "",
    },
    customIssue: issue ? issue.reason : null,
    aiPrompt: aiPrompt(element),
  };
}

/** Room left under Shopify's json metafield limit for what the sync adds (the version token, gift handles). */
export const STOREFRONT_CONFIG_HEADROOM_BYTES = 4_000;

/** `config` with one element's look as the form carried it. The custom look is written on Pro only. */
export function applyLook(config: WonDiscountsConfig, look: LookForm, plan: ShopPlan): WonDiscountsConfig {
  const storefront: WonDiscountsConfig["storefront"] = { ...config.storefront, looks: { ...config.storefront.looks } };
  if (look.element === "tiers") {
    if (plan === "pro") {
      if (look.custom) storefront.custom = look.custom;
      else delete storefront.custom;
    }
    return { ...config, storefront };
  }
  const element: LooksElement = look.element;
  const before = config.storefront.looks[element];
  // BILL-1: only a Pro shop writes the custom look; on Free the stored one stays exactly as it is.
  const custom = plan === "pro" ? look.custom : (before?.custom ?? null);
  const accent: AccentPreset | undefined = look.accent && look.accent !== "theme" ? look.accent : undefined;
  const next: ElementLook = {
    ...(look.preset && look.preset !== LOOK_PRESETS[element][0] ? { preset: look.preset } : {}),
    ...(accent ? { accent } : {}),
    ...(look.blink ? { blink: true as const } : {}),
    ...(custom ? { custom } : {}),
  };
  if (Object.keys(next).length > 0) storefront.looks[element] = next;
  else delete storefront.looks[element];
  return { ...config, storefront };
}

/** The part of the config a look's section owns (the F12 base check compares it). */
function lookPart(config: WonDiscountsConfig, element: LookElement) {
  return element === "tiers" ? (config.storefront.custom ?? null) : (config.storefront.looks[element] ?? null);
}

/**
 * The looks action. `intent=save`: one element's look (model/looks.ts readLookForm, SEC-1). `intent=cards`: prices
 * by quantity on product cards (BETA, with the table's look on Množstevní slevy).
 */
export async function looksAction(ctx: ShopCtx, form: FormDataLike, opts: { maxStorefrontBytes?: number } = {}): Promise<UiResult> {
  const intent = form.get(LOOK_FIELD.intent);
  if (intent === LOOK_INTENT.cards) {
    const on = form.get(LOOK_FIELD.cardPrices) === "on";
    return saveConfigSection(ctx, { ...readSaveOptions(form), path: "storefront", pick: (config) => config.storefront.cardPricesEnabled === true, apply: (config) => ({ ...config, storefront: { ...config.storefront, cardPricesEnabled: on } }) });
  }
  if (intent !== LOOK_INTENT.save) return { ok: false, reason: "bad_request" };
  const parsed = readLookForm(form);
  if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };
  const look = parsed.look;
  const [plan, loaded] = await Promise.all([ctxPlan(ctx), loadConfig(ctx.db, ctx.shop)]);
  if (plan === "pro") {
    const issue = customLookIssue(look.custom, LOOK_ROOT[look.element]);
    if (issue) return { ok: false, reason: "invalid", errors: [{ field: LOOK_FIELD.css, key: `appearance.error.css.${issue.reason}`, params: { detail: issue.detail ?? "" } }] };
  }
  const next = buildStorefrontConfig(gateConfigForPlan(applyLook(loaded.config, look, plan), plan).config, { configVersion: "" });
  const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
  // The live config also carries a version token and gift handles: leave them room under Shopify's limit.
  const max = opts.maxStorefrontBytes ?? STOREFRONT_CONFIG_MAX_BYTES - STOREFRONT_CONFIG_HEADROOM_BYTES;
  if (bytes > max) return { ok: false, reason: "invalid", errors: [{ field: LOOK_FIELD.css, key: "appearance.error.tooLarge", params: { bytes, max } }] };
  return saveConfigSection(ctx, { ...readSaveOptions(form), path: "storefront", pick: (config) => lookPart(config, look.element), apply: (config) => applyLook(config, look, plan) });
}
