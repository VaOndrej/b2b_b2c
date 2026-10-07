import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { activateOrders, lineDiff } from "./activate-orders.mjs";

// MVP 7 contract M5: the one-step activation of orders edits shopify.app.toml exactly — the scope and the one
// subscription, once. Run on the REAL file's text; the real file itself must NOT be activated (Shopify would
// refuse the dev app's whole configuration until the access is approved).

const TOML = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shopify.app.toml");
const real = fs.readFileSync(TOML, "utf8");

test("the committed shopify.app.toml is not activated: no read_orders scope, no order topic", () => {
  assert.doesNotMatch(real, /read_orders"/);
  assert.doesNotMatch(real, /^\s*topics = .*"(orders|refunds)\//m);
});

test("activation adds the scope and the subscription before [access_scopes]; nothing else changes", () => {
  const { toml, changed } = activateOrders(real);
  assert.equal(changed, true);
  assert.match(toml, /^scopes = "write_discounts,read_products,write_products,read_themes,read_markets,read_orders"$/m);
  const added = lineDiff(real, toml).filter((line) => line.startsWith("+ ")).join("\n");
  assert.match(added, /topics = \[ "orders\/create", "orders\/cancelled", "refunds\/create" \]\n\+   uri = "\/webhooks\/outlet"/);
  assert.equal((toml.match(/"orders\/create"/g) ?? []).length, 1, "a topic is subscribed once");
  assert.deepEqual(lineDiff(real, toml).filter((line) => line.startsWith("- ")), ['- scopes = "write_discounts,read_products,write_products,read_themes,read_markets"']);
  assert.ok(toml.indexOf('uri = "/webhooks/outlet"') < toml.indexOf("[access_scopes]"));
  assert.ok(toml.indexOf('uri = "/webhooks/outlet"') > toml.indexOf("[webhooks]"));
});

test("idempotent: activating an activated file changes nothing; a file without scopes is refused", () => {
  const once = activateOrders(real).toml;
  assert.deepEqual(activateOrders(once), { toml: once, changed: false });
  assert.throws(() => activateOrders("[webhooks]\n"), /scopes/);
});
