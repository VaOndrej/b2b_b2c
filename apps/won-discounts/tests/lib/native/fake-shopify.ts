// In-memory Shopify discount store behind the AdminClient contract, for the
// native-discount tests. It dispatches on the operation name (`query|mutation
// WonNative…`), records every call, pages lists exactly like the Admin API
// (first/after + pageInfo), enforces Shopify's "one code, one discount" rule
// (case-insensitive) and can inject failures per operation:
//   { throttled: true }            GraphQL THROTTLED (nothing executed)
//   { graphqlError: "…" }          GraphQL error (nothing executed)
//   { throws: "…" }                transport failure, nothing executed
//   { throwsAfterApply: "…" }      transport failure AFTER the write landed
//   { graphqlErrorAfterApply: "…" } GraphQL error answer although the write landed
//   { userErrors: [{ message }] }  mutation answered with userErrors

import type { AdminGraphQLResult, GraphQLErrorLike } from "../../../app/lib/admin-client.server.ts";
import type { AdminClient } from "../../../app/lib/native/types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake speaks raw Admin API JSON */

export type Injection =
  | { throttled: true }
  | { graphqlError: string }
  | { throws: string }
  | { throwsAfterApply: string }
  | { graphqlErrorAfterApply: string }
  | { userErrors: { message: string; code?: string; field?: string[] }[] };

export interface RecordedCall {
  name: string;
  variables: Record<string, unknown> | undefined;
}

const MUTATION_FIELD: Record<string, string> = {
  WonNativeCodeDelete: "discountCodeDelete",
  WonNativeAutomaticDelete: "discountAutomaticDelete",
  WonNativeCodeBasicCreate: "discountCodeBasicCreate",
  WonNativeAutomaticBasicCreate: "discountAutomaticBasicCreate",
  WonNativeCodeFreeShippingCreate: "discountCodeFreeShippingCreate",
  WonNativeAutomaticFreeShippingCreate: "discountAutomaticFreeShippingCreate",
  WonNativeRedeemCodesAdd: "discountRedeemCodeBulkAdd",
};

const CODE_TYPES = new Set(["DiscountCodeBasic", "DiscountCodeFreeShipping", "DiscountCodeBxgy", "DiscountCodeApp"]);

/** Connection paths inside `discount` that are paged. */
const LIST_PATHS: { path: string[]; doc: string; variable: "items" | "codes" }[] = [
  { path: ["customerGets", "items", "products"], doc: "WonNativeProductsPage", variable: "items" },
  { path: ["customerGets", "items", "productVariants"], doc: "WonNativeVariantsPage", variable: "items" },
  { path: ["customerGets", "items", "collections"], doc: "WonNativeCollectionsPage", variable: "items" },
  { path: ["codes"], doc: "WonNativeCodesPage", variable: "codes" },
];

function at(root: any, path: string[]): any {
  return path.reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), root);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function slice(connection: any, from: number, count: number): any {
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  const end = Math.min(nodes.length, from + count);
  return { nodes: nodes.slice(from, end), pageInfo: { hasNextPage: end < nodes.length, endCursor: String(end) } };
}

