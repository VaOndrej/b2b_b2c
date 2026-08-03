import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// SPEC-DRIVEN contract for the Won Toasts storefront surface. Encodes the
// invariants from won-toasts-mvp-plan.md (§0 principles, MVP0): the extension
// is a pure notification surface (no price/cart mutation), it mounts a
// Shadow-DOM <won-toast-host>, and the app owns an authenticated app-proxy that
// serves the config. If any later MVP breaks these, this fails.

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const extensionRoot = path.join(appRoot, "extensions/won-toasts-storefront");

async function readExtension(relativePath: string): Promise<string> {
  return readFile(path.join(extensionRoot, relativePath), "utf8");
}

test("theme extension is an app embed with static storefront assets", async () => {
  const block = await readExtension("blocks/won_toasts_embed.liquid");

  assert.match(block, /data-won-toasts-embed/);
  assert.match(block, /"target"\s*:\s*"body"/);
  assert.match(block, /"javascript"\s*:\s*"won-toasts\.js"/);
  assert.match(block, /"stylesheet"\s*:\s*"won-toasts\.css"/);
  assert.match(block, /data-won-toasts-endpoint="\/apps\/won-toasts\/config"/);
});

test("storefront JS is a pure notification surface (no price/cart mutation)", async () => {
  const javascript = await readExtension("assets/won-toasts.js");

  // Mounts a Shadow-DOM host and exposes stable markers.
  assert.match(javascript, /customElements/);
  assert.match(javascript, /["']won-toast-host["']/);
  assert.match(javascript, /attachShadow/);
  assert.match(javascript, /data-won-toasts-region/);
  assert.match(javascript, /data-won-toasts-status/);
  assert.match(javascript, /aria-live/);

  // Never manufactures a product/cart form or hits cart-mutating endpoints.
  assert.doesNotMatch(javascript, /createElement\(["']form["']\)/);
  assert.doesNotMatch(javascript, /\/cart\/add/);
  assert.doesNotMatch(javascript, /\/cart\/change/);
  assert.doesNotMatch(javascript, /\/cart\/update/);
});

test("block name and locales are localized", async () => {
  const block = await readExtension("blocks/won_toasts_embed.liquid");
  assert.match(block, /"name"\s*:\s*"t:blocks\.won_toasts\.name"/);

  for (const locale of [
    "en.default.json",
    "cs.json",
    "sk.json",
    "en.default.schema.json",
    "cs.schema.json",
  ]) {
    const parsed = JSON.parse(await readExtension(`locales/${locale}`));
    assert.equal(typeof parsed.blocks?.won_toasts?.name, "string");
  }
});

test("app proxy endpoint is app-owned and authenticated", async () => {
  const appConfig = await readFile(
    path.join(appRoot, "shopify.app.toml"),
    "utf8",
  );
  const configRoute = await readFile(
    path.join(appRoot, "app/routes/won-toasts.config.tsx"),
    "utf8",
  );

  assert.match(appConfig, /subpath\s*=\s*"won-toasts"/);
  assert.match(appConfig, /url\s*=\s*"https:\/\/example\.com\/won-toasts"/);
  assert.match(configRoute, /authenticate\.public\.appProxy\(request\)/);
  assert.match(configRoute, /won-toasts-config-ok/);
  // Serves a resolved config; never leaks another app's namespace.
  assert.match(configRoute, /resolveToastConfig|getToastConfig/);
  assert.doesNotMatch(`${appConfig}\n${configRoute}`, /won-quantity/i);
});
