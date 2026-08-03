import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cartMilestoneState,
  eligibleSubtotalCents,
  evaluateMilestones,
  type MilestoneRule,
} from "../../src/toasts/milestone-rules.ts";
import type { CartSnapshot } from "../../src/toasts/cart-events.ts";

function cart(...lines: Array<Partial<CartSnapshot["items"][number]>>): CartSnapshot {
  return {
    items: lines.map((l, i) => ({
      key: l.key ?? `k${i}`,
      variantId: l.variantId ?? i + 1,
      quantity: l.quantity ?? 1,
      linePrice: l.linePrice ?? 0,
      properties: l.properties ?? null,
    })),
  };
}

const ship: MilestoneRule = {
  id: "ship",
  kind: "free_shipping",
  enabled: true,
  thresholdCents: 150000,
  label: "free shipping",
};
const gift: MilestoneRule = {
  id: "gift",
  kind: "gift",
  enabled: true,
  thresholdCents: 0,
  label: "a gift",
};

test("eligible subtotal excludes gift lines", () => {
  const c = cart(
    { linePrice: 100000 },
    { linePrice: 50000 },
    { linePrice: 9900, properties: { _gift_progress: "1" } },
  );
  assert.equal(eligibleSubtotalCents(c), 150000);
});

test("free shipping fires just_reached only on the crossing", () => {
  const before = cartMilestoneState(cart({ linePrice: 140000 }));
  const after = cartMilestoneState(cart({ linePrice: 150000 }));
  const events = evaluateMilestones(before, after, [ship]);
  assert.equal(events[0].state, "just_reached");
  assert.equal(events[0].remaining, 0);

  // staying above → reached (not re-announced by the caller)
  const stay = cartMilestoneState(cart({ linePrice: 160000 }));
  assert.equal(evaluateMilestones(after, stay, [ship])[0].state, "reached");
});

test("free shipping approaching reports remaining", () => {
  const before = cartMilestoneState(cart({ linePrice: 0 }));
  const after = cartMilestoneState(cart({ linePrice: 130000 }));
  const e = evaluateMilestones(before, after, [ship])[0];
  assert.equal(e.state, "approaching");
  assert.equal(e.remaining, 20000);
});

test("gift unlocks when a GiftLadder line appears", () => {
  const before = cartMilestoneState(cart({ linePrice: 200000 }));
  const after = cartMilestoneState(
    cart({ linePrice: 200000 }, { properties: { _gift_progress: "1" } }),
  );
  assert.equal(evaluateMilestones(before, after, [gift])[0].state, "just_reached");

  // gift removed → just_lost
  assert.equal(evaluateMilestones(after, before, [gift])[0].state, "just_lost");
});

test("disabled rules are skipped", () => {
  assert.deepEqual(
    evaluateMilestones(
      cartMilestoneState(cart({ linePrice: 0 })),
      cartMilestoneState(cart({ linePrice: 200000 })),
      [{ ...ship, enabled: false }],
    ),
    [],
  );
});
