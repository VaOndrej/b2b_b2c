import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveToasts, type ToastCandidate } from "../../src/toasts/conflict.ts";

const c = (
  id: string,
  severity: ToastCandidate["severity"],
  priority = 0,
  summaryLabel?: string,
): ToastCandidate => ({ id, severity, priority, summaryLabel });

test("orders by severity then priority", () => {
  const { toasts } = resolveToasts(
    [c("a", "info", 5), c("b", "warning", 0), c("c", "success", 9)],
    { summarizeConcurrent: false },
  );
  assert.deepEqual(
    toasts.map((t) => t.id),
    ["b", "c", "a"],
  );
});

test("two+ reward milestones collapse into one summary when enabled", () => {
  const { toasts, summary } = resolveToasts(
    [
      c("add", "success", 1),
      c("ship", "reward", 2, "free shipping"),
      c("gift", "reward", 3, "a gift"),
    ],
    { summarizeConcurrent: true },
  );
  assert.ok(summary);
  assert.deepEqual(summary?.labels, ["a gift", "free shipping"]);
  // one summary toast replaces the two rewards; the success toast remains
  const ids = toasts.map((t) => t.id);
  assert.equal(ids.includes("summary"), true);
  assert.equal(ids.includes("ship"), false);
  assert.equal(ids.includes("gift"), false);
  assert.equal(ids.includes("add"), true);
});

test("a single reward is not summarised", () => {
  const { toasts, summary } = resolveToasts(
    [c("add", "success", 1), c("ship", "reward", 2)],
    { summarizeConcurrent: true },
  );
  assert.equal(summary, undefined);
  assert.equal(toasts.length, 2);
});

test("summarizeConcurrent off keeps rewards separate", () => {
  const { summary, toasts } = resolveToasts(
    [c("ship", "reward", 2), c("gift", "reward", 3)],
    { summarizeConcurrent: false },
  );
  assert.equal(summary, undefined);
  assert.equal(toasts.length, 2);
});
