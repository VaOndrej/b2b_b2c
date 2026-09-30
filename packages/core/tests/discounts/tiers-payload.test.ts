// MVP 3: quantity tiers in the shared shop config (the 9 000 B function
// payload), compact — no scope id lists (targeting is in the product
// metafield's `tierRef`), one currency list per set, and only the sets a line
// can reach (the first global set and every set with a product/collection
// list). readTiersPayload is the tolerant reader the engine (and the Rust
// function) use.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase } from "../../src/discounts/function-payload.ts";
import { buildTiersPayload, readTiersPayload } from "../../src/discounts/tiers.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague" };

function config(sets: unknown[]) {
  const out = sanitizeConfig({ modules: { tiers: { sets } } });
  assert.deepEqual(out.issues, []);
  return out.config;
}

const SETS = [
  { id: "empty-scope", scope: { productIds: [], collectionIds: [] }, countAcross: "line", breaks: [{ minQty: 2, percent: 1 }] },
  {
    id: "pro",
    scope: { productIds: [P(1)], collectionIds: [C(1)] },
    countAcross: "cart",
    breaks: [
      { minQty: 5, amountOff: { EUR: 2_00, CZK: 50_00 } },
      { minQty: 2, amountOff: { CZK: 20_00 } },
      { minQty: 10, amountOff: { CZK: 120_00 } },
    ],
  },
  { id: "global", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 12.5 }] },
  { id: "global-2", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 50 }] },
];

test("the shop config ships the compact tiers: [id, count, currencies, breaks]; no scope lists, no unreachable set", () => {
  const { payload, json } = buildShopFunctionConfig(config(SETS), OPTS);
  assert.deepEqual(payload.modules.tiers, {
    global: "global",
    sets: [
      ["pro", "cart", ["CZK", "EUR"], [[2, [20_00, null]], [5, [50_00, 2_00]], [10, [120_00, null]]]],
      ["global", "product", [], [[3, 10], [5, 12.5]]],
    ],
  });
  assert.ok(!json.includes("gid://"), "no product or collection id reaches the shop config");
  assert.ok(!json.includes("global-2") && !json.includes("empty-scope"), "a set no product can reach does not ship");
});

test("no tier sets: the same bytes as before MVP 3", () => {
  const { json } = buildShopFunctionConfig(config([]), OPTS);
  assert.ok(json.includes('"tiers":{"sets":[]}'), json);
});

test("readTiersPayload: per cart currency, a break without a value there is not offered (MKT-1); round trip of the builder", () => {
  const payload = buildTiersPayload(config(SETS).modules.tiers);
  const czk = readTiersPayload(payload, "CZK");
  assert.equal(czk.global, "global");
  assert.deepEqual([...czk.sets.keys()], ["pro", "global"]);
  assert.deepEqual(czk.sets.get("pro"), {
    id: "pro",
    count: "cart",
    breaks: [
      { minQty: 2, percent: null, amount: 20_00, offered: true },
      { minQty: 5, percent: null, amount: 50_00, offered: true },
      { minQty: 10, percent: null, amount: 120_00, offered: true },
    ],
  });
  const eur = readTiersPayload(payload, "EUR").sets.get("pro")!;
  assert.deepEqual(eur.breaks.map((b) => [b.minQty, b.amount, b.offered]), [
    [2, null, false],
    [5, 2_00, true],
    [10, null, false],
  ]);
  const usd = readTiersPayload(payload, "USD").sets.get("pro")!;
  assert.deepEqual(usd.breaks.map((b) => b.offered), [false, false, false]);
});

test("readTiersPayload is tolerant: junk is skipped piece by piece, never thrown, never widened", () => {
  const read = (raw: unknown, currency = "CZK") => readTiersPayload(raw, currency);
  for (const junk of [undefined, null, 7, "x", [], { sets: "x" }, { sets: {} }]) {
    const out = read(junk);
    assert.equal(out.global, null);
    assert.equal(out.sets.size, 0);
  }
  // The pre-MVP-3 shape (config TierSet objects) is not the compact one: nothing is read (fail closed).
  assert.equal(read({ sets: [{ id: "t", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] }).sets.size, 0);
  const out = read({
    global: "missing",
    sets: [
      ["ok", "line", ["CZK"], [[3, 10], [2, [5_00]], [2, 99], [0, 5], ["4", 5], [4, "5"], [5, 140], [6, [-1]], [7, [1e15]], [8, 5.5]]],
      ["ok", "cart", [], [[1, 100]]], // a repeated id: the first one wins
      ["bad-count", "everything", [], [[1, 50]]],
      [5, "line", [], [[1, 50]]],
      ["", "line", [], [[1, 50]]],
      ["no-breaks", "product", ["CZK"], "x"],
      ["junk-currencies", "product", "CZK", [[2, [5_00]]]],
      "junk",
    ],
  });
  assert.equal(out.global, null, "global names a set that is not there: no global set");
  assert.deepEqual([...out.sets.keys()], ["ok", "no-breaks", "junk-currencies"]);
  assert.deepEqual(
    out.sets.get("ok")!.breaks.map((b) => [b.minQty, b.percent, b.amount, b.offered]),
    [
      [2, null, 5_00, true], // [2, 99] repeats minQty 2 after it: ignored
      [3, 10, null, true],
      [5, 100, null, true], // a percent is clamped to 0–100
      [6, null, null, false], // a negative amount is no value
      [7, null, 1e12, true], // an amount is capped at the config's money cap
      [8, 5.5, null, true],
    ],
  );
  assert.deepEqual(out.sets.get("no-breaks")!.breaks, []);
  assert.deepEqual(out.sets.get("junk-currencies")!.breaks.map((b) => b.offered), [false]);
});

test("the save-time worst case also measures the config gated for Free (a global set's cart counting becomes `product`: 3 B longer)", () => {
  const cart = config([{ id: "g", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }] }]);
  const stored = buildShopFunctionConfig(cart, OPTS);
  const worst = buildShopFunctionConfigWorstCase(cart);
  assert.equal(worst.bytes, stored.bytes + 3);
  assert.equal(worst.payload.modules.tiers.sets[0][1], "product");
  // Anything else the gate does only shortens the payload: then the stored config is the worst case.
  const line = config([{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }]);
  assert.equal(buildShopFunctionConfigWorstCase(line).bytes, buildShopFunctionConfig(line, OPTS).bytes);
});
