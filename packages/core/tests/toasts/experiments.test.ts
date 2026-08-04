import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignVariant,
  hashToken,
  pickWinner,
} from "../../src/toasts/experiments.ts";

test("hashToken is deterministic and stable for a token", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
});

test("assignVariant is deterministic per token and within range", () => {
  const t = "cart-token-xyz";
  assert.equal(assignVariant(t, 2), assignVariant(t, 2)); // stable
  for (const token of ["a", "b", "c", "longer-token-123", ""]) {
    const v = assignVariant(token, 3);
    assert.ok(v >= 0 && v < 3);
    assert.ok(Number.isInteger(v));
  }
});

test("assignVariant spreads tokens across variants (not all in one bucket)", () => {
  const buckets = [0, 0, 0];
  for (let i = 0; i < 300; i++) buckets[assignVariant("tok" + i, 3)]++;
  // every bucket gets a meaningful share (no degenerate split)
  buckets.forEach((n) => assert.ok(n > 40));
});

test("assignVariant degenerates safely for <=1 variant", () => {
  assert.equal(assignVariant("x", 1), 0);
  assert.equal(assignVariant("x", 0), 0);
});

test("pickWinner takes the highest CTR meeting the minimum sample", () => {
  const winner = pickWinner(
    [
      { variant: 0, impressions: 100, clicks: 5 }, // 5%
      { variant: 1, impressions: 100, clicks: 12 }, // 12% ← winner
      { variant: 2, impressions: 3, clicks: 3 }, // 100% but under sample floor
    ],
    30,
  );
  assert.equal(winner, 1);
});

test("pickWinner returns null when no variant meets the sample floor", () => {
  assert.equal(
    pickWinner([{ variant: 0, impressions: 5, clicks: 1 }], 30),
    null,
  );
});
