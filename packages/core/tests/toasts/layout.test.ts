import assert from "node:assert/strict";
import { test } from "node:test";

import { stackOffset } from "../../src/toasts/layout.ts";

test("stackOffset adds the tallest overlapping obstacle to the base offset", () => {
  // A 60px sticky header + a 44px cookie bar on the same (top) edge → clear the
  // taller one plus a small gap.
  const offset = stackOffset(16, [
    { edge: "top", size: 60 },
    { edge: "top", size: 44 },
  ]);
  assert.ok(offset >= 60);
});

test("stackOffset ignores obstacles on other edges", () => {
  const offset = stackOffset(16, [{ edge: "bottom", size: 80 }], "top");
  assert.equal(offset, 16);
});

test("stackOffset with no obstacles returns the base", () => {
  assert.equal(stackOffset(16, []), 16);
  assert.equal(stackOffset(16, null as unknown as []), 16);
});
