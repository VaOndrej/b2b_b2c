// Kontrola kombinací, the reading part (feedback 2026-10-06, bod 16): the facts the scenarios are built from come
// from the app's own database — the cost mirror (a variant's price and purchase cost), the refs the sync wrote
// per product, the running sales — and NEVER from Shopify: opening Přehled or Vyzkoušet košík asks Shopify nothing
// more for it. The check is computed when the page opens, from the stored config: it is therefore always the
// state after the last save, and a campaign's day is today's.
// BILL-1: the count of warnings is every plan's; which scenarios and why is Pro — on Free the view carries no
// scenario at all (the page shows the locked list, the server sends nothing to show in it).

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { toMinorUnits } from "@won/core/discounts/money";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import { t, type MessageKey } from "../../i18n";
import { marketView, type MarketNames } from "../../components/model/markets";
import type { CombinationCheckView, CombinationScenarioView } from "../../components/model/types";
import { foldedForCheckout } from "../sync/margin-fold";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { shopLocalDateTime } from "../sync/sync.server";
import type { TryCartScreenProps } from "../../components/screens/TryCartScreen";
import { FINDING_HREF, runScenarios, scenarioLines, type Scenario, type ScenarioFacts, type ScenarioProduct, type ScenarioResult } from "./combination-check";
import { nowOf, type ShopCtx } from "./context.server";
import { parseProductRefs } from "./try-cart-plan";

/** Variants with a purchase cost the lowest margin is looked for among (the mirror can hold a whole catalogue). */
export const SCENARIO_COST_ROWS = 300;

type CostRow = { variantId: string; productId: string; title: string | null; variantTitle: string | null; price: string; cost: string | null; currency: string | null };

/**
 * The shop's products for the scenarios, from the database: the variant with the lowest margin (price against
 * purchase cost), a product with its own quantity tiers, a variant on sale — each with the refs checkout reads.
 * [] = the app has no product stored (the scenarios then use a sample one).
 */
export async function loadScenarioProducts(db: ShopCtx["db"], shop: string, shopCurrency: string): Promise<ScenarioProduct[]> {
  const select = { variantId: true, productId: true, title: true, variantTitle: true, price: true, cost: true, currency: true } as const;
  const [costed, anyRow, sale, own] = await Promise.all([
    db.variantCost.findMany({ where: { shop, cost: { not: null } }, select, take: SCENARIO_COST_ROWS, orderBy: { variantId: "asc" } }),
    db.variantCost.findFirst({ where: { shop }, select, orderBy: { variantId: "asc" } }),
    db.outletRun.findFirst({ where: { shop, status: "active" }, select: { variantId: true }, orderBy: { id: "asc" } }),
    db.productTargetIndex.findFirst({ where: { shop, value: { contains: '"tierRef":"' } }, select: { productId: true }, orderBy: { productId: "asc" } }),
  ]);
  const margin = (row: CostRow) => {
    const price = Number(row.price);
    const cost = Number(row.cost);
    return price > 0 && Number.isFinite(cost) ? (price - cost) / price : Number.POSITIVE_INFINITY;
  };
  const lowest = [...costed].sort((a, b) => margin(a) - margin(b) || (a.variantId < b.variantId ? -1 : 1))[0];
  const [saleRow, ownRow] = await Promise.all([
    sale ? db.variantCost.findFirst({ where: { shop, variantId: sale.variantId }, select }) : null,
    own ? db.variantCost.findFirst({ where: { shop, productId: own.productId }, select, orderBy: { variantId: "asc" } }) : null,
  ]);
  const picked: [CostRow | null | undefined, ScenarioProduct["role"]][] = [
    [lowest, "lowMargin"],
    [lowest ? null : anyRow, "any"],
    [ownRow, "exception"],
    [saleRow, "outlet"],
  ];
  const rows = picked.filter((entry): entry is [CostRow, ScenarioProduct["role"]] => !!entry[0]);
  const index = await db.productTargetIndex.findMany({ where: { shop, productId: { in: [...new Set(rows.map(([row]) => row.productId))] } }, select: { productId: true, value: true } });
  const refs = new Map(index.filter((row) => row.value).map((row) => [row.productId, parseProductRefs(row.value)]));
  const out: ScenarioProduct[] = [];
  for (const [row, role] of rows) {
    const unitPrice = toMinorUnits(row.price, shopCurrency);
    if (unitPrice === null || unitPrice <= 0) continue;
    const cost = row.cost === null ? Number.NaN : Number(row.cost);
    out.push({
      variantId: row.variantId,
      productId: row.productId,
      title: [row.title, row.variantTitle].filter(Boolean).join(" — "),
      unitPrice,
      ...(Number.isFinite(cost) && cost > 0 && row.currency ? { unitCost: cost, unitCostCurrency: row.currency } : {}),
      ...(refs.has(row.productId) ? { refs: refs.get(row.productId)! } : {}),
      role,
    });
  }
  return out;
}

