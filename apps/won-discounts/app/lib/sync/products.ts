// Product targeting write (spec §1 C3, T1 targeting.ts): the engine's
// `productRuleIndex` → `$app:won_discounts`/`product` =
// {"ruleIds": [...], "variantRuleIds": {"<variant GID>": [...]}} on every
// targeted product, so the function never needs rule id lists.
//
// Which products may still carry our metafield from an earlier sync? Shopify
// cannot search products by an app-owned JSON metafield and the Prisma schema
// has no per-product table, so the sync keeps that set itself in an app-owned
// SHOP metafield `$app:won_discounts`/`product_index` = {"v":1,"products":[
// numeric ids]} (never read by the function). Each run:
//   1. candidates = products targeted now (product/variant ids, collection
//      members paged 250 at a time) ∪ the index;
//   2. re-read the current metafield of every candidate (nodes(), 100 per
//      query) and plan: write where the value differs, delete where the
//      product has no rule any more — unchanged products get no write;
//   3. WRITE-AHEAD: record every product about to get a metafield in the index
//      BEFORE writing it, so a crash can never leave an untracked metafield
//      (a stale rule ref would keep discounting a product that left the target);
//   4. metafieldsSet in batches of ≤ 25, metafieldsDelete in batches of ≤ 250;
//   5. rewrite the index = products that now carry a rule + every product
//      whose write/delete failed (retried next run).
// Capacity: JSON metafield writes are capped at 128 KB on API 2026-04
// (https://shopify.dev/changelog/reduced-metafield-value-sizes); at ~16 B per
// id the index holds ~7 500 products. Above PRODUCT_INDEX_MAX_BYTES the
// product step refuses to write (nothing untracked is ever written) and says so.

import { errorText, setMetafields, userErrorText, type Transport, type UserErrorLike } from "./transport";
import { PRODUCT_KEY, SHOP_PRODUCT_INDEX_KEY, WON_NAMESPACE } from "./graphql";
import type { ConfigView, SyncLogger, SyncProductEntry, SyncProductInput, SyncStep } from "./types";

/** Shopify: 25 metafields per metafieldsSet (https://shopify.dev/docs/apps/build/metafields/metafield-limits). */
export const METAFIELDS_SET_BATCH = 25;
/** Shopify: 250 metafields per metafieldsDelete (same page). */
export const METAFIELDS_DELETE_BATCH = 250;
/** Ids per `nodes(ids:)` read. */
export const NODES_BATCH = 100;
/** Under the 128 KB JSON metafield cap with headroom. */
export const PRODUCT_INDEX_MAX_BYTES = 120_000;

const PRODUCT_GID = "gid://shopify/Product/";

export function productNumericId(gid: string): string {
  return gid.startsWith(PRODUCT_GID) ? gid.slice(PRODUCT_GID.length) : gid;
}

function productGid(numeric: string): string {
  return numeric.startsWith("gid://") ? numeric : `${PRODUCT_GID}${numeric}`;
}

export interface ProductIndexState {
  /** Product GIDs that may carry our metafield. */
  products: string[];
  /** False when the stored index was not readable JSON (then only targeted products are cleaned). */
  readable: boolean;
}

export function parseProductIndex(value: string | null | undefined): ProductIndexState {
  if (value === null || value === undefined) return { products: [], readable: true };
  try {
    const parsed = JSON.parse(value) as { products?: unknown };
    if (!Array.isArray(parsed.products)) return { products: [], readable: false };
    return { products: parsed.products.filter((p): p is string => typeof p === "string").map(productGid), readable: true };
  } catch {
    return { products: [], readable: false };
  }
}

export function encodeProductIndex(products: Iterable<string>): string {
  const ids = [...new Set([...products].map(productNumericId))].sort();
  return JSON.stringify({ v: 1, products: ids });
}

