#!/usr/bin/env node
// C3 — does a ~9 000 B function_config reach the function, and a >10 000 B one not?
//      Does the function read a per-product metafield?
//
// One automatic node (percent_all), its function_config rewritten with
// metafieldsSet between reads. Each size gets its own percent, so a stale read
// can never pass for a new state:
//   9 000 B → 11 %   10 100 B → 13 % (expected absent)
//   boundary probes: 10 000 B → 12 %, 10 001 B → 14 %
// Padding = an ignored top-level `_pad` key; campaignStart/End always present.
// Then mode product_metafield + product metafield {percent: 7} on won-e2e-simple-a → 7 %.
//
//   node apps/won-discounts/scripts/prototypes/c3-config-size.mjs              # dry-run
//   WON_PROTO_OUT=<dir> WON_PROTO_APP_DEV_LOG=<app-dev.log> \
//     node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c3-config-size.mjs --live

import {
  CONFIG_NAMESPACE,
  PRODUCT_HANDLE,
  PRODUCT_KEY,
  approx,
  bytes,
  functionConfig,
  observe,
  paddedConfigValue,
  runExperiment,
} from "./lib.mjs";

const STEPS = [
  { bytes: 9000, percent: 11, expect: "present" },
  { bytes: 10100, percent: 13, expect: "absent" },
  { bytes: 10000, percent: 12, expect: "record (boundary)" },
  { bytes: 10001, percent: 14, expect: "record (boundary)" },
];

const PLAN = `Plan:
 1. sweep leftover WON-PROTO nodes; read ${PRODUCT_HANDLE} product metafield (restore/delete at the end)
 2. create automatic node "WON-PROTO C3 size", config percent_all padded to ${STEPS[0].bytes} B
 3. for each size (metafieldsSet on the node, then fresh carts until 2 consecutive reads match):
${STEPS.map((step) => `      ${step.bytes} B, percent ${step.percent} → ${step.expect}`).join("\n")}
    stored size is read back (discountNode.metafield.value) and logged per step
 4. node config → {prototype:{mode:product_metafield}}; metafieldsSet ${PRODUCT_HANDLE} $app:won_discounts.product = {"percent":7}
    → cart discount ≈ 7 %
 5. finally: delete the node, delete/restore the product metafield, list WON-PROTO nodes (must be 0)`;

const autoPercent = (summary) => (summary ? (summary.totalDiscountPercent ?? 0) : null); // null in dry-run

await runExperiment("c3-config-size", PLAN, async ({ evidence, admin, cleanup, logs, storefront }) => {
  const product = await admin.product(PRODUCT_HANDLE);
  evidence.data.productBefore = { id: product.id, metafield: product.metafield };

  const valueFor = (step) => paddedConfigValue(functionConfig({ mode: "percent_all", percent: step.percent }), step.bytes);

  evidence.step(`create automatic node, config ${STEPS[0].bytes} B`);
  const node = await admin.createAutomatic({ title: "C3 size", configValue: valueFor(STEPS[0]) });
  cleanup.node(node.discountId, "C3 size");
  evidence.data.node = node;

  await storefront.open();
  const results = [];
  let previousPercent = null;
  for (const [index, step] of STEPS.entries()) {
    const value = valueFor(step);
    if (index > 0) {
      evidence.step(`metafieldsSet function_config = ${step.bytes} B (percent ${step.percent})`);
      await admin.setNodeConfig(node.discountId, value);
    }
    const stored = await admin.readNodeConfig(node.discountId);
    const before = previousPercent;
    const observation = await observe({
      evidence, storefront,
      label: `${step.bytes} B → percent ${step.percent}`,
      expectation:
        step.expect === "present"
          ? `≈${step.percent} % (config reaches the function)`
          : step.expect === "absent"
            ? "0 % (config above the function-input limit → no discount)"
            : `record: ${step.percent} % = present, 0 % = absent (previous state ${before} %)`,
      expect: (summary) => {
        const percent = autoPercent(summary);
        if (step.expect === "present") return approx(percent, step.percent);
        if (step.expect === "absent") return approx(percent, 0);
        // boundary: accept any state that differs from the previous one
        return approx(percent, step.percent) || (before !== null && !approx(before, 0) && approx(percent, 0));
      },
      timeoutMs: index === 0 ? 150_000 : 120_000,
    });
    previousPercent = autoPercent(observation.finalCart);
    results.push({ ...step, sentBytes: bytes(value), storedBytes: stored.storedBytes, observation: observation.label, matched: observation.matched, cartPercent: previousPercent });
  }

  evidence.step("switch node to product_metafield; set product metafield {percent:7}");
  await admin.setNodeConfig(node.discountId, JSON.stringify(functionConfig({ mode: "product_metafield" })));
  cleanup.metafield(
    { ownerId: product.id, namespace: CONFIG_NAMESPACE, key: PRODUCT_KEY },
    product.metafield ? { type: product.metafield.type, value: product.metafield.value } : null,
  );
  evidence.data.productMetafieldSet = await admin.setProductMetafield(product.id, JSON.stringify({ percent: 7 }));
  const productRead = await observe({
    evidence, storefront,
    label: "product_metafield {percent:7}",
    expectation: "≈7 % on the line (function reads the per-product metafield)",
    expect: (summary) => approx(autoPercent(summary), 7),
    timeoutMs: 150_000,
  });

  if (!evidence.live) return;
  await logs.attach(evidence);

  const runSummary = (observation) =>
    evidence.data.observations
      .find((entry) => entry.label === observation)
      ?.functionRuns.map((run) => ({
        at: run.logTimestamp,
        status: run.status,
        discountMetafield: run.discountMetafield,
        configJsonBytes: run.configJsonBytes,
        inputQueryVariables: run.inputQueryVariables,
        localTime: run.localTime,
        out: run.candidates.map((candidate) => `${candidate.message}@${candidate.percent}%`),
        productMetafields: run.productMetafields?.map((line) => line.wonProduct),
      }));
  evidence.data.verdictData = {
    sizes: results.map((result) => ({ ...result, runs: runSummary(result.observation) })),
    productMetafield: {
      matched: productRead.matched,
      cartPercent: autoPercent(productRead.finalCart),
      allocations: productRead.finalCart.items[0]?.line_level_discount_allocations,
      runs: runSummary(productRead.label),
    },
  };
  console.log(`\nverdictData: ${JSON.stringify(evidence.data.verdictData, null, 2)}`);
});
