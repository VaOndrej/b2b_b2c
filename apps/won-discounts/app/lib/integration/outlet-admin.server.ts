// Výprodej (MVP 5, Pro) — the admin module's server side (contract O10).
//   loadOutletScreen(ctx)      the page (OutletScreenData): running and the 20 last ended sales with Shopify's
//                              names of their variants (never an id on screen), the ledger, the history worded in
//                              the admin language and the shop's zone, the price lists with fixed prices, the
//                              module settings;
//   outletAction(ctx, form)    intent start | end | retry | reopen | keep → outlet.server.ts (the form parsed HERE, SEC-1;
//                              Pro checked there, BILL-1 / A6); intent settings → saveConfigSection on
//                              modules.outlet (display, return after the end);
//   outletOverviewOf(...)      the Přehled card and its question (returned pieces waiting for a decision).
// Both say when the quota is not counted: no order access yet (5a, F-O1, orders-access.server.ts).
// The session shop only (SEC-2).

import { OUTLET_LIMITS, outletLeft, outletOversold, type OutletDraftError } from "@won/core/discounts/outlet";
import type { WonDiscountsConfig } from "@won/core/discounts/config";

import { t, type Locale, type MessageKey } from "../../i18n";
import { outletBlockAddUrl } from "../../components/model/embed";
import { OUTLET_FIELD, OUTLET_INTENT, OUTLET_START_FIELDS, readOutletDraft, readOutletSettings } from "../../components/model/outlet";
import { submittedOf } from "../../components/model/submitted";
import { shopMidnightIso, shopToday, type FormDataLike } from "../../components/model/rule-form";
import type { FieldError, OutletActionResult, OutletHistoryView, OutletOverviewView, OutletPriceListView, OutletRunView, OutletScreenData, UiResult } from "../../components/model/types";
import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { formatShopTime } from "../native/copy";
import { GQL } from "../sync/graphql";
import { lookView } from "./looks.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { GIFT_TITLES_DOCUMENT } from "./rewards.server";
import { endOutletRun, keepOutletEnded, reopenOutletRun, setOutletBadge, startOutletRun, writeOutletStorefront, type OutletDeps } from "./outlet.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { outletStatus } from "../../components/model/module-status";
import { ctxPlan } from "./sync-status.server";
import { readShopContext, readThemeLook } from "./themes.server";
import { ordersAccess } from "./orders-access.server";

type RunRow = Awaited<ReturnType<PrismaClient["outletRun"]["findMany"]>>[number];
type EventRow = Awaited<ReturnType<PrismaClient["outletEvent"]["findMany"]>>[number];

const HISTORY_SHOWN = 20;
const ENDED_SHOWN = 20;

const FIELD_OF: Record<OutletDraftError["field"], string> = {
  plan: OUTLET_FIELD.variant,
  variantId: OUTLET_FIELD.variant,
  quota: OUTLET_FIELD.quota,
  percent: OUTLET_FIELD.percent,
  endsAt: OUTLET_FIELD.endsOn,
  priceListIds: OUTLET_FIELD.priceList,
};

