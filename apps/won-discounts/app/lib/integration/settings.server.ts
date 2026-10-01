// Nastavení (MVP 3; the MVP 1 debt: the Free per-category combination switches,
// engine.combination, decision A1) — and the one save path the module screens
// share (Ochrana marže, Množstevní slevy, Vzhled, Nastavení): the shop's config
// lock with a bounded
// wait (`busy`), the stored config re-read, the F12 version token the page
// loaded (`base_changed` ONLY when the part this page edits was changed
// meanwhile — another tab's change elsewhere is kept and this one applied on
// top), the unreadable guard (I3: replaced only when the merchant confirms),
// then writeAndSync (config + Shopify), and the save's `fixes` worded from the
// sanitizer's issues under the page's config path.

import { createDefaultConfig, readStoredConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import { COMBINATION_FIELD, COMBINATION_INTENT, readCombinationForm } from "../../components/model/combination";
import { currencyViews } from "../../components/model/markets";
import type { FormDataLike } from "../../components/model/rule-form";
import type { CombinationView, SettingsScreenData, UiResult } from "../../components/model/types";
import { configVersionToken, loadConfig, type LoadedConfig } from "../config.server";
import { canonicalJson } from "../sync/util";
import { lockedWrite, SAVE_ATTEMPTS, savedResult, writeAndSync } from "./config-write.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { uiFailureFromSave } from "./results";
import { ctxPlan } from "./sync-status.server";
import { readMarketNames, readShopContext } from "./themes.server";

// --- The shared save ---------------------------------------------------------------------------------

export interface SaveOptions {
  /** F12: the stored version the page was loaded from (null = no config was stored). */
  configVersion: string | null;
  /** I3: the merchant confirmed replacing an unreadable stored config. */
  replaceUnreadable?: boolean;
}

/** The page's save options from its form: `configVersion` (empty = none stored) and `replaceUnreadable` ("1"). */
export function readSaveOptions(form: FormDataLike): SaveOptions {
  const version = form.get("configVersion");
  return {
    configVersion: typeof version === "string" && version.trim() ? version.trim() : null,
    replaceUnreadable: form.get("replaceUnreadable") === "1",
  };
}

/**
 * The part of the config the page edits, as it was in the version the page
 * loaded (ConfigVersion keeps every saved row; the token is the hash of the
 * row). undefined = that version is not known any more.
 */
async function partAtVersion(ctx: Pick<ShopCtx, "db" | "shop">, token: string | null, pick: (config: WonDiscountsConfig) => unknown): Promise<unknown> {
  if (token === null) return pick(createDefaultConfig());
  const versions = await ctx.db.configVersion.findMany({
    where: { shop: ctx.shop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { data: true },
  });
  for (const version of versions) {
    if (configVersionToken(version.data) !== token) continue;
    try {
      return pick(readStoredConfig(JSON.parse(version.data)));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Save one part of the config (see the header). `pick` = the part this page
 * edits (compared for F12), `apply` = the stored config with this page's change,
 * `path` = where the sanitizer's issues about it live (`fixes`).
 */
export async function saveConfigSection(
  ctx: ShopCtx,
  opts: SaveOptions & {
    pick: (config: WonDiscountsConfig) => unknown;
    apply: (config: WonDiscountsConfig) => WonDiscountsConfig;
    path: string;
    /**
     * After a save went through, still under the config lock: what the page's
     * part needs next (the margin screen starts or clears its cost mirror) —
     * gets the config as it was and as it is now, may amend the result.
     */
    after?: (saved: { before: LoadedConfig; config: WonDiscountsConfig; result: UiResult }) => Promise<UiResult> | UiResult;
  },
): Promise<UiResult> {
  return lockedWrite<UiResult>(ctx, { ok: false, reason: "busy" }, async () => {
    const replaceUnreadable = opts.replaceUnreadable === true;
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
      const loaded = await loadConfig(ctx.db, ctx.shop);
      if (loaded.readOnly) return { ok: false, reason: "newer_schema" };
      if (loaded.unreadable && !replaceUnreadable) return { ok: false, reason: "unreadable_config" };
      if (!loaded.unreadable && loaded.version !== opts.configVersion) {
        const base = await partAtVersion(ctx, opts.configVersion, opts.pick);
        if (base === undefined || canonicalJson(base) !== canonicalJson(opts.pick(loaded.config))) return { ok: false, reason: "base_changed" };
      }
      const res = await writeAndSync(ctx, opts.apply(loaded.config), { replaceUnreadable, expectedVersion: loaded.version });
      if (!res.save.ok && res.save.reason === "base_changed") continue;
      if (!res.save.ok) return uiFailureFromSave(res.save);
      const result = savedResult({ ...res, save: res.save }, "saved", opts.path, ctx.locale);
      return opts.after ? opts.after({ before: loaded, config: res.save.config, result }) : result;
    }
    return { ok: false, reason: "base_changed" };
  });
}

// --- Nastavení ------------------------------------------------------------------------------------------

function combinationOf(config: WonDiscountsConfig): CombinationView {
  const c = config.engine.combination;
  return {
    outletWithAnything: c.outletWithAnything,
    productWithOrder: c.productWithOrder,
    productWithShipping: c.productWithShipping,
    orderWithShipping: c.orderWithShipping,
  };
}

/** The Nastavení page: the switches as stored, the plan, the F12 token, the market currencies. */
export async function loadSettingsScreen(ctx: ShopCtx, opts: { scopes: string }): Promise<SettingsScreenData> {
  const graphql = graphqlOf(ctx);
  const [loaded, plan, shopContext, marketNames] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    ctxPlan(ctx),
    readShopContext(graphql),
    readMarketNames(graphql, ctx.shop, opts.scopes),
  ]);
  return {
    plan,
    configVersion: loaded.version ?? null,
    currencies: currencyViews(loaded.config.markets, { shopCurrency: shopContext.currencyCode, marketNames }),
    combination: combinationOf(loaded.config),
  };
}

/** Save the four Free switches (product with product stays "best", A1). */
export function saveCombination(ctx: ShopCtx, combination: CombinationView, opts: SaveOptions): Promise<UiResult> {
  return saveConfigSection(ctx, {
    ...opts,
    path: "engine.combination",
    pick: (config) => combinationOf(config),
    apply: (config) => ({ ...config, engine: { ...config.engine, combination: { ...config.engine.combination, ...combination } } }),
  });
}

/** The Nastavení action: `intent=save` with the switches, parsed here on the server (SEC-1). */
export async function settingsAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(COMBINATION_FIELD.intent) !== COMBINATION_INTENT.save) return { ok: false, reason: "bad_request" };
  return saveCombination(ctx, readCombinationForm(form), readSaveOptions(form));
}
