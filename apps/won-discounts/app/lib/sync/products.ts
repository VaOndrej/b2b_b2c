// Product targeting write (spec §1 C3, T1 targeting.ts): the engine's
// `productRuleIndex` → `$app:won_discounts`/`product` =
// productMetafieldValue(entry) = {"ruleIds": [...], "variantRuleIds": {"<variant numeric id>": [...]}, "marginRefs"?: [...]}
// on every targeted product, so the function never needs rule id lists.
//
// Margin protection (MVP 2): the collections with a margin setting (core
// marginCollectionIds — only while protection is on, and read from the GATED
// config the sync passes in, so a Free shop never gets them) are read like
// targeted collections; their products carry `marginRefs` (the engine takes
// the strictest collection setting from them). A product in such a collection
// gets the metafield even without any rule. The core writes a product's
// DECISIVE collections, so a collection's value change can replace a ref, not
// only add one (MVP 2 audit P2-3): every write that CHANGES a product's
// marginRefs goes in the BEFORE lane (also for a product that carries no Won
// refs yet), and when it fails the new shop config is held (staleRisk,
// retried) — so the new config never relies on refs its products do not
// carry. The one exception: dropping a ref whose collection has no setting in
// force any more holds nothing — checkout ignores a ref its config does not
// name, so the stale ref never loosens a floor (onlyAddsRefs).
//
// Which products carry our metafield is sync bookkeeping in Prisma
// ProductTargetIndex {shop, productId, payloadHash} (DATA-1; no cap). A row
// exists for every product that may carry the metafield (write-ahead), so a
// product WITHOUT a row carries no Won refs.
//
// Collection size limit (F2 re-review M-4/M-5, MVP 2 audit P1-1): Won reads
// at most MAX_COLLECTION_PRODUCTS collection members per sync, all targeted
// collections together. Their sizes are read first (productsCount, one cheap
// query), the MARGIN collections first (they protect the floor; a rule
// collection left out only means less discount), then the rules' in config
// order. A collection that does not fit (or that Shopify only counts as "at
// least") is left out:
//   - a rule collection: out of the product refs of the rules that target it
//     — those rules do not apply to it at checkout, each says so in a failed
//     step `products.too_large:<ruleId>` (fail closed: less discount);
//   - a margin collection: its products get no marginRef for it (they cannot
//     be read), and the shop payload the sync writes FOLDS its values into the
//     global values and into every other collection's own values — strictest
//     wins (max min-margin, min max-discount), like core gateConfigForPlan does
//     for Free — so no product can get a looser floor than that collection's.
//     The product refs are computed from that SAME folded view (audit fix
//     round 4): decisive under the payload that ships. A ref a product carries
//     for it is not kept by hand any more (round 4): while the LIVE config
//     still lists the collection, the flip's bridge keeps it (its membership
//     is unknown: status quo, or read one by one — see bridgeMarginRefs); once
//     the live config folds it too, checkout ignores the ref. So a product
//     carries at most 4 refs (2 new + 2 live). Failed step `margin.too_large`
//     per collection, with its id, title and count as `params` for the admin
//     (sync-copy.ts).
// EVERYTHING ELSE goes on: one huge collection never holds the other rules'
// changes. A paging backstop still stops a read that runs past the limit anyway.
//
// Two lanes around the shop-config flip (sync.server.ts, M1 + audit P2-8):
//   plan    targeted = product ids, products of targeted variants, collection
//           members (paged 250, within the limit above);
//           candidates = targeted ∪ indexed; desired value per candidate
//           (productRuleIndex → productMetafieldValue); skip where the stored
//           payloadHash already equals it (no read, no write). Products that
//           carry our metafield (indexed) and must change — and products that
//           left every target — are read once (nodes(), 100 per query): deleted
//           ones are dropped, an identical Shopify value is only recorded;
//   before  (BEFORE the new shop config is written) every change to a product
//           that already carries Won refs (a marginRef change included), every
//           clear, and every product that GAINS a marginRef (read first, like
//           the indexed ones): a product
//           must lose a rule ref before the new config can give that rule a
//           new value through it, and carry a stricter collection before the
//           new config relies on it. WRITE-AHEAD: a row is set to payloadHash =
//           null before its write. metafieldsSet ≤ 25 per call (row hash on
//           success), metafieldsDelete ≤ 250 per call (row deleted on success);
//   after   (AFTER the flip) products that carry no Won refs yet and only GAIN
//           rule refs: until written they simply lack the new rules
//           (under-discount, never a wrong value). The admin save runs this
//           lane in the background (in-process queue, sync.server.ts) so a
//           rule on a large collection never holds the request.
// `staleRisk` = some product may not carry what the new config relies on: a
// clear failed, a failed SET would have REMOVED a rule ref (its new set of
// rule refs is not a superset of what Shopify has — audit P2-1) or CHANGED
// its marginRefs (MVP 2 audit P2-3, see above), or the plan could not finish,
// or a product crossing the flip may be in a collection the live config lists
// but this pass did not read and that membership could not be read one by one
// either (audit fix round 4, bridgeCrossing: it keeps its value).
// The orchestrator then HOLDS the new shop config (M1) and the run is retried.
// A failed SET that only adds rule refs (or only drops marginRefs no setting
// names any more) does not hold anything.
// `entry.oversized` (the engine had to shrink a product over its 9 000 B
// budget) is surfaced as a warning step naming the product and the rules.
//
// Index trust (audit P2-4): when the shop's function config is missing in
// Shopify (the first sync after an install or a reinstall — Shopify removes
// app-owned metafields on uninstall), a sample of the indexed products is
// read first; any product whose metafield is missing or different
// invalidates every hash of the shop (payloadHash = null), so this run
// re-verifies and rewrites them all.

import { marginCollectionIds, resolveMargin, type FunctionMarginPayload } from "@won/core/discounts/margin";
import { decisiveMarginRefs, parseRuleRef, productMetafieldValue, variantKey } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import { PRODUCT_KEY, WON_NAMESPACE } from "./graphql";
import { setSyncProgress } from "./progress";
import { errorText, userErrorText, type Transport, type UserErrorLike } from "./transport";
import type { ConfigView, SyncProductEntry, SyncProductInput, SyncStep } from "./types";
import { canonicalJson, chunks, hashText, METAFIELDS_DELETE_BATCH, METAFIELDS_SET_BATCH, NODES_BATCH, sameJson } from "./util";

/** Collection members read per sync, all targeted collections together (Shopify counts exactly up to 10 000). */
export const MAX_COLLECTION_PRODUCTS = 10_000;
/** The paging backstop's slack over MAX_COLLECTION_PRODUCTS (counts can lag a busy catalogue). */
const PAGING_SLACK = 1_000;

/** A product pass stopped because a newer sync of the shop superseded it (it redoes the work). */
export class SyncCancelled extends Error {
  constructor() {
    super("superseded by a newer sync");
    this.name = "SyncCancelled";
  }
}
/** Indexed products read to check the index after an install / reinstall. */
export const INDEX_SAMPLE_SIZE = 25;

/** No rule for the product nor for any of its variants, and no margin collection: the metafield should not exist. */
export function isEmptyEntry(entry: SyncProductEntry): boolean {
  return (
    entry.ruleIds.length === 0 &&
    Object.values(entry.variantRuleIds ?? {}).every((refs) => refs.length === 0) &&
    (entry.marginRefs ?? []).length === 0
  );
}

interface Scopes {
  productIds: Set<string>;
  variantIds: Set<string>;
  collectionIds: Set<string>;
}

function addScope(scopes: Scopes, target: unknown): void {
  if (!target || typeof target !== "object") return;
  const t = target as { kind?: unknown; productIds?: unknown; variantIds?: unknown; ids?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  if (t.kind === "products") {
    for (const id of strings(t.productIds)) scopes.productIds.add(id);
    for (const id of strings(t.variantIds)) scopes.variantIds.add(id);
  } else if (t.kind === "collections") {
    for (const id of strings(t.ids)) scopes.collectionIds.add(id);
  }
}

/**
 * Every product/variant/collection any rule (or non-killed campaign re-target)
 * points at, plus the collections with a margin setting while protection is
 * on — the set productRuleIndex reads. Pass the GATED config (BILL-1).
 */
export function targetScopes(config: ConfigView): Scopes {
  const scopes: Scopes = { productIds: new Set(), variantIds: new Set(), collectionIds: new Set() };
  const ruleIds = new Set<string>();
  for (const rule of config.modules.codes.rules) {
    ruleIds.add(rule.id);
    addScope(scopes, rule.target);
  }
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      if (ruleIds.has(override.ruleId)) addScope(scopes, (override.patch as { target?: unknown }).target);
    }
  }
  for (const id of marginCollectionIds(config.modules.margin)) scopes.collectionIds.add(id);
  return scopes;
}

