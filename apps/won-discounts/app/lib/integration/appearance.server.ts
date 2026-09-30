// Vzhled (MVP 3, contract K7): the four ready-made looks of the quantity-tier
// block (config.storefront.appearancePreset — the storefront config carries it,
// the sync writes it, K5). The page shows every look on the shop's own theme
// (integration/themes.server.ts readThemeLook: the MAIN theme's tokens, the same
// CSS the storefront loads), with the shop's set (the global one, else the first
// with tiers; none → an example the screen labels) and a real product. Saved
// like every admin change (settings.server.ts saveConfigSection: lock, F12,
// unreadable guard, saveAndSync). A custom look is Pro, MVP 7.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import { APPEARANCE_FIELD, APPEARANCE_INTENT, presetOf, readAppearanceForm } from "../../components/model/appearance";
import type { FormDataLike } from "../../components/model/rule-form";
import { tierSetView } from "../../components/model/tiers";
import type { AppearancePresetView, AppearanceScreenData, TierSetView, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { loadAdminSignals } from "../ui-actions.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection, type SaveOptions } from "./settings.server";
import { ctxPlan } from "./sync-status.server";
import { readPreviewProduct, readThemeLook } from "./themes.server";

/** The set the previews show: the global one with tiers, else the first set with tiers; null = none (an example is shown). */
export function sampleSet(config: WonDiscountsConfig): TierSetView | null {
  const sets = config.modules.tiers.sets.filter((s) => s.breaks.length > 0);
  const chosen = sets.find((s) => s.scope === "global") ?? sets[0];
  return chosen ? tierSetView(chosen, new Map()) : null;
}

export async function loadAppearanceScreen(ctx: ShopCtx, opts: { scopes: string; fresh?: boolean }): Promise<AppearanceScreenData> {
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const sample = sampleSet(loaded.config);
  const [plan, look, product, signals] = await Promise.all([
    ctxPlan(ctx),
    readThemeLook(ctx, { scopes: opts.scopes, fresh: opts.fresh }),
    readPreviewProduct(ctx, sample?.scope ?? null),
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphqlOf(ctx), fresh: opts.fresh }),
  ]);
  return {
    plan,
    configVersion: loaded.version ?? null,
    preset: presetOf(loaded.config.storefront.appearancePreset),
    tokens: look.tokens,
    sample,
    product,
    block: look.block,
    embed: signals.embed,
  };
}

export function saveAppearance(ctx: ShopCtx, preset: AppearancePresetView, opts: SaveOptions): Promise<UiResult> {
  return saveConfigSection(ctx, {
    ...opts,
    path: "storefront",
    pick: (config) => presetOf(config.storefront.appearancePreset),
    apply: (config) => ({ ...config, storefront: { ...config.storefront, appearancePreset: preset } }),
  });
}

/** The Vzhled action: `intent=save` with one of the four looks, parsed on the server (SEC-1). */
export async function appearanceAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(APPEARANCE_FIELD.intent) !== APPEARANCE_INTENT.save) return { ok: false, reason: "bad_request" };
  const parsed = readAppearanceForm(form);
  if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };
  return saveAppearance(ctx, parsed.preset, readSaveOptions(form));
}