const parse = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** One history step as a sentence (pieces, reasons, prices: never an id). */
function historyText(e: EventRow, locale: Locale, money: (minor: number, currency: string) => string): string {
  const d = (parse(e.detail) ?? {}) as Record<string, unknown>;
  const n = e.qty;
  switch (e.kind) {
    case "started":
      return t(locale, "outlet.history.started", {
        percent: Number(d.percent ?? 0),
        before: money(Number(d.before ?? 0), String(d.currency ?? "")),
        after: money(Number(d.after ?? 0), String(d.currency ?? "")),
      });
    case "sale":
      return t(locale, "outlet.history.sale", { n });
    case "cancel":
      return t(locale, "outlet.history.cancel", { n });
    case "refund":
      return t(locale, "outlet.history.refund", { n });
    case "oversold":
      return t(locale, "outlet.history.oversold", { n });
    case "quota_reached":
      return t(locale, "outlet.history.quotaReached");
    case "ended":
      return t(locale, `outlet.history.ended.${String(d.reason ?? "manual")}` as MessageKey);
    case "price_restored":
      return t(locale, d.field === "fixed" ? "outlet.history.restoredList" : "outlet.history.restored");
    case "price_kept":
      return t(locale, d.field === "fixed" ? "outlet.history.keptList" : "outlet.history.kept");
    case "price_list_skipped":
      return t(locale, "outlet.history.listSkipped");
    case "return_after_end":
      return t(locale, "outlet.history.returnAfterEnd", { n });
    case "reopened":
      return t(locale, "outlet.history.reopened");
    case "return_kept":
      return t(locale, "outlet.history.returnKept");
    case "start_failed":
      return t(locale, "outlet.history.startFailed");
    case "end_failed":
      return t(locale, "outlet.history.endFailed");
    default:
      return e.kind;
  }
}

export interface OutletViewOptions {
  locale: Locale;
  timezone: string | null;
  titles: ReadonlyMap<string, string>;
  /** Price list id → its name (absent or unknown: the list is named by its currency). */
  listTitles?: ReadonlyMap<string, string>;
  money: (minor: number, currency: string) => string;
}

/** A sale as the screen shows it (pure: the dev harness renders the same). */
export function outletRunView(run: RunRow, events: readonly EventRow[], opts: OutletViewOptions): OutletRunView {
  const when = (at: Date | null) => (at ? formatShopTime(at.toISOString(), opts.timezone ?? "UTC", opts.locale) : null);
  const backup = parse(run.backup) as { currency?: string; variant?: { price?: number }; lists?: { id?: string; currency?: string }[] } | null;
  const lists = Array.isArray(backup?.lists) ? backup.lists : [];
  const sale = parse(run.sale) as { variant?: { price?: number } } | null;
  const history: OutletHistoryView[] = [...events]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, HISTORY_SHOWN)
    .map((e) => ({ kind: e.kind, at: when(e.at)!, text: historyText(e, opts.locale, opts.money) }));
  return {
    id: run.id,
    variantId: run.variantId,
    title: opts.titles.get(run.variantId) ?? "",
    percent: run.percent,
    quota: run.quota,
    sold: run.sold,
    returned: run.returned,
    left: outletLeft(run),
    oversold: outletOversold(run),
    showBadge: run.showBadge !== false,
    status: run.status as OutletRunView["status"],
    endReason: (run.endReason as OutletRunView["endReason"]) ?? null,
    endsAt: when(run.endsAt),
    startedAt: when(run.startedAt),
    endedAt: when(run.endedAt),
    price:
      backup?.variant?.price !== undefined && sale?.variant?.price !== undefined && backup.currency
        ? { before: backup.variant.price, sale: sale.variant.price, currency: backup.currency }
        : null,
    lists: lists.length,
    listNames: lists.map((l) => opts.listTitles?.get(String(l?.id ?? "")) || t(opts.locale, "outlet.run.listUnknown", { currency: String(l?.currency ?? "") })),
    // "Zkusit znovu" (outletAction retry): a failed end is finished, a running sale's value for the web is written again.
    retry: run.error !== null && (run.status === "ending" || (run.status === "active" && run.error.startsWith("storefront"))),
    returnPending: run.returnPending,
    problem: run.error ? t(opts.locale, run.status === "active" ? "outlet.problem.storefront" : "outlet.problem.retrying") : null,
    history,
  };
}

async function variantTitles(ctx: ShopCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      type Node = { id?: string; title?: string; product?: { title?: string } } | null;
      const result = await ctx.client.graphql<{ nodes?: Node[] }>(GIFT_TITLES_DOCUMENT, { ids: ids.slice(i, i + 100) });
      for (const node of result.data?.nodes ?? []) {
        if (!node?.id || !node.product?.title) continue;
        out.set(node.id, node.title && node.title !== "Default Title" ? `${node.product.title} — ${node.title}` : node.product.title);
      }
    } catch (error) {
      if (error instanceof Response) throw error;
    }
  }
  return out;
}

