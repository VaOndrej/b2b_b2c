// Cross-process lock for tests that write or read the SAME build outputs
// (audit P3-6). `node --test` runs every test file in its own process, in
// parallel:
//   - tests/contracts/function.contract.test.ts builds
//     extensions/won-discounts-engine/dist/function.wasm and runs ~26 fixtures
//     against it;
//   - tests/contracts/dev-harness.contract.test.ts runs `npm run build`, which
//     rebuilds that same Wasm (build:functions) and build/.
// Without the lock a fixture can run against a half-written Wasm. Both take
// this lock for as long as they need the outputs, so `npm run test:unit` stays
// fully parallel everywhere else.
//
// The lock is a directory (mkdir is atomic) in the OS temp dir, keyed by this
// checkout's path, holding the owner's pid. A lock whose owner process is gone
// (crash, kill -9) is taken over; waiting is bounded by a timeout.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface BuildLockOptions {
  /** Lock name; tests of the lock itself use their own name. Default "build-outputs". */
  name?: string;
  /** Give up after this long (default 15 min: a cold `npm run build` + fixtures). */
  timeoutMs?: number;
  /** Poll interval while waiting (default 200 ms). */
  pollMs?: number;
}

export function buildLockPath(name = "build-outputs"): string {
  const checkout = createHash("sha256").update(APP_ROOT).digest("hex").slice(0, 12);
  return path.join(tmpdir(), `won-discounts-${checkout}-${name}.lock`);
}

function ownerPid(lockDir: string): number | null {
  try {
    const pid = Number(JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")).pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ownerAlive(lockDir: string): boolean {
  const pid = ownerPid(lockDir);
  if (pid !== null) return pidAlive(pid);
  // mkdir happened but the owner file is not written yet (or never will be):
  // treat as alive for a short grace period, then as abandoned.
  try {
    return Date.now() - statSync(lockDir).mtimeMs < 10_000;
  } catch {
    return false; // released meanwhile
  }
}

/**
 * Take an abandoned lock out of the way. rename() is atomic, so of two waiters
 * that both saw it abandoned only one moves it; if what was moved turns out to
 * be a fresh, live lock (another waiter took over in between), it is put back.
 */
function removeAbandoned(lockDir: string): void {
  const tomb = `${lockDir}.abandoned-${process.pid}-${Date.now()}`;
  try {
    renameSync(lockDir, tomb);
  } catch {
    return; // someone else moved or released it
  }
  const pid = ownerPid(tomb);
  if (pid !== null && pidAlive(pid)) {
    try {
      renameSync(tomb, lockDir);
      return;
    } catch {
      // lockDir exists again: that owner won; the moved one is gone either way
    }
  }
  rmSync(tomb, { recursive: true, force: true });
}

/**
 * Wait for and take the lock. Returns `release` (idempotent). The lock is also
 * released if this process exits without calling it.
 */
export async function acquireBuildLock(options: BuildLockOptions = {}): Promise<() => void> {
  const lockDir = buildLockPath(options.name);
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 200;
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off("exit", release);
        rmSync(lockDir, { recursive: true, force: true });
      };
      process.on("exit", release);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!ownerAlive(lockDir)) {
      removeAbandoned(lockDir); // take it over on the next attempt
      continue;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${lockDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Run `fn` while holding the lock. */
export async function withBuildLock<T>(fn: () => Promise<T> | T, options: BuildLockOptions = {}): Promise<T> {
  const release = await acquireBuildLock(options);
  try {
    return await fn();
  } finally {
    release();
  }
}