const isCollectionsTarget = (target: unknown) => (target as { kind?: unknown } | null | undefined)?.kind === "collections";

/**
 * Does the rule target collections — itself, or through a campaign re-target
 * of it (not killed)? Collection membership changes (webhooks, a stale mark)
 * reach only such rules (F2 re-review M-3; Try Cart's stale warning).
 */
export function ruleTargetsCollections(config: ConfigView, ruleId: string): boolean {
  const rule = config.modules.codes.rules.find((r) => r.id === ruleId);
  if (!rule) return false;
  if (isCollectionsTarget(rule.target)) return true;
  return config.campaigns.some(
    (c) => !c.killed && c.overrides.some((o) => o.ruleId === ruleId && isCollectionsTarget((o.patch as { target?: unknown }).target)),
  );
}

/**
 * Does a product metafield ref ("ruleId", or "ruleId@campaignId" for a campaign
 * re-target) come from a collection target? The campaign-scoped ref follows
 * that campaign's re-target; the plain ref, the rule's own target.
 */
export function refTargetsCollections(config: ConfigView, ref: string): boolean {
  const { ruleId, campaignId } = parseRuleRef(ref);
  if (campaignId === undefined) {
    const rule = config.modules.codes.rules.find((r) => r.id === ruleId);
    return rule ? isCollectionsTarget(rule.target) : false;
  }
  const campaign = config.campaigns.find((c) => c.id === campaignId && !c.killed);
  return campaign?.overrides.some((o) => o.ruleId === ruleId && isCollectionsTarget((o.patch as { target?: unknown }).target)) ?? false;
}

/** True when some rule (or campaign re-target) targets products, variants or collections. */
export function hasProductTargets(config: ConfigView): boolean {
  const scopes = targetScopes(config);
  return scopes.productIds.size + scopes.variantIds.size + scopes.collectionIds.size > 0;
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

export interface ProductSyncArgs {
  transport: Transport;
  db: PrismaClient;
  shop: string;
  config: ConfigView;
  productRuleIndex: (config: ConfigView, products: readonly SyncProductInput[]) => Map<string, SyncProductEntry>;
  /** Check a sample of the index against Shopify first (the shop config was missing: first sync after an install). */
  verifyIndex?: boolean;
  /** The collection size check already made for this sync (step 0 builds the payload from it); absent = made here. */
  limits?: CollectionLimits;
  /**
   * The shop config flips after the BEFORE lane and its MARGIN part changes
   * (as checkout reads it — audit fix round 4; a rule-only change needs no
   * bridge): the margin settings of the config LIVE until the flip. A product
   * whose marginRefs change carries the BRIDGE (bridgeMarginRefs,
   * crossingRefs) across the flip and is pruned to its new refs in the AFTER
   * lane. Absent (a products-only refresh, an unchanged margin): the new refs
   * are written directly — they are decisive under the same settings.
   */
  bridgeFrom?: FunctionMarginPayload;
  /**
   * Checked before every Shopify read and write: true stops the pass with
   * SyncCancelled (a products-only refresh superseded by a newer sync). The
   * save's own BEFORE lane never passes it.
   */
  isCancelled?: () => boolean;
}

function checkCancelled(args: Pick<ProductSyncArgs, "isCancelled">): void {
  if (args.isCancelled?.()) throw new SyncCancelled();
}

interface Write {
  productId: string;
  value: string;
  hash: string;
}

/** A write to a product that already carries our metafield, with what Shopify has now. */
interface IndexedWrite extends Write {
  current: string | null;
}

/** A product's value AFTER the flip (null = no metafield: a clear), when the BEFORE lane wrote a bridge. */
export interface FinalWrite {
  productId: string;
  value: string | null;
  hash: string | null;
}

export interface ProductPlan {
  steps: SyncStep[];
  /** The plan could not finish: some product may carry refs the new config no longer gives it. */
  staleRisk: boolean;
  /** False when the plan failed (nothing may be written from it). */
  complete: boolean;
  /** Before the flip: changes to products that carry Won refs already. */
  sets: IndexedWrite[];
  /** Before the flip: products that no longer belong to any target. */
  clears: string[];
  /** After the flip: products without Won refs that only gain rule refs (not read yet). */
  additions: Write[];
  /** After the flip: products that carried a marginRef bridge across it, pruned to their final value. */
  prunes: FinalWrite[];
  /** The numeric ids the margin collections of this pass ship under (onlyAddsRefs: a dropped ref to anything else holds nothing). */
  liveMarginRefs: string[];
  /**
   * The plan itself holds the new config (audit fix round 4): some product's membership in a collection the live
   * config lists could not be read, and its bridge would have been looser than what it carries — it keeps its value.
   */
  hold?: HoldReason;
}

/** Why a BEFORE lane holds the new shop config (the admin words each: sync-copy.ts). */
export type HoldReason = "rule_refs" | "margin_refs" | "products_unread" | "products_refused";

export interface ProductSyncResult {
  steps: SyncStep[];
  /** Some product may still carry refs the new config no longer gives it (see header). */
  staleRisk: boolean;
  /** Why (set with staleRisk): a rule ref that should go / a clear failed; a marginRef change failed; the plan could not read. */
  holdReason?: HoldReason;
}

// --- Reading the targets ---------------------------------------------------------------------

class CollectionTooLarge extends Error {
  constructor(readonly collectionId: string) {
    super(`the targeted collections have more than ${MAX_COLLECTION_PRODUCTS} products together (reading ${collectionId})`);
  }
}

type RuleView = ConfigView["modules"]["codes"]["rules"][number];
type MarginView = { enabled: boolean; global: { minMarginPercent?: number; maxDiscountPercent: number }; perCollection: { collectionId: string; minMarginPercent?: number; maxDiscountPercent?: number }[] };

/** A margin collection that did not fit MAX_COLLECTION_PRODUCTS (folded into the payload's global values). */
export interface MarginTooLarge {
  collectionId: string;
  /** Its Shopify title (null when Shopify did not say). */
  title: string | null;
  /** Its product count; null when Shopify only counted "at least" (over its own limit). */
  count: number | null;
}

/** What the collection size check decided for one sync (see the header). */
export interface CollectionLimits {
  /**
   * The config whose product refs this pass computes: collections that do not
   * fit are left out, and its margin is the FOLDED one the payload ships (the
   * decisive refs are chosen under the settings checkout runs — audit fix
   * round 4: an unfolded view picks other refs on ties, and every sync would
   * then bridge and prune for nothing).
   */
  config: ConfigView;
  /**
   * The config the SHOP PAYLOAD is built from (sync.server.ts step 0): the
   * margin collections that do not fit folded into the global values and into
   * every other collection's own values, strictest wins. Rule targets are as
   * given (the payload does not carry them; the product refs do).
   */
  payloadConfig: ConfigView;
  steps: SyncStep[];
  marginTooLarge: MarginTooLarge[];
  /**
   * Collections read ONLY to know the membership the bridge needs (the live
   * config's margin collections the new config no longer has — `alsoRead`),
   * those that fit after everything else: they carry no rule and no setting
   * of the new config. One that does not fit is simply not read (the refs a
   * product carries for it are then kept as they are).
   */
  alsoRead: string[];
}

/**
 * Fold `dropped` margin collections into the global values AND into every
 * remaining collection's own values (max min-margin, min max-discount): a
 * product whose refs name only remaining collections (or none) never gets a
 * looser floor than a dropped collection it may be in. Fail closed: products
 * in none of them get the stricter values too ("platí přísnější hodnota pro
 * celý obchod"). The input is never changed.
 */
export function foldMarginCollections(config: ConfigView, dropped: ReadonlySet<string>): ConfigView {
  const out = JSON.parse(JSON.stringify(config)) as ConfigView & { modules: { margin: MarginView } };
  const margin = out.modules.margin;
  let min: number | undefined;
  let max: number | undefined;
  for (const o of margin.perCollection) {
    if (!dropped.has(o.collectionId)) continue;
    if (o.minMarginPercent !== undefined) min = Math.max(min ?? 0, o.minMarginPercent);
    if (o.maxDiscountPercent !== undefined) max = Math.min(max ?? 100, o.maxDiscountPercent);
  }
  if (min !== undefined) margin.global.minMarginPercent = Math.max(margin.global.minMarginPercent ?? 0, min);
  if (max !== undefined) margin.global.maxDiscountPercent = Math.min(margin.global.maxDiscountPercent, max);
  margin.perCollection = margin.perCollection
    .filter((o) => !dropped.has(o.collectionId))
    .map((o) => ({
      ...o,
      ...(o.minMarginPercent !== undefined && min !== undefined ? { minMarginPercent: Math.max(o.minMarginPercent, min) } : {}),
      ...(o.maxDiscountPercent !== undefined && max !== undefined ? { maxDiscountPercent: Math.min(o.maxDiscountPercent, max) } : {}),
    }));
  return out;
}

/**
 * The collection size check (see the header): sizes read once, the margin
 * collections counted first, then the rules' in config order. Sizes
 * unreadable → nothing left out (the paging backstop still stops a read that
 * runs past the limit).
 */
export async function collectionLimits(
  args: Pick<ProductSyncArgs, "transport" | "config" | "isCancelled"> & { alsoRead?: readonly string[] },
): Promise<CollectionLimits> {
  const { transport, config } = args;
  const marginIds = marginCollectionIds(config.modules.margin);
  const marginSet = new Set(marginIds);
  const configIds = [...marginIds, ...[...targetScopes(config).collectionIds].filter((id) => !marginSet.has(id))];
  const configSet = new Set(configIds);
  // Read for membership only, counted LAST: they never push a rule's or a setting's collection out.
  const extraIds = [...new Set(args.alsoRead ?? [])].filter((id) => !configSet.has(id));
  const ids = [...configIds, ...extraIds];
  const unchanged: CollectionLimits = { config, payloadConfig: config, steps: [], marginTooLarge: [], alsoRead: [] };
  if (ids.length === 0) return unchanged;
  const sizes = new Map<string, { count: number; exact: boolean; title: string | null }>();
  try {
    for (const batch of chunks(ids, NODES_BATCH)) {
      checkCancelled(args);
      const data: { nodes: ({ id?: string; title?: string | null; productsCount?: { count: number; precision: string } | null } | null)[] } =
        await transport.call("collectionSizes", { ids: batch });
      batch.forEach((id, i) => {
        const node = data.nodes[i];
        const count = node?.productsCount;
        if (count) sizes.set(id, { count: count.count, exact: count.precision === "EXACT", title: typeof node?.title === "string" ? node.title : null });
      });
    }
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    return unchanged;
  }
  const tooLarge = new Set<string>();
  let total = 0;
  for (const id of configIds) {
    const size = sizes.get(id);
    if (!size) continue; // not found: the pass reports it
    if (!size.exact || total + size.count > MAX_COLLECTION_PRODUCTS) tooLarge.add(id);
    else total += size.count;
  }
  const alsoRead: string[] = [];
  for (const id of extraIds) {
    const size = sizes.get(id);
    if (!size || !size.exact || total + size.count > MAX_COLLECTION_PRODUCTS) continue;
    total += size.count;
    alsoRead.push(id);
  }
  if (tooLarge.size === 0) return { ...unchanged, alsoRead };
  const titleOf = (id: string) => sizes.get(id)?.title ?? null;

  const out = JSON.parse(JSON.stringify(config)) as ConfigView & { modules: { codes: { rules: RuleView[] }; margin: MarginView } };
  const affected = new Map<string, { name: string; collections: Set<string> }>();
  const strip = (ruleId: string, name: string, target: unknown) => {
    const t = target as { kind?: unknown; ids?: unknown } | null;
    if (!t || t.kind !== "collections" || !Array.isArray(t.ids)) return;
    const dropped = (t.ids as string[]).filter((id) => tooLarge.has(id));
    if (dropped.length === 0) return;
    (t as { ids: string[] }).ids = (t.ids as string[]).filter((id) => !tooLarge.has(id));
    const entry = affected.get(ruleId) ?? { name, collections: new Set<string>() };
    for (const id of dropped) entry.collections.add(id);
    affected.set(ruleId, entry);
  };
  const names = new Map(out.modules.codes.rules.map((rule) => [rule.id, rule.name]));
  for (const rule of out.modules.codes.rules) strip(rule.id, rule.name, rule.target);
  for (const campaign of out.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) strip(override.ruleId, names.get(override.ruleId) ?? override.ruleId, (override.patch as { target?: unknown }).target);
  }
  // The admin words it from `params` (sync-copy.ts): the titles it knows, and how many have none.
  const steps: SyncStep[] = [...affected].map(([ruleId, { name, collections }]) => {
    const titles = [...collections].map(titleOf).filter((t): t is string => !!t && t.trim() !== "");
    return {
      step: `products.too_large:${ruleId}`,
      ok: false,
      detail:
        `"${name || ruleId}" does not apply at checkout to ${[...collections].join(", ")}: the targeted collections have more than ` +
        `${MAX_COLLECTION_PRODUCTS} products together, more than Won reads per sync — every other rule is synced as usual`,
      // The first title the admin can name ("" = none titled) and how many collections in all.
      params: { collection: titles[0] ?? "", count: collections.size },
    };
  });
  // A margin collection that does not fit: no new refs for its products; the payload folds it (fail closed).
  const droppedMargin = marginIds.filter((id) => tooLarge.has(id));
  const marginTooLarge: MarginTooLarge[] = droppedMargin.map((collectionId) => {
    const size = sizes.get(collectionId)!;
    return { collectionId, title: size.title, count: size.exact ? size.count : null };
  });
  for (const m of marginTooLarge) {
    steps.push({
      step: "margin.too_large",
      ok: false,
      detail:
        `the margin setting of ${m.collectionId} ("${m.title ?? "untitled"}", ${m.count ?? `more than ${MAX_COLLECTION_PRODUCTS}`} products) does not fit the ` +
        `${MAX_COLLECTION_PRODUCTS} products Won reads per sync: its values are folded into the whole store's (the stricter value applies everywhere)`,
      params: { collectionId: m.collectionId, collection: m.title ?? "", count: m.count },
    });
  }
  const dropped = new Set(droppedMargin);
  if (dropped.size === 0) return { config: out, payloadConfig: config, steps, marginTooLarge, alsoRead };
  // The refs and the payload share one margin view: the too-large collections folded (and left out).
  return { config: foldMarginCollections(out, dropped), payloadConfig: foldMarginCollections(config, dropped), steps, marginTooLarge, alsoRead };
}

