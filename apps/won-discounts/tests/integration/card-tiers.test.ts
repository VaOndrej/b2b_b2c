import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import {
  CARD_TIERS_CACHE_MS,
  CARD_TIERS_MAX_HANDLES,
  CARD_TIERS_READS_PER_MINUTE,
  CardTiersRateLimited,
  clearCardTiersCache,
  invalidateCardTiers,
  parseCardTiersRequest,
  runCardTiers,
  setCardTiersClock,
  type CardTiersRequest,
} from "../../app/lib/integration/card-tiers.server.ts";

// Umístění na webu, balík B2: the card line of a product the page does not list, through the app proxy — core
// cardTier (the Liquid snippet's twin) over the live storefront config and the product's own metafields; the shop
// from the proxy signature, nothing but the break in the answer, Shopify reads cached and limited.

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
  setCardTiersClock(() => clock);
  clearCardTiersCache();
});
afterEach(() => setCardTiersClock(() => Date.now()));

const CFG = {
  v: 1,
  cv: "t",
  tiers: { global: "g", sets: { g: { breaks: [{ min: 3, pct: 10 }] }, amt: { breaks: [{ min: 2, off: { EUR: 500, "EUR@sk": 300 } }] } } },
  margin: { on: false },
  appearance: { preset: "default" },
  cards: 1,
};

type Product = {
  won?: unknown;
  giftCard?: boolean;
  variants?: number;
  sale?: unknown;
  cost?: boolean;
  /** The country's cheapest price: [amount, currency]. */
  price?: [string, string];
};

function fakeAdmin(config: unknown, products: Record<string, Product>) {
  const calls: { op: string; variables?: Record<string, unknown> }[] = [];
  const client = {
    async graphql(query: string, variables?: Record<string, unknown>) {
      const op = /query (\w+)/.exec(query)![1]!;
      calls.push({ op, variables });
      if (op === "WonCardTiersConfig") return { data: { currentAppInstallation: { metafield: config === null ? null : { jsonValue: config } } } };
      const asked = String(variables?.query ?? "")
        .split(" OR ")
        .map((part) => part.replace(/^handle:/, ""));
      return {
        data: {
          products: {
            nodes: asked
              .filter((h) => products[h])
              .map((h) => {
                const p = products[h]!;
                const n = p.variants ?? 1;
                return {
                  handle: h,
                  isGiftCard: p.giftCard === true,
                  won: p.won === undefined ? null : { jsonValue: p.won },
                  variantsCount: { count: n },
                  contextualPricing: { minVariantPricing: { price: { amount: (p.price ?? ["250.00", "CZK"])[0], currencyCode: (p.price ?? ["250.00", "CZK"])[1] } } },
                  priceRangeV2: { minVariantPrice: { amount: "250.00", currencyCode: "CZK" } },
                  variants: {
                    nodes: Array.from({ length: Math.min(n, 50) }, (_, i) => ({
                      outlet: i === 0 && p.sale !== undefined ? { jsonValue: p.sale } : null,
                      cost: i === 0 && p.cost ? { id: "gid://shopify/Metafield/1" } : null,
                      pdp: null,
                    })),
                  },
                };
              }),
          },
        },
      };
    },
  } as unknown as AdminClient;
  return { client, calls };
}

const ask = (handles: string[], extra: Partial<CardTiersRequest> = {}): CardTiersRequest => ({ handles, currency: "CZK", market: "cz", country: "CZ", ...extra });

test("the request: handles (at most 50, each a handle), the page's currency, market and country — anything else is refused", () => {
  const q = (s: string) => parseCardTiersRequest(new URLSearchParams(s));
  assert.deepEqual(q("h=mug,cup,mug&cur=CZK&mk=cz&c=CZ"), { handles: ["mug", "cup"], currency: "CZK", market: "cz", country: "CZ" });
  assert.deepEqual(q("h=hrnek-čaj&cur=EUR&c=SK"), { handles: ["hrnek-čaj"], currency: "EUR", market: null, country: "SK" });
  assert.equal(q("cur=CZK&c=CZ"), null, "no handle");
  assert.equal(q(`h=${Array.from({ length: CARD_TIERS_MAX_HANDLES + 1 }, (_, i) => `p${i}`).join(",")}&cur=CZK&c=CZ`), null);
  assert.equal(q("h=a OR title:x&cur=CZK&c=CZ"), null, "a handle never reaches the search query as syntax");
  assert.equal(q("h=a&cur=czk&c=CZ"), null);
  assert.equal(q("h=a&cur=CZK"), null, "no country");
});

