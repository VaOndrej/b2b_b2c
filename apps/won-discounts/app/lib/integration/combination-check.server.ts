// Kontrola kombinací, the reading part (feedback 2026-10-06, bod 16): the facts the scenarios are built from come
// from the app's own database — the cost mirror (a variant's price and purchase cost), the refs the sync wrote
// per product, the running sales — and NEVER from Shopify. The check is computed after every sync of the shop's
// config (a save, a resync) and once a day by the scheduler (a campaign's day moves), and STORED
// (CombinationCheck): Přehled and Vyzkoušet košík read that one row and compute nothing.
// BILL-1: the count of warnings is every plan's; which scenarios and why is Pro — on Free the view carries no
// scenario at all (the page shows the locked list, the server sends nothing to show in it).

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { milestoneSteps } from "@won/core/discounts/milestones";
import { toMinorUnits } from "@won/core/discounts/money";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import { t, translator, type MessageKey, type Translator } from "../../i18n";
import { ruleName } from "../../components/model/describe";
import { marketView, type MarketNames } from "../../components/model/markets";
import type { CombinationCheckView, CombinationScenarioView } from "../../components/model/types";
import { foldedForCheckout } from "../sync/margin-fold";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";
import { shopLocalDateTime } from "../sync/sync.server";
import type { TryCartScreenProps } from "../../components/screens/TryCartScreen";
import { FINDING_HREF, runScenarios, scenarioLines, type Finding, type Scenario, type ScenarioFacts, type ScenarioProduct, type ScenarioResult } from "./combination-check";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import type { ShopCtx } from "./context.server";
import { parseProductRefs } from "./try-cart-plan";

/** Variants with a purchase cost the lowest margin is looked for among (the mirror can hold a whole catalogue). */
export const SCENARIO_COST_ROWS = 300;
/** Products listed from Shopify (margin protection off) are read again after this long. */
export const LISTED_PRODUCTS_MAX_AGE_MS = 24 * 3_600_000;

type CostRow = { variantId: string; productId: string; title: string | null; variantTitle: string | null; price: string; cost: string | null; currency: string | null };

/**
 * A variant as Shopify listed it for the scenarios (readScenarioProducts): the shop's first active product and
 * the products the scenarios need by id. Kept in the stored check, so a page never asks for it.
 */
export interface ListedVariant {
  variantId: string;
  productId: string;
  title: string;
  /** Decimal string in the shop currency. */
  price: string;
}

/** The product ids the scenarios need by name: one a product / collection discount aims at, one with its own tiers, the one on sale. */
async function neededProducts(db: ShopCtx["db"], shop: string) {
  const [sale, own, aimed] = await Promise.all([
    db.outletRun.findFirst({ where: { shop, status: "active" }, select: { variantId: true, productId: true }, orderBy: { id: "asc" } }),
    db.productTargetIndex.findFirst({ where: { shop, value: { contains: '"tierRef":"' } }, select: { productId: true }, orderBy: { productId: "asc" } }),
    db.productTargetIndex.findFirst({ where: { shop, value: { contains: '"ruleIds":["' } }, select: { productId: true }, orderBy: { productId: "asc" } }),
  ]);
  return { sale, own, aimed };
}

/**
 * The shop's products for the scenarios, from the database: the variant with the lowest margin (price against
 * purchase cost), a product a product / collection discount aims at, a product with its own quantity tiers, a
 * variant on sale — each with the refs checkout reads. Prices and costs come from the cost mirror; a shop without
 * one (margin protection off) uses `listed`, the few products last read from Shopify, without costs.
 * [] = the app has no product stored (the scenarios then use a sample one).
 */