export class FakeShopify implements AdminClient {
  shop = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };
  /** id → { id, discount } with FULL lists (no pageInfo). Insertion order = id order. */
  nodes = new Map<string, any>();
  calls: RecordedCall[] = [];
  private injections = new Map<string, Injection[]>();
  private nextId = 9000;
  private bulk = new Map<string, { codesCount: number; importedCount: number; failedCount: number; done: boolean }>();
  /** Redeem-code bulk creations never finish (Shopify still importing): codes do not appear yet. */
  bulkNeverDone = false;
  /** Clock for createdAt / status of created discounts. */
  now: () => Date = () => new Date("2026-09-28T12:00:00Z");

  inject(name: string, ...items: Injection[]): void {
    this.injections.set(name, [...(this.injections.get(name) ?? []), ...items]);
  }

  callsTo(name: string): RecordedCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  add(node: { id: string; discount: any }): string {
    this.nodes.set(node.id, clone(node));
    return node.id;
  }

  newId(kind: "code" | "automatic"): string {
    this.nextId += 1;
    return `gid://shopify/${kind === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${this.nextId}`;
  }

  /** Codes of a node (full list), for assertions. */
  codesOf(id: string): string[] {
    return (this.nodes.get(id)?.discount?.codes?.nodes ?? []).map((n: any) => n.code);
  }

  /** The node holding `code` (case-insensitive), if any. */
  holderOf(code: string): any | null {
    const wanted = code.toUpperCase();
    for (const node of this.nodes.values()) {
      if (!CODE_TYPES.has(node.discount.__typename)) continue;
      if ((node.discount.codes?.nodes ?? []).some((n: any) => String(n.code).toUpperCase() === wanted)) return node;
    }
    return null;
  }

  async graphql<TData = any>(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<TData>> {
    const name = /^(?:query|mutation)\s+(\w+)/.exec(query.trim())?.[1] ?? "anonymous";
    this.calls.push({ name, variables: variables ? clone(variables) : undefined });
    const injected = this.injections.get(name)?.shift();
    if (injected) {
      if ("throttled" in injected) return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
      if ("graphqlError" in injected) return { errors: [{ message: injected.graphqlError }] };
      if ("throws" in injected) throw new Error(injected.throws);
      if ("userErrors" in injected) {
        const field = MUTATION_FIELD[name] ?? "payload";
        const payload = { userErrors: injected.userErrors.map((e) => ({ field: e.field ?? null, code: e.code ?? null, message: e.message })) };
        return { data: { [field]: payload } as TData };
      }
      if ("throwsAfterApply" in injected) {
        this.handle(name, variables ?? {});
        throw new Error(injected.throwsAfterApply);
      }
      if ("graphqlErrorAfterApply" in injected) {
        this.handle(name, variables ?? {});
        return { errors: [{ message: injected.graphqlErrorAfterApply }] };
      }
    }
    return { data: this.handle(name, variables ?? {}) };
  }

  private render(node: any, sizes: { items: number; codes: number }): any {
    const out = clone(node);
    if (!out.discount) return out;
    for (const list of LIST_PATHS) {
      const parentPath = list.path.slice(0, -1);
      const key = list.path[list.path.length - 1];
      const parent = at(out.discount, parentPath);
      if (parent && parent[key]) parent[key] = slice(parent[key], 0, sizes[list.variable]);
    }
    if (CODE_TYPES.has(out.discount.__typename) && node.discount.codes) {
      // `fakeCodesCount` on a fixture overrides what Shopify reports (e.g. AT_LEAST).
      out.discount.codesCount = node.discount.fakeCodesCount ?? { count: node.discount.codes.nodes.length, precision: "EXACT" };
    }
    return out;
  }

  private status(startsAt: string, endsAt: string | null): string {
    const now = this.now().getTime();
    if (Date.parse(startsAt) > now) return "SCHEDULED";
    if (endsAt && Date.parse(endsAt) <= now) return "EXPIRED";
    return "ACTIVE";
  }

  private codeTaken(code: string): boolean {
    return this.holderOf(code) !== null;
  }

  private handle(name: string, v: Record<string, any>): any {
    switch (name) {
      case "WonNativeShop":
        return { shop: clone(this.shop) };
      case "WonNativeDiscounts": {
        const all = [...this.nodes.values()];
        const from = v.after ? Number(v.after) : 0;
        const page = all.slice(from, from + Number(v.first));
        const end = from + page.length;
        return {
          discountNodes: {
            nodes: page.map((n) => this.render(n, { items: Number(v.items), codes: Number(v.codes) })),
            pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
          },
        };
      }
      case "WonNativeDiscount": {
        const node = this.nodes.get(String(v.id));
        return { discountNode: node ? this.render(node, { items: Number(v.items), codes: Number(v.codes) }) : null };
      }
      case "WonNativeDiscountExists":
        return { discountNode: this.nodes.has(String(v.id)) ? { id: v.id } : null };
      case "WonNativeProductsPage":
      case "WonNativeVariantsPage":
      case "WonNativeCollectionsPage":
      case "WonNativeCodesPage": {
        const node = this.nodes.get(String(v.id));
        if (!node) return { discountNode: null };
        const list = LIST_PATHS.find((l) => l.doc === name)!;
        const out: any = { id: node.id, discount: { __typename: node.discount.__typename } };
        let target = out.discount;
        for (const key of list.path.slice(0, -1)) target = target[key] = {};
        target[list.path[list.path.length - 1]] = slice(at(node.discount, list.path), Number(v.after ?? 0), 250);
        return { discountNode: out };
      }
      case "WonNativeCodeDelete":
      case "WonNativeAutomaticDelete": {
        const field = MUTATION_FIELD[name];
        const idKey = name === "WonNativeCodeDelete" ? "deletedCodeDiscountId" : "deletedAutomaticDiscountId";
        if (!this.nodes.has(String(v.id))) {
          return { [field]: { [idKey]: null, userErrors: [{ field: ["id"], code: "INVALID", message: "Discount does not exist" }] } };
        }
        this.nodes.delete(String(v.id));
        return { [field]: { [idKey]: v.id, userErrors: [] } };
      }
      case "WonNativeCodeBasicCreate":
      case "WonNativeAutomaticBasicCreate":
      case "WonNativeCodeFreeShippingCreate":
      case "WonNativeAutomaticFreeShippingCreate":
        return this.create(name, v.input ?? {});
      case "WonNativeRedeemCodesAdd": {
        const node = this.nodes.get(String(v.id));
        const field = MUTATION_FIELD[name];
        if (!node) return { [field]: { bulkCreation: null, userErrors: [{ message: "Discount does not exist" }] } };
        const codes: { code: string }[] = Array.isArray(v.codes) ? v.codes : [];
        if (codes.length > 250) return { [field]: { bulkCreation: null, userErrors: [{ message: "Too many codes" }] } };
        let imported = 0;
        let failed = 0;
        if (!this.bulkNeverDone) {
          for (const { code } of codes) {
            if (this.codeTaken(code)) failed++;
            else {
              node.discount.codes.nodes.push({ code });
              imported++;
            }
          }
        }
        this.nextId += 1;
        const id = `gid://shopify/DiscountRedeemCodeBulkCreation/${this.nextId}`;
        this.bulk.set(id, { codesCount: codes.length, importedCount: imported, failedCount: failed, done: !this.bulkNeverDone });
        return { [field]: { bulkCreation: { id, done: false }, userErrors: [] } };
      }
      case "WonNativeRedeemCodesStatus": {
        const b = this.bulk.get(String(v.id));
        return { discountRedeemCodeBulkCreation: b ? { ...b } : null };
      }
      case "WonNativeCodeLookup": {
        const node = this.holderOf(String(v.code));
        return {
          codeDiscountNodeByCode: node
            ? { id: node.id, codeDiscount: { __typename: node.discount.__typename, title: node.discount.title, createdAt: node.discount.createdAt ?? null } }
            : null,
        };
      }
      case "WonNativeRecentAutomatic": {
        const automatic = [...this.nodes.values()]
          .filter((n) => n.id.includes("DiscountAutomaticNode"))
          .sort((a, b) => Date.parse(b.discount.createdAt ?? "1970-01-01") - Date.parse(a.discount.createdAt ?? "1970-01-01"))
          .slice(0, 10);
        return {
          discountNodes: {
            nodes: automatic.map((n) => ({
              id: n.id,
              discount: { __typename: n.discount.__typename, title: n.discount.title, createdAt: n.discount.createdAt },
            })),
          },
        };
      }
      default:
        throw new Error(`FakeShopify: unknown operation ${name}`);
    }
  }

  private create(name: string, input: any): any {
    const field = MUTATION_FIELD[name];
    const isCode = name.startsWith("WonNativeCode");
    const isBasic = name.includes("Basic");
    const nodeKey = isCode ? "codeDiscountNode" : "automaticDiscountNode";
    const errors: { field: string[]; message: string }[] = [];
    if (!input.title) errors.push({ field: ["title"], message: "Title can't be blank" });
    if (!input.startsAt) errors.push({ field: ["startsAt"], message: "Starts at can't be blank" });
    if (input.context?.all !== "ALL") errors.push({ field: ["context"], message: "Context must be set" });
    if (isCode && !input.code) errors.push({ field: ["code"], message: "Code can't be blank" });
    if (isCode && input.code && this.codeTaken(input.code)) errors.push({ field: ["code"], message: "Code must be unique. Please try a different code." });
    if (isBasic && (!input.customerGets?.value || !input.customerGets?.items)) errors.push({ field: ["customerGets"], message: "Customer gets is invalid" });
    if (!isBasic && !input.destination) errors.push({ field: ["destination"], message: "Destination can't be blank" });
    if (errors.length > 0) return { [field]: { [nodeKey]: null, userErrors: errors.map((e) => ({ ...e, code: "INVALID" })) } };

    const id = this.newId(isCode ? "code" : "automatic");
    const typename = `Discount${isCode ? "Code" : "Automatic"}${isBasic ? "Basic" : "FreeShipping"}`;
    const cycleAlias = `${isCode ? "code" : "auto"}${isBasic ? "Basic" : "Ship"}CycleLimit`;
    const discount: any = {
      __typename: typename,
      title: input.title,
      status: this.status(input.startsAt, input.endsAt ?? null),
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      asyncUsageCount: 0,
      createdAt: this.now().toISOString(),
      minimumRequirement: input.minimumRequirement?.subtotal
        ? {
            __typename: "DiscountMinimumSubtotal",
            greaterThanOrEqualToSubtotal: { amount: input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, currencyCode: this.shop.currencyCode },
          }
        : input.minimumRequirement?.quantity
          ? { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: input.minimumRequirement.quantity.greaterThanOrEqualToQuantity }
          : null,
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false, ...input.combinesWith },
      context: { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
      // The documents read recurringCycleLimit under a per-type alias.
      [cycleAlias]: input.recurringCycleLimit ?? 0,
    };
    if (isCode) {
      discount.codes = { nodes: [{ code: input.code }] };
      discount.usageLimit = input.usageLimit ?? null;
      discount.appliesOncePerCustomer = input.appliesOncePerCustomer ?? false;
    }
    if (isBasic) {
      const value = input.customerGets.value;
      const items = input.customerGets.items;
      discount.customerGets = {
        value:
          value.percentage !== undefined
            ? { __typename: "DiscountPercentage", percentage: value.percentage }
            : {
                __typename: "DiscountAmount",
                amount: { amount: value.discountAmount.amount, currencyCode: this.shop.currencyCode },
                appliesOnEachItem: value.discountAmount.appliesOnEachItem ?? false,
              },
        items: items.all
          ? { __typename: "AllDiscountItems", allItems: true }
          : items.products
            ? {
                __typename: "DiscountProducts",
                products: { nodes: (items.products.productsToAdd ?? []).map((id: string) => ({ id })) },
                productVariants: { nodes: (items.products.productVariantsToAdd ?? []).map((id: string) => ({ id })) },
              }
            : { __typename: "DiscountCollections", collections: { nodes: (items.collections?.add ?? []).map((id: string) => ({ id })) } },
        appliesOnOneTimePurchase: input.customerGets.appliesOnOneTimePurchase ?? true,
        appliesOnSubscription: input.customerGets.appliesOnSubscription ?? false,
      };
      discount.discountClasses = items.all ? ["ORDER"] : ["PRODUCT"];
    } else {
      discount.destinationSelection = input.destination.all
        ? { __typename: "DiscountCountryAll", allCountries: true }
        : { __typename: "DiscountCountries", countries: input.destination.countries.add, includeRestOfWorld: input.destination.countries.includeRestOfWorld };
      discount.maximumShippingPrice = input.maximumShippingPrice ? { amount: input.maximumShippingPrice, currencyCode: this.shop.currencyCode } : null;
      discount.appliesOnOneTimePurchase = input.appliesOnOneTimePurchase ?? true;
      discount.appliesOnSubscription = input.appliesOnSubscription ?? false;
    }
    this.nodes.set(id, { id, discount });
    return { [field]: { [nodeKey]: { id }, userErrors: [] } };
  }
}