async function priceListsOf(ctx: ShopCtx): Promise<OutletPriceListView[]> {
  try {
    type Node = { id?: string; name?: string; currency?: string; fixedPricesCount?: number; catalog?: { title?: string } | null };
    const result = await ctx.client.graphql<{ priceLists?: { nodes?: Node[] } }>(GQL.outletPriceLists);
    return (result.data?.priceLists?.nodes ?? [])
      .filter((l) => l.id && (l.fixedPricesCount ?? 0) > 0)
      .map((l) => ({ id: l.id!, title: l.catalog?.title || l.name || "", currency: l.currency ?? "" }));
  } catch (error) {
    if (error instanceof Response) throw error;
    return [];
  }
}

function moneyOf(locale: Locale) {
  return (minor: number, currency: string) => {
    try {
      return new Intl.NumberFormat(locale === "en" ? "en-US" : "cs-CZ", { style: "currency", currency }).format(minor / 100);
    } catch {
      return `${minor / 100} ${currency}`;
    }
  };
}

export async function loadOutletScreen(ctx: ShopCtx): Promise<OutletScreenData> {
  const graphql = graphqlOf(ctx);
  const [loaded, plan, shop, priceLists, ordersCounted, overview, look] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    ctxPlan(ctx),
    readShopContext(graphql),
    priceListsOf(ctx),
    ordersAccess(ctx),
    // The home tile's own view: the page says the same state (model/module-status.ts).
    loadOutletOverview(ctx).catch(() => null),
    // Is the sale badge on the live theme's product page (the read Množstevní slevy shares, cached 60 s).
    readThemeLook(ctx, { scopes: ctx.scopes }),
  ]);
  const running = await ctx.db.outletRun.findMany({ where: { shop: ctx.shop, status: { not: "ended" } }, orderBy: { createdAt: "desc" } });
  const ended = await ctx.db.outletRun.findMany({ where: { shop: ctx.shop, status: "ended" }, orderBy: { updatedAt: "desc" }, take: ENDED_SHOWN });
  const runs = [...running, ...ended];
  const events = runs.length
    ? await ctx.db.outletEvent.findMany({ where: { shop: ctx.shop, runId: { in: runs.map((r) => r.id) } }, orderBy: { at: "desc" } })
    : [];
  const titles = await variantTitles(ctx, [...new Set(runs.map((r) => r.variantId))]);
  const opts: OutletViewOptions = { locale: ctx.locale, timezone: shop.timezone, titles, listTitles: new Map(priceLists.map((l) => [l.id, l.title])), money: moneyOf(ctx.locale) };
  const view = (r: RunRow) => outletRunView(r, events.filter((e) => e.runId === r.id), opts);
  return {
    plan,
    ...(overview ? { status: outletStatus(overview, plan) } : {}),
    configVersion: loaded.version ?? null,
    look: lookView(loaded.config, "outlet"),
    shopCurrency: shop.currencyCode ?? "",
    today: shopToday(shop.timezone, nowOf(ctx)),
    display: loaded.config.modules.outlet.display,
    reopen: loaded.config.modules.outlet.reopenOnReturnAfterEnd,
    withOthers: loaded.config.engine.combination.outletWithAnything === true,
    running: running.map(view),
    ended: ended.map(view),
    priceLists,
    limits: { percentMin: OUTLET_LIMITS.percentMin, percentMax: OUTLET_LIMITS.percentMax, quotaMax: OUTLET_LIMITS.quotaMax, running: OUTLET_LIMITS.running, priceLists: OUTLET_LIMITS.priceLists },
    badgeBlockAddUrl: outletBlockAddUrl(ctx.shop, ctx.apiKey),
    placed: look.placements,
    ordersCounted,
  };
}

