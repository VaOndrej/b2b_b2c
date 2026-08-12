import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeProductPopularity,
  DEFAULT_POPULARITY_OPTIONS,
  type ProductSale,
} from "../../src/toasts/popularity.ts";

const NOW = 1_700_000_000_000; // fixed epoch ms
const DAY = 24 * 60 * 60 * 1000;
const opts = (over: Partial<Parameters<typeof computeProductPopularity>[1]> = {}) => ({
  now: NOW,
  ...DEFAULT_POPULARITY_OPTIONS,
  ...over,
});

test("sums units per product and excludes sales outside the window", () => {
  const sales: ProductSale[] = [
    { productId: "A", quantity: 2, at: NOW - 1 * DAY },
    { productId: "A", quantity: 3, at: NOW - 10 * DAY },
    { productId: "A", quantity: 9, at: NOW - 40 * DAY }, // outside 30d window
    { productId: "B", quantity: 1, at: NOW - 5 * DAY },
  ];
  const res = computeProductPopularity(sales, opts({ windowDays: 30 }));
  const a = res.find((r) => r.productId === "A")!;
  const b = res.find((r) => r.productId === "B")!;
  assert.equal(a.soldUnits, 5); // 2 + 3, the 40-day-old sale dropped
  assert.equal(b.soldUnits, 1);
});

test("dense rank: strongest seller is rank 1, ties share a rank", () => {
  const sales: ProductSale[] = [
    { productId: "A", quantity: 10, at: NOW - DAY },
    { productId: "B", quantity: 5, at: NOW - DAY },
    { productId: "C", quantity: 5, at: NOW - DAY },
    { productId: "D", quantity: 1, at: NOW - DAY },
  ];
  const res = computeProductPopularity(sales, opts());
  const byId = Object.fromEntries(res.map((r) => [r.productId, r.rank]));
  assert.equal(byId.A, 1);
  assert.equal(byId.B, 2);
  assert.equal(byId.C, 2); // tie shares rank
  assert.equal(byId.D, 3); // dense (not 4)
});

test("bestseller floor: a single sale never earns the badge", () => {
  const sales: ProductSale[] = [{ productId: "A", quantity: 1, at: NOW - DAY }];
  const res = computeProductPopularity(sales, opts({ minSales: 5 }));
  assert.equal(res[0].soldUnits, 1);
  assert.equal(res[0].isBestseller, false);
});

test("bestseller = top (1 − percentile) of eligible, ties at the boundary included", () => {
  // 5 eligible products (>= minSales 5). percentile 0.8 → top 20% → ceil(0.2*5)=1 slot.
  const sales: ProductSale[] = [
    { productId: "A", quantity: 50, at: NOW - DAY },
    { productId: "B", quantity: 40, at: NOW - DAY },
    { productId: "C", quantity: 30, at: NOW - DAY },
    { productId: "D", quantity: 20, at: NOW - DAY },
    { productId: "E", quantity: 10, at: NOW - DAY },
    { productId: "F", quantity: 2, at: NOW - DAY }, // below floor → ineligible
  ];
  const res = computeProductPopularity(sales, opts({ minSales: 5, bestsellerPercentile: 0.8 }));
  const best = res.filter((r) => r.isBestseller).map((r) => r.productId);
  assert.deepEqual(best, ["A"]); // only the single top slot
  assert.equal(res.find((r) => r.productId === "F")!.isBestseller, false);
});

test("boundary ties are treated equally", () => {
  // 4 eligible, percentile 0.5 → top 50% → ceil(0.5*4)=2 slots. Units [9,9,9,5]:
  // threshold is the 2nd product's units (9), so all three 9s qualify (fair ties).
  const sales: ProductSale[] = [
    { productId: "A", quantity: 9, at: NOW - DAY },
    { productId: "B", quantity: 9, at: NOW - DAY },
    { productId: "C", quantity: 9, at: NOW - DAY },
    { productId: "D", quantity: 5, at: NOW - DAY },
  ];
  const res = computeProductPopularity(sales, opts({ minSales: 5, bestsellerPercentile: 0.5 }));
  const best = res.filter((r) => r.isBestseller).map((r) => r.productId).sort();
  assert.deepEqual(best, ["A", "B", "C"]);
});

test("no eligible products → no bestsellers, no crash", () => {
  const sales: ProductSale[] = [
    { productId: "A", quantity: 1, at: NOW - DAY },
    { productId: "B", quantity: 2, at: NOW - DAY },
  ];
  const res = computeProductPopularity(sales, opts({ minSales: 5 }));
  assert.equal(res.every((r) => !r.isBestseller), true);
});

test("ignores malformed rows (no id, non-positive qty, future/NaN time)", () => {
  const sales = [
    { productId: "", quantity: 3, at: NOW - DAY },
    { productId: "A", quantity: 0, at: NOW - DAY },
    { productId: "A", quantity: -4, at: NOW - DAY },
    { productId: "A", quantity: 3, at: NOW + DAY }, // future
    { productId: "A", quantity: 2, at: Number.NaN },
    { productId: "A", quantity: 4, at: NOW - DAY }, // the only valid one
  ] as ProductSale[];
  const res = computeProductPopularity(sales, opts());
  assert.equal(res.length, 1);
  assert.equal(res[0].soldUnits, 4);
});

test("deterministic + empty input", () => {
  assert.deepEqual(computeProductPopularity([], opts()), []);
});
