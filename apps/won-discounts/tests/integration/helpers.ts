// Shared setup for the integration tests (MVP 1 integration step): the REAL
// admin paths (app/lib/integration + ui-actions + app/lib/sync + app/lib/native)
// against a fake Shopify and a throwaway SQLite database.
//
// FakeStore is one AdminClient in front of the existing fakes, dispatching on
// the operation name like Shopify dispatches on the document:
//   WonSync*      → the sync fake (tests/lib/sync/fake-shopify.ts: Won nodes,
//                   metafields, products, collections, markets);
//   WonNative*    → the native fake (tests/lib/native/fake-shopify.ts: native
//                   discounts, backups' restore, one code per discount);
//   WonTryCart*   → prices / product refs (the product metafield the sync
//                   wrote) / markets for Vyzkoušet košík, from the sync fake's
//                   products + `prices` below;
//   WonDiscounts* → the admin's own reads (shop context, market names, themes,
//                   the automatic Won node's status);
//   WonMargin*    → the margin screen's collection titles (`collectionTitles`).
// Anything else fails the test (an unexpected document).

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient, AdminGraphQLResult } from "../../app/lib/admin-client.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { FakeShopify as NativeFake } from "../lib/native/fake-shopify.ts";
import { FakeShopify as SyncFake } from "../lib/sync/fake-shopify.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake speaks raw Admin API JSON */

// One clock for everything: the sync stamps SyncRun.startedAt with its `now`
// and the DB stamps ConfigVersion / ShopConfig with the wall clock, and the
// per-rule "Běží" facts compare the two — exactly as in production.
export const APP_KEY = "won-discounts-test-key";
export const quiet = { info: () => {}, warn: () => {}, error: () => {} };

type Handler = (variables: Record<string, unknown>) => Promise<AdminGraphQLResult> | AdminGraphQLResult;

