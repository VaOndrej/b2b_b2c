#!/usr/bin/env node
// C1 — do the AUTOMATIC node and the CODE nodes see every entered Won code?
//
// Setup: 1 automatic node (echo_codes + echoOnAutomatic → min(50, 10 × entered
// codes) % on the first line) + 2 code nodes WONPROTO1 / WONPROTO2 (echo_codes →
// 1 % on the first line, message WON:<triggering>|<entered>).
// The automatic node's percentage is the cart readout: 10 % per code it saw.
// The code nodes' view comes from the function run logs (input + output).
// Extra (gap fill): a non-existent code and a native (non-Won) code, to learn
// which codes enteredDiscountCodes carries at all.
//
//   node apps/won-discounts/scripts/prototypes/c1-entered-codes.mjs            # dry-run
//   WON_PROTO_OUT=<dir> WON_PROTO_APP_DEV_LOG=<app-dev.log> \
//     node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c1-entered-codes.mjs --live

import { approx, functionConfig, linePercent, observe, runExperiment } from "./lib.mjs";

const CODES = ["WONPROTO1", "WONPROTO2"];
const UNKNOWN = "NOTAWONCODE7";
const NATIVE = "WONPROTONATIVE";

const PLAN = `Plan:
 1. sweep leftover WON-PROTO nodes
 2. create automatic node  "WON-PROTO C1 auto echo"   config {prototype:{mode:echo_codes,echoOnAutomatic:true}, campaignStart/End 1970}
 3. create code node       "WON-PROTO C1 WONPROTO1"   code WONPROTO1, config {prototype:{mode:echo_codes}}
 4. create code node       "WON-PROTO C1 WONPROTO2"   code WONPROTO2, same config
 5. create native code     "WON-PROTO C1 native"      code ${NATIVE} (discountCodeBasicCreate, 5 % all items)
 6. storefront (fresh cart, 1× won-e2e-simple-a), each read twice in a row:
      a. WONPROTO1                    → automatic allocation ≈ 10 %
      b. WONPROTO1,WONPROTO2          → automatic allocation ≈ 20 %   (C1 readout)
      c. no codes                     → no automatic allocation
      d. WONPROTO1,WONPROTO2,${UNKNOWN} (does not exist) → record: 20 % = unknown code not passed, 30 % = passed
      e. WONPROTO1,${NATIVE}      → record: 20 % = native code passed to the Won function, 10 % = not passed
 7. function run logs (timestamp-matched to each cart window): triggeringDiscountCode +
    enteredDiscountCodes seen by the automatic node and by each code node
 8. finally: delete all 4 nodes, list WON-PROTO nodes (must be 0)`;

/** Allocation made by the automatic node: its title is the function message WON:AUTO|… */
const autoPercent = (summary) => linePercent(summary, (allocation) => String(allocation.title).startsWith("WON:AUTO"));

await runExperiment("c1-entered-codes", PLAN, async ({ evidence, admin, cleanup, logs, storefront }) => {
  const nodes = {};

  evidence.step("create automatic node (echo_codes + echoOnAutomatic)");
  const auto = await admin.createAutomatic({
    title: "C1 auto echo",
    config: functionConfig({ mode: "echo_codes", echoOnAutomatic: true }),
  });
  cleanup.node(auto.discountId, "C1 auto echo");
  nodes.auto = auto;

  for (const code of CODES) {
    evidence.step(`create code node ${code} (echo_codes)`);
    const node = await admin.createCode({ title: `C1 ${code}`, code, config: functionConfig({ mode: "echo_codes" }) });
    cleanup.node(node.discountId, `C1 ${code}`);
    nodes[code] = node;
  }

  evidence.step(`create native basic code ${NATIVE} (5 %, not a Won function)`);
  const native = await admin.createNativeCode({ title: "C1 native", code: NATIVE, percentage: 0.05 });
  cleanup.node(native.discountId, "C1 native");
  nodes.native = native;

  evidence.data.nodes = nodes;
  evidence.data.storedConfigs = {};
  for (const [key, node] of Object.entries(nodes)) {
    if (key === "native") continue;
    evidence.data.storedConfigs[key] = await admin.readNodeConfig(node.discountId);
  }

  await storefront.open();

  const a = await observe({
    evidence, storefront,
    label: "a: WONPROTO1 only",
    codes: ["WONPROTO1"],
    expectation: "automatic allocation ≈ 10 % (saw 1 code)",
    expect: (summary) => approx(autoPercent(summary), 10),
    timeoutMs: 150_000,
  });
  const b = await observe({
    evidence, storefront,
    label: "b: WONPROTO1 + WONPROTO2",
    codes: CODES,
    expectation: "automatic allocation ≈ 20 % (saw 2 codes)",
    expect: (summary) => approx(autoPercent(summary), 20),
  });
  const c = await observe({
    evidence, storefront,
    label: "c: no codes",
    codes: [],
    expectation: "no automatic allocation (0 codes)",
    expect: (summary) => approx(autoPercent(summary), 0),
  });
  const d = await observe({
    evidence, storefront,
    label: `d: WONPROTO1 + WONPROTO2 + ${UNKNOWN} (non-existent)`,
    codes: [...CODES, UNKNOWN],
    expectation: "record: 20 % = unknown code not passed to the function, 30 % = passed",
    expect: () => true,
  });
  const e = await observe({
    evidence, storefront,
    label: `e: WONPROTO1 + ${NATIVE} (native code)`,
    codes: ["WONPROTO1", NATIVE],
    expectation: "record: 20 % = native code passed to the Won function, 10 % = not passed (native 5 % may win the line instead)",
    expect: () => true,
  });

  if (!evidence.live) return;
  await logs.attach(evidence);

  const byNode = (observation) => ({
    automatic: observation.functionRuns
      .filter((run) => run.triggeringDiscountCode === null)
      .map((run) => ({ at: run.logTimestamp, entered: run.enteredDiscountCodes, out: run.candidates.map((x) => `${x.message}@${x.percent}%`) })),
    code: observation.functionRuns
      .filter((run) => typeof run.triggeringDiscountCode === "string")
      .map((run) => ({ at: run.logTimestamp, triggering: run.triggeringDiscountCode, entered: run.enteredDiscountCodes, out: run.candidates.map((x) => `${x.message}@${x.percent}%`) })),
  });
  const seesBoth = (run) => CODES.every((code) => (run.entered ?? []).some((entry) => entry.code === code));
  const bRuns = byNode(b);
  evidence.data.verdictData = {
    autoPercentByObservation: { a: autoPercent(a.finalCart), b: autoPercent(b.finalCart), c: autoPercent(c.finalCart), d: autoPercent(d.finalCart), e: autoPercent(e.finalCart) },
    matched: { a: a.matched, b: b.matched, c: c.matched },
    discountCodes: { a: a.finalCart.discount_codes, b: b.finalCart.discount_codes, d: d.finalCart.discount_codes, e: e.finalCart.discount_codes },
    runsDuringB: bRuns,
    automaticSawBothCodes: b.matched && bRuns.automatic.length > 0 && bRuns.automatic.every(seesBoth),
    codeNodesSawBothCodes: bRuns.code.length > 0 ? bRuns.code.every(seesBoth) : null,
    codeNodeTriggeringCodesDuringB: [...new Set(bRuns.code.map((run) => run.triggering))].sort(),
    runsDuringD: byNode(d),
    runsDuringE: byNode(e),
  };
  console.log(`\nverdictData: ${JSON.stringify(evidence.data.verdictData, null, 2)}`);
});
