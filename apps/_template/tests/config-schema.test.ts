import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CONFIG,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
} from "../app/lib/config-schema";

// DATA-2: an invalid/partial/unknown-shaped config must be unrepresentable — the
// sanitizer always yields a complete, safe config, never a crash.

test("non-objects sanitize to the full default (never a crash)", () => {
  assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(sanitizeConfig("nope"), DEFAULT_CONFIG);
  assert.deepEqual(sanitizeConfig(undefined), DEFAULT_CONFIG);
});

test("partial config is default-filled; unknown keys dropped", () => {
  const out = sanitizeConfig({ enabled: true, bogus: "x" });
  assert.equal(out.enabled, true);
  assert.equal(out.label, DEFAULT_CONFIG.label);
  assert.equal(out.limit, DEFAULT_CONFIG.limit);
  assert.equal("bogus" in out, false);
});

test("out-of-range / wrong-type values are clamped or defaulted", () => {
  assert.equal(sanitizeConfig({ limit: 99999 }).limit, 1000);
  assert.equal(sanitizeConfig({ limit: -5 }).limit, 0);
  assert.equal(sanitizeConfig({ limit: "abc" }).limit, DEFAULT_CONFIG.limit);
  assert.equal(sanitizeConfig({ label: 123 }).label, "");
});

// DATA-3: a stored older/partial shape still reads back as a complete config.
test("readStoredConfig upgrades an older/partial persisted shape", () => {
  // e.g. a pre-`limit` row from an earlier schema version.
  const older = { version: 0, enabled: true, label: "Hi" };
  const cfg = readStoredConfig(older);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.label, "Hi");
  assert.equal(cfg.limit, DEFAULT_CONFIG.limit); // missing field default-filled
  assert.ok(SCHEMA_VERSION >= 1);
});
