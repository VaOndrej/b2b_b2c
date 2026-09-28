import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Task 5 brief: GET /apps/won-discounts/health (storefront) proxies to
// app/routes/won-discounts.health.tsx via shopify.app.toml [app_proxy]
// (prefix "apps" + subpath "won-discounts" -> app path /won-discounts/health,
// see https://shopify.dev/docs/apps/build/online-store/app-proxies). The
// route must authenticate the proxy request and answer a stable JSON health
// payload, never cached.
//
// Source-text assertions (not execution): authenticate.public.appProxy()
// requires a real Shopify-signed HMAC request to exercise end to end, which
// belongs to the E2E harness, not a unit test. This pins the contract that
// the loader source must uphold.

async function readRouteSource(): Promise<string> {
  return readFile(
    new URL("../../app/routes/won-discounts.health.tsx", import.meta.url),
    "utf8",
  );
}

test("app_proxy config maps /apps/won-discounts/* to the /won-discounts/* app path", async () => {
  const toml = await readFile(
    new URL("../../shopify.app.toml", import.meta.url),
    "utf8",
  );
  assert.match(toml, /\[app_proxy\]/);
  assert.match(toml, /subpath\s*=\s*"won-discounts"/);
  assert.match(toml, /prefix\s*=\s*"apps"/);
});

test("health route authenticates via authenticate.public.appProxy before responding", async () => {
  const source = await readRouteSource();
  assert.match(
    source,
    /authenticate\.public\.appProxy\(request\)/,
    "the loader must verify the app proxy request signature before answering",
  );
});

test("health route responds with the stable ok payload and no-store caching", async () => {
  const source = await readRouteSource();
  assert.match(source, /won-discounts-health-ok/);
  assert.match(source, /"Cache-Control":\s*"no-store"/);
});
