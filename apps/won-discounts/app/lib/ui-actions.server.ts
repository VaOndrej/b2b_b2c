// The admin UI's single server seam (MVP 1, Task 5). Every admin route action
// and the store-signal reads go through here, so the integration step rewires
// ONE module, not the screens:
//
//   saveRule / deleteRule   → today: saveConfig (config.server). Integration:
//                             app/lib/sync `saveAndSync` (config + Shopify nodes
//                             + function metafields in one step).
//   moveNative / undoMove   → today: `{ ok:false, reason:"not_wired" }`, and the
//                             UI says the Shopify discount is unchanged.
//                             Integration: app/lib/native (backup → Won rule →
//                             delete native; undo = restore from backup).
//   runTryCart              → today: `not_wired`. Integration: the engine
//                             (@won/core/discounts planCart + explainPlan) on
//                             real variant prices read from Shopify.
//   loadAdminSignals        → theme-embed detection is real (read_themes);
//                             sync, native detection and checkout verification
//                             are `not_wired` until app/lib/sync + app/lib/native.
//
// Security: callers pass the SESSION shop (SEC-2) — nothing here ever reads a
// shop from a form — and the raw FormData, which is parsed and validated here on
// the server (SEC-1) by the same parser the editor uses for its live summary.

import {
  CONFIG_LIMITS,
  ONBOARDING_GOALS,
  type OnboardingGoal,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { parseEmbedStatus } from "@won/core/toasts/embed-status";
import { resolveEntitlement } from "@won/app-kit/entitlement";

import type { PrismaClient } from "../generated/prisma/client";
import { EMBED_BLOCK_HANDLE, embedActivationUrl } from "../components/model/embed";
import { currencyCodes, currencyViews, marketHandles } from "../components/model/markets";
import { readRuleForm, newRuleId, type FormDataLike } from "../components/model/rule-form";
import { NOT_WIRED_SIGNALS } from "../components/model/signals";
import { readTryCartForm, type TryCartInput } from "../components/model/try-cart-form";
import type { AdminSignals, CartPlanView, EmbedState, UiResult } from "../components/model/types";
import { loadConfig, saveConfig, type SaveConfigResult } from "./config.server";

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
      .filter((n) => THEME_ROLES_READ.has(n.role.toUpperCase()))
      .sort((a, b) => (a.role.toUpperCase() === "MAIN" ? -1 : b.role.toUpperCase() === "MAIN" ? 1 : 0))
      .slice(0, MAX_THEMES_READ);
    const withSettings = await Promise.all(
      themes.map(async (th) => ({ role: th.role, settings: await readThemeSettings(graphql, th.id) })),
    );
    return embedStateFromThemes(withSettings);
  } catch {
    return "unknown";
  }
}

/**
 * Přehled / onboarding store signals. Only the embed is read today; the rest is
 * explicitly `not_wired` (the integration step fills sync, checkout and native
 * from app/lib/sync and app/lib/native).
 */
export async function loadAdminSignals(ctx: {
  shop: string;
  scopes: string;
  apiKey: string;
  graphql: AdminGraphql;
}): Promise<AdminSignals> {
  const activateUrl = embedActivationUrl(ctx.shop, ctx.apiKey);
  const canReadThemes = ctx.scopes.split(",").map((s) => s.trim()).includes("read_themes");
  const state: EmbedState = canReadThemes ? await detectEmbed(ctx.graphql) : "no_scope";
  return { ...NOT_WIRED_SIGNALS, embed: { state, activateUrl } };
}

// --- Config writes -------------------------------------------------------------------------

function saveFailure(res: Exclude<SaveConfigResult, { ok: true }>): UiResult {
  if (res.reason === "function_config_too_large") {
    return { ok: false, reason: "function_config_too_large", bytes: res.bytes, budget: res.budget };
  }
  if (res.reason === "config_too_large") return { ok: false, reason: "config_too_large", bytes: res.bytes, limit: res.limit };
  if (res.reason === "newer_schema") return { ok: false, reason: "newer_schema" };
  return { ok: false, reason: "error" };
}

