// Backup envelope + restore of a native discount from it (undo, and the
// immediate rollback when a move fails after the delete, REL-3).
//
// The restored discount has the same title, value, targets, minimum, dates,
// combinations, limits and EVERY redeem code (first code in the create, the rest
// via discountRedeemCodeBulkAdd, 250 per call). What Shopify cannot take back:
// the usage count and the "once per customer" history (both start at zero).
//
// Idempotent (REL-2): before creating, a code discount is looked up by its
// first code, so a retried restore whose first attempt landed reuses that
// discount instead of failing on "code taken". An automatic restore whose
// response was lost is found among the newest automatic discounts by exact
// title + type, created after the restore started.

import { REDEEM_CODES_PER_CALL } from "./documents.ts";
import { normalizeNode } from "./normalize.ts";
import { describeUserErrors, type RequestOptions, runGql, userErrorsOf } from "./request.server.ts";
import type { AdminClient, MovableKind, NativeDiscount, ShopContext } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the snapshot is raw Admin API JSON */

/** What NativeDiscountBackup.snapshot stores (JSON). */
export interface SnapshotEnvelope {
  format: 1;
  takenAt: string;
  shop: ShopContext;
  /** The raw `discountNode` payload, every page of every list merged in. */
  node: any;
  /**
   * Set once the discount is (back) in Shopify under this id: after an undo,
   * after a failed move put it back, or when the delete never happened.
   */
  restoredAs?: {
    nativeId: string;
    at: string;
    /** Codes of the snapshot not (yet) on the restored discount: the next undo adds them. */
    codesMissing?: number;
    /** Shopify was still importing codes when we stopped waiting: not a failure yet. */
    codesPending?: boolean;
  };
}

export function makeSnapshot(node: any, shop: ShopContext, now: Date = new Date()): SnapshotEnvelope {
  return { format: 1, takenAt: now.toISOString(), shop, node };
}

export function parseSnapshot(text: string): SnapshotEnvelope | null {
  try {
    const value = JSON.parse(text);
    if (value?.format !== 1 || !value.node || typeof value.shop?.currencyCode !== "string") return null;
    return value as SnapshotEnvelope;
  } catch {
    return null;
  }
}

/** The discount as it was, read back from the snapshot (same reader as detection). */
export function nativeFromSnapshot(envelope: SnapshotEnvelope): NativeDiscount | null {
  const node = normalizeNode(envelope.node, envelope.shop);
  return node && node.movableType ? node.native : null;
}

const CREATE: Record<MovableKind, { doc: "codeBasicCreate" | "automaticBasicCreate" | "codeFreeShippingCreate" | "automaticFreeShippingCreate"; field: string; node: string; typename: string }> = {
  code_basic: { doc: "codeBasicCreate", field: "discountCodeBasicCreate", node: "codeDiscountNode", typename: "DiscountCodeBasic" },
  automatic_basic: {
    doc: "automaticBasicCreate",
    field: "discountAutomaticBasicCreate",
    node: "automaticDiscountNode",
    typename: "DiscountAutomaticBasic",
  },
  code_free_shipping: {
    doc: "codeFreeShippingCreate",
    field: "discountCodeFreeShippingCreate",
    node: "codeDiscountNode",
    typename: "DiscountCodeFreeShipping",
  },
  automatic_free_shipping: {
    doc: "automaticFreeShippingCreate",
    field: "discountAutomaticFreeShippingCreate",
    node: "automaticDiscountNode",
    typename: "DiscountAutomaticFreeShipping",
  },
};

/**
 * The create mutation input for `native` (validated shapes: see the report).
 * `raw` supplies the exact percentage (the normalized one is rounded for Won).
 */