async function targetedProducts(args: ProductSyncArgs, scopes: Scopes) {
  const { transport, shop } = args;
  const productCollections = new Map<string, Set<string>>();
  const targeted = new Set<string>(scopes.productIds);
  const missing: string[] = [];
  let read = 0;
  for (const collectionId of scopes.collectionIds) {
    let after: string | null = null;
    for (;;) {
      checkCancelled(args);
      const data: { collection: { products: Page<{ id: string }> } | null } = await transport.call("collectionProducts", {
        id: collectionId,
        after,
      });
      if (!data.collection) {
        missing.push(collectionId);
        break;
      }
      for (const product of data.collection.products.nodes) {
        targeted.add(product.id);
        const set = productCollections.get(product.id) ?? new Set<string>();
        set.add(collectionId);
        productCollections.set(product.id, set);
      }
      read += data.collection.products.nodes.length;
      setSyncProgress(shop, { phase: "reading", done: read, total: null });
      if (!data.collection.products.pageInfo.hasNextPage) break;
      // Backstop: the sizes said it fits, the paging says otherwise (a catalogue growing right now).
      if (read >= MAX_COLLECTION_PRODUCTS + PAGING_SLACK) throw new CollectionTooLarge(collectionId);
      after = data.collection.products.pageInfo.endCursor;
    }
  }
  const variantProducts = new Set<string>();
  for (const batch of chunks([...scopes.variantIds], NODES_BATCH)) {
    checkCancelled(args);
    const data: { nodes: ({ id: string; product?: { id: string } } | null)[] } = await transport.call("variantProducts", { ids: batch });
    for (const node of data.nodes) {
      if (node?.product?.id) {
        targeted.add(node.product.id);
        variantProducts.add(node.product.id);
      }
    }
  }
  const allVariants = new Map<string, string[]>();
  for (const productId of variantProducts) {
    const variants: string[] = [];
    let after: string | null = null;
    for (;;) {
      checkCancelled(args);
      const data: { product: { variants: Page<{ id: string }> } | null } = await transport.call("productVariants", { id: productId, after });
      if (!data.product) break;
      for (const variant of data.product.variants.nodes) variants.push(variant.id);
      if (!data.product.variants.pageInfo.hasNextPage) break;
      after = data.product.variants.pageInfo.endCursor;
    }
    allVariants.set(productId, variants);
  }
  return { targeted, productCollections, allVariants, missing };
}

