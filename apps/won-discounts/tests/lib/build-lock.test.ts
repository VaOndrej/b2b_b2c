import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { acquireBuildLock, buildLockPath } from "./build-lock.ts";

// Audit P3-6: the lock that keeps function.contract (runs the Wasm) and
// dev-harness.contract (`npm run build` rewrites the Wasm) from racing. Proven
// across real processes, because `node --test` runs each file in its own one.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");
let scratch = "";

before(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "won-discounts-lock-test-"));
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const uniqueName = (label: string) => `test-${label}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

test("the lock is exclusive across processes: holders never overlap", async () => {
  const name = uniqueName("exclusive");
  const log = path.join(scratch, "exclusive.log");
  writeFileSync(log, "");
  const child = path.join(scratch, "holder.mts"); // .mts: ESM (top-level await) outside a "type": "module" package
  writeFileSync(
    child,
    `import { appendFileSync } from "node:fs";
import { acquireBuildLock } from ${JSON.stringify(path.join(HERE, "build-lock.ts"))};
const release = await acquireBuildLock({ name: ${JSON.stringify(name)}, pollMs: 20, timeoutMs: 30000 });
appendFileSync(${JSON.stringify(log)}, "start " + process.pid + "\\n");
await new Promise((r) => setTimeout(r, 150));
appendFileSync(${JSON.stringify(log)}, "end " + process.pid + "\\n");
release();
`,
  );
  const children = Array.from({ length: 4 }, () =>
    spawn(process.execPath, ["--import", "tsx", child], { cwd: APP_ROOT, stdio: "pipe" }),
  );
  const stderr: string[] = [];
  for (const c of children) c.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const codes = await Promise.all(
    children.map((c) => new Promise<number | null>((resolve) => c.on("exit", (code) => resolve(code)))),
  );
  assert.deepEqual(codes, [0, 0, 0, 0], stderr.join(""));

  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 8);
  for (let i = 0; i < lines.length; i += 2) {
    const [startWord, startPid] = lines[i].split(" ");
    const [endWord, endPid] = lines[i + 1].split(" ");
    assert.deepEqual([startWord, endWord, startPid], ["start", "end", endPid], `interleaved holders:\n${lines.join("\n")}`);
  }
  assert.equal(existsSync(buildLockPath(name)), false, "released");
});

test("a lock left behind by a dead process is taken over", async () => {
  const name = uniqueName("stale");
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  const deadPid = Number(dead.stdout);
  const lockDir = buildLockPath(name);
  mkdirSync(lockDir);
  writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: deadPid }));

  const release = await acquireBuildLock({ name, timeoutMs: 2000, pollMs: 20 });
  assert.equal(JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")).pid, process.pid);
  release();
  assert.equal(existsSync(lockDir), false);
});

test("a live holder makes a waiter time out instead of hanging forever", async () => {
  const name = uniqueName("timeout");
  const release = await acquireBuildLock({ name });
  try {
    await assert.rejects(() => acquireBuildLock({ name, timeoutMs: 200, pollMs: 20 }), /timed out/);
  } finally {
    release();
  }
  const again = await acquireBuildLock({ name, timeoutMs: 1000 });
  again();
});

test("both tests that touch the build outputs hold the lock (function.contract, dev-harness.contract)", () => {
  const source = (file: string) => readFileSync(path.join(APP_ROOT, "tests/contracts", file), "utf8");
  const fn = source("function.contract.test.ts");
  // The lock is taken before the Wasm is built and held until every fixture ran.
  assert.match(fn, /import \{[^}]*acquireBuildLock[^}]*\} from "\.\.\/lib\/build-lock\.ts"/);
  assert.match(fn, /before\(async \(\) => \{\s*releaseBuildLock = await acquireBuildLock\(\);[\s\S]*?app", "function", "build"/);
  assert.match(fn, /after\(\(\) => \{\s*releaseBuildLock\(\);/);
  const harness = source("dev-harness.contract.test.ts");
  assert.match(harness, /import \{[^}]*withBuildLock[^}]*\} from "\.\.\/lib\/build-lock\.ts"/);
  assert.match(harness, /await withBuildLock\(\(\) =>\s*execFileSync\("npm", \["run", "build"\]/);
});
