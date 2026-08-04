import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADVISOR_ACTIONS,
  buildAdvisorContext,
  parseAdvisorResponse,
  ruleBasedSuggestions,
} from "../../src/toasts/ai-advisor.ts";

test("parseAdvisorResponse accepts a well-formed suggestion array", () => {
  const json = JSON.stringify({
    suggestions: [
      { action: "disable_rule", ruleId: "stock.low", rationale: "0 clicks in 2 weeks" },
      { action: "shorten_duration", ruleId: "countdown", rationale: "long dwell", value: 2500 },
    ],
  });
  const out = parseAdvisorResponse(json);
  assert.equal(out.length, 2);
  assert.equal(out[0].action, "disable_rule");
  assert.equal(out[1].value, 2500);
});

test("parseAdvisorResponse drops unknown actions and malformed entries", () => {
  const json = JSON.stringify({
    suggestions: [
      { action: "launch_missiles", ruleId: "x", rationale: "no" }, // unknown
      { action: "move_position", rationale: "" }, // missing rationale
      { action: "enable_rule", ruleId: "gift", rationale: "high intent" }, // ok
      42,
    ],
  });
  const out = parseAdvisorResponse(json);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "enable_rule");
});

test("parseAdvisorResponse rejects non-JSON / wrong shape without throwing", () => {
  assert.deepEqual(parseAdvisorResponse("not json"), []);
  assert.deepEqual(parseAdvisorResponse("[]"), []);
  assert.deepEqual(parseAdvisorResponse(JSON.stringify({ suggestions: "x" })), []);
});

test("every known action is covered by the allow-list", () => {
  assert.ok(ADVISOR_ACTIONS.includes("disable_rule"));
  assert.ok(ADVISOR_ACTIONS.includes("shorten_duration"));
  assert.ok(ADVISOR_ACTIONS.includes("move_position"));
});

test("ruleBasedSuggestions (deterministic fallback) flags a zero-CTR rule", () => {
  const suggestions = ruleBasedSuggestions({
    "stock.low": { impressions: 200, clicks: 0, dismisses: 40, undos: 0 },
    "countdown": { impressions: 100, clicks: 20, dismisses: 2, undos: 0 },
  });
  // the 0-CTR high-impression rule should be recommended for disable
  const disable = suggestions.find((s) => s.action === "disable_rule");
  assert.ok(disable);
  assert.equal(disable.ruleId, "stock.low");
});

test("buildAdvisorContext produces a compact JSON metrics summary string", () => {
  const ctx = buildAdvisorContext({
    "countdown": { impressions: 10, clicks: 1, dismisses: 0, undos: 0 },
  });
  assert.ok(typeof ctx === "string");
  assert.ok(ctx.includes("countdown"));
});