/** A scripted AdminClient (tests of the request layer): any raw response shape. */
export function scriptedClient(respond: (query: string, variables?: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown }>): AdminClient {
  return {
    async graphql<TData = any>(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<TData>> {
      const response = await respond(query, variables);
      return { data: response.data as TData, errors: response.errors as GraphQLErrorLike[] | undefined };
    },
  };
}

// --- Fixture builders (raw Admin API shape) -------------------------------------------

let fixtureId = 100;
const nextFixtureId = () => ++fixtureId;

export interface BasicFixture {
  id?: string;
  method?: "code" | "automatic";
  title?: string;
  status?: "ACTIVE" | "SCHEDULED" | "EXPIRED";
  startsAt?: string;
  endsAt?: string | null;
  codes?: string[];
  percentage?: number;
  amount?: string;
  appliesOnEachItem?: boolean;
  items?: { all: true } | { products: string[]; variants?: string[] } | { collections: string[] };
  minimum?: { subtotal: string } | { quantity: number } | null;
  usageLimit?: number | null;
  used?: number;
  oncePerCustomer?: boolean;
  combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
  context?: any;
  appliesOnOneTimePurchase?: boolean;
  appliesOnSubscription?: boolean;
}

function minimumRaw(minimum: BasicFixture["minimum"], currency: string): any {
  if (!minimum) return null;
  if ("subtotal" in minimum) {
    return { __typename: "DiscountMinimumSubtotal", greaterThanOrEqualToSubtotal: { amount: minimum.subtotal, currencyCode: currency } };
  }
  return { __typename: "DiscountMinimumQuantity", greaterThanOrEqualToQuantity: String(minimum.quantity) };
}

export function basicNode(f: BasicFixture = {}, currency = "CZK"): { id: string; discount: any } {
  const method = f.method ?? "code";
  const id = f.id ?? `gid://shopify/${method === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${nextFixtureId()}`;
  const items = f.items ?? { all: true };
  const discount: any = {
    __typename: method === "code" ? "DiscountCodeBasic" : "DiscountAutomaticBasic",
    title: f.title ?? "Sleva",
    status: f.status ?? "ACTIVE",
    startsAt: f.startsAt ?? "2026-09-01T10:00:00Z",
    endsAt: f.endsAt ?? null,
    asyncUsageCount: f.used ?? 0,
    createdAt: "2026-09-01T10:00:00Z",
    discountClasses: "all" in items ? ["ORDER"] : ["PRODUCT"],
    customerGets: {
      value:
        f.amount !== undefined
          ? { __typename: "DiscountAmount", amount: { amount: f.amount, currencyCode: currency }, appliesOnEachItem: f.appliesOnEachItem ?? true }
          : { __typename: "DiscountPercentage", percentage: f.percentage ?? 0.1 },
      items:
        "all" in items
          ? { __typename: "AllDiscountItems", allItems: true }
          : "products" in items
            ? {
                __typename: "DiscountProducts",
                products: { nodes: items.products.map((pid) => ({ id: pid })) },
                productVariants: { nodes: (items.variants ?? []).map((vid) => ({ id: vid })) },
              }
            : { __typename: "DiscountCollections", collections: { nodes: items.collections.map((cid) => ({ id: cid })) } },
      appliesOnOneTimePurchase: f.appliesOnOneTimePurchase ?? true,
      appliesOnSubscription: f.appliesOnSubscription ?? false,
    },
    minimumRequirement: minimumRaw(f.minimum, currency),
    combinesWith: f.combinesWith ?? { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    context: f.context ?? { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
  };
  if (method === "code") {
    discount.codes = { nodes: (f.codes ?? ["SLEVA10"]).map((code) => ({ code })) };
    discount.usageLimit = f.usageLimit ?? null;
    discount.appliesOncePerCustomer = f.oncePerCustomer ?? false;
  }
  return { id, discount };
}

export function freeShippingNode(
  f: Omit<BasicFixture, "items" | "percentage" | "amount"> & {
    countries?: string[];
    maxShipping?: string;
  } = {},
  currency = "CZK",
): { id: string; discount: any } {
  const method = f.method ?? "code";
  const id = f.id ?? `gid://shopify/${method === "code" ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${nextFixtureId()}`;
  const discount: any = {
    __typename: method === "code" ? "DiscountCodeFreeShipping" : "DiscountAutomaticFreeShipping",
    title: f.title ?? "Doprava zdarma",
    status: f.status ?? "ACTIVE",
    startsAt: f.startsAt ?? "2026-09-01T10:00:00Z",
    endsAt: f.endsAt ?? null,
    asyncUsageCount: f.used ?? 0,
    createdAt: "2026-09-01T10:00:00Z",
    destinationSelection: f.countries
      ? { __typename: "DiscountCountries", countries: f.countries, includeRestOfWorld: false }
      : { __typename: "DiscountCountryAll", allCountries: true },
    maximumShippingPrice: f.maxShipping ? { amount: f.maxShipping, currencyCode: currency } : null,
    minimumRequirement: minimumRaw(f.minimum, currency),
    combinesWith: f.combinesWith ?? { orderDiscounts: true, productDiscounts: true, shippingDiscounts: false },
    context: f.context ?? { __typename: "DiscountBuyerSelectionAll", all: "ALL" },
    appliesOnOneTimePurchase: f.appliesOnOneTimePurchase ?? true,
    appliesOnSubscription: f.appliesOnSubscription ?? false,
  };
  if (method === "code") {
    discount.codes = { nodes: (f.codes ?? ["DOPRAVA"]).map((code) => ({ code })) };
    discount.usageLimit = f.usageLimit ?? null;
    discount.appliesOncePerCustomer = f.oncePerCustomer ?? false;
  }
  return { id, discount };
}

export function otherNode(
  typename: "DiscountCodeBxgy" | "DiscountAutomaticBxgy" | "DiscountCodeApp" | "DiscountAutomaticApp",
  f: { id?: string; title?: string; status?: string; appKey?: string; appTitle?: string; codes?: string[] } = {},
): { id: string; discount: any } {
  const code = typename.startsWith("DiscountCode");
  const id = f.id ?? `gid://shopify/${code ? "DiscountCodeNode" : "DiscountAutomaticNode"}/${nextFixtureId()}`;
  const discount: any = { __typename: typename, title: f.title ?? typename, status: f.status ?? "ACTIVE" };
  if (typename.endsWith("App")) {
    discount.appDiscountType = { appKey: f.appKey ?? "other-app", functionId: "fn-other", title: "Function", app: { title: f.appTitle ?? "Jiná appka" } };
  }
  if (code) discount.codes = { nodes: (f.codes ?? []).map((c) => ({ code: c })) };
  return { id, discount };
}
