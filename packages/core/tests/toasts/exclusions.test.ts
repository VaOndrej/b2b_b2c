import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_EXCLUSIONS,
  sanitizeExclusions,
} from "../../src/toasts/exclusions.ts";

test("default exclusions are empty", () => {
  assert.deepEqual(DEFAULT_EXCLUSIONS, { pages: [], urls: [] });
});

test("sanitize keeps valid page types and trims URL patterns", () => {
  const e = sanitizeExclusions({
    pages: ["home", "cart", "bogus", "home"],
    urls: ["/checkout*", "  ", "/account/*", 42],
  });
  assert.deepEqual(e.pages, ["home", "cart"]); // deduped, junk dropped
  assert.deepEqual(e.urls, ["/checkout*", "/account/*"]);
});

test("sanitize is forgiving about bad input", () => {
  assert.deepEqual(sanitizeExclusions(null), { pages: [], urls: [] });
  assert.deepEqual(sanitizeExclusions("x"), { pages: [], urls: [] });
  assert.deepEqual(sanitizeExclusions({}), { pages: [], urls: [] });
});
