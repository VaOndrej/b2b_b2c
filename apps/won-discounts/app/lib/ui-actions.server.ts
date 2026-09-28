// The admin UI's single server seam. Every admin route action and the store
// reads go through here; the routes build ONE request context (ShopCtx,
// app/lib/integration/context.server.ts) from `authenticate.admin` — the
// SESSION shop (SEC-2), the app DB and the embedded admin's AdminClient — and
// hand it over with the raw FormData, which is parsed and validated here on
// the server (SEC-1) by the same parser the editor uses for its live summary.
//
// Wired (MVP 1 integration step, app/lib/integration/*):
//   saveRule / deleteRule   → the canonical saveAndSync (app/lib/sync): config
//                             + Shopify nodes + function metafields in one
//                             step; the result says what reached Shopify.
//                             `unreadable_config` is refused until the merchant
//                             confirms (form `replaceUnreadable=1`).
//   resyncNow               → "Synchronizovat znovu" (resyncShop).
//   moveNative / undoMove   → app/lib/native moveNative / undoMove behind the
//                             canonical saveAndSync (native codes passed for the
//                             hash-collision check).
//   runTryCart              → Shopify prices (market country) + the engine on
//                             the function's own payload (planCart + explainPlan).
//   loadStoreSignals        → embed (read_themes), sync (resyncIfPending,
//                             bounded, REL-1) and native detection (cached).
// Every config read-modify-write runs under one per-shop lock (lock.server.ts).
// Checkout verification is still not wired and says so.

import {
  CONFIG_LIMITS,
  ONBOARDING_GOALS,
  type OnboardingGoal,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { parseEmbedStatus } from "@won/core/toasts/embed-status";
import { resolveEntitlement } from "@won/app-kit/entitlement";

import { EMBED_BLOCK_HANDLE, embedActivationUrl } from "../components/model/embed";
import { BACKUP_ID, NATIVE_DISCOUNT_GID } from "../components/model/ids";
import { currencyCodes, currencyViews, type MarketNames } from "../components/model/markets";
import { readRuleForm, newRuleId, type FormDataLike } from "../components/model/rule-form";
import { NOT_WIRED_SIGNALS } from "../components/model/signals";
import { readTryCartForm, type TryCartInput } from "../components/model/try-cart-form";
import type { AdminSignals, CodeRuleLimit, EmbedState, UiResult } from "../components/model/types";
import { activeCodeRules, MAX_ACTIVE_CODE_RULES, SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS } from "./config-guards.server";
import { loadConfig, saveConfig, type LoadedConfig } from "./config.server";
import type { ShopCtx } from "./integration/context.server";
import { withConfigLock } from "./integration/lock.server";
import {
  cachedNativeCodes,
  forgetDetection,
  loadNativeView,
  moveNativeDiscounts,
  undoNativeDiscount,
} from "./integration/native.server";
import { uiFailureFromSave } from "./integration/results";
import { ruleNames, syncOutcome } from "./integration/sync-copy";
import { overviewSync, resyncNow as resyncStored } from "./integration/sync-status.server";
import { runTryCartPlan, type TryCartRun } from "./integration/try-cart.server";
import { saveAndSync, type SaveAndSyncResult } from "./sync/save-and-sync.server";

export { uiFailureFromSave } from "./integration/results";

/** Admin GraphQL as a plain function (`admin.graphql` adapted by the route; a fake in tests). */
export type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export function graphqlFrom(admin: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}): AdminGraphql {
  return async (query, variables) => (await admin.graphql(query, variables ? { variables } : undefined)).json();
}

// --- Entitlement + shop context ---------------------------------------------------------

/**
 * BILL-1: Pro only from a verified subscription, Free on any uncertainty. Billing
 * (spec §7, Tarif) is not built yet, so there is no subscription to verify and
 * this resolves Free; the check below is where the Billing API read goes.
 */
