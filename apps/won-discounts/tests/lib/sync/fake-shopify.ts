// In-memory Shopify for the sync tests: an AdminClient that understands every
// document in app/lib/sync/graphql.ts (dispatch on the operation name), keeps
// discount nodes / redeem codes / metafields / products / collections, records
// every call, and can inject failures per operation:
//   throttled            → GraphQL THROTTLED error (nothing applied)
//   transport            → AdminTransportError(status) BEFORE applying
//   transportAfterApply  → applies, then AdminTransportError (lost response)
//   userErrors           → mutation answers with userErrors (nothing applied)
//   graphqlError         → non-retryable GraphQL error

import {
  AdminTransportError,
  type AdminClient,
  type AdminGraphQLResult,
} from "../../../app/lib/admin-client.server.ts";
import { operationKind } from "../../../app/lib/admin-client-cli.server.ts";
import { operationName } from "../../../app/lib/sync/graphql.ts";

export const WON_FUNCTION_ID = "fn-won-discounts-engine";
export const WON_FUNCTION_HANDLE = "won-discounts-engine";

export interface FakeMetafield {
  id: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface FakeNode {
  id: string;
  kind: "automatic" | "code";
  /** Null for native (non-app) discounts. */
  functionId: string | null;
  title: string;
  startsAt: string;
  endsAt: string | null;
  discountClasses: string[];
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
  usageLimit: number | null;
  appliesOncePerCustomer: boolean;
  codes: { id: string; code: string }[];
  metafields: Map<string, FakeMetafield>;
}

export interface FakeProduct {
  id: string;
  variantIds: string[];
  metafields: Map<string, FakeMetafield>;
  title?: string;
}

/** A variant with its inventory item (cost mirror, MVP 2). */
export interface FakeVariant {
  id: string;
  productId: string;
  title: string;
  price: string;
  inventoryItemId: string;
  unitCost: { amount: string; currencyCode: string } | null;
  metafields: Map<string, FakeMetafield>;
}

export type Failure =
  | { throttled: true }
  | { transport: number | null }
  | { transportAfterApply: number | null }
  | { userErrors: { field?: string[]; message: string; code?: string }[] }
  | { graphqlError: string };

export interface RecordedCall {
  op: string;
  kind: "query" | "mutation" | "subscription";
  variables: Record<string, unknown> | undefined;
}

const mfKey = (namespace: string, key: string) => `${namespace}/${key}`;

export class FakeShopify implements AdminClient {
  shopId = "gid://shopify/Shop/1";
  ianaTimezone = "Europe/Prague";
  currencyCode = "CZK";
  /** Variants by GID (created with their product; cost mirror). */
  variants = new Map<string, FakeVariant>();
  shopMetafields = new Map<string, FakeMetafield>();
  nodes = new Map<string, FakeNode>();
  products = new Map<string, FakeProduct>();
  collections = new Map<string, string[]>();
  functions = [{ id: WON_FUNCTION_ID, handle: WON_FUNCTION_HANDLE, apiType: "discounts" }];
  /** Shopify Markets (read with read_markets). */
  markets: { id?: string; handle: string; name: string; status: "ACTIVE" | "DRAFT"; currency: string; countries: string[] }[] = [];
  /** Page size for every paged connection (the documents ask for 250/100; smaller exercises paging). */
  pageSize = 250;
  /** Codes that fail inside an async bulk add (per-code errors). */
  bulkAddFailCodes = new Set<string>();
  /** How many status polls a bulk creation / job reports `done: false`. */
  asyncPollsBeforeDone = 0;
  /** Shopify's count limit for `productsCount` (precision AT_LEAST above it). */
  countLimit = 10_000;
  /** Collection sizes Shopify reports instead of the member count (a large collection without seeding thousands of products). */
  collectionCounts = new Map<string, number>();
  /** Collection titles (`productsCount` query); default "Collection <n>". */
  collectionTitles = new Map<string, string>();
  /** metafieldsSet refuses more than this many inputs (Shopify: 25). */
  metafieldsSetLimit = 25;
  /** Owners whose metafield writes Shopify refuses (userErrors; metafieldsSet is all-or-nothing). */
  refusedOwners = new Set<string>();
  /** The store's clock (node status, deactivate). */
  clock: () => Date = () => new Date("2026-09-28T12:00:00Z");
  calls: RecordedCall[] = [];
  /** `nodes(ids:)` responses come back reversed (round 5): exercises matching by id, not by position. */
  reorderNodes = false;