export function buildCreateInput(native: NativeDiscount, raw: any): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: native.title,
    startsAt: native.startsAt,
    endsAt: native.endsAt,
    context: { all: "ALL" },
    combinesWith: { ...native.combinesWith },
  };
  if (native.minimum?.kind === "subtotal") {
    input.minimumRequirement = { subtotal: { greaterThanOrEqualToSubtotal: native.minimum.amount } };
  } else if (native.minimum?.kind === "quantity") {
    input.minimumRequirement = { quantity: { greaterThanOrEqualToQuantity: String(native.minimum.quantity) } };
  }

  if (native.kind === "code_basic" || native.kind === "automatic_basic") {
    const rawPercentage = raw?.discount?.customerGets?.value?.percentage;
    const value =
      native.value?.kind === "fixed"
        ? { discountAmount: { amount: native.value.amount, appliesOnEachItem: native.value.appliesOnEachItem } }
        : { percentage: typeof rawPercentage === "number" ? rawPercentage : ((native.value as { percent?: number })?.percent ?? 0) / 100 };
    const target = native.target;
    const items =
      target?.kind === "products"
        ? { products: { productsToAdd: target.productIds, productVariantsToAdd: target.variantIds } }
        : target?.kind === "collections"
          ? { collections: { add: target.ids } }
          : { all: true };
    input.customerGets = {
      value,
      items,
      appliesOnOneTimePurchase: native.appliesOnOneTimePurchase,
      appliesOnSubscription: native.appliesOnSubscription,
    };
  } else {
    input.destination = native.shippingCountries
      ? { countries: { add: native.shippingCountries.countries, includeRestOfWorld: native.shippingCountries.includeRestOfWorld } }
      : { all: true };
    if (native.maximumShippingPrice) input.maximumShippingPrice = native.maximumShippingPrice.amount;
    input.appliesOnOneTimePurchase = native.appliesOnOneTimePurchase;
    input.appliesOnSubscription = native.appliesOnSubscription;
  }

  if (native.recurringCycleLimit !== null) input.recurringCycleLimit = native.recurringCycleLimit;
  if (native.method === "code") {
    input.code = native.codes[0];
    input.appliesOncePerCustomer = native.oncePerCustomer;
    if (native.usageLimit !== null) input.usageLimit = native.usageLimit;
  }
  return input;
}

export type RestoreResult =
  | {
      ok: true;
      nativeId: string;
      reused: boolean;
      /** Snapshot codes not on the discount yet (failed or, with `codesPending`, still importing). */
      codesMissing: number;
      codesPending: boolean;
    }
  | { ok: false; message: string; codeTaken?: boolean };

export interface RestoreOptions extends RequestOptions {
  now?: () => Date;
  /** Polls of a bulk code creation before giving up waiting (codes may still land). */
  bulkPolls?: number;
}

async function lookupCode(
  client: AdminClient,
  code: string,
  options: RequestOptions,
): Promise<{ ok: true; found: { id: string; typename: string; title: string } | null } | { ok: false; message: string }> {
  const result = await runGql(client, "codeLookup", { code }, options);
  if (!result.ok) return { ok: false, message: result.message };
  const node = result.data?.codeDiscountNodeByCode;
  if (!node?.id) return { ok: true, found: null };
  return {
    ok: true,
    found: { id: node.id, typename: String(node.codeDiscount?.__typename ?? ""), title: String(node.codeDiscount?.title ?? "") },
  };
}

async function findRecentAutomatic(
  client: AdminClient,
  native: NativeDiscount,
  since: Date,
  options: RequestOptions,
): Promise<string | null> {
  const result = await runGql(client, "recentAutomatic", undefined, options);
  if (!result.ok) return null;
  const nodes: any[] = Array.isArray(result.data?.discountNodes?.nodes) ? result.data.discountNodes.nodes : [];
  const typename = CREATE[native.kind].typename;
  const match = nodes.find(
    (n) =>
      n?.discount?.__typename === typename &&
      n.discount.title === native.title &&
      Date.parse(n.discount.createdAt) >= since.getTime() - 60_000,
  );
  return typeof match?.id === "string" ? match.id : null;
}

async function addRemainingCodes(
  client: AdminClient,
  discountId: string,
  codes: string[],
  options: RestoreOptions,
): Promise<{ failed: number; pending: boolean }> {
  let failed = 0;
  let pending = false;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < codes.length; i += REDEEM_CODES_PER_CALL) {
    const chunk = codes.slice(i, i + REDEEM_CODES_PER_CALL);
    const added = await runGql(client, "redeemCodesAdd", { id: discountId, codes: chunk.map((code) => ({ code })) }, options);
    const payload = added.ok ? added.data?.discountRedeemCodeBulkAdd : null;
    const bulkId = payload?.bulkCreation?.id;
    if (!added.ok || userErrorsOf(payload).length > 0 || typeof bulkId !== "string") {
      failed += chunk.length;
      continue;
    }
    let done = payload.bulkCreation.done === true;
    let status: any = null;
    for (let poll = 0; !done && poll < (options.bulkPolls ?? 20); poll++) {
      await sleep(1_000);
      const result = await runGql(client, "redeemCodesStatus", { id: bulkId }, options);
      status = result.ok ? result.data?.discountRedeemCodeBulkCreation : null;
      done = status?.done === true;
    }
    if (!done) pending = true; // still importing: not a failure yet
    else if (status && typeof status.failedCount === "number") failed += status.failedCount;
  }
  return { failed, pending };
}

