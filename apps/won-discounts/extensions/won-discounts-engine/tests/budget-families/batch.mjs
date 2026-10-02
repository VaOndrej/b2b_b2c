// node batch.mjs <out.tsv> <file|dir>... → every *.input.json through WASM (default ./new.wasm), in parallel,
// export from a sibling .export file (or the input's shape), TS parity, % of 11 M × max(200, lines)/200,
// MessagePack size vs the bound, config bytes, max product metafield bytes, entered codes.
import { Buffer } from "node:buffer";
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import os from "node:os";
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { messagePackBytes, inputLimit } = await import(`${EXT}/input-size.js`);
const { runCartLines, runDelivery } = await import(`${EXT}/reference-adapter.js`);
const BIN = new URL("../../../../../../node_modules/@shopify/cli/bin/", import.meta.url).pathname;
const FR = BIN + fs.readdirSync(BIN).find((f) => f.startsWith("function-runner"));
const WASM = process.env.WASM ?? new URL("./new.wasm", import.meta.url).pathname;
const [out, ...args] = process.argv.slice(2);
const files = [];
const walk = (p) => { const st = fs.statSync(p); if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f)); else if (p.endsWith(".input.json") || (p.endsWith(".json") && process.env.ANYJSON)) files.push(p); };
for (const a of args) walk(a);
if (process.env.LIST) for (const l of fs.readFileSync(process.env.LIST, "utf8").split("\n").filter(Boolean)) files.push(l);
const runOne = (input, exp) => new Promise((resolve) => {
  const child = spawn(FR, ["-f", WASM, "--export", exp, "--json"]);
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", () => {});
  child.on("close", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve(null); } });
  child.stdin.end(JSON.stringify(input));
});
const rows = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const f = files[next++];
    let input;
    try { input = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    if (!input?.cart?.lines) continue;
    const expFile = f.replace(/\.input\.json$/, ".export");
    let exp = fs.existsSync(expFile) ? fs.readFileSync(expFile, "utf8").trim() : (input.cart.deliveryGroups ? "cart-delivery-options-discounts-generate-run" : "cart-lines-discounts-generate-run");
    if (process.env.EXPORT) exp = process.env.EXPORT;
    const j = await runOne(input, exp);
    if (!j) { rows.push({ f, fail: true }); continue; }
    const lines = input.cart.lines.length;
    const pct = (100 * j.instructions) / ((11e6 * Math.max(200, lines)) / 200);
    let ts = "-";
    if (!process.env.NOTS) {
      try { const o = exp.includes("delivery") ? runDelivery(input) : runCartLines(input); ts = isDeepStrictEqual(o, j.output) ? "same" : "DIFF"; } catch (e) { ts = "TSERR"; }
    }
    const mp = messagePackBytes(input);
    const cfg = Buffer.byteLength(JSON.stringify(input.shop?.config?.jsonValue ?? null));
    const prod = Math.max(0, ...input.cart.lines.map((l) => Buffer.byteLength(JSON.stringify(l.merchandise?.product?.wonProduct?.jsonValue ?? null))));
    const codes = (input.enteredDiscountCodes ?? []).length;
    rows.push({ f, pct, ins: j.instructions, mem: j.memory_usage, ok: j.success, ts, mp, lim: inputLimit(lines), cfg, prod, codes, lines, exp: exp.includes("delivery") ? "D" : "L" });
  }
}
await Promise.all(Array.from({ length: Number(process.env.JOBS ?? Math.max(1, os.cpus().length - 2)) }, worker));
rows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
const inBound = (r) => r.mp <= r.lim && r.cfg <= 9000 && r.prod <= 9000 && r.codes <= 250;
fs.writeFileSync(out, rows.map((r) => r.fail ? `FAIL\t${r.f}` : [r.pct.toFixed(2), r.ins, r.mem, r.ok ? "ok" : "FAILRUN", r.ts, `${r.mp}/${r.lim}`, r.cfg, r.prod, r.codes, r.lines, r.exp, inBound(r) ? "in" : "OUT", r.f].join("\t")).join("\n") + "\n");
const good = rows.filter((r) => !r.fail);
const inb = good.filter(inBound);
console.log(`files ${files.length} measured ${good.length} fail ${rows.length - good.length} DIFF ${good.filter((r) => r.ts === "DIFF").length} TSERR ${good.filter((r) => r.ts === "TSERR").length} runFail ${good.filter((r) => !r.ok).length}`);
console.log(`in-bound ${inb.length}: max ${inb[0]?.pct.toFixed(2)} % (${inb[0]?.f}) ≥100: ${inb.filter((r) => r.pct >= 100).length} ≥90: ${inb.filter((r) => r.pct >= 90).length}`);
const oob = good.filter((r) => !inBound(r));
if (oob.length) console.log(`out-of-bound ${oob.length}: max ${oob[0].pct.toFixed(2)} % (${oob[0].f})`);
for (const r of inb.slice(0, 6)) console.log(`${r.pct.toFixed(2)} % ${r.ts} mp ${r.mp}/${r.lim} cfg ${r.cfg} prod ${r.prod} codes ${r.codes} ${r.exp} ${path.basename(r.f)}`);
