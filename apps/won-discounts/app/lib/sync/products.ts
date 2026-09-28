// Product targeting write (spec §1 C3, T1 targeting.ts): the engine's
// `productRuleIndex` → `$app:won_discounts`/`product` =
// productMetafieldValue(entry) = {"ruleIds": [...], "variantRuleIds": {"<variant numeric id>": [...]}}
// on every targeted product, so the function never needs rule id lists.
//
// Which products carry our metafield is sync bookkeeping in Prisma
// ProductTargetIndex {shop, productId, payloadHash} (DATA-1; no cap). Each run:
//   1. targeted = product ids, products of targeted variants, collection
//      members (paged 250); candidates = targeted ∪ indexed products;
//   2. desired value per candidate (productRuleIndex → productMetafieldValue);
//      skip where the stored payloadHash already equals it (no read, no write);
//   3. the rest is checked once (nodes(), 100 per query): products deleted in
//      Shopify are dropped; a product whose Shopify value already matches is
//      just recorded;
//   4. WRITE-AHEAD: rows for products about to get a value are set to
//      payloadHash = null BEFORE the write, so a crash never leaves an
//      untracked metafield (a stale ref would keep discounting a product that
//      left the target);
//   5. metafieldsSet ≤ 25 per call (row hash on success), metafieldsDelete
//      ≤ 250 per call (row deleted on success); failures stay tracked and are
//      retried next sync.
// `staleRisk` = some product may still carry refs the new config no longer
// gives it (a clear failed, or the step could not finish): the orchestrator
// then HOLDS the new shop config (M1, sync.server.ts). A failed SET only means
// a product lacks a new ref (under-discount until the next sync), no hold.
// `entry.oversized` (the engine had to shrink a product over its 9 000 B
// budget) is surfaced as a warning step naming the product and the rules.

import { productMetafieldValue } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import { PRODUCT_KEY, WON_NAMESPACE } from "./graphql";
import { errorText, setMetafields, userErrorText, type Transport, type UserErrorLike } from "./transport";
import type { ConfigView, SyncProductEntry, SyncProductInput, SyncStep } from "./types";
import { canonicalJson, chunks, hashText, METAFIELDS_DELETE_BATCH, METAFIELDS_SET_BATCH, NODES_BATCH, sameJson } from "./util";

/** No rule for the product nor for any of its variants: the metafield should not exist. */
export function isEmptyEntry(entry: SyncProductEntry): boolean {
  return entry.ruleIds.length === 0 && Object.values(entry.variantRuleIds ?? {}).every((refs) => refs.length === 0);
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

/** Every product/variant/collection any rule (or non-killed campaign re-target) points at — the set productRuleIndex reads. */
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
  db: PrismaClient;
  shop: string;
  config: ConfigView;
  productRuleIndex: (config: ConfigView, products: readonly SyncProductInput[]) => Map<string, SyncProductEntry>;
}

export interface ProductSyncResult {
  steps: SyncStep[];
  /** Some product may still carry refs the new config no longer gives it (see header). */
  staleRisk: boolean;
}

async function targetedProducts(transport: Transport, scopes: Scopes) {
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
  return { targeted, productCollections, allVariants, missing };
}

