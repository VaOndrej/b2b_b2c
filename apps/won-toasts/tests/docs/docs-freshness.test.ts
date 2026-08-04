import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDocs } from "../../scripts/gen-docs.ts";

// Drift guard for the support knowledge base. The reference docs the support
// chatbot consumes are GENERATED from @won/core/toasts (plan limits, event
// types, config option values). This test regenerates them in memory and
// compares against the committed files. If a core enum changes but nobody ran
// `npm run docs:gen -w won-toasts`, the docs would silently lie to merchants —
// so this fails the gate instead. Fix: run the generator and commit the diff.

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs",
);

const expected = buildDocs();

for (const [rel, content] of Object.entries(expected)) {
  test(`generated doc is up to date: ${rel}`, async () => {
    let committed: string;
    try {
      committed = await readFile(path.join(docsRoot, rel), "utf8");
    } catch {
      assert.fail(
        `Missing generated doc ${rel}. Run: npm run docs:gen -w won-toasts`,
      );
    }
    assert.equal(
      committed,
      content,
      `${rel} is stale. A @won/core/toasts enum changed without regenerating docs. ` +
        `Run: npm run docs:gen -w won-toasts (and commit the result).`,
    );
  });
}
