// The function's build command (shopify.extension.toml): cargo, then ONE pass of wasm-opt of our own before the
// CLI's (the CLI always runs `wasm-opt -Oz` with its own fixed flags, then its trampoline).
//
// Our pass adds `--low-memory-unused`: binaryen may assume the lowest 1 024 B of memory are never touched and fold
// small constant offsets into loads and stores. Measured 2026-10-08 (README.md, "Wasm size"): −4.2 kB and −1.0 point
// of the instruction limit. The assumption holds for this build because rustc links wasm32 with the stack first:
// the stack is [0, 1 MiB) growing down from the top and the data starts above it, so the lowest kilobyte is only
// reached by a stack 1 MiB deep. The check below fails the build if a toolchain ever lays the memory out otherwise.
//
// binaryen is pinned to the version the CLI bundles (wasm-opt 123), so both passes are the same optimizer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WASM = path.join(HERE, "target/wasm32-unknown-unknown/release/won-discounts-engine.wasm");
const LOW_MEMORY = 1024;
const require = createRequire(import.meta.url);

function run(command, args) {
  const env = { ...process.env, PATH: `${path.join(os.homedir(), ".cargo/bin")}${path.delimiter}${process.env.PATH ?? ""}` };
  const done = spawnSync(command, args, { cwd: HERE, env, stdio: "inherit" });
  if (done.error) throw done.error;
  if (done.status !== 0) process.exit(done.status ?? 1);
}

run("cargo", ["build", "--target=wasm32-unknown-unknown", "--release"]);

// The layout the flag relies on, read from what cargo built.
const binaryen = (await import("binaryen")).default;
const module = binaryen.readBinary(fs.readFileSync(WASM));
let lowest = Infinity;
for (let i = 0; i < module.getNumMemorySegments(); i++) {
  const info = module.getMemorySegmentInfo(String(i)); // by name; a segment read from a binary is named by its index
  if (info.passive) continue;
  lowest = Math.min(lowest, info.offset);
}
module.dispose();
if (!(lowest >= LOW_MEMORY)) {
  console.error(`build.mjs: a data segment starts at ${lowest}, inside the lowest ${LOW_MEMORY} B of memory — --low-memory-unused would be wrong for this build.`);
  process.exit(1);
}

const wasmOpt = path.join(path.dirname(require.resolve("binaryen/package.json")), "bin/wasm-opt");
run(process.execPath, [wasmOpt, WASM, "-Oz", "--low-memory-unused", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "-o", WASM]);
