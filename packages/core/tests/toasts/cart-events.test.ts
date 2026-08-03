import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveEvents,
  isGiftLine,
  type CartSnapshot,
} from "../../src/toasts/cart-events.ts";

// SPEC (won-toasts-mvp-plan.md MVP1 / §9). Written against behaviour, not
// implementation.

function line(
  key: string,
  quantity: number,
  extra: Record<string, unknown> = {},
) {
  return { key, variantId: Number(key.replace(/\D/g, "")) || 1, quantity, ...extra };
}
function cart(...items: ReturnType<typeof line>[]): CartSnapshot {
  return { items };
}

test("adding a new line yields one 'added' event with the full quantity", () => {
  const events = deriveEvents(cart(), cart(line("a", 2)));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "added");
  assert.equal(events[0].delta, 2);
  assert.equal(events[0].quantity, 2);
});

test("removing a line yields one 'removed' event with negative delta", () => {
  const events = deriveEvents(cart(line("a", 3)), cart());
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "removed");
  assert.equal(events[0].delta, -3);
  assert.equal(events[0].quantity, 0);
});

test("increasing and decreasing quantity are distinct events", () => {
  assert.equal(deriveEvents(cart(line("a", 1)), cart(line("a", 3)))[0].type, "increased");
  assert.equal(deriveEvents(cart(line("a", 1)), cart(line("a", 3)))[0].delta, 2);
  assert.equal(deriveEvents(cart(line("a", 3)), cart(line("a", 1)))[0].type, "decreased");
  assert.equal(deriveEvents(cart(line("a", 3)), cart(line("a", 1)))[0].delta, -2);
});

test("unchanged lines produce no events", () => {
  assert.deepEqual(deriveEvents(cart(line("a", 2)), cart(line("a", 2))), []);
});

test("gift lines (_gift_progress) are never cart events, added or removed", () => {
  const gift = line("g", 1, { properties: { _gift_progress: "1" } });
  assert.equal(isGiftLine(gift), true);
  // gift appears
  assert.deepEqual(deriveEvents(cart(line("a", 1)), cart(line("a", 1), gift)), []);
  // gift disappears
  assert.deepEqual(deriveEvents(cart(line("a", 1), gift), cart(line("a", 1))), []);
});

test("multiple simultaneous changes are all reported, after-order then removed", () => {
  const before = cart(line("a", 1), line("b", 2), line("c", 1));
  const after = cart(line("a", 3), line("d", 1)); // a increased, b&c removed, d added
  const events = deriveEvents(before, after);
  const summary = events.map((e) => `${e.key}:${e.type}`);
  assert.deepEqual(summary, ["a:increased", "d:added", "b:removed", "c:removed"]);
});

test("null / empty snapshots are safe", () => {
  assert.deepEqual(deriveEvents(null, null), []);
  assert.deepEqual(deriveEvents(undefined, cart()), []);
  assert.equal(deriveEvents(cart(), cart(line("a", 1))).length, 1);
});