export async function resolvePlan(): Promise<{ pro: boolean }> {
  const entitlement = await resolveEntitlement(async () => null);
  return { pro: entitlement.pro };
}

export interface ShopContext {
  currencyCode: string | null;
  /** IANA zone, e.g. "Europe/Prague". */
  timezone: string | null;
}

/** Shop currency + time zone (schedule days, "today" in Vyzkoušet košík). Degrades to nulls (REL-1). */
export async function readShopContext(graphql: AdminGraphql): Promise<ShopContext> {
  try {
    const json = (await graphql(`#graphql
      query WonDiscountsShopContext { shop { currencyCode ianaTimezone } }`)) as {
      data?: { shop?: { currencyCode?: unknown; ianaTimezone?: unknown } };
    };
    const shop = json?.data?.shop;
    const currency = typeof shop?.currencyCode === "string" && /^[A-Z]{3}$/.test(shop.currencyCode) ? shop.currencyCode : null;
    const tz = typeof shop?.ianaTimezone === "string" && shop.ianaTimezone ? shop.ianaTimezone : null;
    return { currencyCode: currency, timezone: tz };
  } catch {
    return { currencyCode: null, timezone: null };
  }
}

// --- Short-lived per-shop cache (theme and market reads) ----------------------------------

/** How long a theme / market read is reused (PERF-1, API-3): a Přehled reload doesn't re-read themes. */
export const SIGNAL_CACHE_TTL_MS = 60_000;

