#!/usr/bin/env node
// Live facts the sync's code-node lifecycle depends on (T3 fix round 1, C1):
//   A. Does a DEACTIVATED (expired) code discount still block creating another
//      discount with the same code text? What do discountCodeDeactivate /
//      discountCodeActivate do to status/endsAt? Can a code discount lose its
//      LAST redeem code (bulk delete)?
//   B. Do SCHEDULED (future startsAt) code app discounts count toward Shopify's
//      "maximum of 25 discount functions" per store, and do CODE app discounts
//      count at all?
//
//   node apps/won-discounts/scripts/sync/verify-code-facts.mjs          # dry-run: plan + documents, sends nothing
//   WON_PROTO_OUT=<dir> node apps/won-discounts/scripts/sync/verify-code-facts.mjs --live
//
// Only CODE app discounts of this app's function are created (a code discount
// never applies unless its WON-PROTO code is entered, so other E2E suites on the
// shared dev store are unaffected), all titled "WON-PROTO …" so
// scripts/prototypes/verify-clean.mjs finds leftovers. Everything created is
// deleted in `finally`; SIGINT/SIGTERM wait for that cleanup. Mutations go
// only to the dev store (lib.mjs STORE). Every document below was validated
// with the Shopify dev MCP (admin 2026-04).

import fsp from "node:fs/promises";
import path from "node:path";

import { API_VERSION, FUNCTION_HANDLE, OUT_DIR, STORE, TITLE_PREFIX, now, shopifyExecute, sleep } from "../prototypes/lib.mjs";

const live = process.argv.includes("--live");
const SHOPIFY_CAP = 25;
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
const VARS = JSON.stringify({
  role: "code",
  ruleId: "won-proto-none",
  campaignId: null,
  campaignStart: "1970-01-01T00:00:00",
  campaignEnd: "1970-01-01T00:00:00",
  varsVersion: null,
});