/**
 * Put `envelope`'s discount back into Shopify. `codeTaken` on failure means the
 * first code belongs to another discount (typically the Won node that took it
 * over): remove that first, then try again.
 */
export async function restoreNative(
  client: AdminClient,
  envelope: SnapshotEnvelope,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const native = nativeFromSnapshot(envelope);
  if (!native) return { ok: false, message: "the backup cannot be read" };
  const spec = CREATE[native.kind];
  const startedAt = options.now?.() ?? new Date();

  if (native.method === "code") {
    if (native.codes.length === 0) return { ok: false, message: "the backup has no code" };
    const existing = await lookupCode(client, native.codes[0], options);
    if (!existing.ok) return { ok: false, message: existing.message };
    if (existing.found) {
      if (existing.found.typename === spec.typename && existing.found.title === native.title) {
        // An earlier attempt created it; it may have died before every code was added.
        const codes = await completeCodes(client, existing.found.id, native, true, options);
        return { ok: true, nativeId: existing.found.id, reused: true, codesMissing: codes.missing, codesPending: codes.pending };
      }
      return { ok: false, message: `the code ${native.codes[0]} belongs to another discount`, codeTaken: true };
    }
  }

  const created = await runGql(client, spec.doc, { input: buildCreateInput(native, envelope.node) }, options);
  let nativeId: string | null = null;
  if (created.ok) {
    const payload = created.data?.[spec.field];
    const errors = userErrorsOf(payload);
    if (errors.length > 0) return { ok: false, message: describeUserErrors(errors) };
    nativeId = typeof payload?.[spec.node]?.id === "string" ? payload[spec.node].id : null;
  }
  if (!nativeId && !(created.ok === false && created.kind === "throttled")) {
    // Transport failure, a GraphQL error or an answer without an id: the create
    // may still have landed. Look before reporting a failure (never duplicate).
    if (native.method === "code") {
      const found = await lookupCode(client, native.codes[0], options);
      if (found.ok && found.found?.typename === spec.typename && found.found.title === native.title) nativeId = found.found.id;
    } else {
      nativeId = await findRecentAutomatic(client, native, startedAt, options);
    }
  }
  if (!nativeId) return { ok: false, message: created.ok ? "Shopify returned no discount id" : created.message };

  const codes = await completeCodes(client, nativeId, native, false, options);
  return { ok: true, nativeId, reused: false, codesMissing: codes.missing, codesPending: codes.pending };
}

/** Redeem codes Shopify reports on a discount, or null when it cannot be read. */
async function countCodes(client: AdminClient, id: string, options: RequestOptions): Promise<number | null> {
  const result = await runGql(client, "one", { id, items: 1, codes: 1 }, options);
  const count = result.ok ? result.data?.discountNode?.discount?.codesCount?.count : null;
  return typeof count === "number" ? count : null;
}

/**
 * Make sure every code of the snapshot is on `id` (the create carried only the
 * first). `missing` is measured by Shopify's own count when it can be read (a
 * code that already exists makes the bulk add report a failure, so the count
 * is the honest number); `pending` when Shopify was still importing when we
 * stopped waiting, so the missing ones may yet land.
 */
async function completeCodes(
  client: AdminClient,
  id: string,
  native: NativeDiscount,
  reused: boolean,
  options: RestoreOptions,
): Promise<{ missing: number; pending: boolean }> {
  if (native.method !== "code" || native.codes.length <= 1) return { missing: 0, pending: false };
  if (reused) {
    const count = await countCodes(client, id, options);
    if (count !== null && count >= native.codes.length) return { missing: 0, pending: false };
  }
  const added = await addRemainingCodes(client, id, native.codes.slice(1), options);
  const count = await countCodes(client, id, options);
  const missing = count === null ? added.failed : Math.max(0, native.codes.length - count);
  return { missing, pending: added.pending && missing > 0 };
}

/**
 * A restored discount still missing codes (snapshot.restoredAs.codesMissing):
 * add them from the snapshot now. The undo path for a partial restore.
 */
export async function finishRestoredCodes(
  client: AdminClient,
  envelope: SnapshotEnvelope,
  options: RestoreOptions = {},
): Promise<{ ok: true; missing: number; pending: boolean } | { ok: false; message: string }> {
  const native = nativeFromSnapshot(envelope);
  const target = envelope.restoredAs?.nativeId;
  if (!native || !target) return { ok: false, message: "the backup cannot be read" };
  const codes = await completeCodes(client, target, native, true, options);
  return { ok: true, ...codes };
}
