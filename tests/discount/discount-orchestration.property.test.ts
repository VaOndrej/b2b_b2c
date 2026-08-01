import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiscounts } from "@won/core/discount/discount.orchestrator";
import type {
  DiscountInput,
  DiscountRules,
  DiscountResolutionContext,
} from "@won/core/discount/discount.rules";

/**
 * Property-based coverage for the discount orchestrator — the most combinatorial,
 * regression-prone part of the app. Instead of hand-picked cases, we generate many
 * random discount sets (deterministically, via a seeded PRNG so failures reproduce)
 * and assert INVARIANTS that must hold for every input:
 *
 *   1. total is always in [0, 100]
 *   2. total never exceeds the configured cap (min of global/segment)
 *   3. every applied discount contributes a positive percent
 *   4. an applied discount never exceeds what it requested (caps/floors only reduce)
 *   5. the sum of applied percents equals the reported total
 *   6. with stacking off, at most one discount applies
 *   7. shuffling the input order does not change the total (order-independence)
 *
 * No Shopify products needed — this is pure core logic.
 */

// mulberry32: tiny deterministic PRNG. Seeded per-iteration so any failure prints a
// seed that reproduces the exact input set.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEGMENTS = ["B2B", "B2C"] as const;

interface GeneratedCase {
  discounts: DiscountInput[];
  rules: DiscountRules;
  context: DiscountResolutionContext;
  cap: number | null;
}

function generateCase(rng: () => number): GeneratedCase {
  const count = 1 + Math.floor(rng() * 5); // 1..5 discounts
  const discounts: DiscountInput[] = [];
  for (let i = 0; i < count; i++) {
    discounts.push({
      // Distinct, stable codes so the applied set is comparable across shuffles.
      code: `D${i}`,
      sourceId: `src-${i}`,
      percentOff: 1 + Math.floor(rng() * 90), // 1..90
      priority: Math.floor(rng() * 5), // 0..4, deliberate ties exercised
    });
  }

  const allowStacking = rng() < 0.7;
  const hasGlobalCap = rng() < 0.5;
  const hasSegmentCap = rng() < 0.5;
  const segment = SEGMENTS[Math.floor(rng() * SEGMENTS.length)];

  const globalCap = hasGlobalCap ? 5 + Math.floor(rng() * 90) : null;
  const segmentCap = hasSegmentCap ? 5 + Math.floor(rng() * 90) : null;

  const rules: DiscountRules = {
    allowStacking,
    ...(globalCap != null ? { maxCombinedPercentOff: globalCap } : {}),
    ...(segmentCap != null
      ? { segmentCaps: [{ segment, maxCombinedPercentOff: segmentCap }] }
      : {}),
  };

  // Effective cap = min of whichever caps are set (matches resolveConfiguredCap).
  let cap: number | null = null;
  if (globalCap != null && segmentCap != null) {
    cap = Math.min(globalCap, segmentCap);
  } else if (globalCap != null) {
    cap = globalCap;
  } else if (segmentCap != null) {
    cap = segmentCap;
  }

  return { discounts, rules, context: { segment }, cap };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const EPSILON = 0.011; // one rounding step of slack (roundPercent → 2 decimals)

test("discount orchestrator: invariants hold across 500 random discount sets", () => {
  for (let seed = 1; seed <= 500; seed++) {
    const rng = mulberry32(seed);
    const { discounts, rules, context, cap } = generateCase(rng);
    const result = resolveDiscounts(discounts, rules, context);
    const where = `seed=${seed}`;

    // 1. total within [0, 100]
    assert.ok(
      result.totalPercentOff >= 0 && result.totalPercentOff <= 100 + EPSILON,
      `${where}: total ${result.totalPercentOff} out of [0,100]`,
    );

    // 2. never exceeds the configured cap
    if (cap != null) {
      assert.ok(
        result.totalPercentOff <= cap + EPSILON,
        `${where}: total ${result.totalPercentOff} exceeds cap ${cap}`,
      );
    }

    const requestedByCode = new Map(
      discounts.map((d) => [d.code, d.percentOff ?? 0]),
    );
    let sumApplied = 0;
    for (const applied of result.appliedDiscounts) {
      // 3. positive contribution
      assert.ok(
        applied.appliedPercentOff > 0,
        `${where}: applied ${applied.id} has non-positive percent`,
      );
      // 4. never exceeds what was requested
      const requested = requestedByCode.get(applied.code) ?? applied.requestedPercentOff;
      assert.ok(
        applied.appliedPercentOff <= requested + EPSILON,
        `${where}: applied ${applied.id} ${applied.appliedPercentOff} > requested ${requested}`,
      );
      sumApplied += applied.appliedPercentOff;
    }

    // 5. reported total is the sum of applied percents, clamped to 100 (you cannot
    //    discount more than the whole price; the surplus is simply not reachable).
    const expectedTotal = Math.min(100, sumApplied);
    assert.ok(
      Math.abs(expectedTotal - result.totalPercentOff) <= EPSILON,
      `${where}: total=${result.totalPercentOff} != min(100, sum=${sumApplied})`,
    );

    // 6. stacking off → at most one applied
    if (!rules.allowStacking) {
      assert.ok(
        result.appliedDiscounts.length <= 1,
        `${where}: stacking off but ${result.appliedDiscounts.length} applied`,
      );
    }

    // 7. order-independence: shuffled input yields the same total
    const shuffled = shuffle(discounts, mulberry32(seed * 7919 + 1));
    const shuffledResult = resolveDiscounts(shuffled, rules, context);
    assert.ok(
      Math.abs(shuffledResult.totalPercentOff - result.totalPercentOff) <= EPSILON,
      `${where}: total not order-independent (${result.totalPercentOff} vs ${shuffledResult.totalPercentOff})`,
    );
  }
});
