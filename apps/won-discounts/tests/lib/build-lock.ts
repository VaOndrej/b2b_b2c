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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

function reaperPath(lockDir: string): string {
  return `${lockDir}.reap`;
}

function writeOwner(lockDir: string): void {
  writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
}

/**
 * Take over a stale lock, run by at most one process at a time per lock (an
 * exclusive reaper marker directory serializes it).
 *
 * Audit fix4-2: the previous version had every waiter that saw the lock as
 * abandoned rename it aside itself, inspect it, and put it back if it turned
 * out to be live after all. With 3+ contenders, two waiters could both decide
 * to reap around the same moment: one (A) takes the original stale lock,
 * deletes it and re-mkdirs it fresh; the other (B) — acting on its own,
 * now-stale "it looked abandoned" check — renames away *A's fresh lock*,
 * finds a live pid in it, and tries to rename it back. If a third process (C)
 * slipped a plain `mkdirSync(lockDir)` into the gap while B held it in a
 * tomb, B's restore fails (the destination is occupied and non-empty) and
 * the old code fell through to deleting the tomb anyway — destroying A's
 * still-live lock while C also believes it holds the lock: two holders.
 *
 * The fix removes the "rename away, maybe restore" dance entirely:
 *  - Only one process may ever be mid-reap for a given lock (the `.reap`
 *    marker directory, created with `mkdirSync`, which is atomic and
 *    exclusive). Every other reap attempt just backs off.
 *  - The winning reaper re-checks liveness one more time — closing the
 *    window between the caller's check and this call — and only then
 *    removes the stale directory and immediately re-creates it as its own,
 *    with no gap in which it inspects, moves, or restores anything.
 *  - `acquireBuildLock`'s normal mkdir attempt is skipped for as long as the
 *    `.reap` marker exists, so nothing else can land a `mkdirSync` in the
 *    brief window between the reaper's removal and its own re-create.
 *
 * Returns true when this process now holds a fresh lockDir.
 */
function reapAndAcquire(lockDir: string): boolean {
  const reaper = reaperPath(lockDir);
  try {
    mkdirSync(reaper);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; // another process is already reaping this lock
    throw error;
  }
  try {
    if (ownerAlive(lockDir)) return false; // became live again since the caller's check: not our job
    rmSync(lockDir, { recursive: true, force: true });
    try {
      mkdirSync(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; // lost a hairline race; the caller retries normally
      throw error;
    }
    writeOwner(lockDir);
    // Verify what we just wrote is really there and is ours (belt-and-braces
    // against a filesystem surprising us) before handing the lock out.
    return ownerPid(lockDir) === process.pid;
  } finally {
    rmSync(reaper, { recursive: true, force: true });
  }
}

function buildRelease(lockDir: string): () => void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off("exit", release);
    // Only delete lockDir if it is still ours: a process whose lock was
    // legitimately reaped away as abandoned (it crashed or hung long enough
    // to look dead, then got taken over) must never delete the new owner's
    // live lock on a delayed/late release call.
    if (ownerPid(lockDir) === process.pid) rmSync(lockDir, { recursive: true, force: true });
  };
  process.on("exit", release);
  return release;
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
    if (!existsSync(reaperPath(lockDir))) {
      try {
        mkdirSync(lockDir);
        writeOwner(lockDir);
        return buildRelease(lockDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (!existsSync(reaperPath(lockDir)) && !ownerAlive(lockDir)) {
        if (reapAndAcquire(lockDir)) return buildRelease(lockDir);
        continue;
      }
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
