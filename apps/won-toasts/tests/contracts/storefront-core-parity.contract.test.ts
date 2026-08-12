import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { hashToken } from "@won/core/toasts/experiments";
import { inHoldout, assignArm } from "@won/core/toasts/experiment-engine";

// DATA-4 (down payment): the storefront JS hand-mirrors ~1900 lines of @won/core.
// The highest-drift-risk piece is the deterministic A/B assignment — if the mirror
// and core disagree on the hash or the salts, the admin preview and the storefront
// split visitors differently and the whole experiment is invalid. This is a
// framework-free drift guard: it pins core's assignment (golden vectors) AND
// asserts the storefront mirror still uses the SAME FNV constant + salts.
//
// NOTE: this does not execute the storefront IIFE. Full behavioural parity of the
// mirror still needs the E2E harness — see the storefront E2E gap (TEST-3).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_SRC = readFileSync(
  path.join(HERE, "../../storefront-src/won-toasts.js"),
  "utf8",
);

test("core A/B assignment is pinned by golden vectors", () => {
  // Frozen expectations — a change here is a deliberate assignment change that
  // MUST be mirrored into the storefront in the same commit.
  assert.equal(hashToken("arm:cart-abc") % 100, 54);
  assert.equal(assignArm("cart-abc", 60), "variant"); // 54 < 60
  assert.equal(assignArm("cart-abc", 50), "control"); // 54 >= 50
  assert.equal(assignArm("cart-abc", 1), "control");
  assert.equal(inHoldout("cart-abc", 0), false);
  assert.equal(inHoldout("cart-abc", 100), true);
});

test("storefront mirror uses the SAME FNV hash as core", () => {
  // FNV-1a 32-bit offset basis + the shift-based prime multiply, byte-identical.
  assert.ok(STOREFRONT_SRC.includes("0x811c9dc5"), "mirror must use the same FNV offset");
  assert.ok(
    STOREFRONT_SRC.includes("(h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)"),
    "mirror must use the same FNV prime multiply",
  );
});

test("storefront mirror uses the SAME experiment salts as core", () => {
  // If either salt is renamed on one side, holdout/arm splits silently diverge.
  assert.ok(STOREFRONT_SRC.includes('"holdout:"'), "mirror must use the holdout: salt");
  assert.ok(STOREFRONT_SRC.includes('"arm:"'), "mirror must use the arm: salt");
});
