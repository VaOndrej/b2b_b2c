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
//   - a margin collection: its products get no NEW marginRef (they cannot be
//     read), and the shop payload the sync writes FOLDS its values into the
//     global values and into every other collection's own values — strictest
//     wins (max min-margin, min max-discount), like core gateConfigForPlan does
//     for Free — so no product can get a looser floor than that collection's;
//     a product that already carries its ref keeps it (never loosened before
//     the flip). Failed step `margin.too_large` per collection, with its id,
//     title and count as `params` for the admin (sync-copy.ts).
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
// its marginRefs (MVP 2 audit P2-3, see above), or the plan could not finish.
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

import { marginCollectionIds } from "@won/core/discounts/margin";
import { parseRuleRef, productMetafieldValue, variantKey } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import { PRODUCT_KEY, WON_NAMESPACE } from "./graphql";
import { setSyncProgress } from "./progress";
import { errorText, setMetafields, userErrorText, type Transport, type UserErrorLike } from "./transport";
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
  /** The numeric ids the margin collections of this pass ship under (onlyAddsRefs: a dropped ref to anything else holds nothing). */
  liveMarginRefs: string[];
}

export interface ProductSyncResult {
  steps: SyncStep[];
  /** Some product may still carry refs the new config no longer gives it (see header). */
  staleRisk: boolean;
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
  /** The config whose product refs this pass computes: collections that do not fit are left out. */
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
export async function collectionLimits(args: Pick<ProductSyncArgs, "transport" | "config" | "isCancelled">): Promise<CollectionLimits> {
  const { transport, config } = args;
  const marginIds = marginCollectionIds(config.modules.margin);
  const marginSet = new Set(marginIds);
  const ids = [...marginIds, ...[...targetScopes(config).collectionIds].filter((id) => !marginSet.has(id))];
  const unchanged: CollectionLimits = { config, payloadConfig: config, steps: [], marginTooLarge: [] };
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
  for (const id of ids) {
    const size = sizes.get(id);
    if (!size) continue; // not found: the pass reports it
    if (!size.exact || total + size.count > MAX_COLLECTION_PRODUCTS) tooLarge.add(id);
    else total += size.count;
  }
  if (tooLarge.size === 0) return unchanged;
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
  const quoted = (ids: Iterable<string>) => [...ids].map((id) => `"${titleOf(id) ?? "(untitled collection)"}"`).join(", ");
  const steps: SyncStep[] = [...affected].map(([ruleId, { name, collections }]) => ({
    step: `products.too_large:${ruleId}`,
    ok: false,
    detail:
      `"${name || ruleId}" does not apply at checkout to ${quoted(collections)}: the targeted collections have more than ` +
      `${MAX_COLLECTION_PRODUCTS} products together, more than Won reads per sync — every other rule is synced as usual`,
  }));
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
  if (dropped.size > 0) out.modules.margin.perCollection = out.modules.margin.perCollection.filter((o) => !dropped.has(o.collectionId));
  return { config: out, payloadConfig: dropped.size > 0 ? foldMarginCollections(config, dropped) : config, steps, marginTooLarge };
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
  const have = refsOf(current);
  const want = refsOf(next);
  if (!have || !want) return false;
  for (const ref of have.ruleIds) if (!want.ruleIds.has(ref)) return false;
  for (const [variant, refs] of have.variants) {
    for (const ref of refs) if (!want.ruleIds.has(ref) && !want.variants.get(variant)?.has(ref)) return false;
  }
  for (const ref of want.marginRefs) if (!have.marginRefs.has(ref)) return false;
  for (const ref of have.marginRefs) if (!want.marginRefs.has(ref) && (!liveMarginRefs || liveMarginRefs.has(ref))) return false;
  return true;
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
  return { steps, staleRisk, complete: false, sets: [], clears: [], additions: [], liveMarginRefs: [] };
}

export async function planProducts(args: ProductSyncArgs): Promise<ProductPlan> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  const limited = args.limits ?? (await collectionLimits(args));
  steps.push(...limited.steps);
  const config = limited.config;
  const scopes = targetScopes(config);
  const rows = await db.productTargetIndex.findMany({ where: { shop }, select: { productId: true, payloadHash: true, value: true } });
  const indexed = new Map(rows.map((row) => [row.productId, row.payloadHash]));
  // A margin collection too large to read: products that already carry its ref keep it (see the header).
  const keepRefs = new Set(limited.marginTooLarge.map((m) => variantKey(m.collectionId)));
  // What the payload's `col` names after this pass (the collections that fit): a dropped ref to anything else is ignored at checkout.
  const liveMarginRefs = marginCollectionIds(config.modules.margin).map(variantKey);
  const storedValue = new Map(rows.map((row) => [row.productId, row.value]));
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
    // Nothing written: products that left a target may still carry old refs.
    return failedPlan(steps, indexed.size > 0);
  }
  const { targeted, productCollections, allVariants, missing } = found;

  const candidates = [...new Set([...targeted, ...indexed.keys()])].sort();
  if (candidates.length === 0) {
    steps.push({ step: "products", ok: true, detail: "no targeted products and none to clean" });
    return { steps, staleRisk: false, complete: true, sets: [], clears: [], additions: [], liveMarginRefs };
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
    let entry = entries.get(productId);
    if (keepRefs.size > 0) {
      const kept = marginRefsOf(storedValue.get(productId)).filter((ref) => keepRefs.has(ref));
      if (kept.length > 0) {
        const base: SyncProductEntry = entry ?? { ruleIds: [], variantRuleIds: {} };
        entry = { ...base, marginRefs: [...new Set([...(base.marginRefs ?? []), ...kept])].sort() };
      }
    }
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
  for (const write of marginNewcomers) {
    const node = values.get(write.productId);
    if (!node) continue; // deleted meanwhile: nothing to write, nothing indexed
    if (sameJson(node.metafield?.value, write.value)) recorded.push(write);
    else sets.push({ ...write, current: node.metafield?.value ?? null });
  }
  for (const productId of wantedIndexed) {
    const node = values.get(productId);
    const want = wanted.get(productId)!;
    if (!node) gone.push(productId);
    else if (sameJson(node.metafield?.value, want.value)) recorded.push({ productId, hash: want.hash, value: want.value });
    else sets.push({ productId, ...want, current: node.metafield?.value ?? null });
  }
  for (const productId of toClear) {
    const node = values.get(productId);
    if (!node || !node.metafield) {
      clearing.delete(productId);
      gone.push(productId); // deleted, or already absent in Shopify: just untrack
    }
  }
  if (gone.length) await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: gone } } });
  for (const { productId, hash, value } of recorded) await upsertRow(db, shop, productId, hash, value);
  return { steps, staleRisk: false, complete: true, sets, clears: [...clearing], additions, liveMarginRefs };
}