const signalCache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>, opts: { fresh?: boolean; now?: number } = {}): Promise<T> {
  const now = opts.now ?? Date.now();
  const hit = signalCache.get(key);
  if (!opts.fresh && hit && now - hit.at < SIGNAL_CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  signalCache.set(key, { at: now, value });
  if (signalCache.size > 5000) signalCache.delete(signalCache.keys().next().value as string);
  return value;
}

/** Test hook: forget every cached read. */
export function clearSignalCache(): void {
  signalCache.clear();
}

/**
 * The shop's market names by handle (read_markets), so the admin shows "Česko",
 * not "cz" (§4c). Degrades to {} — the UI then falls back to the handle.
 */
export async function readMarketNames(graphql: AdminGraphql, shop: string): Promise<MarketNames> {
  return cached(`markets:${shop}`, async () => {
    try {
      const json = (await graphql(`#graphql
        query WonDiscountsMarketNames { markets(first: 50) { nodes { handle name } } }`)) as {
        data?: { markets?: { nodes?: { handle?: unknown; name?: unknown }[] } };
      };
      const out: Record<string, string> = {};
      for (const node of json?.data?.markets?.nodes ?? []) {
        if (typeof node?.handle === "string" && typeof node?.name === "string" && node.name.trim()) out[node.handle] = node.name;
      }
      return out;
    } catch {
      return {};
    }
  });
}

/** Active code rules vs. the cap, for the list, the editor and Tarif (shown before a save refuses). */
export function codeRuleLimit(config: WonDiscountsConfig): CodeRuleLimit {
  return {
    active: activeCodeRules(config).length,
    limit: MAX_ACTIVE_CODE_RULES,
    shopifyLimit: SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS,
  };
}

// --- Store signals -------------------------------------------------------------------------

/**
 * The app embed's state from theme settings (pure; tests feed it real
 * settings_data). Looks for `blocks/won_discounts_embed/` by handle, never by
 * extension UUID. The live theme decides: readable + block absent = never
 * switched on = off. Only when the live theme is off do other themes matter
 * (on only in a draft → `draft_only`). An unreadable live theme = unknown.
 */
export function embedStateFromThemes(themes: readonly { role: string; settings: string | null }[]): EmbedState {
  const main = themes.find((th) => th.role.toUpperCase() === "MAIN");
  if (!main || main.settings === null) return "unknown";
  if (parseEmbedStatus(main.settings, EMBED_BLOCK_HANDLE) === "enabled") return "on";
  const onElsewhere = themes.some(
    (th) => th !== main && th.settings !== null && parseEmbedStatus(th.settings, EMBED_BLOCK_HANDLE) === "enabled",
  );
  return onElsewhere ? "draft_only" : "off";
}

const THEME_ROLES_READ = new Set(["MAIN", "UNPUBLISHED", "DEVELOPMENT"]);
const MAX_THEMES_READ = 4;

async function readThemeSettings(graphql: AdminGraphql, themeId: string): Promise<string | null> {
  try {
    const json = (await graphql(
      `#graphql
      query WonDiscountsThemeSettings($id: ID!) {
        node(id: $id) {
          ... on OnlineStoreTheme {
            files(filenames: ["config/settings_data.json"], first: 1) {
              nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
            }
          }
        }
      }`,
      { id: themeId },
    )) as { data?: { node?: { files?: { nodes?: { body?: { content?: unknown } }[] } } } };
    const content = json?.data?.node?.files?.nodes?.[0]?.body?.content;
    return typeof content === "string" ? content : null;
  } catch {
    // A locked/foreign theme can deny its files; it is skipped, never fatal.
    return null;
  }
}

async function detectEmbed(graphql: AdminGraphql): Promise<EmbedState> {
  try {
    const json = (await graphql(`#graphql
      query WonDiscountsThemes { themes(first: 50) { nodes { id role } } }`)) as {
      data?: { themes?: { nodes?: { id?: unknown; role?: unknown }[] } };
    };
    const nodes = json?.data?.themes?.nodes;
    if (!Array.isArray(nodes)) return "unknown";
    const themes = nodes
      .filter((n): n is { id: string; role: string } => typeof n?.id === "string" && typeof n?.role === "string")
      .filter((n) => THEME_ROLES_READ.has(n.role.toUpperCase()));
    const main = themes.find((th) => th.role.toUpperCase() === "MAIN");
    if (!main) return "unknown";
    const mainRead = { role: main.role, settings: await readThemeSettings(graphql, main.id) };
    const mainState = embedStateFromThemes([mainRead]);
    // Drafts only matter when the live theme is off (API-3: fewer reads).
    if (mainState !== "off") return mainState;
    const drafts = themes.filter((th) => th !== main).slice(0, MAX_THEMES_READ - 1);
    const draftReads = await Promise.all(
      drafts.map(async (th) => ({ role: th.role, settings: await readThemeSettings(graphql, th.id) })),
    );
    return embedStateFromThemes([mainRead, ...draftReads]);
  } catch {
    return "unknown";
  }
}

/**
 * The theme-embed signal (read_themes); sync, native and checkout stay
 * `not_wired` here — loadStoreSignals below adds the wired ones.
 */
export async function loadAdminSignals(ctx: {
  shop: string;
  scopes: string;
  apiKey: string;
  graphql: AdminGraphql;
  /** Skip the short cache (onboarding step 3 re-checks after the theme editor). */
  fresh?: boolean;
}): Promise<AdminSignals> {
  const activateUrl = embedActivationUrl(ctx.shop, ctx.apiKey);
  const canReadThemes = ctx.scopes.split(",").map((s) => s.trim()).includes("read_themes");
  const state: EmbedState = canReadThemes
    ? await cached(`embed:${ctx.shop}`, () => detectEmbed(ctx.graphql), { fresh: ctx.fresh })
    : "no_scope";
  return { ...NOT_WIRED_SIGNALS, embed: { state, activateUrl } };
}

/**
 * Přehled / onboarding store signals, all wired: the embed, the sync line
 * (Přehled only: it is also the retry trigger, resyncIfPending, bounded by a
 * deadline — REL-1) and the native discounts (detection cached ≤ 60 s,
 * bounded). Checkout verification is not wired yet and says so.
 */
export async function loadStoreSignals(
  ctx: ShopCtx,
  loaded: Pick<LoadedConfig, "config" | "exists" | "unreadable" | "readOnly">,
  opts: {
    scopes: string;
    graphql: AdminGraphql;
    timezone: string | null;
    /** Run the Přehled sync trigger (onboarding does not). */
    sync: boolean;
    fresh?: boolean;
    syncDeadlineMs?: number;
    nativeDeadlineMs?: number;
  },
): Promise<AdminSignals> {
  const [base, sync, native] = await Promise.all([
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: opts.graphql, fresh: opts.fresh }),
    opts.sync ? overviewSync(ctx, loaded, { timezone: opts.timezone, deadlineMs: opts.syncDeadlineMs }) : Promise.resolve(NOT_WIRED_SIGNALS.sync),
    // `fresh` re-reads the theme only (onboarding's focus re-check); detection keeps its 60 s cache.
    loadNativeView(ctx, loaded.config, { timezone: opts.timezone, deadlineMs: opts.nativeDeadlineMs }),
  ]);
  return { ...base, sync, native };
}

