// Gift cards never take a discount (decided 10 Oct 2026): the app marks every gift card variant with the flag the
// checkout function reads (core cart.ts NEVER_DISCOUNTED_FLAG = 0; what the function does with it is pinned in
// packages/core/tests/discounts/outlet-allow.test.ts and the engine's fixtures lines-gift-card-never-discounted*).

import assert from "node:assert/strict";
import { test } from "node:test";

import { NEVER_DISCOUNTED_FLAG } from "@won/core/discounts/cart";

import { syncGiftCards, unflaggedGiftCardVariants } from "../../../app/lib/sync/gift-cards.ts";
import { GQL } from "../../../app/lib/sync/graphql.ts";
import type { Transport } from "../../../app/lib/sync/transport.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const product = (id: number, isGiftCard: boolean, variants: [number, unknown][]) => ({
  id: `gid://shopify/Product/${id}`,
  isGiftCard,
  variants: { nodes: variants.map(([n, flag]) => ({ id: V(n), flag: flag === undefined ? null : { jsonValue: flag } })) },
});

/** A transport that answers the pages given and records every call. */
function fake(pages: unknown[], userErrors: { message: string }[] = []) {
  const calls: { name: string; variables: Record<string, unknown> }[] = [];
  let page = 0;
  const transport = {
    async call(name: string, variables: Record<string, unknown> = {}) {
      calls.push({ name, variables });
      if (name === "giftCardVariants") return pages[page++];
      if (name === "metafieldsSet") return { metafieldsSet: { userErrors } };
      throw new Error(`unexpected ${name}`);
    },
  } as unknown as Transport;
  return { transport, calls };
}

test("only gift card variants without the flag are picked: an ordinary product never, a flagged variant not again, a sale's flag is replaced", () => {
  const page = { products: { nodes: [product(1, true, [[11, undefined], [12, 0], [13, true], [14, 2]]), product(2, false, [[21, undefined]]), null] } };
  assert.deepEqual(unflaggedGiftCardVariants(page), [V(11), V(13), V(14)]);
  assert.deepEqual(unflaggedGiftCardVariants({}), []);
});

test("the sync marks every unflagged gift card variant with 0 on the key the function reads, in writes of at most 25, across pages", async () => {
  const many = Array.from({ length: 30 }, (_, i) => [100 + i, undefined] as [number, unknown]);
  const { transport, calls } = fake([
    { products: { nodes: [product(1, true, many)], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
    { products: { nodes: [product(2, true, [[200, 0]]), product(3, false, [[300, undefined]])], pageInfo: { hasNextPage: false, endCursor: null } } },
  ]);
  const step = await syncGiftCards(transport);
  assert.deepEqual([step.step, step.ok], ["gift_cards", true]);
  assert.match(step.detail, /^30 gift card variant/);
  assert.deepEqual(calls.map((c) => c.name), ["giftCardVariants", "giftCardVariants", "metafieldsSet", "metafieldsSet"]);
  assert.deepEqual([calls[0]!.variables.after, calls[1]!.variables.after], [null, "c1"]);
  assert.deepEqual([calls[0]!.variables.namespace, calls[0]!.variables.key], ["$app:won_discounts", "outlet"]);
  const writes = calls.filter((c) => c.name === "metafieldsSet").map((c) => c.variables.metafields as { ownerId: string; namespace: string; key: string; type: string; value: string }[]);
  assert.deepEqual(writes.map((w) => w.length), [25, 5]);
  assert.deepEqual(writes[0]![0], { ownerId: V(100), namespace: "$app:won_discounts", key: "outlet", type: "json", value: "0" });
  assert.equal(JSON.parse(writes[0]![0]!.value), NEVER_DISCOUNTED_FLAG);
});

test("nothing to mark writes nothing; a refused write and a failed read are a failed step, never a throw", async () => {
  const none = fake([{ products: { nodes: [product(1, true, [[11, 0]])] } }]);
  assert.equal((await syncGiftCards(none.transport)).ok, true);
  assert.deepEqual(none.calls.map((c) => c.name), ["giftCardVariants"]);
  const refused = await syncGiftCards(fake([{ products: { nodes: [product(1, true, [[11, undefined]])] } }], [{ message: "Access denied" }]).transport);
  assert.deepEqual([refused.ok, /Access denied/.test(refused.detail)], [false, true]);
  const broken = await syncGiftCards({ call: async () => { throw new Error("boom"); } } as unknown as Transport);
  assert.deepEqual([broken.ok, /boom/.test(broken.detail)], [false, true]);
});

test("the query asks Shopify for gift cards only and reads the flag by variables (one document for every shop)", () => {
  assert.match(GQL.giftCardVariants, /products\(first: 4, after: \$after, query: "gift_card:true"\)/);
  assert.match(GQL.giftCardVariants, /isGiftCard/);
  assert.match(GQL.giftCardVariants, /flag: metafield\(namespace: \$namespace, key: \$key\)/);
  // A sale's flag write asks whether the variant is a gift card (outlet.server.ts writeOutletFlag keeps 0 on one).
  assert.match(GQL.outletVariant, /product \{\s*id\s*title\s*isGiftCard\s*\}/);
});