const depsOf = (ctx: ShopCtx): OutletDeps => ({
  shop: ctx.shop,
  db: ctx.db,
  client: ctx.client,
  plan: () => ctxPlan(ctx),
  ...(ctx.now ? { now: ctx.now } : {}),
  ...(ctx.logger ? { logger: ctx.logger } : {}),
});

const errorsOf = (errors: readonly OutletDraftError[]): FieldError[] =>
  errors.map((e) => ({ field: FIELD_OF[e.field], key: e.key as FieldError["key"], ...(e.params ? { params: e.params } : {}) }));

/** The Výprodej action (see the header). */
export async function outletAction(ctx: ShopCtx, form: FormDataLike): Promise<OutletActionResult | UiResult> {
  const intent = String(form.get(OUTLET_FIELD.intent) ?? "");
  const deps = depsOf(ctx);
  const runId = String(form.get(OUTLET_FIELD.run) ?? "");
  // B14: a refused start gets back what the form posted, so the screen shows it again.
  const values = intent === OUTLET_INTENT.start ? { values: submittedOf(form, OUTLET_START_FIELDS) } : {};
  const outcome = (r: Awaited<ReturnType<typeof startOutletRun>>, kind: "started" | "ended" | "reopened"): OutletActionResult => {
    if (r.ok) return { ok: true, kind, ...(r.skippedLists.length ? { skippedLists: r.skippedLists.length } : {}), ...(r.pending ? { pending: true } : {}) };
    if (r.reason === "invalid") return { ok: false, reason: "invalid", errors: errorsOf(r.errors), ...values };
    return { ok: false, reason: "failed", message: r.message, ...values };
  };
  switch (intent) {
    case OUTLET_INTENT.start: {
      // Free is refused before anything is read (BILL-1, A6); startOutletRun checks the plan again.
      if ((await ctxPlan(ctx)) !== "pro") return { ok: false, reason: "invalid", errors: [{ field: OUTLET_FIELD.variant, key: "outlet.error.pro" }], ...values };
      const { timezone } = await readShopContext(graphqlOf(ctx));
      const raw = readOutletDraft(form, (day) => {
        const at = new Date(shopMidnightIso(day, timezone));
        return Number.isNaN(at.getTime()) ? null : at.toISOString();
      });
      return outcome(await startOutletRun(deps, raw), "started");
    }
    case OUTLET_INTENT.end:
      return outcome(await endOutletRun(deps, runId, "manual"), "ended");
    case OUTLET_INTENT.retry: {
      // "Zkusit znovu" at a failed step: a failed end is finished now, a running sale's value for the web is written again.
      // A sale stuck in `starting` has no retry here: the scheduler closes it after OUTLET_START_STALE_MS.
      const run = await ctx.db.outletRun.findFirst({ where: { id: runId, shop: ctx.shop } });
      if (!run || run.error === null) return { ok: false, reason: "failed", message: "nothing to retry" };
      if (run.status === "ending") return outcome(await endOutletRun(deps, runId, (run.endReason as "quota" | "date" | "manual" | null) ?? "manual"), "ended");
      if (run.status !== "active") return { ok: false, reason: "failed", message: "nothing to retry" };
      const error = await writeOutletStorefront(deps, [run.productId]);
      if (error) return { ok: false, reason: "failed", message: error };
      await ctx.db.outletRun.update({ where: { id: run.id }, data: { error: null, attempts: 0, nextAttemptAt: null } });
      return { ok: true, kind: "retried" };
    }
    case OUTLET_INTENT.badge: {
      // The badge of one running sale, shown or hidden on the storefront; nothing else of the sale changes.
      const show = String(form.get(OUTLET_FIELD.badge) ?? "") !== "hide";
      const r = await setOutletBadge(deps, runId, show);
      return r.ok ? { ok: true, kind: show ? "badgeShown" : "badgeHidden" } : { ok: false, reason: "failed", message: r.message };
    }
    case OUTLET_INTENT.reopen:
      return outcome(await reopenOutletRun(deps, runId), "reopened");
    case OUTLET_INTENT.keep:
      return (await keepOutletEnded(deps, runId)) ? { ok: true, kind: "kept" } : { ok: false, reason: "failed", message: "not an ended sale" };
    case OUTLET_INTENT.settings: {
      // B15: on Free the module runs only while earlier sales finish; with none of them the settings change nothing.
      if ((await ctxPlan(ctx)) !== "pro") {
        const finishing = await ctx.db.outletRun.count({ where: { shop: ctx.shop, status: { not: "ended" } } });
        if (finishing === 0) return { ok: false, reason: "invalid", errors: [{ field: OUTLET_FIELD.display, key: "outlet.error.settingsPro" }] };
      }
      const loaded = await loadConfig(ctx.db, ctx.shop);
      const next = readOutletSettings(form, loaded.config.modules.outlet);
      const saved = await saveConfigSection(ctx, {
        ...readSaveOptions(form),
        path: "modules.outlet",
        pick: (config) => config.modules.outlet,
        apply: (config) => ({ ...config, modules: { ...config.modules, outlet: { ...config.modules.outlet, ...next } } }),
      });
      // Audit A3: the running sales' storefront value takes the new display now (the struck price of a running
      // sale stays as it started: compare_at is written at the start only).
      if (saved.ok) {
        const active = await ctx.db.outletRun.findMany({ where: { shop: ctx.shop, status: "active" }, select: { productId: true } });
        if (active.length) await writeOutletStorefront(deps, [...new Set(active.map((r) => r.productId))]);
      }
      return saved;
    }
    default:
      return { ok: false, reason: "bad_request" };
  }
}

