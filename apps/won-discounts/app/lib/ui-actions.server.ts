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
//                             confirms (form `replaceUnreadable=1`). F12: the
//                             save names the stored version it builds on
//                             (retried once on top of another instance's
//                             write when that write did not touch this rule)
//                             and the rule version the editor loaded
//                             (`ruleVersion`): a rule changed meanwhile is
//                             refused (`base_changed`), never overwritten.
//                             Item 7: the request waits for the save, the
//                             nodes and the shop config (at most
//                             ACTION_SYNC_DEADLINE_MS); products that only
//                             gain rules are written in the background.
//                             Item 10: a code rule's save reads the shop's
//                             native codes FRESH (bounded) for the hash check.
//   resyncNow               → "Synchronizovat znovu" (resyncShop).
//   moveNative / undoMove   → app/lib/native moveNative / undoMove behind the
//                             canonical saveAndSync (native codes passed for the
//                             hash-collision check).
//   runTryCart              → Shopify prices (market country) + the engine on
//                             the function's own payload (planCart + explainPlan).
//   loadStoreSignals        → embed (read_themes), sync (resyncIfPending,
//                             bounded, REL-1), native detection (cached) and
//                             the Ochrana marže card (AdminSignals.margin,
//                             integration/margin.server.ts; Přehled only).
// Every config read-modify-write runs under one per-shop lock (lock.server.ts).
// Checkout verification is still not wired and says so.

import {
  CONFIG_LIMITS,
  ONBOARDING_GOALS,
  type OnboardingGoal,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { parseEmbedStatus } from "@won/core/toasts/embed-status";

import { EMBED_BLOCK_HANDLE, embedActivationUrl } from "../components/model/embed";
import { BACKUP_ID, NATIVE_DISCOUNT_GID } from "../components/model/ids";
import { currencyCodes, currencyViews, type MarketNames } from "../components/model/markets";
import { FIELD, readRuleForm, newRuleId, ruleVersionToken, type FormDataLike } from "../components/model/rule-form";
import { NOT_WIRED_SIGNALS } from "../components/model/signals";
import { readTryCartForm, type TryCartInput } from "../components/model/try-cart-form";
import type { AdminSignals, CodeRuleLimit, EmbedState, UiResult } from "../components/model/types";
import { activeCodeRules, MAX_ACTIVE_CODE_RULES, SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS } from "./config-guards.server";
import { loadConfig, saveConfig, type LoadedConfig } from "./config.server";
import type { ShopCtx } from "./integration/context.server";
import { lockedWrite, SAVE_ATTEMPTS, savedResult, writeAndSync } from "./integration/config-write.server";
import { withinDeadline } from "./integration/deadline";
import {
  cachedNativeCodes,
  detectNative,
  loadNativeView,
  moveNativeDiscounts,
  nativeCodes,
  undoNativeDiscount,
} from "./integration/native.server";
import { loadMarginOverview } from "./integration/margin.server";
import { uiFailureFromSave } from "./integration/results";
import { overviewSync, refreshTargetingNow, resyncNow as resyncStored } from "./integration/sync-status.server";
import { runTryCartPlan, type TryCartRun } from "./integration/try-cart.server";
import { canReadMarkets } from "./sync/save-and-sync.server";
import { canonicalJson } from "./sync/util";

export { resolvePlan } from "./plan.server";

export { uiFailureFromSave } from "./integration/results";

/** Admin GraphQL as a plain function (`admin.graphql` adapted by the route; a fake in tests). */
export type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export function graphqlFrom(admin: {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}): AdminGraphql {
  return async (query, variables) => (await admin.graphql(query, variables ? { variables } : undefined)).json();
}

// --- Shop context ------------------------------------------------------------------------
// (The plan: resolvePlan, re-exported above from app/lib/plan.server.ts — the one BILL-1 resolver.)

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
 * The shop's market names by handle (read_markets — an OPTIONAL scope, item 9),
 * so the admin shows "Česko", not "cz" (§4c). Without the scope (known from
 * the session), or when the read fails, {} — the UI then falls back to the handle.
 */
export async function readMarketNames(graphql: AdminGraphql, shop: string, scopes?: string | null): Promise<MarketNames> {
  if (!canReadMarkets(scopes)) return {};
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
    /** The shop currency the page read (the margin card counts products without a cost in it). */
    shopCurrency?: string | null;
    fresh?: boolean;
    syncDeadlineMs?: number;
    nativeDeadlineMs?: number;
  },
): Promise<AdminSignals> {
  const [base, sync, native, margin] = await Promise.all([
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: opts.graphql, fresh: opts.fresh }),
    opts.sync ? overviewSync(ctx, loaded, { timezone: opts.timezone, deadlineMs: opts.syncDeadlineMs }) : Promise.resolve(NOT_WIRED_SIGNALS.sync),
    // `fresh` re-reads the theme only (onboarding's focus re-check); detection keeps its 60 s cache.
    loadNativeView(ctx, loaded.config, { timezone: opts.timezone, deadlineMs: opts.nativeDeadlineMs }),
    // Ochrana marže card (MVP 2, Přehled only): also starts a due cost pass / clear in the background.
    // A failure leaves the card out (absent = not known), never the page (REL-1).
    opts.sync
      ? loadMarginOverview(ctx, loaded, { timezone: opts.timezone, trigger: true, shopCurrency: opts.shopCurrency }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  return { ...base, sync, native, ...(margin ? { margin } : {}) };
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
    readMarketNames(ctx.graphql, ctx.shop, ctx.scopes),
    ctx.signals ? loadAdminSignals(ctx) : Promise.resolve(null),
  ]);
  return { shopContext, marketNames, signals };
}

