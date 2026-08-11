import assert from "node:assert/strict";
import { test } from "node:test";

import { diagnoseSilentType } from "../../src/toasts/insights-diagnosis.ts";

test("all pages excluded → definitive Targeting cause + fix link", () => {
  const d = diagnoseSilentType({
    type: "announcement",
    label: "Announcement",
    allPagesExcluded: true,
    anyToastShown: true,
  });
  assert.match(d.message, /every page/i);
  assert.equal(d.action?.href, "/app/targeting");
});

test("nothing shown anywhere → settings fine, point to the app embed (not Targeting)", () => {
  const d = diagnoseSilentType({
    type: "cart",
    label: "Cart toasts",
    allPagesExcluded: false,
    anyToastShown: false,
  });
  assert.match(d.message, /settings look right|app embed/i);
  assert.equal(d.action?.href, "/app");
  assert.doesNotMatch(d.message, /check its triggers or targeting/i);
});

test("others firing, this one silent → set up correctly + its real trigger, no Targeting dump", () => {
  const d = diagnoseSilentType({
    type: "stock.low",
    label: "Low-stock urgency",
    allPagesExcluded: false,
    anyToastShown: true,
  });
  assert.match(d.message, /set up correctly|stock/i);
  // The whole point (merchant-review): don't send them away to investigate.
  assert.equal(d.action, undefined);
});

test("unknown type falls back to a generic honest trigger line", () => {
  const d = diagnoseSilentType({
    type: "something.new",
    label: "Something",
    allPagesExcluded: false,
    anyToastShown: true,
  });
  assert.match(d.message, /set up correctly/i);
});
