import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeMessages,
  resolveToastConfig,
  sanitizeMilestones,
} from "../../src/toasts/config.defaults.ts";

test("mergeMessages keeps defaults and applies string overrides", () => {
  const merged = mergeMessages({ added: { cs: "Přidáno!" }, bogus: { en: "x" } });
  assert.equal(merged.added?.cs, "Přidáno!");
  assert.equal(typeof merged.added?.en, "string"); // default kept
  assert.equal("bogus" in merged, false); // unknown type dropped
});

test("mergeMessages ignores empty/non-string overrides", () => {
  const merged = mergeMessages({ added: { cs: "   ", en: 42 } });
  // whitespace-only and non-string are ignored → defaults remain
  assert.notEqual(merged.added?.cs, "   ");
  assert.equal(typeof merged.added?.en, "string");
});

test("sanitizeMilestones drops malformed entries and clamps", () => {
  const rules = sanitizeMilestones([
    { id: "ship", kind: "free_shipping", enabled: true, thresholdCents: 150000, label: "ship" },
    { kind: "bogus", enabled: true },
    { kind: "gift", enabled: "yes", thresholdCents: -5 },
  ]);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].kind, "free_shipping");
  assert.equal(rules[1].kind, "gift");
  assert.equal(rules[1].enabled, false); // non-boolean coerced to false
  assert.equal(rules[1].thresholdCents, 0); // clamped up from -5
});

test("sanitizeMilestones validates per-currency thresholds", () => {
  const rules = sanitizeMilestones([
    {
      id: "ship", kind: "free_shipping", enabled: true, thresholdCents: 150000,
      label: "ship",
      thresholds: { eur: 6000, USD: "6500", GB: 1, EURO: 2, "1UR": 3, JPY: -3 },
    },
  ]);
  // eur→EUR upper-cased, USD string coerced, JPY clamped up from -3; keys that
  // aren't exactly 3 ASCII letters (GB, EURO, 1UR) are dropped.
  assert.deepEqual(rules[0].thresholds, { EUR: 6000, USD: 6500, JPY: 0 });
});

test("sanitizeMilestones omits thresholds when none valid", () => {
  const rules = sanitizeMilestones([
    { id: "s", kind: "free_shipping", enabled: true, thresholdCents: 1000, label: "s", thresholds: { XX: 1 } },
  ]);
  assert.equal("thresholds" in rules[0], false);
});

test("resolveToastConfig includes merged messages and milestones", () => {
  const c = resolveToastConfig({
    messages: { shipping: { en: "Free ship!" } },
    milestones: [
      { id: "g", kind: "gift", enabled: true, thresholdCents: 0, label: "gift" },
    ],
  });
  assert.equal(c.messages.shipping?.en, "Free ship!");
  assert.equal(c.milestones.length, 1);
});