  private seq = 1000;
  private failures = new Map<string, Failure[]>();
  private bulkCreations = new Map<string, { codes: { code: string; error: string | null }[]; polls: number }>();
  private jobs = new Map<string, { polls: number }>();

  private nextId(kind: string): string {
    this.seq += 1;
    return `gid://shopify/${kind}/${this.seq}`;
  }

  /** Queue `failure` for the next `times` calls of operation `op` (e.g. "WonSyncCodeCreate"). */
  fail(op: string, failure: Failure, times = 1): void {
    const queue = this.failures.get(op) ?? [];
    for (let i = 0; i < times; i += 1) queue.push(failure);
    this.failures.set(op, queue);
  }

  mutations(): RecordedCall[] {
    return this.calls.filter((call) => call.kind === "mutation");
  }

  callsOf(op: string): RecordedCall[] {
    return this.calls.filter((call) => call.op === op);
  }

  // --- seeding helpers -----------------------------------------------------

  addProduct(numericId: number, variants = 1): FakeProduct {
    const id = `gid://shopify/Product/${numericId}`;
    const product: FakeProduct = {
      id,
      variantIds: Array.from({ length: variants }, (_, i) => `gid://shopify/ProductVariant/${numericId * 100 + i + 1}`),
      metafields: new Map(),
      title: `Product ${numericId}`,
    };
    this.products.set(id, product);
    product.variantIds.forEach((variantId, i) => this.addVariant(product, variantId, i));
    return product;
  }

  /** A variant of `product` (price 10.00, no cost), its inventory item numbered after it. */
  addVariant(product: FakeProduct, variantId: string, index = product.variantIds.length): FakeVariant {
    if (!product.variantIds.includes(variantId)) product.variantIds.push(variantId);
    const numeric = variantId.split("/").pop();
    const variant: FakeVariant = {
      id: variantId,
      productId: product.id,
      title: index === 0 && product.variantIds.length === 1 ? "Default Title" : `V${index + 1}`,
      price: "10.00",
      inventoryItemId: `gid://shopify/InventoryItem/${numeric}`,
      unitCost: null,
      metafields: new Map(),
    };
    this.variants.set(variantId, variant);
    return variant;
  }

  /** Set (or clear, null) a variant's inventory item cost in the shop currency. */
  setCost(variantId: string, amount: string | null, currencyCode = this.currencyCode): void {
    const variant = this.variants.get(variantId);
    if (!variant) throw new Error(`no variant ${variantId}`);
    variant.unitCost = amount === null ? null : { amount, currencyCode };
  }

  /** Delete a variant (its inventory item and metafields go with it). */
  deleteVariant(variantId: string): void {
    const variant = this.variants.get(variantId);
    if (!variant) return;
    this.variants.delete(variantId);
    const product = this.products.get(variant.productId);
    if (product) product.variantIds = product.variantIds.filter((id) => id !== variantId);
  }

  /** The parsed `$app:won_discounts/variant` value of a variant (undefined = none). */
  variantCostMetafield(variantId: string): unknown {
    const value = this.variants.get(variantId)?.metafields.get(mfKey("$app:won_discounts", "variant"))?.value;
    return value === undefined ? undefined : JSON.parse(value);
  }

  private variantView(variant: FakeVariant, opts: { product?: boolean; inventoryItem?: boolean } = {}) {
    const product = this.products.get(variant.productId);
    const mf = variant.metafields.get(mfKey("$app:won_discounts", "variant"));
    return {
      __typename: "ProductVariant",
      id: variant.id,
      title: variant.title,
      price: variant.price,
      ...(opts.product === false ? {} : { product: { id: variant.productId, title: product?.title ?? null } }),
      ...(opts.inventoryItem === false ? {} : { inventoryItem: { id: variant.inventoryItemId, unitCost: variant.unitCost ? { ...variant.unitCost } : null } }),
      cost: mf ? { value: mf.value } : null,
    };
  }

  /** Every variant in product order (the productVariants connection). */
  allVariants(): FakeVariant[] {
    const out: FakeVariant[] = [];
    for (const product of this.products.values()) {
      for (const id of product.variantIds) {
        const variant = this.variants.get(id);
        if (variant) out.push(variant);
      }
    }
    return out;
  }

