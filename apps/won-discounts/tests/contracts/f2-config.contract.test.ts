import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// F2 configuration contracts (checked with the Shopify dev MCP, 2026-04 docs):
//   item 9  read_markets was an optional scope; since the audit of 6 Oct 2026 (T1)
//           it is REQUIRED: the app reads the shop's markets and currencies for everyone;
//   item 2  products/create (MVP 2), products/update, products/delete,
//           collections/update and collections/delete are delivered to
//           /webhooks/targeting (all five need read_products), and that route exists;
//   MVP 2   inventory_items/update is delivered to /webhooks/costs (the cost
//           mirror of margin protection; read_products covers it — changelog
//           2025-03-31 — so no new scope), trimmed with include_fields;
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

test("T1: read_markets is a required scope; the only optional one is read_locales (the Překlady page asks for it)", () => {
  const section = /\[access_scopes\]([\s\S]*?)(?=\n\[[a-z_]+\]|$)/.exec(toml)?.[1] ?? "";
  const required = (stringValue(section, "scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(required.sort(), ["read_markets", "read_products", "read_themes", "write_discounts", "write_products"]);
  assert.deepEqual(arrayValue(section, "optional_scopes"), ["read_locales"]);
});

test("item 2: the targeting topics go to /webhooks/targeting (the create/update topics trimmed with include_fields)", () => {
  const subscriptions = toml.split("[[webhooks.subscriptions]]").slice(1);
  const byUri = subscriptions.filter((block) => stringValue(block, "uri") === "/webhooks/targeting");
  const topics = byUri.flatMap((block) => arrayValue(block, "topics") ?? []).sort();
  assert.deepEqual(topics, ["collections/delete", "collections/update", "products/create", "products/delete", "products/update"]);
  const creates = byUri.find((block) => (arrayValue(block, "topics") ?? []).includes("products/create"))!;
  assert.deepEqual(arrayValue(creates, "include_fields"), ["id", "admin_graphql_api_id", "updated_at"]);
  const updates = byUri.find((block) => (arrayValue(block, "topics") ?? []).includes("products/update"))!;
  assert.deepEqual(arrayValue(updates, "include_fields"), ["id", "admin_graphql_api_id", "updated_at"]);
  assert.ok(existsSync(path.join(APP_ROOT, "app/routes/webhooks.targeting.tsx")), "the route that receives them");
});

test("MVP 2: inventory_items/update goes to /webhooks/costs, trimmed to the id, cost and time; the route exists; no new scope", () => {
  const subscriptions = toml.split("[[webhooks.subscriptions]]").slice(1);
  const byUri = subscriptions.filter((block) => stringValue(block, "uri") === "/webhooks/costs");
  assert.deepEqual(byUri.flatMap((block) => arrayValue(block, "topics") ?? []), ["inventory_items/update"]);
  assert.deepEqual(arrayValue(byUri[0]!, "include_fields"), ["id", "cost", "updated_at", "admin_graphql_api_id"]);
  assert.ok(existsSync(path.join(APP_ROOT, "app/routes/webhooks.costs.tsx")), "the route that receives it");
});

test("item 16: typecheck and build generate the app's Prisma client first (CI needs no extra step)", () => {
  assert.equal(scripts.pretypecheck, "prisma generate");
  assert.equal(scripts.prebuild, "prisma generate");
  assert.match(readFileSync(path.join(APP_ROOT, "prisma/schema.prisma"), "utf8"), /output\s*=\s*"\.\.\/app\/generated\/prisma"/);
});
