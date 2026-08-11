import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADVISOR_ACTIONS,
  buildAdvisorContext,
  parseAdvisorResponse,
  autoPilotAllows,
  suggestionToOverlay,
  SAFE_AUTOPILOT_LEVERS,
  type TypeContext,
} from "../../src/toasts/ai-advisor-v2.ts";

const typeInfo: Record<string, TypeContext> = {
  announcement: { metricKind: "action", goal: "clicks", ctr: 0.02, readThroughRate: 0.3, sample: 1240 },
  "stock.low": { metricKind: "informational", goal: "read_through", ctr: 0.0, readThroughRate: 0.7, sample: 900 },
  cart: { metricKind: "cart", goal: "aov", ctr: 0.0, readThroughRate: 0.6, sample: 500 },
};

test("buildAdvisorContext embeds per-type metrics + honest framing (no CTR-for-informational)", () => {
  const ctx = buildAdvisorContext({
    types: typeInfo,
    benchmark: { "stock.low": { readRateP50: 0.4 } },
  });
  assert.match(ctx, /stock\.low/);
  assert.match(ctx, /read_through/);
  // informational types are described by read-through, not clicks
  assert.match(ctx, /informational/);
});

test("parseAdvisorResponse validates the JSON schema and drops unknown actions", () => {
  const json = JSON.stringify({
    suggestions: [
      { action: "shorten_duration", type: "announcement", value: 2500, rationale: "high dismiss", evidence: { impressions: 1240 } },
      { action: "delete_everything", type: "cart", rationale: "nope" },
      { action: "move_position", rationale: "" }, // no rationale → dropped
    ],
  });
  const out = parseAdvisorResponse(json, typeInfo);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "shorten_duration");
});

test("every surviving suggestion carries evidence (explainability, no black box)", () => {
  const json = JSON.stringify({
    suggestions: [{ action: "move_position", type: "announcement", value: "bottom-right", rationale: "better visibility" }],
  });
  const out = parseAdvisorResponse(json, typeInfo);
  assert.equal(out.length, 1);
  assert.ok(out[0].evidence);
  assert.equal(out[0].evidence.impressions, 1240); // synthesized from context
  assert.equal(out[0].evidence.metricKind, "action");
});

test("NEVER suggests disabling an informational toast for low/zero CTR", () => {
  const json = JSON.stringify({
    suggestions: [
      { action: "disable_rule", type: "stock.low", rationale: "0 clicks, no value", evidence: { impressions: 900 } },
    ],
  });
  const out = parseAdvisorResponse(json, typeInfo);
  // stock.low reads through 70% — disabling it on CTR grounds is the exact
  // premise error the advisor must refuse.
  assert.equal(out.length, 0);
});

test("MAY disable an informational toast when read-through is genuinely dead", () => {
  const deadInfo: Record<string, TypeContext> = {
    "stock.low": { metricKind: "informational", goal: "read_through", ctr: 0, readThroughRate: 0.02, sample: 900 },
  };
  const json = JSON.stringify({
    suggestions: [{ action: "disable_rule", type: "stock.low", rationale: "almost nobody reads it", evidence: { impressions: 900 } }],
  });
  const out = parseAdvisorResponse(json, deadInfo);
  assert.equal(out.length, 1);
});

test("invalid JSON yields [] (never throws)", () => {
  assert.deepEqual(parseAdvisorResponse("{not json", typeInfo), []);
  assert.deepEqual(parseAdvisorResponse("", typeInfo), []);
});

// --- auto-pilot ---

test("SAFE_AUTOPILOT_LEVERS excludes enabling/disabling rules", () => {
  assert.ok(!SAFE_AUTOPILOT_LEVERS.includes("disable_rule" as never));
  assert.ok(!SAFE_AUTOPILOT_LEVERS.includes("enable_rule" as never));
  assert.ok(SAFE_AUTOPILOT_LEVERS.includes("shorten_duration"));
});

test("auto-pilot only fires safe levers, respects the daily cap, and is off by default", () => {
  const shorten = { action: "shorten_duration" as const, type: "announcement", rationale: "x", evidence: { impressions: 1, metricKind: "action", goal: "clicks" } };
  const disable = { action: "disable_rule" as const, type: "stock.low", rationale: "x", evidence: { impressions: 1, metricKind: "informational", goal: "read_through" } };

  // off → nothing
  assert.equal(autoPilotAllows({ enabled: false, dailyCap: 1 }, shorten, { experimentsToday: 0 }), false);
  // on, safe lever, under cap → allowed
  assert.equal(autoPilotAllows({ enabled: true, dailyCap: 1 }, shorten, { experimentsToday: 0 }), true);
  // on, but disable_rule is not a safe lever → blocked
  assert.equal(autoPilotAllows({ enabled: true, dailyCap: 1 }, disable, { experimentsToday: 0 }), false);
  // on, safe lever, but cap reached → blocked
  assert.equal(autoPilotAllows({ enabled: true, dailyCap: 1 }, shorten, { experimentsToday: 1 }), false);
});

test("suggestionToOverlay maps safe levers to a config overlay for A/B testing", () => {
  assert.deepEqual(
    suggestionToOverlay({ action: "shorten_duration", type: "announcement", value: 2500, rationale: "x", evidence: { impressions: 1, metricKind: "action", goal: "clicks" } }),
    { byType: { announcement: { behavior: { durationMs: 2500 } } } },
  );
  assert.deepEqual(
    suggestionToOverlay({ action: "move_position", value: "bottom-right", rationale: "x", evidence: { impressions: 1, metricKind: "action", goal: "clicks" } }),
    { global: { position: "bottom-right" } },
  );
  assert.deepEqual(
    suggestionToOverlay({ action: "change_cooldown", value: 60000, rationale: "x", evidence: { impressions: 1, metricKind: "action", goal: "clicks" } }),
    { global: { frequency: { cooldownMs: 60000 } } },
  );
});

test("suggestionToOverlay returns null for actions with no safe config mapping", () => {
  assert.equal(
    suggestionToOverlay({ action: "disable_rule", type: "x", rationale: "x", evidence: { impressions: 1, metricKind: "informational", goal: "read_through" } }),
    null,
  );
  assert.equal(
    suggestionToOverlay({ action: "change_goal", rationale: "x", evidence: { impressions: 1, metricKind: "action", goal: "clicks" } }),
    null,
  );
});

test("ADVISOR_ACTIONS is the closed vocabulary", () => {
  assert.ok(ADVISOR_ACTIONS.includes("shorten_duration"));
  assert.ok(ADVISOR_ACTIONS.includes("change_goal"));
});
