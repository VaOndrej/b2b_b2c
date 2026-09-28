import assert from "node:assert/strict";
import { test } from "node:test";

import { loader } from "@won/app-kit/root";

// PERF-1: the shared root loader is what feeds the App Bridge <script> in <head>
// (so Shopify can measure admin Web Vitals). Verify it surfaces the public API key
// server-side, and degrades to an empty string (renders no script) when unset —
// never throwing, which would white-screen every app's document.

test("root loader returns the configured API key", () => {
  const prev = process.env.SHOPIFY_API_KEY;
  try {
    process.env.SHOPIFY_API_KEY = "test-key-123";
    assert.deepEqual(loader(), { apiKey: "test-key-123" });
  } finally {
    if (prev === undefined) delete process.env.SHOPIFY_API_KEY;
    else process.env.SHOPIFY_API_KEY = prev;
  }
});

test("root loader degrades to an empty key (no script) when unset — never throws", () => {
  const prev = process.env.SHOPIFY_API_KEY;
  try {
    delete process.env.SHOPIFY_API_KEY;
    assert.deepEqual(loader(), { apiKey: "" });
  } finally {
    if (prev !== undefined) process.env.SHOPIFY_API_KEY = prev;
  }
});