async function writeConfig(db: PrismaClient, shop: string, next: WonDiscountsConfig): Promise<SaveConfigResult> {
  // Integration step: app/lib/sync saveAndSync(db, shop, next) replaces this call.
  return saveConfig(db, shop, next);
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
 * scoped to the session shop (SEC-2), sanitized again by saveConfig (DATA-2).
 */
export async function saveRule(
  db: PrismaClient,
  shop: string,
  form: FormDataLike,
  opts: SaveRuleOptions,
): Promise<{ result: UiResult; ruleId: string | null }> {
  const { config, readOnly } = await loadConfig(db, shop);
  if (readOnly) return { result: { ok: false, reason: "newer_schema" }, ruleId: null };

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
    marketHandles: marketHandles(config.markets),
    otherRules: rules.filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name, codes: r.codes })),
  });
  if (parsed.errors.length > 0) return { result: { ok: false, reason: "invalid", errors: parsed.errors }, ruleId: null };

  const nextRules = existing ? rules.map((r) => (r.id === id ? parsed.rule : r)) : [...rules, parsed.rule];
  const index = nextRules.findIndex((r) => r.id === id);
  const res = await writeConfig(db, shop, { ...config, modules: { ...config.modules, codes: { rules: nextRules } } });
  if (!res.ok) return { result: saveFailure(res), ruleId: null };
  const prefix = `modules.codes.rules[${index}]`;
  const fixes = res.issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`)).map((i) => i.message);
  return { result: { ok: true, message: "saved", ...(fixes.length > 0 ? { fixes } : {}) }, ruleId: id };
}

/** Delete one rule (the previous config stays in ConfigVersion history, §14b). */
export async function deleteRule(db: PrismaClient, shop: string, ruleId: string): Promise<UiResult> {
  const { config, readOnly } = await loadConfig(db, shop);
  if (readOnly) return { ok: false, reason: "newer_schema" };
  const rules = config.modules.codes.rules;
  if (!rules.some((r) => r.id === ruleId)) return { ok: false, reason: "not_found" };
  const res = await writeConfig(db, shop, {
    ...config,
    modules: { ...config.modules, codes: { rules: rules.filter((r) => r.id !== ruleId) } },
  });
  return res.ok ? { ok: true, message: "deleted" } : saveFailure(res);
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

export async function saveOnboarding(db: PrismaClient, shop: string, patch: OnboardingPatch): Promise<UiResult> {
  const { config, readOnly } = await loadConfig(db, shop);
  if (readOnly) return { ok: false, reason: "newer_schema" };
  const onboarding = {
    goals: patch.goals ?? config.onboarding.goals,
    step: patch.step ?? config.onboarding.step,
  };
  const res = await writeConfig(db, shop, { ...config, onboarding });
  return res.ok ? { ok: true, message: "saved" } : saveFailure(res);
}

// --- Not wired yet: native discounts + cart engine ---------------------------------------

const NATIVE_GID = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/\d{1,20}$/;
const BACKUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Native discount ids from a Move form: only Shopify discount node GIDs, at most 50. */
export function readNativeIds(form: FormDataLike): string[] {
  const ids = form.getAll("nativeId").filter((v): v is string => typeof v === "string" && NATIVE_GID.test(v));
  return [...new Set(ids)].slice(0, 50);
}

export function readBackupId(form: FormDataLike): string | null {
  const v = form.get("backupId");
  return typeof v === "string" && BACKUP_ID.test(v) ? v : null;
}

/**
 * Move native Shopify discounts into Won. Integration: app/lib/native moveNative
 * (backup → Won rule → delete native, restore on failure, REL-3). Until then it
 * changes nothing and says so.
 */
export async function moveNative(ctx: { shop: string }, nativeIds: readonly string[]): Promise<UiResult> {
  void ctx;
  if (nativeIds.length === 0) return { ok: false, reason: "invalid", errors: [] };
  return { ok: false, reason: "not_wired", what: "move" };
}

/** Undo a move from its backup. Integration: app/lib/native undoMove. */
export async function undoMove(ctx: { shop: string }, backupId: string | null): Promise<UiResult> {
  void ctx;
  if (!backupId) return { ok: false, reason: "invalid", errors: [] };
  return { ok: false, reason: "not_wired", what: "undo" };
}

/**
 * Plan the simulated cart. Integration: read variant prices for `input.currency`
 * from Shopify, build CartPlanInput (targeting from productRuleIndex), then
 * planCart(input, buildShopFunctionConfig(config)) + explainPlan(plan, locale)
 * → CartPlanView.
 */
export async function runTryCart(
  ctx: { shop: string },
  input: TryCartInput & { locale: "cs" | "en" },
): Promise<{ result: UiResult; plan: CartPlanView | null }> {
  void ctx;
  void input;
  return { result: { ok: false, reason: "not_wired", what: "tryCart" }, plan: null };
}

/** Try-cart form (SEC-1) → input or field errors. Currencies come from the stored config. */
export function readTryCart(
  form: FormDataLike,
  config: WonDiscountsConfig,
  opts: { shopCurrency: string | null; today: string },
): ReturnType<typeof readTryCartForm> {
  const currencies = currencyCodes(
    currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules: config.modules.codes.rules }),
  );
  return readTryCartForm(form, { currencies, today: opts.today });
}
