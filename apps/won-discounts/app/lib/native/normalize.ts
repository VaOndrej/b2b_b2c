// Raw `discountNodes` / `discountNode` payload → typed facts. Pure (no I/O):
// detection and the full read before a move share exactly one interpretation.
// Unknown shapes never throw; they fall back to the most conservative reading
// (e.g. an unreadable buyer selection counts as "not everyone", which keeps
// the discount in Shopify rather than widening it).

import type {
  MovableKind,
  NativeCombinesWith,
  NativeDiscount,
  NativeKind,
  NativeMinimum,
  NativeStatus,
  NativeTarget,
  NativeValue,
  ShopContext,
} from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- this module IS the narrowing of raw GraphQL JSON */

const KIND_BY_TYPENAME: Readonly<Record<string, NativeKind>> = {
  DiscountCodeBasic: "code_basic",
  DiscountAutomaticBasic: "automatic_basic",
  DiscountCodeFreeShipping: "code_free_shipping",
  DiscountAutomaticFreeShipping: "automatic_free_shipping",
  DiscountCodeBxgy: "code_bxgy",
  DiscountAutomaticBxgy: "automatic_bxgy",
  DiscountCodeApp: "code_app",
  DiscountAutomaticApp: "automatic_app",
};

const MOVABLE_KINDS: ReadonlySet<NativeKind> = new Set<NativeKind>([
  "code_basic",
  "automatic_basic",
  "code_free_shipping",
  "automatic_free_shipping",
]);

export function isMovableKind(kind: NativeKind): kind is MovableKind {
  return MOVABLE_KINDS.has(kind);
}

export function kindOf(typename: unknown): NativeKind {
  return (typeof typename === "string" && KIND_BY_TYPENAME[typename]) || "unknown";
}