/** Deterministic JSON (sorted keys) for comparing a stored value with the desired one. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameJson(stored: string | null | undefined, desired: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  try {
    return canonicalJson(JSON.parse(stored)) === canonicalJson(desired);
  } catch {
    return false;
  }
}

/** No rule for the product nor for any of its variants: the metafield should not exist. */
export function isEmptyEntry(entry: SyncProductEntry): boolean {
  return entry.ruleIds.length === 0 && Object.values(entry.variantRuleIds ?? {}).every((refs) => refs.length === 0);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

/** Every product/variant/collection any rule (or live campaign re-target) points at — the same set productRuleIndex reads. */
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
  return scopes;
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

export interface ProductSyncArgs {
  transport: Transport;
  config: ConfigView;
  shopId: string;
  index: ProductIndexState;
  productRuleIndex: (config: ConfigView, products: readonly SyncProductInput[]) => Map<string, SyncProductEntry>;
  logger: SyncLogger;
}

export async function syncProducts(args: ProductSyncArgs): Promise<SyncStep[]> {
  const { transport, config, shopId, index } = args;
  const steps: SyncStep[] = [];
  const scopes = targetScopes(config);

  // 1. Targeted products.
  const productCollections = new Map<string, Set<string>>();
  const targeted = new Set<string>(scopes.productIds);
  const missing: string[] = [];
  for (const collectionId of scopes.collectionIds) {
    let after: string | null = null;
    for (;;) {
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
      if (!data.collection.products.pageInfo.hasNextPage) break;
      after = data.collection.products.pageInfo.endCursor;
    }
  }
  const variantProducts = new Set<string>();
  for (const batch of chunks([...scopes.variantIds], NODES_BATCH)) {
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
      const data: { product: { variants: Page<{ id: string }> } | null } = await transport.call("productVariants", { id: productId, after });
      if (!data.product) break;
      for (const variant of data.product.variants.nodes) variants.push(variant.id);
      if (!data.product.variants.pageInfo.hasNextPage) break;
      after = data.product.variants.pageInfo.endCursor;
    }
    allVariants.set(productId, variants);
  }

  if (!index.readable) {
    steps.push({
      step: "products.index",
      ok: false,
      detail:
        "the stored product index was unreadable: products outside today's targets that still carry an old Won rule cannot be found; the index is rebuilt from today's targets",
    });
  }
  const candidates = [...new Set([...targeted, ...index.products])].sort();
  if (candidates.length === 0) {
    if (!index.readable) {
      const written = await writeIndex(transport, shopId, encodeProductIndex([]));
      if (!written.ok) steps.push({ step: "products.index", ok: false, detail: `could not rebuild the product index: ${written.error}` });
    }
    steps.push({ step: "products", ok: true, detail: "no targeted products and none to clean" });
    return steps;
  }

  // 2. Current values + plan.
  const current = new Map<string, string | null>();
  for (const batch of chunks(candidates, NODES_BATCH)) {
    const data: { nodes: ({ id: string; metafield: { value: string } | null } | null)[] } = await transport.call("productMetafields", { ids: batch });
    for (const node of data.nodes) if (node?.id) current.set(node.id, node.metafield?.value ?? null);
  }
  const inputs: SyncProductInput[] = candidates
    .filter((id) => current.has(id))
    .map((productId) => ({
      productId,
      variantIds: allVariants.get(productId) ?? [],
      collectionIds: [...(productCollections.get(productId) ?? [])].sort(),
    }));
  const refs = args.productRuleIndex(config, inputs);
  const toSet: { productId: string; value: string }[] = [];
  const toClear: string[] = [];
  const carrying = new Set<string>();
  for (const { productId } of inputs) {
    const entry = refs.get(productId);
    const stored = current.get(productId) ?? null;
    if (entry && !isEmptyEntry(entry)) {
      carrying.add(productId);
      if (!sameJson(stored, entry)) toSet.push({ productId, value: JSON.stringify(entry) });
    } else if (stored !== null) {
      toClear.push(productId);
    }
  }
  const scopeDetail =
    `${targeted.size} targeted product(s) (${scopes.collectionIds.size} collection(s), ${scopes.variantIds.size} variant target(s))` +
    (missing.length ? `; collection(s) not found: ${missing.join(", ")}` : "");
  steps.push({ step: "products.scope", ok: true, detail: scopeDetail });

  // 3. Write-ahead index.
  const stored = new Set(index.products);
  const ahead = new Set([...stored, ...toSet.map((p) => p.productId)]);
  const aheadJson = encodeProductIndex(ahead);
  if (Buffer.byteLength(aheadJson, "utf8") > PRODUCT_INDEX_MAX_BYTES) {
    steps.push({
      step: "products.index",
      ok: false,
      detail: `too many targeted products to track (${ahead.size}; the index is capped at ${PRODUCT_INDEX_MAX_BYTES} B) — product discounts were not updated; narrow the targeted collections`,
    });
    return steps;
  }
  // What the shop metafield holds right now (an unreadable value never equals a real index).
  let indexOnShopJson = index.readable ? encodeProductIndex(stored) : null;
  if (ahead.size !== stored.size) {
    const written = await writeIndex(transport, shopId, aheadJson);
    if (!written.ok) {
      steps.push({ step: "products.index", ok: false, detail: `could not record products before writing them: ${written.error}` });
      return steps;
    }
    indexOnShopJson = aheadJson;
  }

  // 4. Writes.
  const failed = new Set<string>();
  let setOk = 0;
  const setErrors: string[] = [];
  for (const batch of chunks(toSet, METAFIELDS_SET_BATCH)) {
    const metafields = batch.map(({ productId, value }) => ({ ownerId: productId, namespace: WON_NAMESPACE, key: PRODUCT_KEY, type: "json", value }));
    const error = await setMetafields(transport, metafields);
    if (error) {
      for (const { productId } of batch) failed.add(productId);
      setErrors.push(error);
    } else setOk += batch.length;
  }
  if (toSet.length > 0 || setErrors.length > 0) {
    steps.push({
      step: "products.set",
      ok: setErrors.length === 0,
      detail: setErrors.length === 0 ? `${setOk} product(s) updated` : `${setOk}/${toSet.length} product(s) updated; ${setErrors.join("; ")}`,
    });
  }
  let clearOk = 0;
  const clearErrors: string[] = [];
  for (const batch of chunks(toClear, METAFIELDS_DELETE_BATCH)) {
    try {
      const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsDelete", {
        metafields: batch.map((ownerId) => ({ ownerId, namespace: WON_NAMESPACE, key: PRODUCT_KEY })),
      });
      const error = userErrorText(data.metafieldsDelete.userErrors);
      if (error) {
        for (const id of batch) failed.add(id);
        clearErrors.push(error);
      } else clearOk += batch.length;
    } catch (error) {
      for (const id of batch) failed.add(id);
      clearErrors.push(errorText(error));
    }
  }
  if (toClear.length > 0 || clearErrors.length > 0) {
    steps.push({
      step: "products.clear",
      ok: clearErrors.length === 0,
      detail: clearErrors.length === 0 ? `${clearOk} product(s) no longer targeted, cleared` : `${clearOk}/${toClear.length} cleared; ${clearErrors.join("; ")}`,
    });
  }
  if (toSet.length === 0 && toClear.length === 0) {
    steps.push({ step: "products", ok: true, detail: `${carrying.size} product(s) up to date` });
  }

  // 5. Final index: what carries a rule now + whatever failed (retried next run).
  const finalSet = new Set([...carrying, ...failed]);
  const finalJson = encodeProductIndex(finalSet);
  if (finalJson !== indexOnShopJson) {
    const written = await writeIndex(transport, shopId, finalJson);
    steps.push({
      step: "products.index",
      ok: written.ok,
      detail: written.ok ? `tracking ${finalSet.size} product(s)` : `could not update the product index: ${written.error} (retried next sync)`,
    });
  }
  return steps;
}

async function writeIndex(transport: Transport, shopId: string, value: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const error = await setMetafields(transport, [{ ownerId: shopId, namespace: WON_NAMESPACE, key: SHOP_PRODUCT_INDEX_KEY, type: "json", value }]);
  return error ? { ok: false, error } : { ok: true };
}
