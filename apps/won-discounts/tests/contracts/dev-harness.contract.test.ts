import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { withBuildLock } from "../lib/build-lock.ts";

// Task 5 brief: the dev-only admin harness (app/routes/dev.preview.$.tsx) lets
// us screenshot admin screens without logging into Shopify admin, but must
// NEVER exist outside development/test. Two independent guards, both proven here:
//
//   1. RUNTIME: the loader 404s unless NODE_ENV is exactly "development" or
//      "test" (allowlist, audit P3-5 — "staging", unset, anything else = off).
//   2. BUILD-TIME: app/routes.ts drops the route file from the manifest under
//      the same allowlist, so the harness module never reaches build/server/**
//      (proven by the route manifest per NODE_ENV and by actually building).
//
// And (audit P2-5) the harness renders the REAL Přehled screen: the same
// OverviewScreen component app._index.tsx renders, fed by a fixture config.

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

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// dev-harness.server.ts reads process.env at call time (not import time), so the
// env only has to be set around the loader call.
const harnessRoute = () => import("../../app/routes/dev.preview.$.tsx");
const harnessRequest = (query = "") =>
  ({ request: new Request(`http://localhost/dev/preview/overview${query}`), params: {}, context: {} }) as never;

for (const nodeEnv of ["production", "staging", "preview", "", undefined]) {
  test(`runtime guard: loader returns 404 when NODE_ENV=${JSON.stringify(nodeEnv)}`, async () => {
    const routeModule = await harnessRoute();
    await withEnv({ NODE_ENV: nodeEnv, WON_DEV_HARNESS: undefined }, () => {
      assert.throws(
        () => routeModule.loader(harnessRequest()),
        (err: unknown) => err instanceof Response && err.status === 404,
        `loader must throw a 404 Response when NODE_ENV=${JSON.stringify(nodeEnv)}`,
      );
    });
  });
}

test("runtime guard: WON_DEV_HARNESS=0 turns the harness off even in development", async () => {
  const routeModule = await harnessRoute();
  await withEnv({ NODE_ENV: "development", WON_DEV_HARNESS: "0" }, () => {
    assert.throws(
      () => routeModule.loader(harnessRequest()),
      (err: unknown) => err instanceof Response && err.status === 404,
    );
  });
});

test("harness serves the real Přehled props, built from a fixture WonDiscountsConfig (development, test)", async () => {
  const routeModule = await harnessRoute();
  const { DEV_OVERVIEW_FIXTURE } = await import("../../app/lib/dev-harness.server.ts");
  const { buildOverviewProps } = await import("../../app/components/screens/OverviewScreen.tsx");
  const { DEFAULT_CONFIG } = await import("@won/core/discounts/config");

  // The fixture is a real config: the defaults plus a couple of rules.
  assert.deepEqual(DEV_OVERVIEW_FIXTURE.engine, DEFAULT_CONFIG.engine);
  assert.ok(DEV_OVERVIEW_FIXTURE.modules.codes.rules.length >= 2);

  for (const nodeEnv of ["development", "test"]) {
    await withEnv({ NODE_ENV: nodeEnv, WON_DEV_HARNESS: undefined }, () => {
      assert.deepEqual(routeModule.loader(harnessRequest()), buildOverviewProps(DEV_OVERVIEW_FIXTURE, { readOnly: false }));
      assert.deepEqual(
        routeModule.loader(harnessRequest("?readOnly=1")),
        buildOverviewProps(DEV_OVERVIEW_FIXTURE, { readOnly: true }),
      );
    });
  }
});

test("app._index.tsx and the harness render the same OverviewScreen component; the fictional list is gone", () => {
  const index = readFileSync(path.join(APP_ROOT, "app/routes/app._index.tsx"), "utf8");
  const harness = readFileSync(path.join(APP_ROOT, "app/routes/dev.preview.$.tsx"), "utf8");
  const harnessLib = readFileSync(path.join(APP_ROOT, "app/lib/dev-harness.server.ts"), "utf8");
  for (const [name, source] of [
    ["app._index.tsx", index],
    ["dev.preview.$.tsx", harness],
  ] as const) {
    assert.match(source, /from "\.\.\/components\/screens\/OverviewScreen"/, `${name} must import OverviewScreen`);
    assert.match(source, /<OverviewScreen \{\.\.\.\w+\} \/>/, `${name} must render <OverviewScreen {...props} />`);
    assert.match(source, /buildOverviewProps\(/, `${name} must build its props with buildOverviewProps`);
  }
  for (const gone of ["statusLabel", "typeLabel", "DevDiscountStatus", "Naplánovaná"]) {
    assert.ok(!harness.includes(gone) && !harnessLib.includes(gone), `fictional harness list leftover: ${gone}`);
  }
  // The harness never touches the database or Shopify auth (audit P3-5).
  for (const source of [harness, harnessLib]) {
    assert.doesNotMatch(source, /db\.server|shopify\.server|PrismaClient/);
  }
});

test("OverviewScreen renders the Přehled status with Czech plurals and the read-only banner", async () => {
  const { OverviewScreen } = await import("../../app/components/screens/OverviewScreen.tsx");
  const render = (ruleCount: number, readOnly = false) =>
    renderToStaticMarkup(createElement(OverviewScreen, { schemaVersion: 1, ruleCount, readOnly }));

  assert.match(render(0), /verze 1 · 0 pravidel/);
  assert.match(render(1), /1 pravidlo</);
  assert.match(render(2), /2 pravidla</);
  assert.match(render(5), /5 pravidel</);
  assert.match(render(2), /<s-page heading="Won Discounts">/);
  assert.doesNotMatch(render(2), /s-banner/);
  assert.match(render(2, true), /<s-banner tone="warning"/);
});

function routeManifest(nodeEnv: string): string {
  return execFileSync("npx", ["react-router", "routes", "--json"], {
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: nodeEnv },
    stdio: "pipe",
    encoding: "utf8",
  });
}

test("build-time guard: the route manifest includes the harness only for NODE_ENV development/test", () => {
  for (const nodeEnv of ["development", "test"]) {
    assert.match(routeManifest(nodeEnv), /"file": "routes\/dev\.preview\.\$\.tsx"/, `NODE_ENV=${nodeEnv}`);
  }
  for (const nodeEnv of ["production", "staging", "preview"]) {
    assert.doesNotMatch(routeManifest(nodeEnv), /dev\.preview/, `NODE_ENV=${nodeEnv} must exclude the harness`);
  }
});

test("production build excludes the dev harness route from build/server (build-time guard)", { timeout: 20 * 60_000 }, async () => {
  // `npm run build` also rebuilds extensions/…/dist/function.wasm, which
  // function.contract runs its fixtures against: build under the shared lock
  // (audit P3-6).
  await withBuildLock(() =>
    execFileSync("npm", ["run", "build"], {
      cwd: APP_ROOT,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    }),
  );

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
      /DEV_OVERVIEW_FIXTURE|dev-fixture-1/,
      `${path.relative(APP_ROOT, file)} must not contain the dev harness fixture data`,
    );
  }
});
