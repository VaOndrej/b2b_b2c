// Writes fixtures/combine-before.json: what the engine gives every case of combine-migration-cases.ts.
//
// It was run ONCE, on commit b21f1f4 — the last one whose engine combined discounts by the four category switches
// and `combinesWith`. The file it wrote is frozen. Running this on a later commit would write what the NEW engine
// gives and make the "before and after" test compare the engine with itself, so it refuses unless forced.
//
//   npx tsx tests/discounts/fixtures/gen-combine-before.ts --i-am-on-b21f1f4

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sanitizeConfig } from "../../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../../src/discounts/function-payload.ts";
import { gateConfigForPlan } from "../../../src/discounts/plan-gate.ts";
import { planCart } from "../../../src/discounts/plan.ts";
import { combineCases, combineResultOf } from "../combine-migration-cases.ts";

if (!process.argv.includes("--i-am-on-b21f1f4")) {
  console.error("Refusing: this file is frozen (see the header). Pass --i-am-on-b21f1f4 only on that commit's engine.");
  process.exit(1);
}

const results = combineCases().map(({ config, plan, cart }) => {
  const stored = sanitizeConfig(config).config;
  const gated = gateConfigForPlan(stored, plan).config;
  const payload = buildShopFunctionConfig(gated, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" }).payload;
  const result = combineResultOf(planCart(cart, payload));
  return [result.lines, result.order, result.shipping, result.gifts, result.total];
});

const file = fileURLToPath(new URL("./combine-before.json", import.meta.url));
writeFileSync(file, `[\n${results.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${results.length} results → ${file}`);
