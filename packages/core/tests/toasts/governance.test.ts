import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emptyGovernanceState,
  governanceOK,
  recordDismiss,
  recordEmit,
  setQuietMode,
} from "../../src/toasts/governance.ts";

test("maxPerSession: the N+1-th emit in a session is suppressed", () => {
  const rule = { key: "countdown", maxPerSession: 2 };
  let s = emptyGovernanceState();

  assert.equal(governanceOK(s, rule, "g", 0), true);
  s = recordEmit(s, rule, 0);
  assert.equal(governanceOK(s, rule, "g", 1), true);
  s = recordEmit(s, rule, 1);
  // two shown; the third is suppressed (not 5, not 3)
  assert.equal(governanceOK(s, rule, "g", 2), false);
});

test("suppressAfterDismiss: same groupKey stays hidden within the window", () => {
  const rule = { key: "promo", suppressAfterDismissMs: 5000 };
  let s = recordDismiss(emptyGovernanceState(), "g1", 100);

  assert.equal(governanceOK(s, rule, "g1", 200), false); // within window
  assert.equal(governanceOK(s, rule, "g1", 5200), true); // window elapsed
  assert.equal(governanceOK(s, rule, "g2", 200), true); // other group unaffected
});

test("quiet mode mutes everything (zero emits) until it expires", () => {
  const rule = { key: "any" };
  const s = setQuietMode(emptyGovernanceState(), 1000);

  assert.equal(governanceOK(s, rule, "g", 500), false);
  assert.equal(governanceOK(s, rule, "g", 999), false);
  assert.equal(governanceOK(s, rule, "g", 1000), true); // no longer before quietUntil
});

test("per-rule cooldown blocks re-emit within the interval", () => {
  const rule = { key: "stock", cooldownMs: 2000 };
  const s = recordEmit(emptyGovernanceState(), rule, 1000);

  assert.equal(governanceOK(s, rule, "g", 1500), false); // 500ms < 2000
  assert.equal(governanceOK(s, rule, "g", 3000), true); // 2000ms >= 2000
});

test("emptyGovernanceState allows a first emit and mutators are pure", () => {
  const rule = { key: "x", maxPerSession: 1 };
  const s0 = emptyGovernanceState();
  const s1 = recordEmit(s0, rule, 0);
  // original state untouched (pure)
  assert.equal(governanceOK(s0, rule, "g", 0), true);
  assert.equal(governanceOK(s1, rule, "g", 0), false);
});
