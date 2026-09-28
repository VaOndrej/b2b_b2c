import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Task 5 brief: the dev-only admin harness (app/routes/dev.preview.$.tsx) lets
// us screenshot admin screens without logging into Shopify admin, but must
// NEVER exist in a production build. Two independent guards, both proven here:
//
//   1. RUNTIME: the loader 404s when NODE_ENV === "production" (defence in
//      depth — proven directly below, no build needed).
//   2. BUILD-TIME: app/routes.ts drops the route file from the manifest in a
//      production build, so the harness module never reaches build/server/**
//      at all (proven by actually building and grepping the output).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../../"); // apps/won-discounts

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

test("dev harness loader returns 404 when NODE_ENV=production (runtime guard)", async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevHarnessFlag = process.env.WON_DEV_HARNESS;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.WON_DEV_HARNESS;

    // Cache-bust: dev-harness.server.ts reads process.env at call time (not
    // import time), so a fresh import isn't required, but importing here
    // (rather than at module top-level) keeps the env mutation scoped to
    // this test.
    const routeModule = await import("../../app/routes/dev.preview.$.tsx");

    assert.throws(
      () => routeModule.loader(),
      (err: unknown) => err instanceof Response && err.status === 404,
      "loader must throw a 404 Response when NODE_ENV=production",
    );
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevHarnessFlag !== undefined) process.env.WON_DEV_HARNESS = prevHarnessFlag;
  }
});

test("production build excludes the dev harness route from build/server (build-time guard)", () => {
  execFileSync("npm", ["run", "build"], {
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "pipe",
  });

  const serverDir = path.join(APP_ROOT, "build", "server");
  const files = listFiles(serverDir);
  assert.ok(files.length > 0, "expected build/server to contain built files");

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    assert.doesNotMatch(
      contents,
      /dev\.preview/,
      `${path.relative(APP_ROOT, file)} must not reference the dev.preview harness route`,
    );
    assert.doesNotMatch(
      contents,
      /Přehled v0 \(dev harness\)/,
      `${path.relative(APP_ROOT, file)} must not contain the dev harness page heading`,
    );
    assert.doesNotMatch(
      contents,
      /DEV_OVERVIEW_FIXTURE|dev-fixture-1/,
      `${path.relative(APP_ROOT, file)} must not contain the dev harness fixture data`,
    );
  }
});