// --- Přehled ----------------------------------------------------------------------------------------------

/** The sales Přehled speaks about: running ones, ended ones with returned pieces to decide, ones with a failed step. */
export function outletOverviewRuns(ctx: Pick<ShopCtx, "db" | "shop">): Promise<RunRow[]> {
  return ctx.db.outletRun.findMany({
    where: { shop: ctx.shop, OR: [{ status: { not: "ended" } }, { returnPending: { gt: 0 } }, { error: { not: null } }] },
  });
}

export async function loadOutletOverview(ctx: ShopCtx): Promise<OutletOverviewView> {
  const rows = await outletOverviewRuns(ctx);
  const pending = rows.filter((r) => r.status === "ended" && r.returnPending > 0);
  const [titles, ordersCounted] = await Promise.all([
    pending.length ? variantTitles(ctx, pending.map((r) => r.variantId)) : Promise.resolve(new Map<string, string>()),
    ordersAccess(ctx),
  ]);
  return outletOverviewOf(rows, titles, ordersCounted);
}

/** The Přehled card from the shop's sales (pure). */
export function outletOverviewOf(rows: readonly RunRow[], titles: ReadonlyMap<string, string>, ordersCounted: boolean): OutletOverviewView {
  return {
    running: rows.filter((r) => r.status !== "ended").length,
    // P4: the running sales by name (a sale whose title could not be read is left out of the names, not of the count).
    runningTitles: rows.filter((r) => r.status !== "ended").map((r) => titles.get(r.variantId) ?? "").filter(Boolean),
    pendingReturns: rows.filter((r) => r.status === "ended" && r.returnPending > 0).map((r) => ({ runId: r.id, title: titles.get(r.variantId) ?? "", qty: r.returnPending })),
    // Only where there is something to do about it (audit N16): a sale that is ACTIVE can be ended; one that is starting or ending cannot.
    oversold: rows.filter((r) => outletOversold(r) > 0 && r.status === "active").length,
    problems: rows.filter((r) => r.error !== null && r.status !== "ended").length,
    ordersCounted,
  };
}

/** Unused config parts stay as stored (§14a): only display and reopen are written by this module. */
export type OutletSettings = Pick<WonDiscountsConfig["modules"]["outlet"], "display" | "reopenOnReturnAfterEnd">;
