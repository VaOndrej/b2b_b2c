import assert from "node:assert/strict";
import { test } from "node:test";

import { groupEvents } from "../../src/toasts/grouping.ts";
import { DEFAULT_GROUPING } from "../../src/toasts/config.defaults.ts";
import type { ToastCartEvent } from "../../src/toasts/cart-events.ts";

function ev(
  type: ToastCartEvent["type"],
  delta: number,
  variantId: number,
  productId?: number,
): ToastCartEvent {
  return {
    type,
    key: `${variantId}:${type}:${delta}`,
    variantId,
    delta,
    quantity: Math.max(0, delta),
    line: { key: `${variantId}`, variantId, quantity: Math.max(0, delta), productId },
  };
}

test("by-product merges same-product events into one +N group", () => {
  const groups = groupEvents(
    [ev("added", 1, 1, 100), ev("increased", 1, 1, 100), ev("increased", 1, 1, 100)],
    { ...DEFAULT_GROUPING, mode: "by-product" },
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].totalDelta, 3);
});

test("by-type collapses many products of the same type", () => {
  const groups = groupEvents(
    [ev("added", 1, 1, 100), ev("added", 1, 2, 200)],
    { ...DEFAULT_GROUPING, mode: "by-type" },
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "added");
  assert.equal(groups[0].count, 2);
});

test("mixed types in a group are marked 'mixed'", () => {
  const groups = groupEvents(
    [ev("added", 2, 1, 100), ev("removed", -1, 1, 100)],
    { ...DEFAULT_GROUPING, mode: "by-product" },
  );
  assert.equal(groups[0].type, "mixed");
  assert.equal(groups[0].totalDelta, 1);
});

test("mode off (or mergeDeltas off) keeps every event separate", () => {
  const events = [ev("added", 1, 1, 100), ev("increased", 1, 1, 100)];
  assert.equal(groupEvents(events, { ...DEFAULT_GROUPING, mode: "off" }).length, 2);
  assert.equal(
    groupEvents(events, { ...DEFAULT_GROUPING, mode: "by-product", mergeDeltas: false })
      .length,
    2,
  );
});

test("group order follows first appearance", () => {
  const groups = groupEvents(
    [ev("added", 1, 2, 200), ev("added", 1, 1, 100), ev("increased", 1, 2, 200)],
    { ...DEFAULT_GROUPING, mode: "by-product" },
  );
  assert.deepEqual(
    groups.map((g) => g.key),
    ["product:200", "product:100"],
  );
});
