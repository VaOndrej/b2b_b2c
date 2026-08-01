import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readFileText(relativePath: string) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("shopify.app.toml declares required scopes and webhooks", async () => {
  const toml = await readFileText("shopify.app.toml");
  assert.match(toml, /scopes\s*=\s*"[^"]*read_customers[^"]*"/, "read_customers scope must be declared");
  assert.match(toml, /api_version\s*=\s*"2026-04"/, "webhooks api_version must be 2026-04");
});

test("app server uses API version 2026-04", async () => {
  const server = await readFileText("app/shopify.server.ts");
  assert.match(server, /ApiVersion\.April26/, "app server must target ApiVersion.April26");
});

test("function extensions target API version 2026-04", async () => {
  const cartValidation = await readFileText(
    "extensions/margin-guard-cart-validation/shopify.extension.toml",
  );
  const discount = await readFileText(
    "extensions/margin-guard-discount-function/shopify.extension.toml",
  );
  assert.match(cartValidation, /api_version\s*=\s*"2026-04"/, "cart validation extension api_version must be 2026-04");
  assert.match(discount, /api_version\s*=\s*"2026-04"/, "discount extension api_version must be 2026-04");
});