type MetafieldNode = { id: string; metafield: { value: string } | null } | null;

async function readProductValues(transport: Transport, ids: readonly string[], isCancelled?: () => boolean): Promise<Map<string, MetafieldNode>> {
  const out = new Map<string, MetafieldNode>();
  for (const batch of chunks(ids, NODES_BATCH)) {
    if (isCancelled?.()) throw new SyncCancelled();
    const data: { nodes: MetafieldNode[] } = await transport.call("productMetafields", { ids: batch });
    batch.forEach((productId, i) => out.set(productId, data.nodes[i]?.id ? data.nodes[i] : null));
  }
  return out;
}

// --- Refs: does a write only ADD? ----------------------------------------------------------------

interface Refs {
  ruleIds: Set<string>;
  variants: Map<string, Set<string>>;
  marginRefs: Set<string>;
}

/** The refs a product metafield value carries ({} for none); null when it cannot be read. */
function refsOf(value: string | null | undefined): Refs | null {
  if (value === null || value === undefined) return { ruleIds: new Set(), variants: new Map(), marginRefs: new Set() };
  try {
    const parsed = JSON.parse(value) as { ruleIds?: unknown; variantRuleIds?: unknown; marginRefs?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const variants = new Map<string, Set<string>>();
    if (parsed.variantRuleIds && typeof parsed.variantRuleIds === "object") {
      for (const [variant, refs] of Object.entries(parsed.variantRuleIds as Record<string, unknown>)) variants.set(variant, new Set(strings(refs)));
    }
    return { ruleIds: new Set(strings(parsed.ruleIds)), variants, marginRefs: new Set(strings(parsed.marginRefs)) };
  } catch {
    return null;
  }
}

/**
 * True when a FAILED write of `next` over `current` is harmless — it holds
 * nothing (see the header): every rule ref the product has now stays
 * (product-wide, or on the same variant — a product-wide ref covers every
 * variant) and its marginRefs do not change (MVP 2 audit P2-3: the core writes
 * the DECISIVE collections, so a value change can replace a ref, not only add
 * one). The one harmless marginRef change is dropping refs whose collections
 * have no setting in force any more (`liveMarginRefs` = the numeric ids the
 * new config's margin collections ship under): checkout ignores a ref its
 * config does not name (core resolveMargin), so the stale ref never loosens a
 * floor. Any other stale ref could — a collection may be looser than the
 * global values, and a product whose only ref it is gets its values. Without
 * `liveMarginRefs` every marginRef change holds. An unreadable current value
 * is never "only adds".
 */
export function onlyAddsRefs(next: string, current: string | null | undefined, liveMarginRefs?: ReadonlySet<string>): boolean {
  return holdsNothing(next, current, liveMarginRefs) === null;
}

/**
 * What a FAILED write of `next` over `current` would leave wrong (null =
 * nothing, onlyAddsRefs): "rule_refs" = a rule ref the product should lose
 * (or an unreadable value); "margin_refs" = its marginRefs change (see
 * onlyAddsRefs).
 */
function holdsNothing(next: string, current: string | null | undefined, liveMarginRefs?: ReadonlySet<string>): "rule_refs" | "margin_refs" | null {
  const have = refsOf(current);
  const want = refsOf(next);
  if (!have || !want) return "rule_refs";
  for (const ref of have.ruleIds) if (!want.ruleIds.has(ref)) return "rule_refs";
  for (const [variant, refs] of have.variants) {
    for (const ref of refs) if (!want.ruleIds.has(ref) && !want.variants.get(variant)?.has(ref)) return "rule_refs";
  }
  for (const ref of want.marginRefs) if (!have.marginRefs.has(ref)) return "margin_refs";
  for (const ref of have.marginRefs) if (!want.marginRefs.has(ref) && (!liveMarginRefs || liveMarginRefs.has(ref))) return "margin_refs";
  return null;
}

/** The marginRefs a product metafield value carries (junk → none). */
function marginRefsOf(value: string | null | undefined): string[] {
  return [...(refsOf(value)?.marginRefs ?? [])];
}

// --- Index check after an install ------------------------------------------------------------------

async function verifyIndexSample(args: ProductSyncArgs, indexed: Map<string, string | null>, steps: SyncStep[]): Promise<void> {
  const { transport, db, shop } = args;
  const hashed = [...indexed].filter(([, hash]) => hash !== null).map(([productId]) => productId);
  if (hashed.length === 0) return;
  const sample = hashed.slice(0, INDEX_SAMPLE_SIZE);
  let mismatch: string | null = null;
  try {
    const values = await readProductValues(transport, sample, args.isCancelled);
    for (const productId of sample) {
      const node = values.get(productId);
      if (!node) continue; // deleted product: dropped by the normal pass
      const value = node.metafield?.value;
      const hash = value === undefined ? null : hashText(canonicalJson(safeParse(value)));
      if (hash !== indexed.get(productId)) {
        mismatch = productId;
        break;
      }
    }
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    mismatch = `(read failed: ${errorText(error)})`;
  }
  if (mismatch === null) {
    steps.push({ step: "products.index", ok: true, detail: `index checked on ${sample.length} product(s) after the shop config was missing: it matches Shopify` });
    return;
  }
  await db.productTargetIndex.updateMany({ where: { shop }, data: { payloadHash: null } });
  for (const productId of indexed.keys()) indexed.set(productId, null);
  steps.push({
    step: "products.index",
    ok: true,
    detail: `the shop config was missing and the index does not match Shopify (${mismatch}): every indexed product is checked and rewritten`,
  });
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// --- Plan -------------------------------------------------------------------------------------

function failedPlan(steps: SyncStep[], staleRisk: boolean): ProductPlan {
  return { steps, staleRisk, complete: false, sets: [], clears: [], additions: [], prunes: [], liveMarginRefs: [] };
}

export async function planProducts(args: ProductSyncArgs): Promise<ProductPlan> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  const limited = args.limits ?? (await collectionLimits(args));
  steps.push(...limited.steps);
  const config = limited.config;
  const scopes = targetScopes(config);
  // The live config's margin collections the new one dropped: read for the bridge's membership only.
  for (const id of limited.alsoRead) scopes.collectionIds.add(id);
  const rows = await db.productTargetIndex.findMany({ where: { shop }, select: { productId: true, payloadHash: true, value: true } });
  const indexed = new Map(rows.map((row) => [row.productId, row.payloadHash]));
  // What the payload's `col` names after this pass (the collections that fit): a dropped ref to anything else is ignored at checkout.
  const liveMarginRefs = marginCollectionIds(config.modules.margin).map(variantKey);
  // Rows whose value is recorded (the impact overview reads it); an up-to-date row without one gets it below.
  const valued = new Set(rows.filter((row) => row.value !== null).map((row) => row.productId));
  const unrecorded: { productId: string; value: string }[] = [];
  if (args.verifyIndex) await verifyIndexSample(args, indexed, steps);

  let found;
  try {
    found = await targetedProducts(args, scopes);
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    const detail =
      error instanceof CollectionTooLarge
        ? `${error.message}; the collections grew past what Won reads per sync while being read (nothing was written; the next sync leaves the largest out)`
        : `could not read the targeted products: ${errorText(error)}`;
    steps.push({ step: "products", ok: false, detail });
    // Nothing written: products that left a target may still carry old refs — and with a margin collection
    // in force, its members carry no ref yet (a fresh shop, or new members): the new config must not rely
    // on them either (audit fix round 2).
    return failedPlan(steps, indexed.size > 0 || marginCollectionIds(config.modules.margin).length > 0);
  }
  const { targeted, productCollections, allVariants, missing } = found;

  const candidates = [...new Set([...targeted, ...indexed.keys()])].sort();
  if (candidates.length === 0) {
    steps.push({ step: "products", ok: true, detail: "no targeted products and none to clean" });
    return { steps, staleRisk: false, complete: true, sets: [], clears: [], additions: [], prunes: [], liveMarginRefs };
  }
  const inputs: SyncProductInput[] = candidates.map((productId) => ({
    productId,
    variantIds: allVariants.get(productId) ?? [],
    collectionIds: [...(productCollections.get(productId) ?? [])].sort(),
  }));
  const entries = args.productRuleIndex(config, inputs);

  // Plan against the index (no Shopify read for products already up to date).
  const wanted = new Map<string, { value: string; hash: string }>();
  const toClear: string[] = [];
  const oversized: string[] = [];
  for (const productId of candidates) {
    const entry = entries.get(productId);
    const reduced = entry?.oversized;
    if (reduced) {
      const parts = [
        reduced.droppedRefs.length ? `rules ${reduced.droppedRefs.join(", ")} no longer apply to it` : "",
        reduced.collapsedRefs.length ? `rules ${reduced.collapsedRefs.join(", ")} now apply to all its variants` : "",
      ].filter(Boolean);
      oversized.push(`${productId} (${reduced.bytes} B): ${parts.join("; ")}`);
    }
    if (entry && !isEmptyEntry(entry)) {
      // Exactly what the engine says to write (never the `oversized` report).
      const value = JSON.stringify(
        productMetafieldValue({
          ruleIds: [...entry.ruleIds],
          variantRuleIds: Object.fromEntries(Object.entries(entry.variantRuleIds ?? {}).map(([k, v]) => [k, [...v]])),
          ...(entry.marginRefs && entry.marginRefs.length > 0 ? { marginRefs: [...entry.marginRefs] } : {}),
        }),
      );
      const hash = hashText(canonicalJson(JSON.parse(value)));
      if (indexed.get(productId) !== hash) wanted.set(productId, { value, hash });
      else if (!valued.has(productId)) unrecorded.push({ productId, value });
    } else if (indexed.has(productId)) {
      toClear.push(productId);
    }
  }
  if (unrecorded.length > 0) {
    await db.$transaction(
      unrecorded.map(({ productId, value }) => db.productTargetIndex.updateMany({ where: { shop, productId }, data: { value } })),
    );
  }
  const wantedIndexed = [...wanted.keys()].filter((productId) => indexed.has(productId));
  // Products without Won refs yet: only-rule gains go AFTER the flip; a gained marginRef goes BEFORE it (audit P2-3).
  const newcomers = [...wanted].filter(([productId]) => !indexed.has(productId)).map(([productId, w]) => ({ productId, ...w }));
  const additions = newcomers.filter((w) => marginRefsOf(w.value).length === 0);
  const marginNewcomers = newcomers.filter((w) => marginRefsOf(w.value).length > 0);
  steps.push({
    step: "products.scope",
    ok: true,
    detail:
      `${targeted.size} targeted product(s) (${scopes.collectionIds.size} collection(s), ${scopes.variantIds.size} variant target(s)); ` +
      `${candidates.length - wanted.size - toClear.length} up to date` +
      (missing.length ? `; collection(s) not found: ${missing.join(", ")}` : ""),
  });
  if (oversized.length > 0) {
    steps.push({
      step: "products.oversized",
      ok: true,
      warning: true,
      detail: `${oversized.length} product(s) had too many variant-level rules for the 9 000 B product budget and were reduced: ${oversized.slice(0, 5).join(" | ")}${oversized.length > 5 ? " | …" : ""}`,
    });
  }

  // Read the products that already carry our metafield and must change, and the newcomers that gain a
  // marginRef: deleted ones are dropped, an identical value is only recorded.
  const sets: IndexedWrite[] = [];
  const recorded: { productId: string; hash: string; value: string }[] = [];
  const gone: string[] = [];
  const clearing = new Set(toClear);
  let values: Map<string, MetafieldNode>;
  try {
    values = await readProductValues(transport, [...wantedIndexed, ...toClear, ...marginNewcomers.map((w) => w.productId)], args.isCancelled);
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    steps.push({ step: "products", ok: false, detail: `could not read the products to update: ${errorText(error)}` });
    // Every one of them may lose a ref, or lack a stricter collection the new config relies on: nothing may flip.
    return failedPlan(steps, toClear.length > 0 || wantedIndexed.length > 0 || marginNewcomers.length > 0);
  }
  // Across the flip (args.bridgeFrom), a product whose value changes carries a marginRef bridge (bridgeMarginRefs):
  // its final value (null = a clear) and what Shopify has now, decided below.
  const live = args.bridgeFrom;
  const crossing: Crossing[] = [];
  for (const write of marginNewcomers) {
    const node = values.get(write.productId);
    if (!node) continue; // deleted meanwhile: nothing to write, nothing indexed
    if (sameJson(node.metafield?.value, write.value)) recorded.push(write);
    else if (live) crossing.push({ productId: write.productId, final: write, current: node.metafield?.value ?? null });
    else sets.push({ ...write, current: node.metafield?.value ?? null });
  }
  for (const productId of wantedIndexed) {
    const node = values.get(productId);
    const want = wanted.get(productId)!;
    if (!node) gone.push(productId);
    else if (sameJson(node.metafield?.value, want.value)) recorded.push({ productId, hash: want.hash, value: want.value });
    else if (live) crossing.push({ productId, final: { productId, ...want }, current: node.metafield?.value ?? null });
    else sets.push({ productId, ...want, current: node.metafield?.value ?? null });
  }
  for (const productId of toClear) {
    const node = values.get(productId);
    if (!node || !node.metafield) {
      clearing.delete(productId);
      gone.push(productId); // deleted, or already absent in Shopify: just untrack
      continue;
    }
    // A clear across the flip keeps the live config's decisive refs for the product until after it.
    if (live) crossing.push({ productId, final: null, current: node.metafield.value });
  }
  const prunes: FinalWrite[] = [];
  let hold: HoldReason | undefined;
  if (live && crossing.length > 0) {
    const bridge = await bridgeCrossing(args, live, crossing, scopes, productCollections, steps);
    if (bridge.held.size > 0) hold = "margin_refs";
    for (const item of crossing) {
      const refs = bridge.refs.get(item.productId);
      if (refs === undefined) {
        clearing.delete(item.productId); // held: it keeps its current value, the new config waits (hold)
        continue;
      }
      if (item.final === null) {
        if (refs.length === 0) continue; // nothing to keep: a plain clear
        clearing.delete(item.productId);
        prunes.push({ productId: item.productId, value: null, hash: null });
        const value = JSON.stringify(productMetafieldValue({ ruleIds: [], variantRuleIds: {}, marginRefs: refs }));
        if (!sameJson(item.current, value)) sets.push({ productId: item.productId, value, hash: hashText(canonicalJson(JSON.parse(value))), current: item.current });
        continue;
      }
      if (sameSet(refs, marginRefsOf(item.final.value))) {
        sets.push({ ...item.final, current: item.current });
        continue;
      }
      prunes.push({ productId: item.productId, value: item.final.value, hash: item.final.hash });
      const value = withMarginRefs(item.final.value, refs);
      if (sameJson(item.current, value)) continue; // it already carries the bridge: only the prune after the flip
      sets.push({ productId: item.productId, value, hash: hashText(canonicalJson(JSON.parse(value))), current: item.current });
    }
  }
  if (gone.length) await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: gone } } });
  for (const { productId, hash, value } of recorded) await upsertRow(db, shop, productId, hash, value);
  return { steps, staleRisk: false, complete: true, sets, clears: [...clearing], additions, prunes, liveMarginRefs, ...(hold ? { hold } : {}) };
}