/** "Množstevní sleva + kód LETO10" — the scenario by what is in it. */
export function scenarioTitle(scenario: Scenario, locale: "cs" | "en"): string {
  const parts = scenario.parts
    .filter((part) => part !== "market")
    .map((part) => t(locale, `combos.part.${part}` as MessageKey, { code: scenario.code ?? "", name: scenario.campaign ?? "" }));
  const text = parts.join(" + ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function scenarioView(result: ScenarioResult, opts: { locale: "cs" | "en"; marketNames: MarketNames; home: string }): CombinationScenarioView {
  const { scenario, findings, detail } = result;
  const sample = scenario.lines.some((line) => line.product.role === "sample");
  return {
    id: scenario.id,
    title: scenarioTitle(scenario, opts.locale),
    market: scenario.market.handle && scenario.market.key !== opts.home ? marketView(scenario.market.handle, opts.marketNames).name : null,
    status: findings.length > 0 ? "warning" : "ok",
    findings: findings.map((kind) => ({ kind, text: t(opts.locale, `combos.finding.${kind}` as MessageKey), href: FINDING_HREF[kind] })),
    estimate: scenario.rate !== undefined,
    currency: scenario.market.currency,
    subtotal: detail.view.totals.subtotal,
    discount: detail.view.totals.productDiscount + detail.view.totals.orderDiscount,
    // A sample product is not the shop's: there is nothing to open in the manual cart.
    open: sample ? null : `/app/try-cart?scenario=${encodeURIComponent(scenario.id)}`,
  };
}

export interface CombinationFacts {
  /** The STORED config (gated here for the plan, as the sync gates it). */
  config: WonDiscountsConfig;
  plan: ShopPlan;
  shopCurrency: string | null;
  timezone: string | null;
  marketNames?: MarketNames;
}

/** The scenarios of the shop planned now, with the facts they were planned from; null = the shop's currency or time zone is not known. */
export async function runCombinationCheck(ctx: ShopCtx, facts: CombinationFacts): Promise<{ results: ScenarioResult[]; facts: ScenarioFacts; sample: boolean } | null> {
  if (!facts.shopCurrency || !facts.timezone) return null;
  const local = shopLocalDateTime(nowOf(ctx), facts.timezone);
  const finishing = (await loadShopSyncFacts(ctx.db, ctx.shop).catch(() => null))?.campaignsFinishing ?? [];
  const gated = await foldedForCheckout(ctx.db, ctx.shop, gateConfigForPlan(facts.config, facts.plan, { now: local, finishing }).config);
  const products = await loadScenarioProducts(ctx.db, ctx.shop, facts.shopCurrency);
  const scenarioFacts: ScenarioFacts = { products, shopCurrency: facts.shopCurrency, shopTimezone: facts.timezone, date: local.slice(0, 10), time: local.slice(11), locale: ctx.locale };
  return { results: runScenarios(gated, scenarioFacts), facts: scenarioFacts, sample: products.length === 0 };
}

/**
 * The check as a page shows it. Free gets the two counts only (BILL-1: the scenarios never leave the server);
 * null = nothing runs, or the shop's currency / time zone is not known — the page then shows no check at all.
 */
export async function combinationCheck(ctx: ShopCtx, facts: CombinationFacts): Promise<CombinationCheckView | null> {
  const run = await runCombinationCheck(ctx, facts);
  return run ? combinationView(run.results, { plan: facts.plan, locale: ctx.locale, marketNames: facts.marketNames ?? {}, sample: run.sample }) : null;
}

/** The planned scenarios as a page shows them (pure; the dev harness uses it on fixtures). null = no scenario. */
export function combinationView(results: readonly ScenarioResult[], opts: { plan: ShopPlan; locale: "cs" | "en"; marketNames: MarketNames; sample: boolean }): CombinationCheckView | null {
  if (results.length === 0) return null;
  const warnings = results.filter((r) => r.findings.length > 0).length;
  const counts = { ok: results.length - warnings, warnings, sample: opts.sample };
  if (opts.plan !== "pro") return counts;
  const home = results.find((r) => !r.scenario.parts.includes("market"))?.scenario.market.key ?? "";
  return { ...counts, scenarios: results.map((result) => scenarioView(result, { locale: opts.locale, marketNames: opts.marketNames, home })) };
}

/**
 * One scenario as the manual cart takes it (`?scenario=<id>` on Vyzkoušet košík): its lines with the stored
 * prices, the code discounts to tick, its market and time. null = no such scenario, or it uses a sample product.
 */
export async function scenarioCart(ctx: ShopCtx, facts: CombinationFacts, id: string): Promise<Pick<TryCartScreenProps, "lines" | "ruleIds" | "currency" | "date" | "time" | "opened"> | null> {
  const run = await runCombinationCheck(ctx, facts);
  const found = run?.results.find((result) => result.scenario.id === id)?.scenario;
  if (!run || !found || found.lines.some((line) => line.product.role === "sample")) return null;
  const priced = scenarioLines(found, run.facts);
  return {
    lines: found.lines.map(({ product, quantity }, i) => ({ variantId: product.variantId, productId: product.productId, title: product.title, quantity, unitPrice: { [found.market.currency]: priced[i]!.unitPrice } })),
    ruleIds: found.ruleIds,
    currency: found.market.handle ? `${found.market.currency}:${found.market.handle}` : found.market.currency,
    date: found.date,
    time: found.time.slice(0, 5),
    opened: scenarioTitle(found, ctx.locale),
  };
}
