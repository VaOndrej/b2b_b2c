#!/usr/bin/env node
/* eslint-env node */
// Orders activation in ONE step (MVP 7, contract M5; decisions 1 and 5 of 2026-10-04). Shopify lets the app read
// orders only after "Protected customer data access" is approved (live fact F-O1: without it the dev app's whole
// configuration is refused). Everything that needs orders is built and switched off; this script switches it on:
//   shopify.app.toml  + scope `read_orders`
//                     + orders/create, orders/cancelled, refunds/create → /webhooks/outlet
//                       (one subscription: the route feeds Výprodej's quota, 5b, AND the analytics facts)
//   node scripts/activate-orders.mjs           DRY-RUN (default): prints the diff, writes nothing
//   node scripts/activate-orders.mjs --live    writes shopify.app.toml (a copy is kept next to it: *.before-orders)
//   node scripts/activate-orders.mjs --file <toml> [--live]   another file (the unit test uses a copy)
// Idempotent: a file that already has the scope and the subscriptions is left as it is.
// After --live: restart `shopify app dev` (it must accept the configuration; if it refuses, restore the copy), then
// the steps of docs/plans/2026-10-02-won-discounts-mvp5.md "Aktivace 5b" from step 3 (store auth for the E2E
// cancellations, `WON_E2E_ORDERS=1 profile.sh outlet <tag> pro`).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "read_orders";
const MARKER = "# Orders (activated by scripts/activate-orders.mjs";
const BLOCK = `  ${MARKER} after Shopify approved protected customer data access):
  # ONE subscription (a topic is not subscribed twice): app/routes/webhooks.outlet.tsx counts the Výprodej quota
  # from orders, cancellations and refunds (WBH-2 idempotent per order line) and keeps one fact per order for
  # Přehledy, without personal data (app/lib/analytics).
  [[webhooks.subscriptions]]
  topics = [ "orders/create", "orders/cancelled", "refunds/create" ]
  uri = "/webhooks/outlet"

`;

/** The activated toml text; `changed` false when it already was. Throws when the file has no scopes line. */
export function activateOrders(toml) {
  let out = toml;
  const scopes = /^scopes = "([^"]*)"$/m.exec(out);
  if (!scopes) throw new Error('shopify.app.toml: no `scopes = "…"` line under [access_scopes]');
  const list = scopes[1].split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.includes(SCOPE)) out = out.replace(scopes[0], `scopes = "${[...list, SCOPE].join(",")}"`);
  if (!out.includes(MARKER)) {
    const at = out.indexOf("[access_scopes]");
    if (at === -1) throw new Error("shopify.app.toml: no [access_scopes] section");
    out = `${out.slice(0, at)}${BLOCK}${out.slice(at)}`;
  }
  return { toml: out, changed: out !== toml };
}

/** A minimal line diff (added / removed lines only), for the dry-run. */
export function lineDiff(before, after) {
  const a = before.split("\n");
  const b = new Set(after.split("\n"));
  const was = new Set(a);
  return [...a.filter((line) => !b.has(line)).map((line) => `- ${line}`), ...after.split("\n").filter((line) => !was.has(line)).map((line) => `+ ${line}`)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  for (const arg of argv) if (arg.startsWith("--") && !["--live", "--file"].includes(arg)) throw new Error(`unknown argument ${arg}`);
  const file = path.resolve(argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : path.join(APP, "shopify.app.toml"));
  const before = fs.readFileSync(file, "utf8");
  const { toml, changed } = activateOrders(before);
  if (!changed) console.log(`${path.relative(process.cwd(), file)}: orders are already activated — nothing to do`);
  else {
    console.log(lineDiff(before, toml).join("\n"));
    if (argv.includes("--live")) {
      fs.writeFileSync(`${file}.before-orders`, before);
      fs.writeFileSync(file, toml);
      console.log(`\nwritten: ${path.relative(process.cwd(), file)} (the previous file: ${path.basename(file)}.before-orders)\nnext: restart \`shopify app dev\`; if Shopify refuses the configuration, restore the copy.`);
    } else console.log("\n(dry-run: nothing written; pass --live)");
  }
}