// --- The marginRef bridge across the flip (audit fix rounds 2, 3 + 4) ------------------------------

/** A product whose value changes across the flip: its final value (null = a clear) and what Shopify has now. */
interface Crossing {
  productId: string;
  final: Write | null;
  current: string | null;
}

/**
 * The most calls to `productsInCollection` one sync makes (audit fix round 5):
 * without a cap, an unlucky sync (many unsure newcomers × many unread live
 * collections) could make ceil(unsure / NODES_BATCH) × unread calls, unbounded.
 * Beyond the cap the still-unresolved products are held (fail closed, same as
 * a read failure) and the next sync picks up where this one left off.
 */
const MEMBERSHIP_READ_CALL_CAP = 20;

/** A collection's own values (global fallback filled in), as they'd apply if the product turned out to be a member. */
function collectionValues(live: FunctionMarginPayload, key: string): { min: number; max: number } | null {
  if (!live.enabled || !live.col) return null;
  const tuple = live.col[key];
  if (!tuple) return null;
  const [m, p] = tuple;
  return { min: m ?? (live.min ?? 0), max: p ?? live.max };
}

/**
 * Whether an unread collection could possibly tighten a product's bridge past
 * `candidate` (round 5): a collection that isn't stricter than the candidate
 * in EITHER field can never matter, whether or not the product turns out to
 * be a member of it — resolveMargin only ever takes the max of the minimums
 * and the min of the maximums, so merging in a non-stricter collection can
 * never change the resolved settings.
 */
