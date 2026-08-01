import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const extensionRoot = path.join(appRoot, "extensions/won-quantity-storefront");

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(extensionRoot, relativePath), "utf8");
}

test("theme extension is an app embed with one static storefront asset", async () => {
  const block = await read("blocks/won_quantity_embed.liquid");
  const javascript = await read("assets/won-quantity.js");

  assert.match(block, /data-won-quantity-embed/);
  assert.match(block, /"target"\s*:\s*"body"/);
  assert.match(block, /"javascript"\s*:\s*"won-quantity\.js"/);
  assert.doesNotMatch(block, /<form\b|\/cart\/add/i);
  assert.doesNotMatch(javascript, /createElement\(["']form["']\)/);
});

test("extension exposes portable lifecycle and stable DOM markers", async () => {
  const javascript = await read("assets/won-quantity.js");

  assert.match(javascript, /input\[name=["']quantity["']\]/);
  assert.match(javascript, /form\[action\*=["']\/cart\/add["']\]/);
  assert.match(javascript, /data-won-quantity-ready/);
  assert.match(javascript, /data-won-quantity-notice/);
  assert.match(javascript, /MutationObserver/);
  assert.match(javascript, /shopify:section:load/);
  assert.match(javascript, /new Event\(["']input["']/);
  assert.match(javascript, /new Event\(["']change["']/);
  assert.doesNotMatch(javascript, /margin[-_ ]guard/i);
  assert.doesNotMatch(javascript, /mg_e2e_audience/i);
});

test("schema and storefront labels are localized", async () => {
  const block = await read("blocks/won_quantity_embed.liquid");
  assert.match(block, /"name"\s*:\s*"t:blocks\.won_quantity\.name"/);
  assert.match(block, /won_quantity\.minimum/);
  assert.match(block, /won_quantity\.step/);
  assert.match(block, /won_quantity\.maximum/);

  for (const locale of ["en.default.json", "cs.json", "sk.json"]) {
    const parsed = JSON.parse(await read(`locales/${locale}`));
    assert.equal(typeof parsed.blocks?.won_quantity?.name, "string");
    assert.equal(typeof parsed.won_quantity?.minimum, "string");
    assert.equal(typeof parsed.won_quantity?.step, "string");
    assert.equal(typeof parsed.won_quantity?.maximum, "string");
  }

  for (const locale of ["en.default.schema.json", "cs.schema.json"]) {
    const parsed = JSON.parse(await read(`locales/${locale}`));
    assert.equal(typeof parsed.blocks?.won_quantity?.name, "string");
  }
});

test("app proxy endpoint is app-owned and authenticated", async () => {
  const appConfig = await readFile(
    path.join(appRoot, "shopify.app.toml"),
    "utf8",
  );
  const route = await readFile(
    path.join(appRoot, "app/routes/won-quantity.config.tsx"),
    "utf8",
  );

  assert.match(appConfig, /subpath\s*=\s*"won-quantity"/);
  assert.match(appConfig, /url\s*=\s*"https:\/\/example\.com\/won-quantity"/);
  assert.match(route, /authenticate\.public\.appProxy\(request\)/);
  assert.match(route, /resolveQuantityRule/);
  assert.match(route, /won-quantity-config-ok/);
  assert.doesNotMatch(`${appConfig}\n${route}`, /margin[-_ ]guard/i);
});
