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

// The shipped assets/won-toasts.js is a minified build, so identifier markers
// (e.g. CART_MUTATOR) are renamed. Assert the storefront behaviour contract
// against the AUTHORED, readable source; the storefront-build contract proves
// the shipped asset is exactly minify(source), and perf-budget guards its size.
async function readStorefrontSource(): Promise<string> {
  return readFile(path.join(appRoot, "storefront-src/won-toasts.js"), "utf8");
}

test("theme extension is an app embed with static storefront assets", async () => {
  const block = await readExtension("blocks/won_toasts_embed.liquid");

  assert.match(block, /data-won-toasts-embed/);
  assert.match(block, /"target"\s*:\s*"body"/);
  assert.match(block, /"javascript"\s*:\s*"won-toasts\.js"/);
  assert.match(block, /"stylesheet"\s*:\s*"won-toasts\.css"/);
  assert.match(block, /data-won-toasts-endpoint="\/apps\/won-toasts\/config"/);
});

test("storefront JS mounts a Shadow-DOM host with stable, accessible markers", async () => {
  const javascript = await readStorefrontSource();

  assert.match(javascript, /customElements/);
  assert.match(javascript, /["']won-toast-host["']/);
  assert.match(javascript, /attachShadow/);
  assert.match(javascript, /data-won-toasts-region/);
  assert.match(javascript, /data-won-toasts-status/);
  assert.match(javascript, /aria-live/);
});

test("storefront observes the cart and reconciles from /cart.js (not theme DOM)", async () => {
  const javascript = await readStorefrontSource();

  // Intercepts cart mutations and always re-reads the authoritative snapshot.
  assert.match(javascript, /CART_MUTATOR/);
  assert.match(javascript, /add\|change\|update\|clear/);
  assert.match(javascript, /\/cart\.js/);
  assert.match(javascript, /cart:updated/);
  // Renders semantic toasts with a stable marker + delta.
  assert.match(javascript, /data-won-toast["'\]]/);
  assert.match(javascript, /data-type/);
});

test("storefront stays a notification surface: no price/discount/form fabrication", async () => {
  const javascript = await readStorefrontSource();

  // It must never manufacture the merchant's product form or touch pricing.
  assert.doesNotMatch(javascript, /createElement\(["']form["']\)/);
  assert.doesNotMatch(javascript, /discount|applied_discount|final_price\s*=/i);
  // The ONLY cart write is the user-initiated Undo re-add.
  assert.match(javascript, /data-won-toast-undo/);
  assert.match(javascript, /"\/cart\/add\.js"/);
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
