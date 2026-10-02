import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { APP_DIR, REPO_ROOT } from "./fixtures.ts";
import { OUT_DIR } from "./outlet-orders.ts";

// Kampaně E2E (MVP 6, K9): the spec schedules the fixture's campaign itself (scripts/e2e/campaign.mjs — the app's
// own save + sync, a window minutes ahead in the shop's time zone), so every theme of the matrix gets its own window.

export interface CampaignWindow {
  start: string;
  end: string;
  startUtc: string;
  endUtc: string;
  timezone: string;
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(APP_DIR, "scripts/e2e/campaign.mjs"), ...args, "--out", OUT_DIR], { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`campaign.mjs ${args.join(" ")} → exit ${code}: ${(err || out).slice(-600)}`))));
  });
}

/** Schedule the E2E campaign `inMinutes` ahead for `forMinutes` (live); its window. */
export async function scheduleCampaign(inMinutes: number, forMinutes: number): Promise<CampaignWindow> {
  await run(["--schedule", "--in", String(inMinutes), "--for", String(forMinutes), "--live"]);
  return JSON.parse(await readFile(path.join(OUT_DIR, "campaign-window.json"), "utf8")) as CampaignWindow;
}

/** Remove the E2E campaign (live). */
export async function removeCampaign(): Promise<void> {
  await run(["--remove", "--live"]);
}

/** Wait until the wall clock reaches `iso` (+ `afterMs`). */
export async function waitUntil(iso: string, afterMs = 0): Promise<void> {
  const ms = Date.parse(iso) + afterMs - Date.now();
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}