export async function syncProducts(args: ProductSyncArgs): Promise<ProductSyncResult> {
  const { transport, db, shop, config } = args;
  const steps: SyncStep[] = [];
  const scopes = targetScopes(config);
  const rows = await db.productTargetIndex.findMany({ where: { shop }, select: { productId: true, payloadHash: true } });
  const indexed = new Map(rows.map((row) => [row.productId, row.payloadHash]));

  let found;
  try {
    found = await targetedProducts(transport, scopes);
  } catch (error) {
    if (error instanceof Response) throw error;
    steps.push({ step: "products", ok: false, detail: `could not read the targeted products: ${errorText(error)}` });
    // Nothing written: products that left a target may still carry old refs.
    return { steps, staleRisk: indexed.size > 0 };
  }
  const { targeted, productCollections, allVariants, missing } = found;

  const candidates = [...new Set([...targeted, ...indexed.keys()])].sort();
  if (candidates.length === 0) {
    steps.push({ step: "products", ok: true, detail: "no targeted products and none to clean" });
    return { steps, staleRisk: false };
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
        }),
      );
      const hash = hashText(canonicalJson(JSON.parse(value)));
      if (indexed.get(productId) !== hash) wanted.set(productId, { value, hash });
    } else if (indexed.has(productId)) {
      toClear.push(productId);
    }
  }
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

  // Check the products that need a change: deleted ones are dropped, an identical Shopify value is only recorded.
  const toSet: { productId: string; value: string; hash: string }[] = [];
  const recorded: { productId: string; hash: string }[] = [];
  const gone: string[] = [];
  const clearing = new Set(toClear);
  try {
    for (const batch of chunks([...wanted.keys(), ...toClear], NODES_BATCH)) {
      const data: { nodes: ({ id: string; metafield: { value: string } | null } | null)[] } = await transport.call("productMetafields", { ids: batch });
      batch.forEach((productId, i) => {
        const node = data.nodes[i];
        if (!node?.id) {
          gone.push(productId);
          clearing.delete(productId);
          return;
        }
        const want = wanted.get(productId);
        if (want) {
          if (sameJson(node.metafield?.value, want.value)) recorded.push({ productId, hash: want.hash });
          else toSet.push({ productId, ...want });
        } else if (!node.metafield) {
          clearing.delete(productId);
          gone.push(productId); // already absent in Shopify: just untrack
        }
      });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    steps.push({ step: "products", ok: false, detail: `could not read the products to update: ${errorText(error)}` });
    return { steps, staleRisk: toClear.length > 0 };
  }
  if (gone.length) await db.productTargetIndex.deleteMany({ where: { shop, productId: { in: gone } } });
  for (const { productId, hash } of recorded) await upsertRow(db, shop, productId, hash);

  // Write-ahead, then writes.
  let setOk = 0;
  const setErrors: string[] = [];
  for (const batch of chunks(toSet, METAFIELDS_SET_BATCH)) {
    for (const { productId } of batch) await upsertRow(db, shop, productId, null);
    const error = await setMetafields(
      transport,
      batch.map(({ productId, value }) => ({ ownerId: productId, namespace: WON_NAMESPACE, key: PRODUCT_KEY, type: "json", value })),
    );
    if (error) {
      setErrors.push(error);
      continue;
    }
    setOk += batch.length;
    await db.$transaction(
      batch.map(({ productId, hash }) =>
        db.productTargetIndex.update({ where: { shop_productId: { shop, productId } }, data: { payloadHash: hash } }),
      ),
    );
  }
  if (toSet.length > 0) {
    steps.push({
      step: "products.set",
      ok: setErrors.length === 0,
      detail:
        setErrors.length === 0
          ? `${setOk} product(s) updated`
          : `${setOk}/${toSet.length} product(s) updated; ${setErrors.join("; ")} (they lack the new rules until the next sync)`,
    });
  }

  const clears = [...clearing];
  let clearOk = 0;
  const clearErrors: string[] = [];
  for (const batch of chunks(clears, METAFIELDS_DELETE_BATCH)) {
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
      if (error instanceof Response) throw error;
      clearErrors.push(errorText(error));
    }
  }
  if (clears.length > 0) {
    steps.push({
      step: "products.clear",
      ok: clearErrors.length === 0,
      detail:
        clearErrors.length === 0
          ? `${clearOk} product(s) no longer targeted, cleared`
          : `${clearOk}/${clears.length} cleared; ${clearErrors.join("; ")} (they still carry old rules: the new config is held)`,
    });
  }
  return { steps, staleRisk: clearErrors.length > 0 };
}

async function upsertRow(db: PrismaClient, shop: string, productId: string, payloadHash: string | null): Promise<void> {
  await db.productTargetIndex.upsert({
    where: { shop_productId: { shop, productId } },
    create: { shop, productId, payloadHash },
    update: { payloadHash },
  });
}
