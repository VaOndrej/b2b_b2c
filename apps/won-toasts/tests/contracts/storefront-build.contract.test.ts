import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ASSET, buildStorefront } from "../../scripts/build-storefront.mjs";

// Drift guard: the shipped assets/won-toasts.js must be EXACTLY the minified
// build of storefront-src/won-toasts.js. This makes the readable source the
// single source of truth — editing the source without `npm run build:storefront`,
// or hand-editing the shipped artifact, fails here. Combined with the
// theme-extension behaviour contract (which reads the source) and perf-budget
// (which reads the shipped asset), the two files can never silently diverge.
test("shipped storefront asset is exactly the minified build of the source", async () => {
  const expected: string = await buildStorefront();
  const shipped = readFileSync(ASSET, "utf8");

  assert.equal(
    shipped,
    expected,
    "assets/won-toasts.js is stale or hand-edited. Edit storefront-src/won-toasts.js " +
      "and run `npm run build:storefront`, then commit the regenerated asset.",
  );
});