export class FakeStore implements AdminClient {
  readonly sync = new SyncFake();
  readonly native = new NativeFake();
  shop = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };
  /** variant id → currency → decimal price (contextual pricing answers in the country's market currency). */
  prices = new Map<string, Record<string, string>>();
  titles = new Map<string, { product: string; variant: string }>();
  /** Collection GID → title (the margin screen's collection names; unknown ids answer null). */
  collectionTitles = new Map<string, string>();
  /** Operation names in call order. */
  ops: string[] = [];
  /** Every call with its variables. */
  calls: { op: string; variables: Record<string, unknown> }[] = [];
  /** Delay (ms) before every answer: a slow Shopify (REL-1 tests). */
  delayMs = 0;
  /** The languages switched on in Shopify (`shopLocales`, read_locales). */
  shopLocales: { locale: string; primary: boolean }[] = [{ locale: "cs", primary: true }];
  /** Operation name → a replacement answer (errors, outages). */
  overrides = new Map<string, Handler>();

  constructor() {
    this.native.now = () => new Date();
    this.sync.clock = () => new Date();
  }

  async graphql<TData = any>(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<TData>> {
    // Documents may start with a `#graphql` tag comment.
    const op = /^\s*(?:#[^\n]*\n\s*)*(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
    this.ops.push(op);
    this.calls.push({ op, variables: variables ?? {} });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const override = this.overrides.get(op);
    if (override) return (await override(variables ?? {})) as AdminGraphQLResult<TData>;
    if (op.startsWith("WonSync")) return (await this.sync.graphql(query, variables)) as AdminGraphQLResult<TData>;
    if (op.startsWith("WonNative")) return (await this.native.graphql(query, variables)) as AdminGraphQLResult<TData>;
    return { data: this.own(op, variables ?? {}) as TData };
  }

  /** The market a country belongs to (sync fake markets), for contextual pricing. */
  private marketOf(country: string | null | undefined) {
    return this.sync.markets.find((m) => m.status === "ACTIVE" && country && m.countries.includes(country)) ?? null;
  }

  private own(op: string, variables: Record<string, unknown>): unknown {
    switch (op) {
      case "WonDiscountsShopContext":
        return { shop: { ...this.shop } };
      case "WonDiscountsMarketNames":
        return { markets: { nodes: this.sync.markets.map((m) => ({ handle: m.handle, name: m.name })) } };
      case "WonDiscountsShopLocales":
        return { shopLocales: this.shopLocales };
      case "WonDiscountsThemes":
        return { themes: { nodes: [] } };
      case "WonTryCartMarkets":
        return {
          markets: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: this.sync.markets.map((m) => ({
              handle: m.handle,
              status: m.status,
              currencySettings: { baseCurrency: { currencyCode: m.currency } },
              conditions: { regionsCondition: { regions: { nodes: m.countries.slice(0, 1).map((code) => ({ __typename: "MarketRegionCountry", code })) } } },
            })),
          },
        };
      case "WonTryCartVariants": {
        const ids = (variables.ids as string[]) ?? [];
        const country = (variables.country as string | null) ?? null;
        const market = this.marketOf(country);
        return {
          nodes: ids.map((id) => {
            const product = [...this.sync.products.values()].find((p) => p.variantIds.includes(id));
            if (!product) return null;
            const prices = this.prices.get(id) ?? {};
            const currency = market?.currency ?? this.shop.currencyCode;
            const titles = this.titles.get(id) ?? { product: `Product ${product.id}`, variant: "Default Title" };
            const refs = product.metafields.get("$app:won_discounts/product");
            // Live collection membership (read only when asked for: stale targeting + a collection rule).
            const collections = [...this.sync.collections].filter(([, members]) => members.includes(product.id)).map(([cid]) => ({ id: cid }));
            return {
              __typename: "ProductVariant",
              id,
              title: titles.variant,
              price: prices[this.shop.currencyCode] ?? "0.00",
              ...(variables.priced
                ? { contextualPricing: { price: { amount: prices[currency] ?? prices[this.shop.currencyCode], currencyCode: prices[currency] ? currency : this.shop.currencyCode } } }
                : {}),
              product: {
                id: product.id,
                title: titles.product,
                wonRefs: refs ? { value: refs.value } : null,
                ...(variables.withCollections ? { collections: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: collections } } : {}),
              },
            };
          }),
        };
      }
      case "WonTryCartProductCollections":
        return { product: null };
      case "WonMarginCollectionTitles":
        return {
          nodes: ((variables.ids as string[]) ?? []).map((id) => {
            const title = this.collectionTitles.get(id);
            return title ? { __typename: "Collection", id, title } : null;
          }),
        };
      case "WonDiscountsAutoNodeStatus": {
        const node = this.sync.nodes.get(String(variables.id));
        if (!node) return { node: null };
        return {
          node: {
            __typename: "DiscountAutomaticNode",
            id: node.id,
            automaticDiscount: { __typename: "DiscountAutomaticApp", status: this.sync.statusOf(node) },
          },
        };
      }
      default:
        throw new Error(`FakeStore: unexpected operation ${op}`);
    }
  }
}

/** The production sync (real engine builders, wall clock) on the fake, without retry sleeps. */
export function realSync(client: AdminClient, db: PrismaClient) {
  return createSync({ ...productionSyncDeps(client, db, quiet), sleep: async () => {} });
}

export function testCtx(db: PrismaClient, shop: string, client: AdminClient, opts: { locale?: "cs" | "en" } = {}): ShopCtx {
  return {
    shop,
    db,
    client,
    locale: opts.locale ?? "cs",
    apiKey: APP_KEY,
    createSync: realSync,
    logger: quiet,
  };
}

export function formOf(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

/** Server-render a screen inside a data router (fetcher hooks work), as the page text (scripts stripped). */
export async function renderPage(element: import("react").ReactElement): Promise<string> {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { createStaticHandler, createStaticRouter, StaticRouterProvider } = await import("react-router");
  const handler = createStaticHandler([{ path: "/", Component: () => element }]);
  const context = await handler.query(new Request("http://localhost/"));
  if (context instanceof Response) throw new Error(`render: ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context })).replace(/<script[\s\S]*?<\/script>/g, "");
}

/** Decode the few HTML entities React writes into text. */
export function text(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