// --- Config writes -------------------------------------------------------------------------

/** How long a code rule's save waits for a fresh read of the shop's native codes (item 10). */
export const NATIVE_CODES_DEADLINE_MS = 8_000;

/**
 * The shop's native codes for the hash-collision check of a CODE rule's save,
 * read FRESH (item 10: the 60 s detection cache could miss a native code
 * created meanwhile). The read is native detection itself (paged, every page
 * ≤ 1 000 requested points — app/lib/native/documents.ts) bounded by
 * NATIVE_CODES_DEADLINE_MS; when it does not finish, the cached codes are
 * used and the save says the check could not be made fresh.
 */
async function freshNativeCodes(ctx: ShopCtx, config: WonDiscountsConfig): Promise<{ codes: string[] | undefined; warning?: string }> {
  const outcome = await withinDeadline(detectNative(ctx, config, { fresh: true }), NATIVE_CODES_DEADLINE_MS);
  if (outcome.done && "value" in outcome) return { codes: nativeCodes(outcome.value) };
  if (outcome.done && "error" in outcome && outcome.error instanceof Response) throw outcome.error;
  return {
    codes: cachedNativeCodes(ctx.shop),
    warning: "native discount codes could not be read fresh; the code collision check used what was known",
  };
}

// writeAndSync / savedResult / lockedWrite: integration/config-write.server.ts (the margin screen saves the same way).

const sameRule = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

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
/** The rule version the editor loaded (hidden `ruleVersion`), or null (a new rule, an old form). */
function formRuleVersion(form: FormDataLike): string | null {
  const v = form.get(FIELD.ruleVersion);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function saveRule(
  ctx: ShopCtx,
  form: FormDataLike,
  opts: SaveRuleOptions,
): Promise<{ result: UiResult; ruleId: string | null }> {
  return lockedWrite(ctx, { result: { ok: false, reason: "busy" }, ruleId: null }, async () => {
    const replaceUnreadable = readReplaceUnreadable(form);
    const loadedVersion = formRuleVersion(form);
    const isNew = opts.ruleId === "new";
    const id = isNew ? newRuleId() : opts.ruleId;
    let firstRule: unknown;
    let native: { codes: string[] | undefined; warning?: string } | null = null;
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
      const loaded = await loadConfig(ctx.db, ctx.shop);
      const { config, readOnly, unreadable } = loaded;
      if (readOnly) return { result: { ok: false, reason: "newer_schema" }, ruleId: null };
      // I3: never replace an unreadable stored config without the merchant's confirmation.
      if (unreadable && !replaceUnreadable) return { result: { ok: false, reason: "unreadable_config" }, ruleId: null };

      const rules = config.modules.codes.rules;
      const existing = isNew ? null : (rules.find((r) => r.id === opts.ruleId) ?? null);
      if (!isNew && !existing) return { result: { ok: false, reason: "not_found" }, ruleId: null };
      // F12: the rule changed since the editor loaded it, or since this save first read it.
      if (existing && loadedVersion && ruleVersionToken(existing) !== loadedVersion) return { result: { ok: false, reason: "base_changed" }, ruleId: null };
      if (attempt === 1) firstRule = existing;
      else if (!sameRule(existing, firstRule)) return { result: { ok: false, reason: "base_changed" }, ruleId: null };
      if (isNew && rules.length >= CONFIG_LIMITS.rules) {
        return {
          result: { ok: false, reason: "invalid", errors: [{ field: "name", key: "editor.error.tooManyRules", params: { max: CONFIG_LIMITS.rules } }] },
          ruleId: null,
        };
      }

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
      const next = { ...config, modules: { ...config.modules, codes: { rules: nextRules } } };
      if (parsed.rule.method === "code" && native === null) native = await freshNativeCodes(ctx, next);
      const res = await writeAndSync(ctx, next, {
        replaceUnreadable,
        expectedVersion: loaded.version,
        ...(native ? { otherCodes: native.codes, warnings: native.warning ? [native.warning] : [] } : {}),
      });
      if (!res.save.ok && res.save.reason === "base_changed") continue;
      if (!res.save.ok) return { result: uiFailureFromSave(res.save), ruleId: null };
      return { result: savedResult({ ...res, save: res.save }, "saved", `modules.codes.rules[${index}]`), ruleId: id };
    }
    return { result: { ok: false, reason: "base_changed" }, ruleId: null };
  });
}