function stricterThan(live: FunctionMarginPayload, key: string, candidate: { minMarginPercent: number; maxDiscountPercent: number }): boolean {
  const values = collectionValues(live, key);
  return values !== null && (values.min > candidate.minMarginPercent || values.max < candidate.maxDiscountPercent);
}

/**
 * The bridge of every crossing product (crossingRefs). The live config may list
 * collections this pass did not read — a live-only one past the leftover
 * budget, or one the new config folds (too large): a product's membership in
 * them is unknown, so a bridge that would be looser than what the product
 * carries now (either field, under the live config) is not trusted.
 *
 * Only the unread collections that could actually tighten a product's bridge
 * are worth a read (`stricterThan`, round 5): a collection already carried
 * (kept regardless, see bridgeMarginRefs) or that isn't stricter than the
 * product's candidate value needs no read. What is worth reading is read one
 * by one (productsInCollection), up to MEMBERSHIP_READ_CALL_CAP calls total
 * for the whole sync; when a read fails, or the cap is reached first, the
 * products still unresolved keep their current value and the new config is
 * held (`held`, reason margin_refs — retried like every hold, so the next
 * sync continues where this one stopped). Never a bridge looser than both the
 * status quo and the requirement (audit fix round 4). `refs` has no entry for
 * a held product.
 */
async function bridgeCrossing(
  args: ProductSyncArgs,
  live: FunctionMarginPayload,
  crossing: readonly Crossing[],
  scopes: Scopes,
  productCollections: ReadonlyMap<string, ReadonlySet<string>>,
  steps: SyncStep[],
): Promise<{ refs: Map<string, string[]>; held: Set<string> }> {
  // "Read" = paged in full by this pass: the new config's collections that fit, the rules' and the live-only
  // ones that fit (alsoRead). A folded (too-large) collection is never among them.
  const read = new Set([...scopes.collectionIds].map(variantKey));
  const members = (productId: string) => [...(productCollections.get(productId) ?? [])].map(variantKey);
  const unread = live.enabled && live.col ? Object.keys(live.col).filter((key) => !read.has(key)) : [];
  const refs = new Map<string, string[]>();
  const held = new Set<string>();
  if (unread.length === 0) {
    for (const item of crossing) {
      const next = item.final ? marginRefsOf(item.final.value) : [];
      refs.set(item.productId, crossingRefs({ next, live, members: members(item.productId), read, carried: marginRefsOf(item.current) }).refs);
    }
    return { refs, held };
  }

  interface Pending {
    productId: string;
    next: string[];
    carried: string[];
    /** Unread collections not already carried that could tighten this product's candidate value. */
    relevant: string[];
  }
  const pending: Pending[] = [];
  for (const item of crossing) {
    const next = item.final ? marginRefsOf(item.final.value) : [];
    const carried = marginRefsOf(item.current);
    const first = crossingRefs({ next, live, members: members(item.productId), read, carried });
    if (!first.needsMembership) {
      refs.set(item.productId, first.refs);
      continue;
    }
    const candidate = resolveMargin(live, first.refs)!; // live.enabled: needsMembership is only ever true when it is
    const relevant = unread.filter((key) => !carried.includes(key) && stricterThan(live, key, candidate));
    if (relevant.length === 0) {
      // No unread collection — carried or not — could tighten this product's bridge any further.
      refs.set(item.productId, first.refs);
      continue;
    }
    pending.push({ productId: item.productId, next, carried, relevant });
  }
  if (pending.length === 0) return { refs, held };

  const known = new Map<string, string[]>(pending.map((p) => [p.productId, []]));
  const remaining = new Map<string, Set<string>>(pending.map((p) => [p.productId, new Set(p.relevant)]));
  const productsByKey = new Map<string, string[]>();
  for (const p of pending) for (const key of p.relevant) productsByKey.set(key, [...(productsByKey.get(key) ?? []), p.productId]);

  const finalize = (p: Pending): void => {
    const allRead = new Set([...read, ...p.relevant]);
    refs.set(p.productId, crossingRefs({ next: p.next, live, members: [...members(p.productId), ...known.get(p.productId)!], read: allRead, carried: p.carried }).refs);
  };
  const holdOutstanding = (): void => {
    for (const p of pending) if (remaining.get(p.productId)!.size > 0) held.add(p.productId);
  };

  let calls = 0;
  let capped = false;
  try {
    outer: for (const key of unread) {
      const productIds = productsByKey.get(key);
      if (!productIds) continue;
      for (const batch of chunks(productIds, NODES_BATCH)) {
        if (calls >= MEMBERSHIP_READ_CALL_CAP) {
          capped = true;
          break outer;
        }
        checkCancelled(args);
        calls += 1;
        const data: { nodes: ({ id?: string; inCollection?: boolean } | null)[] } = await args.transport.call("productsInCollection", {
          ids: batch,
          collection: `gid://shopify/Collection/${key}`,
        });
        // Matched by id, not by position (audit fix round 5): robust to the response reordering the nodes.
        const byId = new Map(data.nodes.filter((n): n is { id?: string; inCollection?: boolean } => n !== null).map((n) => [n.id, n]));
        for (const productId of batch) {
          if (byId.get(productId)?.inCollection === true) known.get(productId)!.push(key);
          remaining.get(productId)!.delete(key);
        }
      }
    }
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    holdOutstanding();
    for (const p of pending) if (!held.has(p.productId)) finalize(p);
    steps.push({
      step: "products.membership",
      ok: false,
      detail:
        `could not read whether ${held.size} product(s) are in ${unread.length} collection(s) the live config lists but this sync did not read ` +
        `(${errorText(error)}): they keep their current value and the new config is held; the next sync retries`,
    });
    return { refs, held };
  }

  if (capped) holdOutstanding();
  for (const p of pending) if (!held.has(p.productId)) finalize(p);
  steps.push({
    step: "products.membership",
    ok: true,
    detail:
      `${pending.length - held.size} product(s) checked one by one in ${new Set(pending.flatMap((p) => p.relevant)).size} collection(s) the live config lists but this sync did not read ` +
      `(${calls} call(s))` +
      (capped ? `; the ${MEMBERSHIP_READ_CALL_CAP}-call budget was reached, ${held.size} product(s) held for the next sync` : ""),
  });
  return { refs, held };
}

/**
 * One product's refs across the flip (audit fix round 4): the bridge over what
 * this pass knows — `members` = the keys it is in among `read` (the collections
 * whose membership is known), plus every ref it carries (`carried`) for a
 * collection outside `read` (membership unknown: the status quo is kept for
 * it). `needsMembership`: the live config lists a collection outside `read`
 * AND the bridge resolves looser than `carried` under the live config (either
 * field) — the unknown membership could be what makes it stricter, so the
 * bridge is not trusted until that membership is known (bridgeCrossing).
 */
export function crossingRefs(args: {
  next: readonly string[];
  live: FunctionMarginPayload;
  members: readonly string[];
  read: ReadonlySet<string>;
  carried: readonly string[];
}): { refs: string[]; needsMembership: boolean } {
  const { live, read, carried } = args;
  const refs = bridgeMarginRefs(args.next, live, [...args.members, ...carried.filter((ref) => !read.has(ref))]);
  const unread = live.enabled && live.col ? Object.keys(live.col).some((key) => !read.has(key)) : false;
  if (!unread) return { refs, needsMembership: false };
  const now = resolveMargin(live, carried);
  const bridged = resolveMargin(live, refs);
  const looser = !!now && !!bridged && (bridged.minMarginPercent < now.minMarginPercent || bridged.maxDiscountPercent > now.maxDiscountPercent);
  return { refs, needsMembership: looser };
}

/**
 * The marginRefs a product carries across the shop-config flip: its NEW refs
 * (core decisiveMarginRefs of the new config over the collections it is in)
 * plus the LIVE config's decisive refs over its members — the collections
 * this pass read it in, and any collection it carries a ref for that this pass
 * did not read (membership unknown: kept as it is). The engine takes the
 * strictest over a product's refs (resolveMargin; a decisive set resolves
 * exactly like all of its collections), so:
 *   - under the LIVE config (running during the BEFORE lane, and kept when
 *     the new config is held) the bridge holds the live decisive refs → it
 *     resolves at least as strict as the live config does for the product's
 *     collections now — also after it left one;
 *   - under the NEW config every other ref names a collection it is in, or
 *     one the new config does not list (ignored), and it holds the new
 *     decisive refs → it resolves exactly to the new result.
 * At most 4 refs (2 + 2: both parts are core decisive sets, and no ref is
 * added by hand since audit fix round 4) and no growth across repeated holds:
 * the live refs are recomputed from the live settings, never accumulated. The
 * AFTER lane prunes to the new refs (unchanged under the new config). A
 * membership this pass does not know (a live-listed collection it did not
 * read) is settled by crossingRefs / bridgeCrossing.
 */