function statusOf(v: unknown): NativeStatus {
  return v === "ACTIVE" || v === "SCHEDULED" || v === "EXPIRED" ? v : "EXPIRED";
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

interface Page {
  ids: string[];
  /** Cursor to continue from, or null when the list is complete. */
  next: string | null;
}

function pageOf(connection: any, pick: (node: any) => unknown = (n) => n?.id): Page {
  const nodes: unknown[] = Array.isArray(connection?.nodes) ? connection.nodes : [];
  const ids = nodes.map(pick).filter((v): v is string => typeof v === "string");
  const hasNext = connection?.pageInfo?.hasNextPage === true;
  const cursor = connection?.pageInfo?.endCursor;
  return { ids, next: hasNext && typeof cursor === "string" ? cursor : null };
}

/** Where each list of a node continues (null = complete). */
export interface ListCursors {
  products: string | null;
  variants: string | null;
  collections: string | null;
  codes: string | null;
}

export type NormalizedNode =
  | { movableType: true; native: NativeDiscount; cursors: ListCursors }
  | {
      movableType: false;
      id: string;
      title: string;
      kind: NativeKind;
      status: NativeStatus;
      /** App discounts: which app provides it. */
      app: { appKey: string | null; functionId: string | null; title: string | null } | null;
      /** Redeem codes of a code BXGY / app discount (first page): a Won rule cannot share them. */
      codes: string[];
    };

function valueOf(customerGets: any): NativeValue | null {
  const value = customerGets?.value;
  if (value?.__typename === "DiscountPercentage" && typeof value.percentage === "number") {
    // Shopify: 0.0–1.0; Won: 0–100 with at most two decimals.
    return { kind: "percentage", percent: Math.round(value.percentage * 10_000) / 100 };
  }
  if (value?.__typename === "DiscountAmount" && typeof value.amount?.amount === "string") {
    return {
      kind: "fixed",
      amount: value.amount.amount,
      currencyCode: str(value.amount.currencyCode),
      appliesOnEachItem: bool(value.appliesOnEachItem, false),
    };
  }
  return null;
}

function targetOf(customerGets: any): { target: NativeTarget | null; cursors: Partial<ListCursors> } {
  const items = customerGets?.items;
  switch (items?.__typename) {
    case "AllDiscountItems":
      return { target: { kind: "order" }, cursors: {} };
    case "DiscountProducts": {
      const products = pageOf(items.products);
      const variants = pageOf(items.productVariants);
      return {
        target: { kind: "products", productIds: products.ids, variantIds: variants.ids },
        cursors: { products: products.next, variants: variants.next },
      };
    }
    case "DiscountCollections": {
      const collections = pageOf(items.collections);
      return { target: { kind: "collections", ids: collections.ids }, cursors: { collections: collections.next } };
    }
    default:
      return { target: null, cursors: {} };
  }
}

function minimumOf(requirement: any): NativeMinimum {
  if (requirement?.__typename === "DiscountMinimumSubtotal") {
    const money = requirement.greaterThanOrEqualToSubtotal;
    if (typeof money?.amount === "string") return { kind: "subtotal", amount: money.amount, currencyCode: str(money.currencyCode) };
  }
  if (requirement?.__typename === "DiscountMinimumQuantity") {
    const quantity = int(requirement.greaterThanOrEqualToQuantity);
    if (quantity !== null) return { kind: "quantity", quantity };
  }
  return null;
}

function combinesWithOf(v: any): NativeCombinesWith {
  return {
    productDiscounts: bool(v?.productDiscounts, false),
    orderDiscounts: bool(v?.orderDiscounts, false),
    shippingDiscounts: bool(v?.shippingDiscounts, false),
  };
}

function buyersOf(context: any): NativeDiscount["buyers"] {
  switch (context?.__typename) {
    case "DiscountBuyerSelectionAll":
      return "all";
    case "DiscountCustomers":
      return "customers";
    case "DiscountCustomerSegments":
      return "segments";
    default:
      return "unknown";
  }
}

/**
 * One `discountNodes` node → facts. Basic and Free shipping discounts become a
 * NativeDiscount (movable TYPE — whether it can really move is ./classify.ts);
 * every other type keeps only what the admin shows about it.
 */
export function normalizeNode(node: any, shop: ShopContext): NormalizedNode | null {
  const id = str(node?.id);
  const d = node?.discount;
  if (!id || !d || typeof d !== "object") return null;
  const kind = kindOf(d.__typename);
  const title = str(d.title, "");
  const status = statusOf(d.status);

  if (!isMovableKind(kind)) {
    const appType = d.appDiscountType;
    return {
      movableType: false,
      id,
      title,
      kind,
      status,
      codes: pageOf(d.codes, (n) => n?.code).ids,
      app: appType
        ? {
            appKey: typeof appType.appKey === "string" ? appType.appKey : null,
            functionId: typeof appType.functionId === "string" ? appType.functionId : null,
            title: typeof appType.app?.title === "string" ? appType.app.title : typeof appType.title === "string" ? appType.title : null,
          }
        : null,
    };
  }

  const isCode = kind === "code_basic" || kind === "code_free_shipping";
  const isShipping = kind === "code_free_shipping" || kind === "automatic_free_shipping";
  const codes = isCode ? pageOf(d.codes, (n) => n?.code) : { ids: [], next: null };
  const cursors: ListCursors = { products: null, variants: null, collections: null, codes: codes.next };

  let value: NativeValue | null;
  let target: NativeTarget | null;
  let appliesOnOneTimePurchase: boolean;
  let appliesOnSubscription: boolean;
  if (isShipping) {
    value = { kind: "freeShipping" };
    target = { kind: "shipping" };
    appliesOnOneTimePurchase = bool(d.appliesOnOneTimePurchase, true);
    appliesOnSubscription = bool(d.appliesOnSubscription, false);
  } else {
    value = valueOf(d.customerGets);
    const t = targetOf(d.customerGets);
    target = t.target;
    Object.assign(cursors, t.cursors);
    appliesOnOneTimePurchase = bool(d.customerGets?.appliesOnOneTimePurchase, true);
    appliesOnSubscription = bool(d.customerGets?.appliesOnSubscription, false);
  }

  const destination = d.destinationSelection;
  const shippingCountries =
    isShipping && destination?.__typename === "DiscountCountries"
      ? {
          countries: Array.isArray(destination.countries) ? destination.countries.filter((c: unknown) => typeof c === "string") : [],
          includeRestOfWorld: bool(destination.includeRestOfWorld, false),
        }
      : null;
  const maxShipping = d.maximumShippingPrice;

  const native: NativeDiscount = {
    id,
    kind,
    method: isCode ? "code" : "automatic",
    title,
    status,
    startsAt: str(d.startsAt),
    endsAt: typeof d.endsAt === "string" ? d.endsAt : null,
    value,
    target,
    minimum: minimumOf(d.minimumRequirement),
    codes: codes.ids,
    codesCount: isCode ? (int(d.codesCount?.count) ?? codes.ids.length) : 0,
    // Without a count, only a fully read list is exact.
    codesCountExact: !isCode || (d.codesCount ? d.codesCount.precision === "EXACT" : codes.next === null),
    recurringCycleLimit: int(d.codeBasicCycleLimit ?? d.autoBasicCycleLimit ?? d.codeShipCycleLimit ?? d.autoShipCycleLimit),
    usageCount: int(d.asyncUsageCount) ?? 0,
    usageLimit: int(d.usageLimit),
    oncePerCustomer: bool(d.appliesOncePerCustomer, false),
    combinesWith: combinesWithOf(d.combinesWith),
    appliesOnOneTimePurchase,
    appliesOnSubscription,
    buyers: buyersOf(d.context),
    shippingCountries,
    maximumShippingPrice:
      isShipping && typeof maxShipping?.amount === "string"
        ? { amount: maxShipping.amount, currencyCode: str(maxShipping.currencyCode) }
        : null,
    complete: Object.values(cursors).every((c) => c === null),
    shop,
  };
  return { movableType: true, native, cursors };
}