// --- One call per loader ------------------------------------------------------------------

export interface AdminReads {
  shopContext: ShopContext;
  marketNames: MarketNames;
  /** Only when asked for (Přehled, onboarding). */
  signals: AdminSignals | null;
}

/**
 * Everything an admin loader reads from Shopify besides the config, in
 * parallel, each degrading on its own (REL-1): shop currency + zone, market
 * names, and (when asked) the store signals. `fresh` bypasses the short cache.
 */
export async function readAdminContext(ctx: {
  shop: string;
  scopes: string;
  apiKey: string;
  graphql: AdminGraphql;
  signals?: boolean;
  fresh?: boolean;
}): Promise<AdminReads> {
  const [shopContext, marketNames, signals] = await Promise.all([
    readShopContext(ctx.graphql),
    readMarketNames(ctx.graphql, ctx.shop),
    ctx.signals ? loadAdminSignals(ctx) : Promise.resolve(null),
  ]);
  return { shopContext, marketNames, signals };
}

// --- Config writes -------------------------------------------------------------------------

/** Save `next` and write it into Shopify (canonical saveAndSync); the shop's native codes guard code hashes. */
async function writeAndSync(ctx: ShopCtx, next: WonDiscountsConfig, replaceUnreadable: boolean): Promise<SaveAndSyncResult> {
  const result = await saveAndSync({
    client: ctx.client,
    db: ctx.db,
    shop: ctx.shop,
    input: next,
    otherCodes: cachedNativeCodes(ctx.shop),
    replaceUnreadable,
    createSync: ctx.createSync,
    now: ctx.now,
    logger: ctx.logger,
  });
  // A rule change can start or end a conflict with a native discount.
  if (result.save.ok) forgetDetection(ctx.shop);
  return result;
}