export function bridgeMarginRefs(next: readonly string[], live: FunctionMarginPayload, liveMembers: readonly string[]): string[] {
  return [...new Set([...next, ...decisiveMarginRefs(live, liveMembers)])].sort();
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

/** A product metafield value with its marginRefs replaced (none → the key goes). */
function withMarginRefs(value: string, marginRefs: readonly string[]): string {
  const parsed = JSON.parse(value) as { ruleIds?: string[]; variantRuleIds?: Record<string, string[]> };
  return JSON.stringify(
    productMetafieldValue({ ruleIds: parsed.ruleIds ?? [], variantRuleIds: parsed.variantRuleIds ?? {}, ...(marginRefs.length > 0 ? { marginRefs: [...marginRefs] } : {}) }),
  );
}

// --- Writes -----------------------------------------------------------------------------------

interface WriteOutcome<W extends Write> {
  written: W[];
  /** Shopify refused these products' writes (userErrors), one by one: the rest of their batch went through. */
  refused: { write: W; error: string }[];
  /** Calls that failed as a whole (transport / GraphQL after the retries). */
  failed: { writes: W[]; error: string }[];
  /** Batches in a row Shopify refused completely, product by product (the breaker counts them). */
  refusedInARow?: number;
  /** The breaker tripped: Shopify refuses writes shop-wide, refused batches are no longer split this run. */
  breaker?: boolean;
}

/**
 * Batches refused completely in a row before refused batches stop being split
 * per product (audit fix round 3). Accepted limit (round 4 ruling): the
 * breaker cannot tell a shop-wide refusal from 3 × 25 products in a row that
 * Shopify each refuses for its own reason — either way it trips. In the BEFORE
 * lane a tripped breaker holds the new config (products_refused), so a refusal
 * that persists holds every sync until Shopify accepts the writes again; the
 * admin says so (sync.problem.configHeldRefused, productsRefusedBreaker).
 */
export const REFUSAL_BREAKER_BATCHES = 3;

/**
 * One batch of a lane: sendProductWrites (a refused batch split per product)
 * — until REFUSAL_BREAKER_BATCHES batches in a row were refused completely:
 * then Shopify refuses writes shop-wide, and splitting the rest would only
 * multiply the calls by 25; a refused batch is then recorded as a whole.
 */
async function writeProducts<W extends Write>(args: ProductSyncArgs, batch: readonly W[], out: WriteOutcome<W>): Promise<void> {
  const written = out.written.length;
  const refused = out.refused.length;
  if (out.breaker) {
    const one: WriteOutcome<W> = { written: [], refused: [], failed: [] };
    await sendProductWrites(args, batch, one, false);
    out.written.push(...one.written);
    out.refused.push(...one.refused);
    out.failed.push(...one.failed);
    return;
  }
  await sendProductWrites(args, batch, out);
  const allRefused = out.written.length === written && out.refused.length - refused === batch.length;
  out.refusedInARow = allRefused ? (out.refusedInARow ?? 0) + 1 : 0;
  if (out.refusedInARow >= REFUSAL_BREAKER_BATCHES) out.breaker = true;
}

/**
 * metafieldsSet of product values, ≤ 25 per call, write-ahead (row hash null
 * first). metafieldsSet is all-or-nothing: a batch Shopify REFUSES is split
 * and sent per product (audit fix round 2), so one bad product never keeps
 * the other 24 — or the flip — back; each refused product is reported.
 */
async function sendProductWrites<W extends Write>(
  args: ProductSyncArgs,
  batch: readonly W[],
  out: WriteOutcome<W> = { written: [], refused: [], failed: [] },
  split = true,
): Promise<WriteOutcome<W>> {
  const { transport, db, shop } = args;
  for (const { productId } of batch) await upsertRow(db, shop, productId, null);
  let refused: string | null;
  try {
    const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsSet", {
      metafields: batch.map(({ productId, value }) => ({ ownerId: productId, namespace: WON_NAMESPACE, key: PRODUCT_KEY, type: "json", value })),
    });
    refused = userErrorText(data.metafieldsSet.userErrors);
  } catch (error) {
    if (error instanceof Response || error instanceof SyncCancelled) throw error;
    out.failed.push({ writes: [...batch], error: errorText(error) });
    return out;
  }
  if (refused === null) {
    await db.$transaction(
      batch.map(({ productId, hash, value }) =>
        db.productTargetIndex.update({ where: { shop_productId: { shop, productId } }, data: { payloadHash: hash, value } }),
      ),
    );
    out.written.push(...batch);
    return out;
  }
  if (batch.length === 1 || !split) {
    for (const write of batch) out.refused.push({ write, error: refused });
    return out;
  }
  for (const write of batch) await sendProductWrites(args, [write], out);
  return out;
}

/** One line for support: which products Shopify refused, and why (the merchant sentence has no ids: sync-copy.ts). */
function refusedDetail(refused: readonly { write: Write; error: string }[], breaker = false): string {
  const shown = refused.slice(0, 5).map((r) => `${r.write.productId}: ${r.error}`);
  return (
    `Shopify refused ${refused.length} product(s): ${shown.join("; ")}${refused.length > 5 ? "; …" : ""}` +
    (breaker ? ` — every write in ${REFUSAL_BREAKER_BATCHES} batches in a row was refused: the rest was not split per product` : "")
  );
}

/** The counts the admin words a refusal with (sync-copy.ts): how many products, and whether the breaker tripped. */
function refusedParams(outcome: WriteOutcome<Write>): { params?: Record<string, number> } {
  if (outcome.refused.length === 0) return {};
  return { params: { refused: outcome.refused.length, ...(outcome.breaker ? { breaker: 1 } : {}) } };
}

/**
 * The BEFORE lane: changes to products that carry Won refs, products that gain
 * a marginRef, bridges across the flip, and clears. A failed write that would
 * have removed a rule ref or changed marginRefs (onlyAddsRefs false), or a
 * failed clear, is `staleRisk` — with its `holdReason`.
 */
export async function applyProductChanges(args: ProductSyncArgs, plan: ProductPlan): Promise<ProductSyncResult> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  let staleRisk = false;
  let holdReason: HoldReason | undefined;
  const hold = (reason: HoldReason) => {
    staleRisk = true;
    if (holdReason !== "rule_refs") holdReason = reason; // a rule ref that should go is the more serious one
  };

  // The plan could not settle some product's live membership: it keeps its value, the new config waits.
  if (plan.hold) hold(plan.hold);
  const live = new Set(plan.liveMarginRefs);
  const outcome: WriteOutcome<IndexedWrite> = { written: [], refused: [], failed: [] };
  for (const batch of chunks(plan.sets, METAFIELDS_SET_BATCH)) {
    checkCancelled(args);
    await writeProducts(args, batch, outcome);
  }
  // Shopify refuses writes shop-wide: nothing the new config relies on can be trusted to be there.
  if (outcome.breaker) hold("products_refused");
  let heldProducts = 0;
  for (const write of [...outcome.refused.map((r) => r.write), ...outcome.failed.flatMap((f) => f.writes)]) {
    const reason = holdsNothing(write.value, write.current, live);
    if (reason) {
      heldProducts += 1;
      hold(reason);
    }
  }
  if (plan.sets.length > 0) {
    const failedCount = outcome.refused.length + outcome.failed.reduce((n, f) => n + f.writes.length, 0);
    const errors = [...(outcome.refused.length > 0 ? [refusedDetail(outcome.refused, outcome.breaker)] : []), ...outcome.failed.map((f) => f.error)];
    steps.push({
      step: "products.set",
      ok: failedCount === 0,
      detail:
        failedCount === 0
          ? `${outcome.written.length} product(s) updated`
          : `${outcome.written.length}/${plan.sets.length} product(s) updated; ${errors.join("; ")}` +
            (heldProducts > 0
              ? ` (${heldProducts} of them do not carry what the new config relies on — a rule they should lose, or their margin collections: the new config is held)`
              : " (they lack the new rules until the next sync)"),
      ...refusedParams(outcome),
    });
  }

  let clearOk = 0;
  const clearErrors: string[] = [];
  for (const batch of chunks(plan.clears, METAFIELDS_DELETE_BATCH)) {
    checkCancelled(args);
    try {
      const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsDelete", {
        metafields: batch.map((ownerId) => ({ ownerId, namespace: WON_NAMESPACE, key: PRODUCT_KEY })),
      });
      const error = userErrorText(data.metafieldsDelete.userErrors);
      if (error) {
        clearErrors.push(error);
        continue;
      }
      clearOk += batch.length;
      await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: batch } } });
    } catch (error) {
      if (error instanceof Response || error instanceof SyncCancelled) throw error;
      clearErrors.push(errorText(error));
    }
  }
  if (plan.clears.length > 0) {
    steps.push({
      step: "products.clear",
      ok: clearErrors.length === 0,
      detail:
        clearErrors.length === 0
          ? `${clearOk} product(s) no longer targeted, cleared`
          : `${clearOk}/${plan.clears.length} cleared; ${clearErrors.join("; ")} (they still carry old rules: the new config is held)`,
    });
    if (clearErrors.length > 0) hold("rule_refs");
  }
  return { steps, staleRisk, ...(holdReason ? { holdReason } : {}) };
}

