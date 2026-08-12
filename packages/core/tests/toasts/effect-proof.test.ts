import assert from "node:assert/strict";
import { test } from "node:test";

import { capProof } from "../../src/toasts/effect-proof.ts";

// The Cap "Effect Proof" must show the SAME truth the storefront enforces:
// `maxPer > 0` gates, so 0 (or negative) means "no limit" — every toast shows.
test("capProof: 0 means no limit — all shown, none quiet", () => {
  const p = capProof(0, 6);
  assert.equal(p.unlimited, true);
  assert.equal(p.shown, 6);
  assert.equal(p.quiet, 0);
});

test("capProof: a cap below the burst shows N and quiets the rest", () => {
  const p = capProof(3, 6);
  assert.equal(p.unlimited, false);
  assert.equal(p.shown, 3);
  assert.equal(p.quiet, 3); // 6 - 3
});

test("capProof: a cap at or above the burst shows everything, quiets none", () => {
  const atBurst = capProof(6, 6);
  assert.deepEqual(atBurst, { unlimited: false, shown: 6, quiet: 0 });

  const aboveBurst = capProof(10, 6);
  assert.deepEqual(aboveBurst, { unlimited: false, shown: 6, quiet: 0 });
});

test("capProof: a negative cap is treated as no limit (never negative shown)", () => {
  const p = capProof(-1, 6);
  assert.equal(p.unlimited, true);
  assert.equal(p.shown, 6);
  assert.equal(p.quiet, 0);
});

test("capProof: a cap of 1 shows a single toast and quiets the rest", () => {
  const p = capProof(1, 6);
  assert.deepEqual(p, { unlimited: false, shown: 1, quiet: 5 });
});