/**
 * Delete one rule (the previous config stays in ConfigVersion history, §14b);
 * its Won node goes with it. `ruleVersion` = the version the editor loaded
 * (F12: a rule changed meanwhile is not deleted blindly).
 */
export async function deleteRule(ctx: ShopCtx, ruleId: string, opts: { ruleVersion?: string | null } = {}): Promise<UiResult> {
  return lockedWrite<UiResult>(ctx, { ok: false, reason: "busy" }, async () => {
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
      const loaded = await loadConfig(ctx.db, ctx.shop);
      const { config, readOnly, unreadable } = loaded;
      if (readOnly) return { ok: false, reason: "newer_schema" };
      if (unreadable) return { ok: false, reason: "unreadable_config" };
      const rules = config.modules.codes.rules;
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return { ok: false, reason: "not_found" };
      if (opts.ruleVersion && ruleVersionToken(rule) !== opts.ruleVersion) return { ok: false, reason: "base_changed" };
      const res = await writeAndSync(ctx, { ...config, modules: { ...config.modules, codes: { rules: rules.filter((r) => r.id !== ruleId) } } }, {
        replaceUnreadable: false,
        expectedVersion: loaded.version,
      });
      if (!res.save.ok && res.save.reason === "base_changed") continue;
      return res.save.ok ? savedResult({ ...res, save: res.save }, "deleted", null) : uiFailureFromSave(res.save);
    }
    return { ok: false, reason: "base_changed" };
  });
}

/** "Synchronizovat znovu" (Přehled, and the Notice after a save that did not reach Shopify). */
export function resyncNow(ctx: ShopCtx): Promise<UiResult> {
  return resyncStored(ctx);
}

/** "Obnovit cílení" (Přehled): re-read collection members and rewrite the product refs now (item 2). */
export function refreshTargetingAction(ctx: ShopCtx): Promise<UiResult> {
  return refreshTargetingNow(ctx);
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
export async function saveOnboarding(ctx: Pick<ShopCtx, "db" | "shop" | "lockWaitMs">, patch: OnboardingPatch): Promise<UiResult> {
  return lockedWrite<UiResult>(ctx, { ok: false, reason: "busy" }, async () => {
    // F12: on top of the version just read; another instance's write in between → the patch is re-applied on it.
    for (let attempt = 1; attempt <= ONBOARDING_ATTEMPTS; attempt += 1) {
      const loaded = await loadConfig(ctx.db, ctx.shop);
      const { config, readOnly } = loaded;
      if (readOnly) return { ok: false, reason: "newer_schema" };
      const onboarding = {
        goals: patch.goals ?? config.onboarding.goals,
        step: patch.step ?? config.onboarding.step,
      };
      const res = await saveConfig(ctx.db, ctx.shop, { ...config, onboarding }, { expectedVersion: loaded.version });
      if (!res.ok && res.reason === "base_changed") continue;
      return res.ok ? { ok: true, message: "saved" } : uiFailureFromSave(res);
    }
    return { ok: false, reason: "base_changed" };
  });
}

/** An onboarding step is a patch that applies on top of any config: retried a few times on a concurrent write. */
const ONBOARDING_ATTEMPTS = 3;

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
