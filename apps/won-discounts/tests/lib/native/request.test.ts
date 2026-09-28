import assert from "node:assert/strict";
import { test } from "node:test";

import { runGql } from "../../../app/lib/native/request.server.ts";
import type { AdminClient } from "../../../app/lib/native/types.ts";

// API-3 / REL-2: what is retried and what never is.

function scripted(steps: (() => Promise<{ data?: unknown; errors?: unknown }>)[]): AdminClient & { calls: number } {
  const client = {
    calls: 0,
    async graphql() {
      const step = steps[Math.min(client.calls, steps.length - 1)];
      client.calls += 1;
      return step();
    },
  };
  return client;
}

const httpError = (status: number, retryAfterMs: number | null = null) =>
  Object.assign(new Error(`HTTP ${status}`), { status, retryAfterMs });

test("HTTP 429 is throttling: even a mutation is resent, after the server's Retry-After", async () => {
  const client = scripted([() => Promise.reject(httpError(429, 1500)), () => Promise.resolve({ data: { ok: 1 } })]);
  const waits: number[] = [];
  const result = await runGql(client, "codeDelete", { id: "x" }, { sleep: async (ms) => void waits.push(ms) });
  assert.deepEqual(result, { ok: true, data: { ok: 1 } });
  assert.deepEqual(waits, [1500]);
});

test("a transport failure of a mutation is never resent blindly (it may have landed)", async () => {
  const client = scripted([() => Promise.reject(new Error("socket hang up")), () => Promise.resolve({ data: {} })]);
  const result = await runGql(client, "codeDelete", { id: "x" }, { sleep: async () => {} });
  assert.deepEqual(result, { ok: false, kind: "transport", message: "socket hang up" });
  assert.equal(client.calls, 1);
});

test("a transport failure of a read is retried with exponential backoff, bounded", async () => {
  const client = scripted([() => Promise.reject(httpError(503))]);
  const waits: number[] = [];
  const result = await runGql(client, "shop", undefined, { sleep: async (ms) => void waits.push(ms), backoffMs: 10, maxAttempts: 3 });
  assert.equal(result.ok, false);
  assert.equal(client.calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test("a GraphQL error is an answer, not retried", async () => {
  const client = scripted([() => Promise.resolve({ errors: [{ message: "Field 'x' doesn't exist" }] })]);
  const result = await runGql(client, "shop", undefined, { sleep: async () => {} });
  assert.deepEqual(result, { ok: false, kind: "graphql", message: "Field 'x' doesn't exist" });
  assert.equal(client.calls, 1);
});