test("each card says what the snippet would: the first break, nothing for a sale, a gift card, too many variants, a product without a set", async () => {
  const { client } = fakeAdmin(CFG, {
    mug: {},
    own: { won: { tierRef: "amt" } },
    gone: { won: { tierRef: "deleted" } },
    sale: { sale: 2 },
    gift: { giftCard: true },
    big: { variants: 60 },
  });
  const answer = await runCardTiers(client, "a.myshopify.com", ask(["mug", "own", "gone", "sale", "gift", "big", "missing"]));
  // `own` is an amount break without an amount in CZK: nothing.
  assert.deepEqual(answer, { ok: true, cards: { mug: { min: 3, pct: 10 } } });
});

test("an amount break: the market's own amount first, at most the cheapest price in the page's currency; cards off or no config = nothing", async () => {
  const products = { own: { won: { tierRef: "amt" }, price: ["4.00", "EUR"] as [string, string] }, cheap: { won: { tierRef: "amt" }, price: ["2.00", "EUR"] as [string, string] } };
  const sk = await runCardTiers(fakeAdmin(CFG, products).client, "a.myshopify.com", ask(["own", "cheap"], { currency: "EUR", market: "sk", country: "SK" }));
  assert.deepEqual(sk.cards, { own: { min: 2, off: 300 } }, "3 € off a 2 € item is never promised");
  clearCardTiersCache();
  const pricier = { own: { won: { tierRef: "amt" }, price: ["10.00", "EUR"] as [string, string] } };
  const at = await runCardTiers(fakeAdmin(CFG, pricier).client, "a.myshopify.com", ask(["own"], { currency: "EUR", market: "at", country: "AT" }));
  assert.deepEqual(at.cards, { own: { min: 2, off: 500 } }, "a market without its own amount: the currency's");
  clearCardTiersCache();
  assert.deepEqual((await runCardTiers(fakeAdmin({ ...CFG, cards: undefined }, products).client, "a.myshopify.com", ask(["own"]))).cards, {});
  clearCardTiersCache();
  assert.deepEqual((await runCardTiers(fakeAdmin(null, products).client, "a.myshopify.com", ask(["own"]))).cards, {});
});

test("margin protection: a costed product says nothing, a percent above the product's ceiling says nothing", async () => {
  const cfg = { ...CFG, margin: { on: true, max: 8, col: {}, prod: {} } };
  const { client } = fakeAdmin(cfg, { costed: { cost: true }, plain: {} });
  assert.deepEqual((await runCardTiers(client, "a.myshopify.com", ask(["costed", "plain"]))).cards, {});
  clearCardTiersCache();
  const { client: c2 } = fakeAdmin({ ...cfg, margin: { ...cfg.margin, max: 15 } }, { plain: {} });
  assert.deepEqual((await runCardTiers(c2, "a.myshopify.com", ask(["plain"]))).cards, { plain: { min: 3, pct: 10 } });
});

test("Shopify is read once per shop and product for CARD_TIERS_CACHE_MS, per country; a write of the app drops the shop's cache", async () => {
  const { client, calls } = fakeAdmin(CFG, { mug: {}, cup: {} });
  await runCardTiers(client, "a.myshopify.com", ask(["mug"]));
  await runCardTiers(client, "a.myshopify.com", ask(["mug", "cup"]));
  assert.deepEqual(calls.map((c) => [c.op, c.variables?.query]), [["WonCardTiersConfig", undefined], ["WonCardTiersProducts", "handle:mug"], ["WonCardTiersProducts", "handle:cup"]]);
  await runCardTiers(client, "a.myshopify.com", ask(["mug"], { country: "SK", currency: "EUR" }));
  assert.equal(calls.length, 4, "another country's price is another read");
  clock += CARD_TIERS_CACHE_MS;
  await runCardTiers(client, "a.myshopify.com", ask(["mug"]));
  assert.equal(calls.length, 6, "config and product again");
  invalidateCardTiers("a.myshopify.com");
  await runCardTiers(client, "a.myshopify.com", ask(["mug"]));
  assert.equal(calls.length, 8);
});

test("a shop's requests that need Shopify are limited a minute; cached answers are not", async () => {
  const { client } = fakeAdmin(CFG, { mug: {} });
  for (let i = 0; i < CARD_TIERS_READS_PER_MINUTE; i += 1) await runCardTiers(client, "a.myshopify.com", ask([`p${i}`]));
  await assert.rejects(runCardTiers(client, "a.myshopify.com", ask(["other"])), CardTiersRateLimited);
  await runCardTiers(client, "a.myshopify.com", ask(["p1"]));
  await runCardTiers(client, "b.myshopify.com", ask(["mug"]));
  clock += 60_000;
  await runCardTiers(client, "a.myshopify.com", ask(["other"]));
});
