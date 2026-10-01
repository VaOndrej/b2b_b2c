// MVP 4 measurement (README "Rewards"): the instruction cost of the rewards on
// every budget fixture — the worst rewards payload that still fits each
// config's 9 000 B (up to 10 tiers × 4 variants, 64-character tier ids, both
// thresholds at the money cap) and a gift attribute on every 10th line — with
// one Wasm build (as the CLI's function build leaves it). Not a test.
//
//   node tests/reward-budget.mjs <wasm>
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, "fixtures");
const BIN = path.resolve(HERE, "../../../../../node_modules/@shopify/cli/bin");
const RUNNER = path.join(BIN, readdirSync(BIN).find((f) => f.startsWith("function-runner")));
const WASM = process.argv[2];
if (!WASM) throw new Error("usage: node tests/reward-budget.mjs <wasm>");
const limit = (lines) => 11_000_000 * Math.max(1, lines / 200);
const run = (exp, input) => { const r = spawnSync(RUNNER, ["-f", WASM, "--export", exp, "--json"], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 1 << 28 }); return JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).instructions; };
const tierId = (i) => `gift-${i}-`.padEnd(64, "x");
let worst = 0;
for (const file of readdirSync(FX).filter((f) => f.includes("budget")).sort()) {
  const { payload } = JSON.parse(readFileSync(`${FX}/${file}`, "utf8"));
  const input = payload.input;
  const lines = input.cart.lines.length;
  const base = run(payload.export, input);
  const cfg = input.shop.config.jsonValue;
  let tiers = 10, json;
  for (; tiers >= 0; tiers--) {
    cfg.modules.rewards = { s: { CZK: 99_999_999_00, EUR: 9_999_999_99 }, g: Array.from({ length: tiers }, (_, i) => [tierId(i), { CZK: 1_000_00 + i, EUR: 40_00 + i }, [48468678902001 + i, 48468678902101 + i, 48468678902201 + i, 48468678902301 + i]]), o: 1 };
    json = JSON.stringify(cfg);
    if (json.length <= 9000) break;
  }
  input.cart.lines.forEach((l, k) => { if (k % 10 === 9) l.gift = { value: tierId(k % Math.max(1, tiers)) }; });
  const withRewards = run(payload.export, input);
  const d = (100 * (withRewards - base)) / limit(lines);
  worst = Math.max(worst, (100 * withRewards) / limit(lines));
  console.log(file.padEnd(58), `tiers ${String(tiers).padStart(2)} cfg ${json.length} B`, `${((100 * base) / limit(lines)).toFixed(2)} % → ${((100 * withRewards) / limit(lines)).toFixed(2)} % (+${d.toFixed(2)})`);
}
console.log("worst with rewards", worst.toFixed(2), "%");
