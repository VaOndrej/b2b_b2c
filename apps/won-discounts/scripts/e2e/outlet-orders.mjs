#!/usr/bin/env node
/* eslint-env node */
// Výprodej 5b E2E (F-O4b, Ondřej 2026-10-02): cancel the TEST orders the outlet E2E placed, with restock, through
// `shopify store execute --allow-mutations` (Ondřej's CLI login; the app itself never cancels orders). Only orders of
// THIS run are touched: created at or after --since, by the E2E e-mail, Bogus (test) orders, every line a won-e2e-*
// product, not cancelled yet. Anything else is listed as skipped with the reason and never written.
//
//   node apps/won-discounts/scripts/e2e/outlet-orders.mjs --since <ISO>             DRY-RUN (default): lists the
//                                                                                   run's orders and what would be
//                                                                                   cancelled. Writes nothing.
//   node …/outlet-orders.mjs --since <ISO> [--latest] --live                        cancels them (restock, no
//                                                                                   customer notification, refund
//                                                                                   to the Bogus card); --latest =
//                                                                                   only the newest one.
// Options: --email <e-mail> (default won-e2e-outlet@example.com) · --out <dir> (default $WON_E2E_OUT or
// <tmp>/won-discounts-e2e) · --json. Every run writes <out>/outlet-orders[-live].json.
// Only the shared dev store. Validated with the Shopify dev MCP (admin 2026-10). Needs the CLI's store auth with
// order scopes (once, Ondřej: `shopify store auth -s <store> --scopes read_orders,write_orders,read_products`).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STORE = "b2b-b2c-store-development.myshopify.com";
const DEFAULT_EMAIL = "won-e2e-outlet@example.com";
const HANDLE = /^won-e2e-/;

const ORDERS_QUERY = `query WonE2eOutletOrders($q: String!) { orders(first: 20, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt email cancelledAt test lineItems(first: 10) { nodes { quantity variant { id product { handle } } } } } } }`;
const CANCEL_MUTATION = `mutation WonE2eOrderCancel($orderId: ID!) { orderCancel(orderId: $orderId, reason: OTHER, refundMethod: { originalPaymentMethodsRefund: true }, restock: true, notifyCustomer: false, staffNote: "Won Discounts E2E: storno testovací objednávky") { job { id done } orderCancelUserErrors { field message code } } }`;

function storeExecute(query, variables, mutation = false) {
  const args = ["store", "execute", "-s", STORE, "-j", "-q", query, "-v", JSON.stringify(variables)];
  if (mutation) args.push("--allow-mutations");
  let raw;
  try {
    raw = execFileSync("shopify", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const text = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    // Live 2026-10-02: the stored store auth had no order scopes ("Access denied for orders field").
    if (/ACCESS_DENIED|Access denied for orders/.test(text)) {
      throw new Error(`the store auth of the Shopify CLI cannot read or cancel orders. Ondřej runs once:\n  shopify store auth -s ${STORE} --scopes read_orders,write_orders,read_products`);
    }
    throw new Error(`shopify store execute failed: ${text.split("\n").find((l) => /error|message/i.test(l))?.trim() ?? error.message}`);
  }
  const json = JSON.parse(raw.slice(raw.indexOf("{")));
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  return json.data ?? json;
}

/** Why an order is not this run's test order (null = it is). Pure, exported for the unit test. */
export function skipReason(order, opts) {
  if (Date.parse(order.createdAt) < Date.parse(opts.since)) return "created before this run";
  if ((order.email ?? "").toLowerCase() !== opts.email.toLowerCase()) return "another e-mail";
  if (order.test !== true) return "not a test (Bogus) order";
  if (order.cancelledAt) return "already cancelled";
  const lines = order.lineItems?.nodes ?? [];
  if (!lines.length || lines.some((l) => !HANDLE.test(l.variant?.product?.handle ?? ""))) return "a line outside the won-e2e-* catalog";
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const KNOWN = ["--since", "--email", "--latest", "--live", "--out", "--json"];
  for (const arg of argv) if (arg.startsWith("--") && !KNOWN.includes(arg)) throw new Error(`unknown argument ${arg}`);

  const since = option("--since");
  if (!since || Number.isNaN(Date.parse(since))) throw new Error("--since <ISO time of the run start> is required (only this run's orders)");
  const email = option("--email") ?? DEFAULT_EMAIL;
  const live = flag("--live");
  const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const day = new Date(since).toISOString().slice(0, 10);
  const data = storeExecute(ORDERS_QUERY, { q: `email:${email} created_at:>=${day}` });
  const orders = (data.orders?.nodes ?? []).map((o) => ({ ...o, skip: skipReason(o, { since, email }) }));
  let targets = orders.filter((o) => o.skip === null);
  if (flag("--latest")) targets = targets.slice(0, 1);
  const out = { store: STORE, since, email, live, orders: orders.map(({ id, name, createdAt, cancelledAt, skip }) => ({ id, name, createdAt, cancelledAt, skip })), cancelled: [] };
  for (const o of orders) {
    const lines = (o.lineItems?.nodes ?? []).map((l) => `${l.quantity}× ${l.variant?.product?.handle ?? "?"}`).join(", ");
    const will = targets.includes(o);
    console.log(`${o.name} ${o.createdAt} [${lines}] → ${will ? (live ? "CANCEL (restock)" : "would cancel (restock)") : `skip: ${o.skip ?? "not the latest"}`}`);
  }
  if (!targets.length) console.log("nothing to cancel");
  if (!live) {
    if (targets.length) console.log("\n(dry-run: nothing written; pass --live)");
  } else {
    for (const o of targets) {
      const r = storeExecute(CANCEL_MUTATION, { orderId: o.id }, true).orderCancel;
      const errors = r?.orderCancelUserErrors ?? [];
      out.cancelled.push({ id: o.id, name: o.name, job: r?.job?.id ?? null, errors });
      console.log(`${o.name}: ${errors.length ? `FAILED ${JSON.stringify(errors)}` : `cancel queued (${r?.job?.id ?? "no job"})`}`);
      if (errors.length) process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `outlet-orders${live ? "-live" : ""}.json`), JSON.stringify(out, null, 2));
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
