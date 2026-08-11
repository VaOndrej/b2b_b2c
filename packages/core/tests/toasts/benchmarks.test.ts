import assert from "node:assert/strict";
import { test } from "node:test";

import { computeBenchmark, percentileRank, type StoreTypeRates } from "../../src/toasts/benchmarks.ts";

// Build N stores each contributing a read-rate for one type.
function stores(type: string, rates: number[]): StoreTypeRates[] {
  return rates.map((readRate, i) => ({
    shopHash: "s" + i,
    optOut: false,
    byType: { [type]: { readRate, ctr: readRate / 2, dismissRate: 1 - readRate } },
  }));
}

test("k-anonymity: no benchmark until at least N stores contribute a type", () => {
  const b = computeBenchmark(stores("stock.low", [0.4, 0.5, 0.6]), { minStores: 10 });
  assert.equal(b["stock.low"], undefined); // only 3 stores → suppressed
});

test("computes p25/p50/p75 per type once k-anonymity is met", () => {
  const rates = Array.from({ length: 10 }, (_, i) => (i + 1) / 10); // 0.1..1.0
  const b = computeBenchmark(stores("stock.low", rates), { minStores: 10 });
  assert.ok(b["stock.low"]);
  assert.equal(b["stock.low"].stores, 10);
  assert.ok(b["stock.low"].readRate.p50 > 0.4 && b["stock.low"].readRate.p50 < 0.7);
  assert.ok(b["stock.low"].readRate.p25 < b["stock.low"].readRate.p50);
  assert.ok(b["stock.low"].readRate.p75 > b["stock.low"].readRate.p50);
});

test("opted-out stores are excluded from the aggregate", () => {
  const rows = stores("stock.low", Array.from({ length: 12 }, () => 0.5));
  rows[0].optOut = true;
  rows[1].optOut = true;
  const b = computeBenchmark(rows, { minStores: 10 });
  assert.equal(b["stock.low"].stores, 10); // 12 - 2 opted out
});

test("dropping below k after opt-out suppresses the type", () => {
  const rows = stores("stock.low", Array.from({ length: 11 }, () => 0.5));
  for (let i = 0; i < 3; i++) rows[i].optOut = true; // 11 - 3 = 8 < 10
  const b = computeBenchmark(rows, { minStores: 10 });
  assert.equal(b["stock.low"], undefined);
});

test("benchmark is deterministic regardless of store order", () => {
  const rates = Array.from({ length: 10 }, (_, i) => (i + 1) / 10);
  const a = computeBenchmark(stores("stock.low", rates), { minStores: 10 });
  const b = computeBenchmark(stores("stock.low", [...rates].reverse()), { minStores: 10 });
  assert.deepEqual(a, b);
});

test("industry filter cohorts a shop against 'stores like yours' only", () => {
  const fashion = stores("stock.low", Array.from({ length: 10 }, () => 0.6)).map((s) => ({
    ...s,
    industry: "fashion",
  }));
  const electronics = stores("stock.low", Array.from({ length: 10 }, () => 0.2)).map((s) => ({
    ...s,
    industry: "electronics",
  }));
  const all = [...fashion, ...electronics];

  const fashionBench = computeBenchmark(all, { minStores: 10, industry: "fashion" });
  assert.ok(fashionBench["stock.low"]);
  assert.equal(fashionBench["stock.low"].stores, 10); // only fashion contributes
  assert.ok(fashionBench["stock.low"].readRate.p50 > 0.5); // fashion's 0.6, not the 0.2 electronics

  // Global (no industry) blends both cohorts.
  const globalBench = computeBenchmark(all, { minStores: 10 });
  assert.equal(globalBench["stock.low"].stores, 20);
});

test("industry filter re-applies k-anonymity within the cohort", () => {
  const fashion = stores("stock.low", Array.from({ length: 6 }, () => 0.6)).map((s) => ({
    ...s,
    industry: "fashion",
  }));
  const electronics = stores("stock.low", Array.from({ length: 12 }, () => 0.2)).map((s) => ({
    ...s,
    industry: "electronics",
  }));
  // Fashion cohort has only 6 stores → below k=10 → suppressed.
  const bench = computeBenchmark([...fashion, ...electronics], { minStores: 10, industry: "fashion" });
  assert.equal(bench["stock.low"], undefined);
});

test("percentileRank places a shop against the cohort (0..1)", () => {
  const cohort = [0.1, 0.2, 0.3, 0.4, 0.5];
  assert.equal(percentileRank(0.3, cohort), 0.6); // 3 of 5 ≤ 0.3
  assert.equal(percentileRank(0.05, cohort), 0);
  assert.equal(percentileRank(1, cohort), 1);
});