export interface AdditionsOptions {
  /** Checked before every batch: true stops the lane (a newer sync redoes it). */
  isCancelled?: () => boolean;
}

export interface AdditionsResult {
  steps: SyncStep[];
  /** Stopped because a newer sync superseded it (nothing recorded as done). */
  cancelled: boolean;
}

/**
 * The AFTER lane: products that carry no Won refs yet and only gain some.
 * Read first (deleted products dropped, identical values recorded), then
 * written ≤ 25 per call with progress. Failures never hold anything.
 */
export async function applyProductAdditions(args: ProductSyncArgs, additions: readonly Write[], options: AdditionsOptions = {}): Promise<AdditionsResult> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  if (additions.length === 0) return { steps, cancelled: false };
  const cancelled = () => options.isCancelled?.() === true || args.isCancelled?.() === true;
  const toSet: Write[] = [];
  let skipped = 0;
  try {
    for (const batch of chunks(additions, NODES_BATCH)) {
      if (cancelled()) return { steps, cancelled: true };
      const values = await readProductValues(transport, batch.map((w) => w.productId), cancelled);
      for (const write of batch) {
        const node = values.get(write.productId);
        if (!node) skipped += 1;
        else if (sameJson(node.metafield?.value, write.value)) await upsertRow(db, shop, write.productId, write.hash, write.value);
        else toSet.push(write);
      }
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof SyncCancelled) return { steps, cancelled: true };
    steps.push({ step: "products.add", ok: false, detail: `could not read the products that get new rules: ${errorText(error)} (they lack them until the next sync)` });
    return { steps, cancelled: false };
  }
  const outcome: WriteOutcome<Write> = { written: [], refused: [], failed: [] };
  setSyncProgress(shop, { phase: "writing", done: 0, total: toSet.length });
  for (const batch of chunks(toSet, METAFIELDS_SET_BATCH)) {
    if (cancelled()) return { steps, cancelled: true };
    await writeProducts(args, batch, outcome);
    setSyncProgress(shop, { phase: "writing", done: outcome.written.length, total: toSet.length });
  }
  const errors = [...(outcome.refused.length > 0 ? [refusedDetail(outcome.refused, outcome.breaker)] : []), ...outcome.failed.map((f) => f.error)];
  steps.push({
    step: "products.add",
    ok: errors.length === 0,
    detail:
      (errors.length === 0
        ? `${outcome.written.length} product(s) got their new rules`
        : `${outcome.written.length}/${toSet.length} product(s) got their new rules; ${errors.join("; ")} (the rest lack them until the next sync)`) +
      (skipped > 0 ? `; ${skipped} deleted product(s) skipped` : ""),
    ...refusedParams(outcome),
  });
  return { steps, cancelled: false };
}

/**
 * AFTER the flip: products that carried a marginRef bridge across it get their
 * final value (set, or cleared). Read first (deleted products untracked,
 * identical values recorded). Never loosens a floor under the new config (the
 * bridge resolves exactly like the final refs there) and never holds anything.
 */
export async function applyProductPrunes(args: ProductSyncArgs, prunes: readonly FinalWrite[], options: AdditionsOptions = {}): Promise<AdditionsResult> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  if (prunes.length === 0) return { steps, cancelled: false };
  const cancelled = () => options.isCancelled?.() === true || args.isCancelled?.() === true;
  const toSet: Write[] = [];
  const toDelete: string[] = [];
  const untrack: string[] = [];
  try {
    for (const batch of chunks(prunes, NODES_BATCH)) {
      if (cancelled()) return { steps, cancelled: true };
      const values = await readProductValues(transport, batch.map((w) => w.productId), cancelled);
      for (const write of batch) {
        const node = values.get(write.productId);
        const current = node?.metafield?.value ?? null;
        if (!node || (write.value === null && current === null)) untrack.push(write.productId);
        else if (write.value === null) toDelete.push(write.productId);
        else if (sameJson(current, write.value)) await upsertRow(db, shop, write.productId, write.hash, write.value);
        else toSet.push({ productId: write.productId, value: write.value, hash: write.hash! });
      }
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof SyncCancelled) return { steps, cancelled: true };
    steps.push({ step: "products.prune", ok: false, detail: `could not read the products to finish after the flip: ${errorText(error)} (the next sync finishes them)` });
    return { steps, cancelled: false };
  }
  if (untrack.length > 0) await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: untrack } } });
  const outcome: WriteOutcome<Write> = { written: [], refused: [], failed: [] };
  for (const batch of chunks(toSet, METAFIELDS_SET_BATCH)) {
    if (cancelled()) return { steps, cancelled: true };
    await writeProducts(args, batch, outcome);
  }
  const errors = [...(outcome.refused.length > 0 ? [refusedDetail(outcome.refused, outcome.breaker)] : []), ...outcome.failed.map((f) => f.error)];
  let cleared = 0;
  for (const batch of chunks(toDelete, METAFIELDS_DELETE_BATCH)) {
    if (cancelled()) return { steps, cancelled: true };
    try {
      const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsDelete", {
        metafields: batch.map((ownerId) => ({ ownerId, namespace: WON_NAMESPACE, key: PRODUCT_KEY })),
      });
      const error = userErrorText(data.metafieldsDelete.userErrors);
      if (error) {
        errors.push(error);
        continue;
      }
      cleared += batch.length;
      await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: batch } } });
    } catch (error) {
      if (error instanceof Response || error instanceof SyncCancelled) throw error;
      errors.push(errorText(error));
    }
  }
  steps.push({
    step: "products.prune",
    ok: errors.length === 0,
    detail:
      `${outcome.written.length + cleared}/${toSet.length + toDelete.length} product(s) finished after the flip (margin collections they no longer need)` +
      (errors.length > 0 ? `; ${errors.join("; ")} (they keep a stricter-or-equal set until the next sync)` : ""),
    ...refusedParams(outcome),
  });
  return { steps, cancelled: false };
}

/**
 * Plan + both lanes in order, no shop config in between (the products-only
 * refresh). A superseded pass (args.isCancelled) stops at its next Shopify
 * call and says `cancelled` (nothing to record: the newer sync redoes it).
 */
export async function syncProducts(args: ProductSyncArgs, options: AdditionsOptions = {}): Promise<ProductSyncResult & { cancelled: boolean }> {
  try {
    const plan = await planProducts(args);
    if (!plan.complete) return { steps: plan.steps, staleRisk: plan.staleRisk, ...(plan.staleRisk ? { holdReason: "products_unread" as const } : {}), cancelled: false };
    const changes = await applyProductChanges(args, plan);
    const additions = await applyProductAdditions(args, plan.additions, options);
    const prunes = additions.cancelled ? { steps: [], cancelled: true } : await applyProductPrunes(args, plan.prunes, options);
    return {
      steps: [...plan.steps, ...changes.steps, ...additions.steps, ...prunes.steps],
      staleRisk: changes.staleRisk,
      ...(changes.holdReason ? { holdReason: changes.holdReason } : {}),
      cancelled: prunes.cancelled,
    };
  } catch (error) {
    if (error instanceof SyncCancelled) return { steps: [], staleRisk: false, cancelled: true };
    throw error;
  }
}

/** payloadHash null = a write is in flight (the value is then left as it was). */
async function upsertRow(db: PrismaClient, shop: string, productId: string, payloadHash: string | null, value?: string): Promise<void> {
  await db.productTargetIndex.upsert({
    where: { shop_productId: { shop, productId } },
    create: { shop, productId, payloadHash, ...(value !== undefined ? { value } : {}) },
    update: { payloadHash, ...(value !== undefined ? { value } : {}) },
  });
}
