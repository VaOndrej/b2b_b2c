import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { APP_DIR, REPO_ROOT } from "./fixtures.ts";

// Výprodej 5b (F-O1): the order specs read the sale's ledger from the app's own DB (scripts/e2e/outlet.mjs
// --status, the same file the runbook reads) and cancel the run's test orders through scripts/e2e/outlet-orders.mjs
// (`shopify store execute --allow-mutations`, F-O4b). Only with WON_E2E_ORDERS=1.

export const OUT_DIR = path.resolve(process.env.WON_E2E_OUT ?? path.join(tmpdir(), "won-discounts-e2e"));

export interface OutletRunState {
  id: string;
  status: string;
  quota: number;
  sold: number;
  returned: number;
  endReason: string | null;
  error: string | null;
  events: { kind: string; qty: number; at: string }[];
}

export interface OutletSaleState {
  handle: string;
  variant: string | null;
  price: string;
  compareAt: string | null;
  flag: string | null;
  runs: OutletRunState[];
}

class ScriptExit extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

function run(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(APP_DIR, "scripts/e2e", script), ...args, "--out", OUT_DIR], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new ScriptExit(`${script} ${args.join(" ")} → exit ${code}: ${err.split("\n").find((l) => /Error/.test(l)) ?? err.slice(-400)}`, code))));
  });
}

/** The fixture's sales: live prices + the newest run's ledger and steps (read-only). */
export async function outletStatus(): Promise<OutletSaleState[]> {
  await run("outlet.mjs", ["--status"]);
  return JSON.parse(await readFile(path.join(OUT_DIR, "outlet-status.json"), "utf8")).sales as OutletSaleState[];
}

/** The newest run of the sale on `handle` (the one this E2E started). */
export async function latestRun(handle: string): Promise<OutletRunState> {
  const sale = (await outletStatus()).find((s) => s.handle === handle);
  const r = sale?.runs[0];
  if (!r) throw new Error(`no sale run for ${handle}: start it with outlet.mjs --start --live`);
  return r;
}

/** Poll the run until `done` holds (webhooks arrive within seconds; Shopify retries for longer). */
export async function waitForRun(handle: string, done: (r: OutletRunState) => boolean, timeoutMs = 180_000): Promise<OutletRunState> {
  const until = Date.now() + timeoutMs;
  let last: OutletRunState | null = null;
  while (Date.now() < until) {
    last = await latestRun(handle);
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`the sale on ${handle} did not reach the expected state in ${timeoutMs / 1000} s; last: ${JSON.stringify(last)}`);
}

/** Start the fixture sale on `handle` again (after the quota spec sold it out: the next theme finds it running). */
export async function restartSale(handle: string): Promise<void> {
  await run("outlet.mjs", ["--start", "--live", "--only", handle]);
}

/** Cancel the newest test order of this run (restock), through the guarded script. */
export async function cancelLatestOrder(since: string, tries = 9): Promise<string> {
  for (let i = 1; ; i += 1) {
    try {
      return await run("outlet-orders.mjs", ["--since", since, "--latest", "--live"]);
    } catch (error) {
      // Exit 3: the order is not in Shopify's order search yet (eventually consistent) — wait and look again.
      if (!(error instanceof ScriptExit) || error.code !== 3 || i >= tries) throw error;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
