// Measurement tool, not a test: one fixture's input through the built Wasm with variants of its shop config, to
// see what a part of the config costs in instructions. Run from apps/won-discounts (the function must be built):
//   node extensions/won-discounts-engine/tests/budget-families/measure-variants.mjs lines-200-lines-budget [variant…]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const [, , fixture, ...variants] = process.argv;
const fx = JSON.parse(readFileSync(`extensions/won-discounts-engine/tests/fixtures/${fixture}.json`, "utf8"));
const env = { ...process.env, PATH: `${path.join(os.homedir(), ".cargo/bin")}:${process.env.PATH}`, SHOPIFY_CLI_NO_ANALYTICS: "1", NO_COLOR: "1" };
const all = {
  asis: () => {},
  // No lists at all (the order discount then does not add up with the products: the "order first" path runs).
  nocx: (c) => delete c.engine.cx,
  // The modules' lists only.
  headonly: (c) => (c.engine.cx = c.engine.cx.split("|")[0]),
  // Every rule's list, no exceptions.
  noexc: (c) => {
    const [head, tail] = c.engine.cx.split("|");
    c.engine.cx = `${head}|${tail.split(";").map((entry) => entry.split(":")[0]).join(";")}`;
  },
};
for (const name of variants.length > 0 ? variants : Object.keys(all)) {
  const input = JSON.parse(JSON.stringify(fx.payload.input));
  all[name](input.shop.config.jsonValue);
  const file = path.join(os.tmpdir(), `measure-${name}.json`);
  writeFileSync(file, JSON.stringify(input));
  const out = execFileSync("npx", ["shopify", "app", "function", "run", "--path", "extensions/won-discounts-engine", "--input", file, "--export", fx.payload.export, "--json"], { env, maxBuffer: 1 << 28 }).toString();
  const found = /"instructions":\s*(\d+)/.exec(out);
  console.log(name.padEnd(12), found ? Number(found[1]).toLocaleString("en") : out.slice(-300), `${JSON.stringify(input.shop.config.jsonValue).length} B of config`);
}