export async function loadScenarioProducts(db: ShopCtx["db"], shop: string, shopCurrency: string, listed: readonly ListedVariant[] = []): Promise<ScenarioProduct[]> {
  const select = { variantId: true, productId: true, title: true, variantTitle: true, price: true, cost: true, currency: true } as const;
  const [costed, anyRow, needed] = await Promise.all([
    db.variantCost.findMany({ where: { shop, cost: { not: null } }, select, take: SCENARIO_COST_ROWS, orderBy: { variantId: "asc" } }),
    db.variantCost.findFirst({ where: { shop }, select, orderBy: { variantId: "asc" } }),
    neededProducts(db, shop),
  ]);
  const margin = (row: CostRow) => {
    const price = Number(row.price);
    const cost = Number(row.cost);
    return price > 0 && Number.isFinite(cost) ? (price - cost) / price : Number.POSITIVE_INFINITY;
  };
  const lowest = [...costed].sort((a, b) => margin(a) - margin(b) || (a.variantId < b.variantId ? -1 : 1))[0];
  // Without the mirror: what Shopify listed, in the mirror's shape (no purchase cost).
  const fromList = (match: (v: ListedVariant) => boolean): CostRow | null => {
    const found = listed.find(match);
    return found ? { ...found, variantTitle: null, cost: null, currency: null } : null;
  };
  const mirrored = anyRow !== null;
  const { sale, own, aimed } = needed;
  const [saleRow, ownRow, aimedRow] = mirrored
    ? await Promise.all([
        sale ? db.variantCost.findFirst({ where: { shop, variantId: sale.variantId }, select }) : null,
        own ? db.variantCost.findFirst({ where: { shop, productId: own.productId }, select, orderBy: { variantId: "asc" } }) : null,
        aimed ? db.variantCost.findFirst({ where: { shop, productId: aimed.productId }, select, orderBy: { variantId: "asc" } }) : null,
      ])
    : [sale ? fromList((v) => v.variantId === sale.variantId) : null, own ? fromList((v) => v.productId === own.productId) : null, aimed ? fromList((v) => v.productId === aimed.productId) : null];
  const picked: [CostRow | null | undefined, ScenarioProduct["role"]][] = [
    [lowest, "lowMargin"],
    [lowest ? null : mirrored ? anyRow : fromList(() => true), "any"],
    [aimedRow, "targeted"],
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

// Validated with the Shopify dev MCP (admin 2026-04): read_products.
const PRODUCTS_QUERY = `#graphql
query WonCombinationProducts($ids: [ID!]!) {
  products(first: 1, sortKey: ID, query: "status:active") {
    nodes {
      id
      title
      variants(first: 10) {
        nodes {
          id
          title
          price
        }
      }
    }
  }
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      variants(first: 10) {
        nodes {
          id
          title
          price
        }
      }
    }
  }
}`;

type ProductNode = { id?: string; title?: string; variants?: { nodes?: { id?: string; title?: string; price?: string }[] } } | null;

/**
 * ONE Shopify read for a shop without the cost mirror: its first active product and the products the scenarios
 * need by id, with their variants' prices. Never called when a page opens (refreshCombinationCheck decides).
 */
export async function readScenarioProducts(client: AdminClient, productIds: readonly string[]): Promise<ListedVariant[]> {
  const result = await client.graphql<{ products?: { nodes?: ProductNode[] }; nodes?: ProductNode[] }>(PRODUCTS_QUERY, { ids: [...new Set(productIds)] });
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const out: ListedVariant[] = [];
  for (const product of [...(result.data?.products?.nodes ?? []), ...(result.data?.nodes ?? [])]) {
    if (!product?.id) continue;
    for (const variant of product.variants?.nodes ?? []) {
      if (!variant.id || typeof variant.price !== "string" || out.some((v) => v.variantId === variant.id)) continue;
      const own = variant.title && variant.title !== "Default Title" ? ` — ${variant.title}` : "";
      out.push({ variantId: variant.id, productId: product.id, title: `${product.title ?? ""}${own}`, price: variant.price });
    }
  }
  return out;
}

/** "Množstevní sleva + kód LETO10" — the scenario by what is in it. */
export function scenarioTitle(scenario: Pick<Scenario, "parts" | "code" | "campaign">, locale: "cs" | "en"): string {
  const parts = scenario.parts
    .filter((part) => part !== "market")
    .map((part) => t(locale, `combos.part.${part}` as MessageKey, { code: scenario.code ?? "", name: scenario.campaign ?? "" }));
  const text = parts.join(" + ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Where the discount behind a finding is set and what its link says: the discount's own editor, the step's card
 * on Milníky, the tier set's section. A finding the plan names no discount for (or one no longer stored) leads to
 * its module's page.
 */
export function findingLink(finding: Finding, config: WonDiscountsConfig, tr: Translator): { href: string; label: string } {
  const cause = finding.cause;
  if (cause?.type === "rule") {
    const rule = config.modules.codes.rules.find((r) => r.id === cause.id);
    if (rule) return { href: `/app/discounts/${encodeURIComponent(rule.id)}${finding.kind === "not_combinable" ? "#combines" : ""}`, label: tr.t("combos.fix.rule", { name: ruleName(rule, tr) }) };
  }
  if (cause?.type === "step") {
    const index = milestoneSteps(config).findIndex((step) => step.id === cause.id);
    if (index >= 0) return { href: `/app/rewards#step-${index + 1}`, label: tr.t("combos.fix.step", { n: index + 1 }) };
  }
  if (cause?.type === "tiers") {
    const set = config.modules.tiers.sets.find((s) => s.id === cause.id);
    if (set) return { href: set.scope === "global" ? "/app/tiers#global" : "/app/tiers#pro", label: tr.t("combos.fix.tiers") };
  }
  return { href: FINDING_HREF[finding.kind], label: tr.t("combos.fix") };
}

// --- The stored check ------------------------------------------------------------------------------------

/** The manual cart a scenario opens (`?scenario=<id>`): its lines with the stored prices, the code discounts to tick, its market and time. */
export type ScenarioCart = Pick<TryCartScreenProps, "lines" | "ruleIds" | "currency" | "date" | "time">;

/** One planned scenario as it is stored: what it is, what was found, the money — no wording (the pages word it). */
export interface StoredScenario {
  id: string;
  parts: Scenario["parts"];
  code?: string;
  campaign?: string;
  /** The market's handle when the scenario is not the shop's own market. */
  market: string | null;
  findings: Finding[];
  estimate: boolean;
  currency: string;
  subtotal: number;
  discount: number;
  /** null = it uses a sample product: nothing of the shop's to open. */
  cart: ScenarioCart | null;
}

export interface StoredCheck {
  scenarios: StoredScenario[];
  /** The shop has no product stored: the carts use a sample one. */
  sample: boolean;
}

/** The planned scenarios as they are stored (pure; the dev harness builds its fixture the same way). */
export function storedCheck(results: readonly ScenarioResult[], facts: Pick<ScenarioFacts, "shopCurrency" | "products">): StoredCheck {
  const home = results.find((r) => !r.scenario.parts.includes("market"))?.scenario.market.key ?? "";
  return {
    sample: facts.products.length === 0,
    scenarios: results.map(({ scenario, findings, detail }) => {
      const priced = scenarioLines(scenario, facts);
      const sample = scenario.lines.some((line) => line.product.role === "sample");
      return {
        id: scenario.id,
        parts: scenario.parts,
        ...(scenario.code ? { code: scenario.code } : {}),
        ...(scenario.campaign ? { campaign: scenario.campaign } : {}),
        market: scenario.market.handle && scenario.market.key !== home ? scenario.market.handle : null,
        findings,
        estimate: scenario.rate !== undefined,
        currency: scenario.market.currency,
        subtotal: detail.view.totals.subtotal,
        discount: detail.view.totals.productDiscount + detail.view.totals.orderDiscount,
        cart: sample
          ? null
          : {
              lines: scenario.lines.map(({ product, quantity }, i) => ({ variantId: product.variantId, productId: product.productId, title: product.title, quantity, unitPrice: { [scenario.market.currency]: priced[i]!.unitPrice } })),
              ruleIds: scenario.ruleIds,
              currency: scenario.market.handle ? `${scenario.market.currency}:${scenario.market.handle}` : scenario.market.currency,
              date: scenario.date,
              time: scenario.time.slice(0, 5),
            },
      };
    }),
  };
}

/**
 * The stored check as a page shows it (pure). Free gets the two counts only (BILL-1: the scenarios never leave
 * the server); null = no scenario. `config` = the STORED config: a finding's link names its discount and the
 * step's place on the Milníky page.
 */
export function combinationView(check: StoredCheck, opts: { plan: ShopPlan; locale: "cs" | "en"; marketNames: MarketNames; config: WonDiscountsConfig }): CombinationCheckView | null {
  if (check.scenarios.length === 0) return null;
  const warnings = check.scenarios.filter((s) => s.findings.length > 0).length;
  const counts = { ok: check.scenarios.length - warnings, warnings, sample: check.sample };
  if (opts.plan !== "pro") return counts;
  const tr = translator(opts.locale);
  return {
    ...counts,
    scenarios: check.scenarios.map(
      (s): CombinationScenarioView => ({
        id: s.id,
        title: scenarioTitle(s, opts.locale),
        market: s.market ? marketView(s.market, opts.marketNames).name : null,
        status: s.findings.length > 0 ? "warning" : "ok",
        findings: s.findings.map((finding) => ({ kind: finding.kind, text: tr.t(`combos.finding.${finding.kind}` as MessageKey), ...findingLink(finding, opts.config, tr) })),
        estimate: s.estimate,
        currency: s.currency,
        subtotal: s.subtotal,
        discount: s.discount,
        // A sample product is not the shop's: there is nothing to open in the manual cart.
        open: s.cart ? `/app/try-cart?scenario=${encodeURIComponent(s.id)}` : null,
      }),
    ),
  };
}

/** One stored scenario as the manual cart takes it, with the sentence that says where the cart came from; null = no such scenario, or it uses a sample product. */
export function scenarioCartOf(check: StoredCheck, id: string, locale: "cs" | "en"): (ScenarioCart & Pick<TryCartScreenProps, "opened">) | null {
  const found = check.scenarios.find((s) => s.id === id);
  return found?.cart ? { ...found.cart, opened: scenarioTitle(found, locale) } : null;
}

export interface CombinationFacts {
  /** "free" | "pro": the scenarios are gated for it, as the sync gates the config. */
  plan: ShopPlan;
  shopCurrency: string | null;
  timezone: string | null;
  now: Date;
  /**
   * Shopify, when the caller has it (a sync, the daily run with the shop's session): a shop without the cost
   * mirror gets its few products read through it — once a day at most, or when a product the scenarios need is
   * not among the stored ones. Absent = the stored ones are used as they are.
   */
  client?: AdminClient;
  logger?: Pick<SyncLogger, "warn">;
}

/**
 * Plan the shop's scenarios from what the database holds and store them — after a sync of its config and once a
 * day (the scheduler), never when a page opens. Asks Shopify nothing. Nothing runs, or the shop's currency or
 * time zone is not known → the stored check is removed (the pages then show none).
 */
export async function refreshCombinationCheck(db: ShopCtx["db"], shop: string, facts: CombinationFacts): Promise<StoredCheck | null> {
  const loaded = await loadConfig(db, shop);
  if (!loaded.exists || loaded.unreadable || !facts.shopCurrency || !facts.timezone) {
    await db.combinationCheck.deleteMany({ where: { shop } });
    return null;
  }
  const listed = await listedProducts(db, shop, facts);
  const local = shopLocalDateTime(facts.now, facts.timezone);
  const finishing = (await loadShopSyncFacts(db, shop).catch(() => null))?.campaignsFinishing ?? [];
  const gated = await foldedForCheckout(db, shop, gateConfigForPlan(loaded.config, facts.plan, { now: local, finishing }).config);
  const products = await loadScenarioProducts(db, shop, facts.shopCurrency, listed.variants);
  // The wording is the pages' (they word the stored result in the admin's language); the plan's own texts are not stored.
  const scenarioFacts: ScenarioFacts = { products, shopCurrency: facts.shopCurrency, shopTimezone: facts.timezone, date: local.slice(0, 10), time: local.slice(11), locale: "en" };
  const computed = storedCheck(runScenarios(gated, scenarioFacts), scenarioFacts);
  const row = { computedAt: facts.now, plan: facts.plan, payload: JSON.stringify(computed), products: JSON.stringify(listed.variants), productsReadAt: listed.readAt };
  await db.combinationCheck.upsert({ where: { shop }, create: { shop, ...row }, update: row });
  return computed.scenarios.length > 0 ? computed : null;
}

/**
 * The products Shopify listed for a shop without the cost mirror: the stored ones, read again through
 * `facts.client` when there are none, they are a day old, or a product the scenarios need is missing. A read that
 * fails keeps the stored ones (the check is never the reason a save fails).
 */
async function listedProducts(db: ShopCtx["db"], shop: string, facts: CombinationFacts): Promise<{ variants: ListedVariant[]; readAt: Date | null }> {
  const [row, mirrored, needed] = await Promise.all([
    db.combinationCheck.findUnique({ where: { shop }, select: { products: true, productsReadAt: true } }),
    db.variantCost.findFirst({ where: { shop }, select: { id: true } }),
    neededProducts(db, shop),
  ]);
  // The mirror holds every variant with its price and cost: nothing to list.
  if (mirrored) return { variants: [], readAt: null };
  let stored: ListedVariant[] = [];
  try {
    const parsed: unknown = JSON.parse(row?.products ?? "[]");
    if (Array.isArray(parsed)) stored = parsed.filter((v): v is ListedVariant => typeof v?.variantId === "string" && typeof v?.productId === "string" && typeof v?.price === "string");
  } catch {
    stored = [];
  }
  const readAt = row?.productsReadAt ?? null;
  if (!facts.client) return { variants: stored, readAt };
  const ids = [needed.sale?.productId, needed.own?.productId, needed.aimed?.productId].filter((id): id is string => typeof id === "string");
  const fresh = readAt !== null && facts.now.getTime() - readAt.getTime() < LISTED_PRODUCTS_MAX_AGE_MS && stored.length > 0 && ids.every((id) => stored.some((v) => v.productId === id));
  if (fresh) return { variants: stored, readAt };
  try {
    return { variants: await readScenarioProducts(facts.client, ids), readAt: facts.now };
  } catch (error) {
    if (error instanceof Response) throw error;
    facts.logger?.warn(`combination check ${shop}: the shop's products could not be read (${errorText(error)}); the stored ones are used`);
    return { variants: stored, readAt };
  }
}

/** The shop's stored check; null = none (nothing runs, or it was never computed). */
export async function loadStoredCheck(db: ShopCtx["db"], shop: string): Promise<StoredCheck | null> {
  const row = await db.combinationCheck.findUnique({ where: { shop }, select: { payload: true } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as StoredCheck;
    return Array.isArray(parsed?.scenarios) ? parsed : null;
  } catch {
    return null;
  }
}

/** The check as a page shows it: one row read, nothing computed, nothing asked of Shopify. */
export async function combinationCheck(ctx: ShopCtx, opts: { plan: ShopPlan; marketNames?: MarketNames; config: WonDiscountsConfig }): Promise<{ view: CombinationCheckView; stored: StoredCheck } | null> {
  const stored = await loadStoredCheck(ctx.db, ctx.shop);
  const view = stored ? combinationView(stored, { plan: opts.plan, locale: ctx.locale, marketNames: opts.marketNames ?? {}, config: opts.config }) : null;
  return stored && view ? { view, stored } : null;
}
