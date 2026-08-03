import assert from "node:assert/strict";
import { test } from "node:test";

import { planToastQueue } from "../../src/toasts/queue.ts";

const opts = (o: Partial<Parameters<typeof planToastQueue>[1]> = {}) => ({
  maxVisible: 3,
  stackDirection: "newest-top" as const,
  overflowStrategy: "collapse" as const,
  ...o,
});

test("caps visible toasts at maxVisible and reports overflow", () => {
  const plan = planToastQueue([1, 2, 3, 4, 5], opts({ maxVisible: 3 }));
  assert.equal(plan.visible.length, 3);
  assert.equal(plan.overflowCount, 2);
});

test("newest-top surfaces the newest event in slot 0", () => {
  const plan = planToastQueue(["old", "mid", "new"], opts({ maxVisible: 3 }));
  assert.deepEqual(plan.visible, ["new", "mid", "old"]);
});

test("newest-bottom keeps oldest-first order", () => {
  const plan = planToastQueue(
    ["old", "mid", "new"],
    opts({ stackDirection: "newest-bottom" }),
  );
  assert.deepEqual(plan.visible, ["old", "mid", "new"]);
});

test("no overflow when everything fits", () => {
  const plan = planToastQueue([1, 2], opts({ maxVisible: 3 }));
  assert.equal(plan.overflowCount, 0);
  assert.equal(plan.visible.length, 2);
});

test("degenerate maxVisible falls back to at least one", () => {
  const plan = planToastQueue([1, 2, 3], opts({ maxVisible: 0 }));
  assert.equal(plan.visible.length, 1);
  assert.equal(plan.overflowCount, 2);
});
