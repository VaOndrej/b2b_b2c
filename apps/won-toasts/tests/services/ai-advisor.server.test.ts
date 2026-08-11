import assert from "node:assert/strict";
import { test } from "node:test";

import type { TypeContext } from "@won/core/toasts/ai-advisor-v2";
import { createAdvisorService } from "../../app/services/ai-advisor.server";

const types: Record<string, TypeContext> = {
  announcement: { metricKind: "action", goal: "clicks", ctr: 0.02, readThroughRate: 0.3, sample: 1240 },
  "stock.low": { metricKind: "informational", goal: "read_through", ctr: 0, readThroughRate: 0.7, sample: 900 },
};

function mockGenerate(response: string) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return response;
  };
  return { fn, calls: () => calls };
}

test("optimize builds context, validates LLM JSON, and returns evidence-bearing suggestions", async () => {
  const gen = mockGenerate(
    JSON.stringify({
      suggestions: [
        { action: "shorten_duration", type: "announcement", value: 2500, rationale: "high dismiss" },
        { action: "disable_rule", type: "stock.low", rationale: "0 clicks" }, // must be refused
      ],
    }),
  );
  const service = createAdvisorService({
    loadTypeContext: async () => ({ types, benchmark: {} }),
    configHash: async () => "hash-1",
    generate: gen.fn,
  });

  const result = await service.optimize("shop.myshopify.com");
  assert.equal(result.cached, false);
  assert.equal(result.suggestions.length, 1); // informational disable dropped
  assert.equal(result.suggestions[0].action, "shorten_duration");
  assert.ok(result.suggestions[0].evidence.impressions > 0);
});

test("optimize caches by config hash (no second LLM call until config changes)", async () => {
  const gen = mockGenerate(JSON.stringify({ suggestions: [] }));
  let hash = "hash-A";
  const service = createAdvisorService({
    loadTypeContext: async () => ({ types, benchmark: {} }),
    configHash: async () => hash,
    generate: gen.fn,
  });

  await service.optimize("s.myshopify.com", 1000);
  await service.optimize("s.myshopify.com", 2000); // same hash → cached
  assert.equal(gen.calls(), 1);

  hash = "hash-B"; // config changed → re-run
  await service.optimize("s.myshopify.com", 3000);
  assert.equal(gen.calls(), 2);
});

test("optimize degrades honestly when the LLM is unavailable", async () => {
  const service = createAdvisorService({
    loadTypeContext: async () => ({ types, benchmark: {} }),
    configHash: async () => "h",
    generate: async () => {
      throw new Error("no api key");
    },
  });
  const result = await service.optimize("s.myshopify.com");
  assert.equal(result.available, false);
  assert.deepEqual(result.suggestions, []);
});