  addCollection(numericId: number, productIds: string[]): string {
    const id = `gid://shopify/Collection/${numericId}`;
    this.collections.set(id, [...productIds]);
    return id;
  }

  addForeignNode(input: Partial<FakeNode> & { kind: "automatic" | "code"; title: string }): FakeNode {
    const node: FakeNode = {
      id: this.nextId(input.kind === "automatic" ? "DiscountAutomaticNode" : "DiscountCodeNode"),
      functionId: null,
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: null,
      discountClasses: ["PRODUCT"],
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      usageLimit: null,
      appliesOncePerCustomer: false,
      codes: [],
      metafields: new Map(),
      ...input,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  productMetafield(productId: string): unknown {
    const value = this.products.get(productId)?.metafields.get(mfKey("$app:won_discounts", "product"))?.value;
    return value === undefined ? undefined : JSON.parse(value);
  }

  shopMetafieldValue(key: string): string | undefined {
    return this.shopMetafields.get(mfKey("$app:won_discounts", key))?.value;
  }

  wonNodes(): FakeNode[] {
    return [...this.nodes.values()].filter((node) => node.functionId === WON_FUNCTION_ID);
  }

  // --- AdminClient -----------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async graphql(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<any>> {
    const op = operationName(query);
    this.calls.push({ op, kind: operationKind(query), variables: variables === undefined ? undefined : structuredClone(variables) });
    const failure = this.failures.get(op)?.shift();
    if (failure) {
      if ("throttled" in failure) return { data: null, errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
      if ("transport" in failure) throw new AdminTransportError(`HTTP ${failure.transport}`, { status: failure.transport });
      if ("graphqlError" in failure) return { data: null, errors: [{ message: failure.graphqlError }] };
      if ("userErrors" in failure) return { data: this.userErrorResponse(op, failure.userErrors) };
    }
    const data = this.execute(op, variables ?? {});
    if (failure && "transportAfterApply" in failure) {
      throw new AdminTransportError(`HTTP ${failure.transportAfterApply} (applied)`, { status: failure.transportAfterApply });
    }
    return { data };
  }

  private userErrorResponse(op: string, userErrors: unknown[]): Record<string, unknown> {
    const root: Record<string, string> = {
      WonSyncAutomaticCreate: "discountAutomaticAppCreate",
      WonSyncAutomaticUpdate: "discountAutomaticAppUpdate",
      WonSyncAutomaticDelete: "discountAutomaticDelete",
      WonSyncCodeCreate: "discountCodeAppCreate",
      WonSyncCodeUpdate: "discountCodeAppUpdate",
      WonSyncCodeDelete: "discountCodeDelete",
      WonSyncRedeemBulkAdd: "discountRedeemCodeBulkAdd",
      WonSyncRedeemBulkDelete: "discountCodeRedeemCodeBulkDelete",
      WonSyncMetafieldsSet: "metafieldsSet",
      WonSyncMetafieldsDelete: "metafieldsDelete",
    };
    const field = root[op];
    if (!field) throw new Error(`userErrors injected for a non-mutation ${op}`);
    return { [field]: { userErrors } };
  }

  private page<T>(items: T[], after: unknown): { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
    const start = typeof after === "string" ? Number(after) : 0;
    const nodes = items.slice(start, start + this.pageSize);
    const end = start + nodes.length;
    return { nodes, pageInfo: { hasNextPage: end < items.length, endCursor: nodes.length ? String(end) : null } };
  }

  private codeOwner(code: string): FakeNode | undefined {
    const upper = code.toUpperCase();
    return [...this.nodes.values()].find((node) => node.codes.some((c) => c.code.toUpperCase() === upper));
  }

  private metafieldsOf(ownerId: string): Map<string, FakeMetafield> | null {
    if (ownerId === this.shopId) return this.shopMetafields;
    const node = this.nodes.get(ownerId);
    if (node) return node.metafields;
    const product = this.products.get(ownerId);
    if (product) return product.metafields;
    const variant = this.variants.get(ownerId);
    if (variant) return variant.metafields;
    return null;
  }

  private applyDiscountInput(node: FakeNode, input: Record<string, unknown>): void {
    if (typeof input.title === "string") node.title = input.title;
    if (typeof input.startsAt === "string") node.startsAt = new Date(input.startsAt).toISOString();
    if ("endsAt" in input) node.endsAt = input.endsAt === null ? null : new Date(String(input.endsAt)).toISOString();
    if (Array.isArray(input.discountClasses)) node.discountClasses = [...(input.discountClasses as string[])];
    if (input.combinesWith) node.combinesWith = { ...(input.combinesWith as FakeNode["combinesWith"]) };
    if ("usageLimit" in input) node.usageLimit = (input.usageLimit as number | null) ?? null;
    if (typeof input.appliesOncePerCustomer === "boolean") node.appliesOncePerCustomer = input.appliesOncePerCustomer;
    for (const mf of (input.metafields as FakeMetafield[] | undefined) ?? []) {
      node.metafields.set(mfKey(mf.namespace, mf.key), { ...mf, id: this.nextId("Metafield") });
    }
  }

  private newNode(kind: "automatic" | "code", input: Record<string, unknown>): FakeNode {
    const node: FakeNode = {
      id: this.nextId(kind === "automatic" ? "DiscountAutomaticNode" : "DiscountCodeNode"),
      kind,
      functionId: WON_FUNCTION_ID,
      title: "",
      startsAt: new Date().toISOString(),
      endsAt: null,
      discountClasses: [],
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
      usageLimit: null,
      appliesOncePerCustomer: false,
      codes: [],
      metafields: new Map(),
    };
    this.applyDiscountInput(node, input);
    return node;
  }

  /** Shopify derives the status from the dates (deactivate = endsAt := now). */
  statusOf(node: FakeNode): "ACTIVE" | "EXPIRED" | "SCHEDULED" {
    const now = this.clock().getTime();
    if (node.endsAt !== null && Date.parse(node.endsAt) <= now) return "EXPIRED";
    if (Date.parse(node.startsAt) > now) return "SCHEDULED";
    return "ACTIVE";
  }

  private nodeView(node: FakeNode) {
    const vars = node.metafields.get(mfKey("$app:won_discounts", "function_vars"));
    const common = {
      title: node.title,
      status: this.statusOf(node),
      startsAt: node.startsAt,
      endsAt: node.endsAt,
      discountClasses: node.discountClasses,
      combinesWith: node.combinesWith,
    };
    if (node.kind === "automatic") {
      return {
        __typename: "DiscountAutomaticNode",
        id: node.id,
        vars: vars ? { value: vars.value } : null,
        automaticDiscount: node.functionId ? { __typename: "DiscountAutomaticApp", ...common } : { __typename: "DiscountAutomaticBasic" },
      };
    }
    return {
      __typename: "DiscountCodeNode",
      id: node.id,
      vars: vars ? { value: vars.value } : null,
      codeDiscount: node.functionId
        ? {
            __typename: "DiscountCodeApp",
            ...common,
            usageLimit: node.usageLimit,
            appliesOncePerCustomer: node.appliesOncePerCustomer,
            codesCount: { count: node.codes.length },
          }
        : { __typename: "DiscountCodeBasic" },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity
  private execute(op: string, v: Record<string, any>): Record<string, unknown> {
    switch (op) {
      case "WonSyncShop":
        return {
          shop: {
            id: this.shopId,
            ianaTimezone: this.ianaTimezone,
            currencyCode: this.currencyCode,
            functionConfig: this.shopMetafields.get(mfKey("$app:won_discounts", "function_config")) ?? null,
          },
        };
      case "WonSyncShopConfigReadBack":
        return { shop: { id: this.shopId, metafield: this.shopMetafields.get(mfKey("$app:won_discounts", "function_config")) ?? null } };
      case "WonSyncFunctions":
        return { shopifyFunctions: { nodes: this.functions } };
      case "WonSyncNodes":
        return { nodes: (v.ids as string[]).map((id) => (this.nodes.has(id) ? this.nodeView(this.nodes.get(id)!) : null)) };
      case "WonSyncAutomaticCreate": {
        const input = v.automaticAppDiscount;
        if (input.functionHandle !== WON_FUNCTION_HANDLE) {
          return { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ message: "Function not found" }] } };
        }
        const node = this.newNode("automatic", input);
        this.nodes.set(node.id, node);
        return { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: node.id }, userErrors: [] } };
      }
      case "WonSyncCodeCreate": {
        const input = v.codeAppDiscount;
        const owner = this.codeOwner(input.code);
        if (owner) {
          return {
            discountCodeAppCreate: {
              codeAppDiscount: null,
              userErrors: [{ field: ["codeAppDiscount", "code"], message: "Code must be unique. Please try a different code.", code: "TAKEN" }],
            },
          };
        }
        const node = this.newNode("code", input);
        node.codes.push({ id: this.nextId("DiscountRedeemCode"), code: input.code });
        this.nodes.set(node.id, node);
        return { discountCodeAppCreate: { codeAppDiscount: { discountId: node.id }, userErrors: [] } };
      }
      case "WonSyncAutomaticUpdate":
      case "WonSyncCodeUpdate": {
        const node = this.nodes.get(v.id);
        const field = op === "WonSyncAutomaticUpdate" ? "discountAutomaticAppUpdate" : "discountCodeAppUpdate";
        const payload = op === "WonSyncAutomaticUpdate" ? "automaticAppDiscount" : "codeAppDiscount";
        if (!node) return { [field]: { [payload]: null, userErrors: [{ message: "Discount does not exist" }] } };
        this.applyDiscountInput(node, v[payload]);
        return { [field]: { [payload]: { discountId: node.id }, userErrors: [] } };
      }
      case "WonSyncAutomaticDelete":
      case "WonSyncCodeDelete": {
        const field = op === "WonSyncAutomaticDelete" ? "discountAutomaticDelete" : "discountCodeDelete";
        const idField = op === "WonSyncAutomaticDelete" ? "deletedAutomaticDiscountId" : "deletedCodeDiscountId";
        if (!this.nodes.has(v.id)) return { [field]: { [idField]: null, userErrors: [{ message: "Discount does not exist", code: "INVALID" }] } };
        this.nodes.delete(v.id);
        return { [field]: { [idField]: v.id, userErrors: [] } };
      }
      case "WonSyncCodeDeactivate":
      case "WonSyncCodeActivate": {
        const field = op === "WonSyncCodeActivate" ? "discountCodeActivate" : "discountCodeDeactivate";
        const node = this.nodes.get(v.id);
        if (!node) return { [field]: { codeDiscountNode: null, userErrors: [{ message: "Discount does not exist" }] } };
        // Live (verify-code-facts): deactivate sets endsAt = now; activate clears endsAt.
        node.endsAt = op === "WonSyncCodeActivate" ? null : this.clock().toISOString();
        return { [field]: { codeDiscountNode: { id: node.id }, userErrors: [] } };
      }
      case "WonSyncRedeemBulkAdd": {
        const node = this.nodes.get(v.discountId);
        if (!node) return { discountRedeemCodeBulkAdd: { bulkCreation: null, userErrors: [{ message: "Discount does not exist" }] } };
        if ((v.codes as unknown[]).length > 250) {
          return { discountRedeemCodeBulkAdd: { bulkCreation: null, userErrors: [{ message: "Too many codes (max 250)" }] } };
        }
        const results: { code: string; error: string | null }[] = [];
        for (const { code } of v.codes as { code: string }[]) {
          if (this.bulkAddFailCodes.has(code)) results.push({ code, error: "Code is invalid" });
          else if (this.codeOwner(code)) results.push({ code, error: "Code must be unique" });
          else {
            node.codes.push({ id: this.nextId("DiscountRedeemCode"), code });
            results.push({ code, error: null });
          }
        }
        const id = this.nextId("DiscountRedeemCodeBulkCreation");
        this.bulkCreations.set(id, { codes: results, polls: 0 });
        return { discountRedeemCodeBulkAdd: { bulkCreation: { id, done: false, codesCount: results.length, importedCount: 0, failedCount: 0 }, userErrors: [] } };
      }
      case "WonSyncRedeemBulkStatus": {
        const creation = this.bulkCreations.get(v.id);
        if (!creation) return { discountRedeemCodeBulkCreation: null };
        creation.polls += 1;
        const done = creation.polls > this.asyncPollsBeforeDone;
        const failed = creation.codes.filter((c) => c.error);
        return {
          discountRedeemCodeBulkCreation: {
            id: v.id,
            done,
            codesCount: creation.codes.length,
            importedCount: done ? creation.codes.length - failed.length : 0,
            failedCount: done ? failed.length : 0,
            codes: { nodes: creation.codes.map((c) => ({ code: c.code, errors: c.error ? [{ message: c.error }] : [] })) },
          },
        };
      }
      case "WonSyncRedeemBulkDelete": {
        const node = this.nodes.get(v.discountId);
        if (!node) return { discountCodeRedeemCodeBulkDelete: { job: null, userErrors: [{ message: "Discount does not exist" }] } };
        const ids = new Set(v.ids as string[]);
        node.codes = node.codes.filter((c) => !ids.has(c.id));
        const id = this.nextId("Job");
        this.jobs.set(id, { polls: 0 });
        return { discountCodeRedeemCodeBulkDelete: { job: { id, done: false }, userErrors: [] } };
      }
      case "WonSyncJob": {
        const job = this.jobs.get(v.id);
        if (!job) return { job: null };
        job.polls += 1;
        return { job: { id: v.id, done: job.polls > this.asyncPollsBeforeDone } };
      }
      case "WonSyncNodeCodes": {
        const node = this.nodes.get(v.id);
        if (!node) return { discountNode: null };
        return { discountNode: { id: node.id, discount: { __typename: "DiscountCodeApp", codes: this.page(node.codes, v.after) } } };
      }
      case "WonSyncCodeLookup": {
        const node = this.codeOwner(v.code);
        if (!node || node.kind !== "code") return { codeDiscountNodeByCode: null };
        return {
          codeDiscountNodeByCode: {
            id: node.id,
            codeDiscount: node.functionId
              ? { __typename: "DiscountCodeApp", title: node.title, appDiscountType: { functionId: node.functionId } }
              : { __typename: "DiscountCodeBasic", title: node.title },
          },
        };
      }
      case "WonSyncAutomaticLookup": {
        const all = [...this.nodes.values()].map((node) => ({
          id: node.id,
          discount:
            node.kind === "automatic" && node.functionId
              ? { __typename: "DiscountAutomaticApp", title: node.title, appDiscountType: { functionId: node.functionId } }
              : { __typename: node.kind === "automatic" ? "DiscountAutomaticBasic" : node.functionId ? "DiscountCodeApp" : "DiscountCodeBasic" },
        }));
        return { discountNodes: this.page(all, v.after) };
      }
      case "WonSyncMetafieldsSet": {
        const inputs = v.metafields as FakeMetafield[] & { ownerId: string }[];
        if (inputs.length > this.metafieldsSetLimit) {
          return { metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields"], message: `Exceeded the maximum metafields input limit of ${this.metafieldsSetLimit}.`, code: "LESS_THAN_OR_EQUAL_TO" }] } };
        }
        const userErrors = [];
        for (const [index, input] of inputs.entries()) {
          const ownerId = (input as unknown as { ownerId: string }).ownerId;
          if (!this.metafieldsOf(ownerId)) {
            userErrors.push({ field: ["metafields", String(index), "ownerId"], message: "Owner does not exist", code: "INVALID" });
          } else if (this.refusedOwners.has(ownerId)) {
            userErrors.push({ field: ["metafields", String(index), "value"], message: "Value is invalid", code: "INVALID_VALUE" });
          }
        }
        if (userErrors.length) return { metafieldsSet: { metafields: [], userErrors } };
        const out = [];
        for (const input of inputs) {
          const ownerId = (input as unknown as { ownerId: string }).ownerId;
          const map = this.metafieldsOf(ownerId)!;
          const existing = map.get(mfKey(input.namespace, input.key));
          const metafield = { id: existing?.id ?? this.nextId("Metafield"), namespace: input.namespace, key: input.key, type: input.type, value: input.value };
          map.set(mfKey(input.namespace, input.key), metafield);
          out.push({ id: metafield.id, key: input.key, ownerType: "X" });
        }
        return { metafieldsSet: { metafields: out, userErrors: [] } };
      }
      case "WonSyncMetafieldsDelete": {
        const deleted = (v.metafields as { ownerId: string; namespace: string; key: string }[]).map((input) => {
          const map = this.metafieldsOf(input.ownerId);
          if (!map || !map.delete(mfKey(input.namespace, input.key))) return null;
          return { ownerId: input.ownerId, namespace: input.namespace, key: input.key };
        });
        return { metafieldsDelete: { deletedMetafields: deleted, userErrors: [] } };
      }
      case "WonSyncCollectionProducts": {
        const products = this.collections.get(v.id);
        if (!products) return { collection: null };
        return { collection: { id: v.id, products: this.page(products.map((id) => ({ id })), v.after) } };
      }
      case "WonSyncCollectionSizes":
        return {
          nodes: (v.ids as string[]).map((id) => {
            const members = this.collections.get(id);
            if (!members) return null;
            // Shopify stops counting at its limit (10 000) and says so.
            const size = this.collectionCounts.get(id) ?? members.length;
            const limited = size > this.countLimit;
            return {
              __typename: "Collection",
              id,
              title: this.collectionTitles.get(id) ?? `Collection ${id.split("/").pop()}`,
              productsCount: { count: limited ? this.countLimit : size, precision: limited ? "AT_LEAST" : "EXACT" },
            };
          }),
        };
      case "WonSyncProductsInCollection": {
        const nodes = (v.ids as string[]).map((id) => {
          const product = this.products.get(id);
          if (!product) return null;
          return { __typename: "Product", id, inCollection: (this.collections.get(v.collection as string) ?? []).includes(id) };
        });
        return { nodes: this.reorderNodes ? [...nodes].reverse() : nodes };
      }
      case "WonSyncVariantProducts":
        return {
          nodes: (v.ids as string[]).map((id) => {
            const product = [...this.products.values()].find((p) => p.variantIds.includes(id));
            return product ? { __typename: "ProductVariant", id, product: { id: product.id } } : null;
          }),
        };
      case "WonSyncProductVariants": {
        const product = this.products.get(v.id);
        if (!product) return { product: null };
        return { product: { id: product.id, variants: this.page(product.variantIds.map((id) => ({ id })), v.after) } };
      }
      case "WonSyncProductMetafields":
        return {
          nodes: (v.ids as string[]).map((id) => {
            const product = this.products.get(id);
            if (!product) return null;
            const mf = product.metafields.get(mfKey("$app:won_discounts", "product"));
            return { __typename: "Product", id, metafield: mf ? { id: mf.id, value: mf.value } : null };
          }),
        };
      case "WonSyncMarkets":
        return {
          markets: this.page(
            this.markets.map((m, i) => ({
              id: m.id ?? `gid://shopify/Market/${i + 1}`,
              handle: m.handle,
              name: m.name,
              status: m.status,
              currencySettings: { baseCurrency: { currencyCode: m.currency } },
            })),
            v.after,
          ),
        };
      case "WonSyncMarketRegions": {
        const market = this.markets.find((m, i) => (m.id ?? `gid://shopify/Market/${i + 1}`) === v.id);
        if (!market) return { market: null };
        return {
          market: {
            id: v.id,
            conditions: {
              regionsCondition: {
                regions: this.page(market.countries.map((code) => ({ __typename: "MarketRegionCountry", code })), v.after),
              },
            },
          },
        };
      }
      case "WonSyncCostVariantsCount":
        return { productVariantsCount: { count: this.allVariants().length, precision: "EXACT" } };
      case "WonSyncCostVariants":
        return { productVariants: this.page(this.allVariants().map((variant) => this.variantView(variant)), v.after) };
      case "WonSyncCostVariantNodes":
        return {
          nodes: (v.ids as string[]).map((id) => {
            const variant = this.variants.get(id);
            return variant ? this.variantView(variant) : null;
          }),
        };
      case "WonSyncCostInventoryItems":
        return {
          nodes: (v.ids as string[]).map((id) => {
            const variant = [...this.variants.values()].find((x) => x.inventoryItemId === id);
            if (!variant) return null;
            return {
              __typename: "InventoryItem",
              id,
              unitCost: variant.unitCost ? { ...variant.unitCost } : null,
              variants: { nodes: [this.variantView(variant, { inventoryItem: false })] },
            };
          }),
        };
      case "WonSyncCostProductVariants": {
        const product = this.products.get(v.id);
        if (!product) return { product: null };
        const variants = product.variantIds.map((id) => this.variants.get(id)).filter((x): x is FakeVariant => x !== undefined);
        return {
          product: {
            id: product.id,
            title: product.title ?? null,
            variants: this.page(variants.map((variant) => this.variantView(variant, { product: false })), v.after),
          },
        };
      }
      default:
        throw new Error(`FakeShopify: unknown operation ${op}`);
    }
  }
}