/** The success result of a save: sanitizer notes for `prefix` + what reached Shopify. */
function savedResult(
  res: SaveAndSyncResult & { save: { ok: true } },
  message: "saved" | "deleted",
  prefix: string | null,
): UiResult {
  const fixes = prefix === null ? [] : res.save.issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`)).map((i) => i.message);
  return {
    ok: true,
    message,
    ...(fixes.length > 0 ? { fixes } : {}),
    ...(res.sync ? { sync: syncOutcome(res.sync, res.warnings, ruleNames(res.save.config)) } : {}),
  };
}

/** The form's explicit confirmation to replace an unreadable stored config (I3). */
export function readReplaceUnreadable(form: FormDataLike): boolean {
  return form.get("replaceUnreadable") === "1";
}

export interface SaveRuleOptions {
  /** "new" or the id from the URL (never from the form). */
  ruleId: string;
  timezone: string | null;
  shopCurrency: string | null;
  pro: boolean;
}

/**
 * Create or update one rule from the editor's raw form. Validated here (SEC-1),
 * scoped to the session shop (SEC-2), sanitized again by saveConfig (DATA-2),
 * then written into Shopify (saveAndSync).
 */
export async function saveRule(
  ctx: ShopCtx,
  form: FormDataLike,
  opts: SaveRuleOptions,
): Promise<{ result: UiResult; ruleId: string | null }> {
  return withConfigLock(ctx.shop, async () => {
    const replaceUnreadable = readReplaceUnreadable(form);
    const { config, readOnly, unreadable } = await loadConfig(ctx.db, ctx.shop);
    if (readOnly) return { result: { ok: false, reason: "newer_schema" }, ruleId: null };
    // I3: never replace an unreadable stored config without the merchant's confirmation.
    if (unreadable && !replaceUnreadable) return { result: { ok: false, reason: "unreadable_config" }, ruleId: null };

    const rules = config.modules.codes.rules;
    const isNew = opts.ruleId === "new";
    const existing = isNew ? null : (rules.find((r) => r.id === opts.ruleId) ?? null);
    if (!isNew && !existing) return { result: { ok: false, reason: "not_found" }, ruleId: null };
    if (isNew && rules.length >= CONFIG_LIMITS.rules) {
      return {
        result: { ok: false, reason: "invalid", errors: [{ field: "name", key: "editor.error.tooManyRules", params: { max: CONFIG_LIMITS.rules } }] },
        ruleId: null,
      };
    }

    const id = existing ? existing.id : newRuleId();
    const parsed = readRuleForm(form, {
      id,
      currencies: currencyCodes(currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules })),
      timezone: opts.timezone,
      pro: opts.pro,
      existing,
      marketHandles: config.markets.filter((m) => m.enabled).map((m) => m.handle),
      otherRules: rules.filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name, codes: r.codes })),
    });
    if (parsed.errors.length > 0) return { result: { ok: false, reason: "invalid", errors: parsed.errors }, ruleId: null };

    const nextRules = existing ? rules.map((r) => (r.id === id ? parsed.rule : r)) : [...rules, parsed.rule];
    const index = nextRules.findIndex((r) => r.id === id);
    const res = await writeAndSync(ctx, { ...config, modules: { ...config.modules, codes: { rules: nextRules } } }, replaceUnreadable);
    if (!res.save.ok) return { result: uiFailureFromSave(res.save), ruleId: null };
    return { result: savedResult({ ...res, save: res.save }, "saved", `modules.codes.rules[${index}]`), ruleId: id };
  });
}

/** Delete one rule (the previous config stays in ConfigVersion history, §14b); its Won node goes with it. */
export async function deleteRule(ctx: ShopCtx, ruleId: string): Promise<UiResult> {
  return withConfigLock(ctx.shop, async () => {
    const { config, readOnly, unreadable } = await loadConfig(ctx.db, ctx.shop);
    if (readOnly) return { ok: false, reason: "newer_schema" };
    if (unreadable) return { ok: false, reason: "unreadable_config" };
    const rules = config.modules.codes.rules;
    if (!rules.some((r) => r.id === ruleId)) return { ok: false, reason: "not_found" };
    const res = await writeAndSync(
      ctx,
      { ...config, modules: { ...config.modules, codes: { rules: rules.filter((r) => r.id !== ruleId) } } },
      false,
    );
    return res.save.ok ? savedResult({ ...res, save: res.save }, "deleted", null) : uiFailureFromSave(res.save);
  });
}

/** "Synchronizovat znovu" (Přehled, and the Notice after a save that did not reach Shopify). */
export function resyncNow(ctx: ShopCtx): Promise<UiResult> {
  return resyncStored(ctx);
}

export type OnboardingPatch = { goals?: OnboardingGoal[]; step?: number };

/** Onboarding form → a patch; unknown goals and out-of-range steps are dropped (SEC-1). */
export function readOnboardingForm(form: FormDataLike): OnboardingPatch | null {
  const intent = form.get("intent");
  if (intent === "goals") {
    // s-choice-list (multiple) submits one comma-joined value; plain checkboxes submit several.
    const goals = form
      .getAll("goals")
      .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
      .map((g) => g.trim())
      .filter((g): g is OnboardingGoal => (ONBOARDING_GOALS as readonly string[]).includes(g));
    return { goals: [...new Set(goals)], step: 2 };
  }
  if (intent === "step") {
    const raw = form.get("step");
    const step = typeof raw === "string" && /^[1-5]$/.test(raw) ? Number(raw) : null;
    return step === null ? null : { step };
  }
  return null;
}

/**
 * Onboarding steps (goals, step) change nothing Shopify runs, so they are saved
 * without a sync — under the same per-shop lock as every other config write.
 */
export async function saveOnboarding(ctx: Pick<ShopCtx, "db" | "shop">, patch: OnboardingPatch): Promise<UiResult> {
  return withConfigLock(ctx.shop, async () => {
    const { config, readOnly } = await loadConfig(ctx.db, ctx.shop);
    if (readOnly) return { ok: false, reason: "newer_schema" };
    const onboarding = {
      goals: patch.goals ?? config.onboarding.goals,
      step: patch.step ?? config.onboarding.step,
    };
    const res = await saveConfig(ctx.db, ctx.shop, { ...config, onboarding });
    return res.ok ? { ok: true, message: "saved" } : uiFailureFromSave(res);
  });
}

// --- Native discounts + cart engine -----------------------------------------------------

/** Native discount ids from a Move form: only Shopify discount node GIDs, at most 50. */
export function readNativeIds(form: FormDataLike): string[] {
  const ids = form.getAll("nativeId").filter((v): v is string => typeof v === "string" && NATIVE_DISCOUNT_GID.test(v));
  return [...new Set(ids)].slice(0, 50);
}

export function readBackupId(form: FormDataLike): string | null {
  const v = form.get("backupId");
  return typeof v === "string" && BACKUP_ID.test(v) ? v : null;
}

/**
 * Move native Shopify discounts into Won (app/lib/native moveNative: backup →
 * delete native → Won rule through saveAndSync; restored at once on failure,
 * REL-3). One after another; the result says what moved and what did not.
 */
export async function moveNative(ctx: ShopCtx, nativeIds: readonly string[]): Promise<UiResult> {
  return moveNativeDiscounts(ctx, nativeIds);
}

/** Undo a move from its backup (app/lib/native undoMove; only this shop's backups, SEC-2). */
export async function undoMove(ctx: ShopCtx, backupId: string | null): Promise<UiResult> {
  return undoNativeDiscount(ctx, backupId);
}

/**
 * Plan the simulated cart: prices from Shopify for the chosen market/currency,
 * targeting from productRuleIndex, planCart on the function's own payload +
 * explainPlan → CartPlanView (app/lib/integration/try-cart*.ts).
 */
export async function runTryCart(
  ctx: ShopCtx,
  input: TryCartInput & { locale: "cs" | "en" },
  opts: { config: WonDiscountsConfig; shopCurrency: string | null; timezone: string | null; marketNames?: MarketNames },
): Promise<TryCartRun> {
  return runTryCartPlan(ctx, input, opts);
}

/** Try-cart form (SEC-1) → input or field errors. Currencies and markets come from the stored config. */
export function readTryCart(
  form: FormDataLike,
  config: WonDiscountsConfig,
  opts: { shopCurrency: string | null; today: string },
): ReturnType<typeof readTryCartForm> {
  const currencies = currencyCodes(
    currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules: config.modules.codes.rules }),
  );
  const markets = config.markets.filter((m) => m.enabled).map((m) => ({ handle: m.handle, currency: m.currency }));
  return readTryCartForm(form, { currencies, today: opts.today, markets });
}