// --- Writes -----------------------------------------------------------------------------------

async function writeBatch(args: ProductSyncArgs, batch: readonly Write[]): Promise<string | null> {
  const { transport, db, shop } = args;
  for (const { productId } of batch) await upsertRow(db, shop, productId, null);
  const error = await setMetafields(
    transport,
    batch.map(({ productId, value }) => ({ ownerId: productId, namespace: WON_NAMESPACE, key: PRODUCT_KEY, type: "json", value })),
  );
  if (error) return error;
  await db.$transaction(
    batch.map(({ productId, hash, value }) =>
      db.productTargetIndex.update({ where: { shop_productId: { shop, productId } }, data: { payloadHash: hash, value } }),
    ),
  );
  return null;
}

/**
 * The BEFORE lane: changes to products that carry Won refs, products that gain
 * a marginRef, and clears. A failed write that would have removed a rule ref
 * or added a marginRef (onlyAddsRefs false), or a failed clear, is `staleRisk`.
 */
export async function applyProductChanges(args: ProductSyncArgs, plan: ProductPlan): Promise<ProductSyncResult> {
  const { transport, db, shop } = args;
  const steps: SyncStep[] = [];
  let staleRisk = false;

  let setOk = 0;
  const setErrors: string[] = [];
  let reductionFailed = 0;
  const live = new Set(plan.liveMarginRefs);
  for (const batch of chunks(plan.sets, METAFIELDS_SET_BATCH)) {
    checkCancelled(args);
    const error = await writeBatch(args, batch);
    if (error) {
      setErrors.push(error);
      const reductions = batch.filter((w) => !onlyAddsRefs(w.value, w.current, live)).length;
      if (reductions > 0) {
        reductionFailed += reductions;
        staleRisk = true;
      }
      continue;
    }
    setOk += batch.length;
  }
  if (plan.sets.length > 0) {
    steps.push({
      step: "products.set",
      ok: setErrors.length === 0,
      detail:
        setErrors.length === 0
          ? `${setOk} product(s) updated`
          : `${setOk}/${plan.sets.length} product(s) updated; ${setErrors.join("; ")}` +
            (reductionFailed > 0
              ? ` (${reductionFailed} of them do not carry what the new config relies on — a rule they should lose, or a stricter margin collection: the new config is held)`
              : " (they lack the new rules until the next sync)"),
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
    if (clearErrors.length > 0) staleRisk = true;
  }
  return { steps, staleRisk };
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
  let setOk = 0;
  const errors: string[] = [];
  setSyncProgress(shop, { phase: "writing", done: 0, total: toSet.length });
  for (const batch of chunks(toSet, METAFIELDS_SET_BATCH)) {
    if (cancelled()) return { steps, cancelled: true };
    const error = await writeBatch(args, batch);
    if (error) errors.push(error);
    else setOk += batch.length;
    setSyncProgress(shop, { phase: "writing", done: setOk, total: toSet.length });
  }
  steps.push({
    step: "products.add",
    ok: errors.length === 0,
    detail:
      (errors.length === 0 ? `${setOk} product(s) got their new rules` : `${setOk}/${toSet.length} product(s) got their new rules; ${errors.join("; ")} (the rest lack them until the next sync)`) +
      (skipped > 0 ? `; ${skipped} deleted product(s) skipped` : ""),
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
    if (!plan.complete) return { steps: plan.steps, staleRisk: plan.staleRisk, cancelled: false };
    const changes = await applyProductChanges(args, plan);
    const additions = await applyProductAdditions(args, plan.additions, options);
    return { steps: [...plan.steps, ...changes.steps, ...additions.steps], staleRisk: changes.staleRisk, cancelled: additions.cancelled };
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
