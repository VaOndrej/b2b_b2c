import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// F2 configuration contracts (checked with the Shopify dev MCP, 2026-04 docs):
//   item 9  read_markets is an OPTIONAL scope ([access_scopes] optional_scopes),
//           requested with App Bridge shopify.scopes.request only when needed;
//   item 2  products/update, products/delete, collections/update and
//           collections/delete are delivered to /webhooks/targeting (all four
//           need read_products), and that route exists;
//   item 16 `typecheck` and `build` generate this app's own Prisma client first
//           (CI runs typecheck:apps / build:apps on a clean checkout, where
//           app/generated is not committed).

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toml = readFileSync(path.join(APP_ROOT, "shopify.app.toml"), "utf8").replace(/^\s*#.*$/gm, "");
const scripts = (JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

/** Values of a TOML array like `key = [ "a", "b" ]` inside `block`. */
function arrayValue(block: string, key: string): string[] | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(block);
  return match ? [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) : null;
}

function stringValue(block: string, key: string): string | null {
  return new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(block)?.[1] ?? null;
}

test("item 9: read_markets is optional, not required; every required scope stays", () => {
  const section = /\[access_scopes\]([\s\S]*?)(?=\n\[[a-z_]+\]|$)/.exec(toml)?.[1] ?? "";
  const required = (stringValue(section, "scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(required.sort(), ["read_products", "read_themes", "write_discounts", "write_products"]);
  assert.deepEqual(arrayValue(section, "optional_scopes"), ["read_markets"]);
});

test("item 2: the four targeting topics go to /webhooks/targeting (the update topics trimmed with include_fields)", () => {
  const subscriptions = toml.split("[[webhooks.subscriptions]]").slice(1);
  const byUri = subscriptions.filter((block) => stringValue(block, "uri") === "/webhooks/targeting");
  const topics = byUri.flatMap((block) => arrayValue(block, "topics") ?? []).sort();
  assert.deepEqual(topics, ["collections/delete", "collections/update", "products/delete", "products/update"]);
  const updates = byUri.find((block) => (arrayValue(block, "topics") ?? []).includes("products/update"))!;
  assert.deepEqual(arrayValue(updates, "include_fields"), ["id", "admin_graphql_api_id", "updated_at"]);
  assert.ok(existsSync(path.join(APP_ROOT, "app/routes/webhooks.targeting.tsx")), "the route that receives them");
});

test("item 16: typecheck and build generate the app's Prisma client first (CI needs no extra step)", () => {
  assert.equal(scripts.pretypecheck, "prisma generate");
  assert.equal(scripts.prebuild, "prisma generate");
  assert.match(readFileSync(path.join(APP_ROOT, "prisma/schema.prisma"), "utf8"), /output\s*=\s*"\.\.\/app\/generated\/prisma"/);
});