const DOCS = {
  functions: `query WonFactsFunctions {
  shopifyFunctions(first: 50) {
    nodes {
      id
      handle
    }
  }
}`,
  list: `query WonFactsList($after: String) {
  discountNodes(first: 100, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        __typename
        ... on DiscountCodeApp {
          title
          status
          appDiscountType {
            functionId
          }
        }
        ... on DiscountAutomaticApp {
          title
          status
          appDiscountType {
            functionId
          }
        }
      }
    }
  }
}`,
  status: `query WonFactsStatus($id: ID!) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeApp {
        status
        startsAt
        endsAt
        codesCount {
          count
        }
        codes(first: 5) {
          nodes {
            id
            code
          }
        }
      }
    }
  }
}`,
  deactivate: `mutation WonFactsDeactivate($id: ID!) {
  discountCodeDeactivate(id: $id) {
    codeDiscountNode {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  activate: `mutation WonFactsActivate($id: ID!) {
  discountCodeActivate(id: $id) {
    codeDiscountNode {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  bulkDelete: `mutation WonFactsBulkDelete($discountId: ID!, $ids: [ID!]) {
  discountCodeRedeemCodeBulkDelete(discountId: $discountId, ids: $ids) {
    job {
      id
      done
    }
    userErrors {
      field
      message
      code
    }
  }
}`,
  job: `query WonFactsJob($id: ID!) {
  job(id: $id) {
    id
    done
  }
}`,
};

/** N aliased discountCodeAppCreate in one document (executed serially, in order). */
function createDoc(count) {
  const vars = Array.from({ length: count }, (_, i) => `$d${i}: DiscountCodeAppInput!`).join(", ");
  const body = Array.from(
    { length: count },
    (_, i) => `  c${i}: discountCodeAppCreate(codeAppDiscount: $d${i}) {
    codeAppDiscount {
      discountId
    }
    userErrors {
      field
      message
      code
    }
  }`,
  ).join("\n");
  return `mutation WonFactsCreate${count}(${vars}) {\n${body}\n}`;
}

/** N aliased discountCodeDelete in one document. */
function deleteDoc(count) {
  const vars = Array.from({ length: count }, (_, i) => `$id${i}: ID!`).join(", ");
  const body = Array.from(
    { length: count },
    (_, i) => `  x${i}: discountCodeDelete(id: $id${i}) {
    deletedCodeDiscountId
    userErrors {
      field
      message
    }
  }`,
  ).join("\n");
  return `mutation WonFactsDelete${count}(${vars}) {\n${body}\n}`;
}

function codeInput(title, code, startsAt) {
  return {
    title: `${TITLE_PREFIX} ${title}`,
    code,
    functionHandle: FUNCTION_HANDLE,
    startsAt,
    discountClasses: ["ORDER"],
    context: { all: "ALL" },
    appliesOncePerCustomer: false,
    combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
    metafields: [{ namespace: "$app:won_discounts", key: "function_vars", type: "json", value: VARS }],
  };
}

const evidence = {
  experiment: "verify-code-facts",
  mode: live ? "live" : "dry-run",
  store: STORE,
  apiVersion: API_VERSION,
  run: RUN,
  startedAt: now(),
  steps: [],
  facts: {},
  cleanup: null,
};
const log = (message, extra) => {
  evidence.steps.push({ at: now(), message, ...(extra === undefined ? {} : { extra }) });
  console.log(`- ${message}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
};

const printed = new Set();
async function gql(name, query, variables) {
  if (!live) {
    if (!printed.has(name)) {
      printed.add(name);
      console.log(`\n--- GraphQL ${name} (${API_VERSION}) ---\n${query}`);
    }
    return null;
  }
  return shopifyExecute(name, query, variables);
}

const created = new Set();
let stopping = null;
const onSignal = (signal) => {
  if (stopping) return console.log(`(${signal} again: still cleaning up)`);
  stopping = signal;
  console.log(`\n${signal}: finishing the current call, then cleaning up`);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
const guard = () => {
  if (stopping) throw new Error(`stopped by ${stopping}`);
};

async function createMany(inputs, label) {
  const results = [];
  for (let i = 0; i < inputs.length; i += 10) {
    guard();
    const batch = inputs.slice(i, i + 10);
    const variables = Object.fromEntries(batch.map((input, j) => [`d${j}`, input]));
    const data = await gql(`create-${label}`, createDoc(batch.length), variables);
    if (!data) return results;
    let stop = false;
    batch.forEach((input, j) => {
      const payload = data[`c${j}`];
      const id = payload?.codeAppDiscount?.discountId ?? null;
      if (id) created.add(id);
      results.push({ title: input.title, code: input.code, id, userErrors: payload?.userErrors ?? [] });
      if (!id) stop = true;
    });
    if (stop) break;
  }
  return results;
}

async function deleteMany(ids) {
  const out = [];
  const list = [...ids];
  for (let i = 0; i < list.length; i += 10) {
    const batch = list.slice(i, i + 10);
    const data = await shopifyExecute("delete", deleteDoc(batch.length), Object.fromEntries(batch.map((id, j) => [`id${j}`, id])));
    batch.forEach((id, j) => {
      const payload = data[`x${j}`];
      out.push({ id, deleted: payload?.deletedCodeDiscountId ?? null, userErrors: payload?.userErrors ?? [] });
      if (payload?.deletedCodeDiscountId || /not exist/i.test(JSON.stringify(payload?.userErrors ?? []))) created.delete(id);
    });
  }
  return out;
}

async function listApp(functionId) {
  const nodes = [];
  let after = null;
  for (;;) {
    const data = await shopifyExecute("list", DOCS.list, { after });
    for (const node of data.discountNodes.nodes) {
      const d = node.discount;
      if (d.__typename !== "DiscountCodeApp" && d.__typename !== "DiscountAutomaticApp") continue;
      nodes.push({ id: node.id, type: d.__typename, title: d.title, status: d.status, ours: d.appDiscountType?.functionId === functionId });
    }
    if (!data.discountNodes.pageInfo.hasNextPage) break;
    after = data.discountNodes.pageInfo.endCursor;
  }
  return nodes;
}

async function status(id) {
  const data = await shopifyExecute("status", DOCS.status, { id });
  return data.discountNode?.discount ?? null;
}

async function main() {
  console.log(`# verify-code-facts — ${live ? `LIVE on ${STORE}` : "DRY-RUN (nothing is sent; pass --live to execute)"}`);
  if (!live) {
    for (const [name, doc] of Object.entries(DOCS)) await gql(name, doc);
    await gql("create-N", createDoc(2));
    await gql("delete-N", deleteDoc(2));
    console.log("\nPlan: A) create WON-PROTO code discount, deactivate, create another with the same code, activate, delete its last code;");
    console.log(`      B) with the store's active app discounts counted, create scheduled code discounts up to ${SHOPIFY_CAP}, then active ones until Shopify refuses (≤ ${SHOPIFY_CAP + 1}); delete everything.`);
    return;
  }

  const fns = await shopifyExecute("functions", DOCS.functions);
  const functionId = fns.shopifyFunctions.nodes.find((fn) => fn.handle === FUNCTION_HANDLE)?.id;
  if (!functionId) throw new Error(`function ${FUNCTION_HANDLE} not found on ${STORE}`);
  const before = await listApp(functionId);
  const leftovers = before.filter((n) => n.title?.startsWith(TITLE_PREFIX));
  if (leftovers.length) throw new Error(`WON-PROTO leftovers on the store, run verify-clean first: ${JSON.stringify(leftovers)}`);
  const baseline = {
    appDiscounts: before.length,
    active: before.filter((n) => n.status === "ACTIVE").length,
    scheduled: before.filter((n) => n.status === "SCHEDULED").length,
    byStatus: before.map((n) => ({ type: n.type, status: n.status, ours: n.ours })),
  };
  evidence.facts.baseline = baseline;
  log("baseline app discounts on the store", { active: baseline.active, scheduled: baseline.scheduled, total: baseline.appDiscounts });

  // --- A ---------------------------------------------------------------------
  const code = `WONPROTOFA${RUN}`;
  const startedPast = new Date(Date.now() - 60_000).toISOString();
  const [a1] = await createMany([codeInput(`FACT-A1 ${RUN}`, code, startedPast)], "a1");
  if (!a1?.id) throw new Error(`could not create A1: ${JSON.stringify(a1?.userErrors)}`);
  log("A1 created", { id: a1.id, code, status: await status(a1.id) });

  guard();
  const deact = await shopifyExecute("deactivate", DOCS.deactivate, { id: a1.id });
  const afterDeactivate = await status(a1.id);
  log("A1 deactivated", { userErrors: deact.discountCodeDeactivate.userErrors, status: afterDeactivate });

  guard();
  const [a2] = await createMany([codeInput(`FACT-A2 ${RUN}`, code, startedPast)], "a2");
  const blocked = !a2?.id;
  log(`A2 with the same code while A1 is deactivated: ${blocked ? "REFUSED" : "CREATED"}`, { userErrors: a2?.userErrors ?? [] });

  guard();
  const act = await shopifyExecute("activate", DOCS.activate, { id: a1.id });
  const afterActivate = await status(a1.id);
  log("A1 activated again", { userErrors: act.discountCodeActivate.userErrors, status: afterActivate });

  guard();
  const lastCodeId = afterActivate?.codes?.nodes?.[0]?.id;
  const bulk = await shopifyExecute("bulk-delete", DOCS.bulkDelete, { discountId: a1.id, ids: [lastCodeId] });
  let jobDone = null;
  if (bulk.discountCodeRedeemCodeBulkDelete.job) {
    for (let i = 0; i < 10; i += 1) {
      const job = await shopifyExecute("job", DOCS.job, { id: bulk.discountCodeRedeemCodeBulkDelete.job.id });
      jobDone = job.job?.done ?? null;
      if (jobDone) break;
      await sleep(1500);
    }
  }
  const afterLastCode = await status(a1.id);
  log("A1: bulk delete of its LAST code", {
    userErrors: bulk.discountCodeRedeemCodeBulkDelete.userErrors,
    jobDone,
    codesCount: afterLastCode?.codesCount?.count ?? null,
    status: afterLastCode?.status ?? null,
  });
  evidence.facts.A = {
    deactivateSets: { status: afterDeactivate?.status, endsAt: afterDeactivate?.endsAt, startsAt: afterDeactivate?.startsAt },
    sameCodeOnAnotherDiscountWhileDeactivated: blocked ? "refused" : "allowed",
    sameCodeUserErrors: a2?.userErrors ?? [],
    activateSets: { status: afterActivate?.status, endsAt: afterActivate?.endsAt, startsAt: afterActivate?.startsAt },
    deleteLastCode: {
      userErrors: bulk.discountCodeRedeemCodeBulkDelete.userErrors,
      jobDone,
      codesCountAfter: afterLastCode?.codesCount?.count ?? null,
    },
  };
  log("A cleanup", await deleteMany([...created]));

  // --- B ---------------------------------------------------------------------
  guard();
  const room = Math.max(0, SHOPIFY_CAP - baseline.active);
  const future = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  const scheduled = await createMany(
    Array.from({ length: room }, (_, i) => codeInput(`FACT-B-SCHEDULED ${RUN} ${i + 1}`, `WONPROTOBS${RUN}${i + 1}`, future)),
    "b-scheduled",
  );
  const scheduledOk = scheduled.filter((r) => r.id).length;
  log(`B: ${scheduledOk}/${room} scheduled code discounts created`, { refused: scheduled.filter((r) => !r.id) });

  guard();
  const active = await createMany(
    Array.from({ length: room + 1 }, (_, i) => codeInput(`FACT-B-ACTIVE ${RUN} ${i + 1}`, `WONPROTOBA${RUN}${i + 1}`, startedPast)),
    "b-active",
  );
  const activeOk = active.filter((r) => r.id).length;
  const refusal = active.find((r) => !r.id) ?? null;
  log(`B: ${activeOk} active code discounts created before ${refusal ? "a refusal" : "stopping (none refused)"}`, {
    refusal,
  });
  const verdict =
    scheduledOk < room
      ? "scheduled creation itself was refused (see steps)"
      : refusal && activeOk === 0
        ? "SCHEDULED code app discounts COUNT toward the cap (the first active one after filling it with scheduled ones was refused)"
        : refusal && activeOk === room
          ? "scheduled do NOT count; ACTIVE code app discounts DO count (refused when active app discounts reached the cap)"
          : !refusal
            ? `neither counts: ${activeOk} active + ${scheduledOk} scheduled code app discounts were accepted on top of ${baseline.active} active app discounts`
            : `refused after ${activeOk} active (baseline ${baseline.active} active, ${scheduledOk} scheduled) — see steps`;
  evidence.facts.B = { baselineActive: baseline.active, room, scheduledCreated: scheduledOk, activeCreated: activeOk, refusal, verdict };
  log(`B verdict: ${verdict}`);
}

let failed = null;
try {
  await main();
} catch (error) {
  failed = error;
  evidence.error = String(error?.message ?? error).slice(0, 4000);
  console.error(`\n✖ ${evidence.error}`);
} finally {
  if (live) {
    const results = created.size ? await deleteMany([...created]) : [];
    evidence.cleanup = { deleted: results, remaining: [...created] };
    console.log(`\ncleanup: deleted ${results.filter((r) => r.deleted).length}, remaining ${created.size}`);
    evidence.finishedAt = now();
    await fsp.mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, "verify-code-facts.json");
    await fsp.writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`evidence: ${file}`);
  }
  process.exitCode = failed || created.size ? 1 : 0;
}
