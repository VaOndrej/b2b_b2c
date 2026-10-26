import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { buildShopFunctionConfig } from "@won/core/discounts/function-payload";
import { sanitizeConfig } from "@won/core/discounts/config";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import {
  CART_PLAN_CODES_PER_MINUTE,
  CART_PLAN_READS_PER_MINUTE,
  CartPlanRateLimited,
  clearCartPlanCache,
  runCartPlan,
  setCartPlanClock,
  type CartPlanRequest,
} from "../../app/lib/integration/cart-plan.server.ts";

// Audit 2026-10-26, finding SEC-03: the public cart plan (app proxy POST /apps/won-discounts/cart-plan) plans the
// cart with the codes the BROWSER sends (up to 25 per request) and answers `saved`, so it tells a correct Won code
// from a wrong one. The per-shop limit counts only requests that read Shopify (audit P2: the API budget); once the
// shop config and the variant are cached, any number of requests is answered. Together: an unthrottled oracle for
// guessing a shop's discount codes, outside Shopify's own checkout throttling.
// The first test pins the oracle (the answer still tells codes apart: evidence); the others guard the fix — a per-shop
// budget of DIFFERENT codes a minute (CART_PLAN_CODES_PER_MINUTE), counted for cached answers too.

const SHOP = "oracle.myshopify.com";
const SECRET_CODE = "SECRET-42";
let clock = 5_000_000;

beforeEach(() => {
  clock = 5_000_000;
  setCartPlanClock(() => clock);
  clearCartPlanCache();
});
afterEach(() => setCartPlanClock(() => Date.now()));

function shopConfigJson(): string {
  const { config } = sanitizeConfig({
    modules: { codes: { rules: [{ id: "c1", name: "Secret", method: "code", codes: [SECRET_CODE], value: { kind: "percentage", percent: 15 }, target: { kind: "order" } }] } },
  });
  return buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" }).json;
}

function fakeShopify() {
  const json = shopConfigJson();
  let reads = 0;
  const client = {
    async graphql(query: string, variables?: Record<string, unknown>) {
      reads += 1;
      if (query.includes("WonCartPlanConfig")) return { data: { shop: { ianaTimezone: "Europe/Prague", config: { value: json } } } };
      const ids = (variables?.ids as string[]) ?? [];
      return { data: { nodes: ids.map((id) => ({ id, cost: null, outlet: null, product: { won: null } })) } };
    },
  } as AdminClient;
  return { client, reads: () => reads };
}

const request = (codes: string[]): CartPlanRequest => ({
  currency: "CZK",
  locale: "cs",
  codes,
  lines: [{ key: "k1", variantId: 11, productId: 1, quantity: 1, unitPrice: 1000_00 }],
});

const guesses = (round: number) => Array.from({ length: 25 }, (_, i) => `GUESS-${round}-${i}`);

test("evidence: the answer tells a correct code from wrong ones (saved > 0 only with the real code)", async () => {
  const { client } = fakeShopify();
  const wrong = await runCartPlan(client, SHOP, request(["WRONG-1", "WRONG-2"]));
  const right = await runCartPlan(client, SHOP, request(["WRONG-1", SECRET_CODE]));
  assert.equal(wrong.saved, 0);
  assert.equal(right.saved, 15_000, "15 % of 1 000 Kč");
});

test("SEC-03: guessing codes through the public cart plan is throttled per shop like Shopify reads", async () => {
  const { client, reads } = fakeShopify();
  let limited = 0;
  for (let round = 0; round < 10 * CART_PLAN_READS_PER_MINUTE; round += 1) {
    try {
      await runCartPlan(client, SHOP, request(guesses(round)));
    } catch (error) {
      if (!(error instanceof CartPlanRateLimited)) throw error;
      limited += 1;
    }
  }
  assert.ok(reads() <= 2, "the scenario stays inside the cache (no Shopify read beyond the first two)");
  assert.ok(limited > 0, `${10 * CART_PLAN_READS_PER_MINUTE * 25} guesses within one minute were all answered`);
});

test("SEC-03: a shopper asking again and again with the same codes is never limited by the code budget", async () => {
  const { client } = fakeShopify();
  for (let i = 0; i < 10 * CART_PLAN_CODES_PER_MINUTE; i += 1) {
    const answer = await runCartPlan(client, SHOP, request(["WRONG-1", SECRET_CODE.toLowerCase(), SECRET_CODE]));
    assert.equal(answer.saved, 15_000);
  }
});

test("SEC-03: the code budget is per shop and per minute — a new minute answers again, another shop is not affected", async () => {
  const { client } = fakeShopify();
  const fresh = (prefix: string) => Array.from({ length: CART_PLAN_CODES_PER_MINUTE + 1 }, (_, i) => `${prefix}-${i}`);
  await assert.rejects(runCartPlan(client, SHOP, request(fresh("A"))), CartPlanRateLimited);
  await runCartPlan(client, "other.myshopify.com", request(fresh("B").slice(0, CART_PLAN_CODES_PER_MINUTE)));
  clock += 60_000;
  const answer = await runCartPlan(client, SHOP, request(["WRONG-1", SECRET_CODE]));
  assert.equal(answer.saved, 15_000);
});
