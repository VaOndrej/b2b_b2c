import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Audit P3-2 / P3-3: the MVP 0 prototype scripts (scripts/prototypes/lib.mjs)
// write to the SHARED dev store, so their safety is proven here without a store:
// a fake executor stands in for `shopify app execute`.
//   - cleanup always finishes: a signal is deferred until the cleanup is done,
//     and a signal during the experiment never races new creates;
//   - a create is never repeated blindly after a transport failure;
//   - the sweep pages through every discount node and deletes only app
//     discounts of THIS app's function, plus our metafield on won-e2e products;
//   - modes that discount every cart need --confirm-store-wide; dry-run stays
//     the default.

type Lib = typeof import("../../scripts/prototypes/lib.mjs");
let lib: Lib;
let outDir = "";

before(async () => {
  // Evidence files of the "live" (fake) runs go to a throwaway dir.
  outDir = mkdtempSync(path.join(tmpdir(), "won-proto-lib-"));
  process.env.WON_PROTO_OUT = outDir;
  lib = await import("../../scripts/prototypes/lib.mjs");
});

after(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const FUNCTION_ID = "01a0e791-bf2a-77e6-9d45-e355028dabfe";
const OTHER_APP = "0000000000000000000000000000other";

type FakeNode = { id: string; type: string; title: string; status: string; functionId?: string; appKey?: string };
type Failure = "before" | "after" | "graphql";
/** The variables the lib sends, as far as the fake store reads them. */
type FakeVars = {
  after?: string;
  id?: string;
  identifier?: { handle: string };
  automaticAppDiscount?: { title: string };
  codeAppDiscount?: { title: string; code: string };
  basicCodeDiscount?: { title: string };
  metafields?: Array<{ ownerId: string; key: string; type?: string; value?: string }>;
};
type Call = { name: string; variables: FakeVars | undefined };

/** In-memory stand-in for the dev store behind `shopify app execute`. */
class FakeStore {
  nodes: FakeNode[] = [];
  products = new Map<string, { id: string; metafield: { id: string; type: string; value: string } | null }>();
  calls: Call[] = [];
  failures = new Map<string, Failure[]>();
  gates = new Map<string, Promise<void>>();
  pageSize = 100;
  private seq = 0;

  constructor(private clientId: string) {}

  addNode(node: Omit<FakeNode, "id" | "status"> & { id?: string; status?: string }) {
    const id = node.id ?? `gid://shopify/${node.type.includes("Automatic") ? "DiscountAutomaticNode" : "DiscountCodeNode"}/${++this.seq}`;
    const full: FakeNode = { status: "ACTIVE", ...node, id };
    this.nodes.push(full);
    return full;
  }

  ourNode(title: string, type = "DiscountAutomaticApp") {
    return this.addNode({ type, title, functionId: FUNCTION_ID, appKey: this.clientId });
  }

  addProduct(handle: string, withMetafield: boolean) {
    const id = `gid://shopify/Product/${++this.seq}`;
    this.products.set(handle, {
      id,
      metafield: withMetafield ? { id: `gid://shopify/Metafield/${++this.seq}`, type: "json", value: '{"percent":5}' } : null,
    });
    return id;
  }

  /** Make the next call(s) of `name` fail: "before" = request lost, "after" = applied but response lost. */
  failNext(name: string, ...modes: Failure[]) {
    this.failures.set(name, [...(this.failures.get(name) ?? []), ...modes]);
  }

  /** Hold every call of `name` until the returned release() is called. */
  gate(name: string) {
    let release!: () => void;
    this.gates.set(name, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.gates.delete(name);
      release();
    };
  }

  count(name: string) {
    return this.calls.filter((call) => call.name === name).length;
  }

  execute = async (name: string, _query: string, variables: FakeVars | undefined) => {
    this.calls.push({ name, variables });
    const gate = this.gates.get(name);
    if (gate) await gate;
    const mode = this.failures.get(name)?.shift();
    if (mode === "graphql") throw Object.assign(new Error("GraphQL errors: Field 'x' doesn't exist"), { stdout: "", stderr: "" });
    if (mode === "before") throw Object.assign(new Error("Command failed"), { stderr: "request to https://… failed, reason: socket hang up" });
    const result = this.apply(name, variables ?? {});
    if (mode === "after") throw Object.assign(new Error("Command failed"), { stderr: "HTTP 503 Service Unavailable" });
    return result;
  };

  private apply(name: string, v: FakeVars): unknown {
    switch (name) {
      case "functions":
        return {
          shopifyFunctions: { nodes: [{ id: FUNCTION_ID, handle: "won-discounts-engine", apiType: "discount", app: { title: "won-discounts" } }] },
          shop: { ianaTimezone: "America/New_York", timezoneOffset: "-0400" },
        };
      case "discountNodes": {
        const start = v?.after ? Number(v.after) : 0;
        const page = this.nodes.slice(start, start + this.pageSize);
        const end = start + page.length;
        return {
          discountNodes: {
            pageInfo: { hasNextPage: end < this.nodes.length, endCursor: String(end) },
            nodes: page.map((n) => ({
              id: n.id,
              discount: {
                __typename: n.type,
                title: n.title,
                status: n.status,
                ...(n.functionId ? { appDiscountType: { functionId: n.functionId, appKey: n.appKey } } : {}),
              },
            })),
          },
        };
      }
      case "automaticCreate": {
        const node = this.ourNode(v.automaticAppDiscount?.title ?? "");
        return { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: node.id, title: node.title, status: "ACTIVE" }, userErrors: [] } };
      }
      case "codeCreate": {
        const node = this.ourNode(v.codeAppDiscount?.title ?? "", "DiscountCodeApp");
        return {
          discountCodeAppCreate: {
            codeAppDiscount: { discountId: node.id, title: node.title, status: "ACTIVE", codes: { nodes: [{ code: v.codeAppDiscount?.code }] } },
            userErrors: [],
          },
        };
      }
      case "basicCodeCreate": {
        const node = this.addNode({ type: "DiscountCodeBasic", title: v.basicCodeDiscount?.title ?? "" });
        return { discountCodeBasicCreate: { codeDiscountNode: { id: node.id }, userErrors: [] } };
      }
      case "automaticDelete":
      case "codeDelete": {
        const before = this.nodes.length;
        this.nodes = this.nodes.filter((n) => n.id !== v.id);
        const key = name === "automaticDelete" ? "discountAutomaticDelete" : "discountCodeDelete";
        const idKey = name === "automaticDelete" ? "deletedAutomaticDiscountId" : "deletedCodeDiscountId";
        return before === this.nodes.length
          ? { [key]: { [idKey]: null, userErrors: [{ field: ["id"], message: "Discount does not exist", code: "INVALID" }] } }
          : { [key]: { [idKey]: v.id, userErrors: [] } };
      }
      case "product": {
        const handle = v.identifier?.handle ?? "";
        const product = this.products.get(handle);
        return { productByIdentifier: product ? { id: product.id, handle, metafield: product.metafield, variants: { nodes: [] } } : null };
      }
      case "metafieldsSet": {
        const metafields = v.metafields ?? [];
        for (const m of metafields) {
          for (const product of this.products.values()) {
            if (product.id === m.ownerId && m.key === "product") {
              product.metafield = { id: `gid://shopify/Metafield/${++this.seq}`, type: m.type ?? "json", value: m.value ?? "" };
            }
          }
        }
        return { metafieldsSet: { metafields: metafields.map((m) => ({ id: "gid://shopify/Metafield/x", key: m.key })), userErrors: [] } };
      }
      case "metafieldsDelete": {
        for (const m of v.metafields ?? []) {
          for (const product of this.products.values()) if (product.id === m.ownerId && m.key === "product") product.metafield = null;
        }
        return { metafieldsDelete: { deletedMetafields: v.metafields ?? [], userErrors: [] } };
      }
      case "redeemBulkAdd":
        return { discountRedeemCodeBulkAdd: { bulkCreation: { id: "gid://shopify/DiscountRedeemCodeBulkCreation/1", done: false }, userErrors: [] } };
      default:
        throw new Error(`fake store: unexpected ${name}`);
    }
  }
}

function setup(options: { confirmStoreWide?: boolean; live?: boolean } = {}) {
  const store = new FakeStore(lib.APP_CLIENT_ID);
  const evidence = new lib.Evidence(`test-${Math.random().toString(36).slice(2, 8)}`, options.live ?? true);
  const admin = new lib.Admin(evidence, options.live ?? true, {
    execute: store.execute,
    confirmStoreWide: options.confirmStoreWide ?? false,
    retryDelayMs: 0,
  });
  const signals = new EventEmitter();
  const exits: number[] = [];
  const cleanup = new lib.Cleanup(admin, evidence, { signals, exit: (code: number) => void exits.push(code) });
  return { store, evidence, admin, cleanup, signals, exits };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
/** Poll until `done()` (the signal handler also saves the evidence file before it exits). */
async function waitFor(done: () => boolean, timeoutMs = 3000) {
  const started = Date.now();
  while (!done() && Date.now() - started < timeoutMs) await new Promise((resolve) => setTimeout(resolve, 5));
}
const percentAll = { prototype: { mode: "percent_all", percent: 11 }, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00" };
const productMode = { prototype: { mode: "product_metafield" }, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00" };

// --- retries never repeat a create blindly -----------------------------------------------

test("a create whose response was lost (but which landed) is recovered by its exact title, never sent twice", async () => {
  const { store, admin, cleanup } = setup({ confirmStoreWide: true });
  await admin.functionInfo();
  store.ourNode("WON-PROTO C1 auto echo (older run, other title)");
  store.failNext("automaticCreate", "after");

  const created = await admin.createAutomatic({ title: "C1 auto echo", config: productMode });

  assert.equal(store.count("automaticCreate"), 1, "the create is not re-sent");
  const ours = store.nodes.filter((n) => n.title === "WON-PROTO C1 auto echo");
  assert.equal(ours.length, 1, "exactly one node exists");
  assert.equal(created.discountId, ours[0].id);
  assert.ok(cleanup.tasks.some((t: { id?: string }) => t.id === ours[0].id), "and it is registered for cleanup");
});

test("a create that never landed is re-sent only after the title lookup finds nothing", async () => {
  const { store, admin } = setup();
  await admin.functionInfo();
  store.failNext("codeCreate", "before");

  const created = await admin.createCode({ title: "C1 WONPROTO1", code: "WONPROTO1", config: productMode });

  assert.equal(store.count("codeCreate"), 2);
  const lookupIndex = store.calls.findIndex((c) => c.name === "discountNodes");
  const secondCreate = store.calls.map((c) => c.name).lastIndexOf("codeCreate");
  assert.ok(lookupIndex !== -1 && lookupIndex < secondCreate, "looked up by title before re-creating");
  assert.equal(store.nodes.filter((n) => n.title === "WON-PROTO C1 WONPROTO1").length, 1);
  assert.equal(created.discountId, store.nodes.at(-1)?.id);
});

test("a create that lands only on the last, still-failed attempt is registered for cleanup (audit fix4-3)", async () => {
  const { store, admin, cleanup } = setup({ confirmStoreWide: true });
  await admin.functionInfo();
  // Attempts 1 and 2 never reach the store (transport failure before landing);
  // attempt 3 lands (a node is created) but its response is lost, so the
  // whole call still reports failure -- the node it left behind must not be
  // silently orphaned.
  store.failNext("automaticCreate", "before", "before", "after");

  await assert.rejects(() => admin.createAutomatic({ title: "C1 last-attempt-orphan", config: productMode }));

  assert.equal(store.count("automaticCreate"), 3, "all three attempts were sent");
  const ours = store.nodes.filter((n) => n.title === "WON-PROTO C1 last-attempt-orphan");
  assert.equal(ours.length, 1, "the third attempt's node exists on the store");
  assert.ok(
    cleanup.tasks.some((t: { id?: string }) => t.id === ours[0].id),
    "the orphaned node from the last failed attempt is registered for cleanup",
  );
});

test("a GraphQL error is a result, never retried; redeemBulkAdd is never retried either", async () => {
  const { store, admin } = setup();
  store.failNext("functions", "graphql");
  await assert.rejects(() => admin.functionInfo(), /GraphQL functions failed/);
  assert.equal(store.count("functions"), 1);

  store.failNext("redeemBulkAdd", "before");
  await assert.rejects(() => admin.run("redeemBulkAdd", { discountId: "gid://shopify/DiscountCodeNode/1", codes: [{ code: "X" }] }));
  assert.equal(store.count("redeemBulkAdd"), 1);
});

test("isTransportError matches 502/503 only as status codes, not as any substring", () => {
  assert.equal(lib.isTransportError({ stderr: "HTTP 503 Service Unavailable" }), true);
  assert.equal(lib.isTransportError({ stderr: "status 502" }), true);
  assert.equal(lib.isTransportError({ stderr: "socket hang up" }), true);
  assert.equal(lib.isTransportError({ stderr: "discount gid://shopify/DiscountCodeNode/15023 not found" }), false);
  assert.equal(lib.isTransportError({ message: "GraphQL errors: invalid id 5030" }), false);
});

// --- the sweep ---------------------------------------------------------------------------------

test("the sweep pages through every node and deletes only WON-PROTO app discounts of this app's function", async () => {
  const { store, admin, cleanup, evidence } = setup();
  store.pageSize = 3;
  await admin.functionInfo();
  for (let i = 0; i < 7; i++) store.addNode({ type: "DiscountCodeBasic", title: `Merchant code ${i}` });
  const e2eNode = store.ourNode("WON-E2E automatic 10 %"); // ours, but not a prototype
  const leftoverA = store.ourNode("WON-PROTO C3 size"); // page 3
  const leftoverB = store.ourNode("WON-PROTO C2 node 1", "DiscountCodeApp");
  const otherApp = store.addNode({ type: "DiscountAutomaticApp", title: "WON-PROTO lookalike", functionId: "someone-else", appKey: OTHER_APP });
  const native = store.addNode({ type: "DiscountCodeBasic", title: "WON-PROTO C1 native" });
  const leftoverC = store.ourNode("WON-PROTO C4 campaign"); // last page

  store.addProduct("won-e2e-simple-a", true);
  store.addProduct("won-e2e-simple-b", true);
  store.addProduct("won-e2e-spare", false);
  const foreignProductId = store.addProduct("some-merchant-product", true);

  await cleanup.sweepLeftovers();

  const remaining = new Set(store.nodes.map((n) => n.id));
  for (const gone of [leftoverA, leftoverB, leftoverC]) assert.equal(remaining.has(gone.id), false, `${gone.title} deleted`);
  for (const kept of [e2eNode, otherApp, native]) assert.equal(remaining.has(kept.id), true, `${kept.title} kept`);
  assert.equal(store.nodes.length, 7 + 3, "merchant nodes untouched");
  assert.ok(store.count("discountNodes") >= 5, "every page was read");
  assert.deepEqual(
    (evidence.data.cleanup.foreignNodes as Array<{ id: string }>).map((n) => n.id).sort(),
    [otherApp.id, native.id].sort(),
    "prefix-only matches are reported, not deleted",
  );
  assert.equal(store.products.get("won-e2e-simple-a")?.metafield, null);
  assert.equal(store.products.get("won-e2e-simple-b")?.metafield, null);
  assert.notEqual(store.products.get("some-merchant-product")?.metafield, null, "non-e2e products are never touched");
  assert.ok(!store.calls.some((c) => JSON.stringify(c.variables ?? {}).includes(foreignProductId)));
});

test("without a known function id the sweep deletes nothing", async () => {
  const { store, cleanup } = setup();
  const leftover = store.ourNode("WON-PROTO C3 size");
  await cleanup.sweepLeftovers();
  assert.ok(store.nodes.some((n) => n.id === leftover.id));
  assert.equal(store.count("automaticDelete"), 0);
});

test("the cleanup removes registered nodes AND unregistered duplicates of this run (post-run sweep)", async () => {
  const { store, admin, cleanup, evidence } = setup();
  await admin.functionInfo();
  await admin.createCode({ title: "C2 node 1", code: "WONPROTO1", config: productMode });
  store.ourNode("WON-PROTO C2 node 1"); // a duplicate nobody registered
  store.addProduct("won-e2e-simple-b", false);
  const product = await admin.product("won-e2e-simple-b");
  await admin.setProductMetafield(product.id, '{"percent":5}');

  await cleanup.run();

  assert.equal(store.nodes.length, 0);
  assert.equal(store.products.get("won-e2e-simple-b")?.metafield, null);
  assert.equal(evidence.data.cleanup.ok, true);
});

// --- signals ----------------------------------------------------------------------------------

test("SIGINT during the cleanup waits for the cleanup to finish before exiting", async () => {
  const { store, admin, cleanup, signals, exits } = setup();
  await admin.functionInfo();
  await admin.createCode({ title: "C2 node 1", code: "WONPROTO1", config: productMode });
  await admin.createCode({ title: "C2 node 2", code: "WONPROTO2", config: productMode });
  const release = store.gate("codeDelete");

  const finallyCleanup = cleanup.run(); // what runExperiment's finally does
  await settle();
  signals.emit("SIGINT", "SIGINT");
  signals.emit("SIGINT", "SIGINT"); // impatient second Ctrl+C
  await settle();
  assert.deepEqual(exits, [], "no exit while a delete is still pending");

  release();
  await finallyCleanup;
  await waitFor(() => exits.length > 0);
  assert.deepEqual(exits, [130], "exactly one exit, after the cleanup");
  assert.equal(store.nodes.length, 0, "every node was deleted");
  assert.equal(store.count("codeDelete"), 2, "each delete sent once — the signal did not start a second cleanup");
});

test("SIGINT during the experiment blocks new creates, and a create already in flight is still cleaned up", async () => {
  const { store, admin, signals, exits } = setup();
  await admin.functionInfo();
  const release = store.gate("codeCreate");

  const inFlight = admin.createCode({ title: "C1 WONPROTO1", code: "WONPROTO1", config: productMode });
  await settle();
  signals.emit("SIGTERM", "SIGTERM");
  await settle();
  await assert.rejects(
    () => admin.createCode({ title: "C1 WONPROTO2", code: "WONPROTO2", config: productMode }),
    /not sent: SIGTERM received/,
  );
  assert.equal(store.count("codeCreate"), 1, "the body cannot create anything after the signal");

  release();
  await inFlight;
  await waitFor(() => exits.length > 0);
  assert.deepEqual(exits, [143]);
  assert.equal(store.nodes.length, 0, "the node created by the in-flight call was deleted");
});

test("a signal while a failed create waits for its retry stops the re-send", async () => {
  const { store, admin, signals, exits } = setup();
  await admin.functionInfo();
  store.failNext("codeCreate", "before");
  (admin as unknown as { retryDelayMs: number }).retryDelayMs = 50;

  const attempt = admin.createCode({ title: "C2 node 1", code: "WONPROTO1", config: productMode });
  await new Promise((resolve) => setTimeout(resolve, 10)); // inside the retry wait
  signals.emit("SIGINT", "SIGINT");
  await assert.rejects(attempt, /not retried: SIGINT received/);
  await waitFor(() => exits.length > 0);
  assert.equal(store.count("codeCreate"), 1, "the create was not sent again after the signal");
  assert.deepEqual(exits, [130]);
});

// --- store-wide modes, dry-run default ------------------------------------------------------

test("storeWideReason flags modes that discount every cart", () => {
  assert.match(String(lib.storeWideReason(percentAll)), /percent_all/);
  assert.match(String(lib.storeWideReason(JSON.stringify({ prototype: { mode: "campaign_window" } }))), /campaign_window/);
  assert.match(String(lib.storeWideReason({ prototype: { mode: "echo_codes", echoOnAutomatic: true } })), /echoOnAutomatic/);
  assert.equal(lib.storeWideReason({ prototype: { mode: "echo_codes" } }), null);
  assert.equal(lib.storeWideReason(productMode), null);
  assert.equal(lib.storeWideReason("{not json"), null);
});

test("a store-wide automatic node needs --confirm-store-wide in a live run (nothing is sent without it)", async () => {
  const refused = setup();
  await refused.admin.functionInfo();
  await assert.rejects(() => refused.admin.createAutomatic({ title: "C3 size", config: percentAll }), /--confirm-store-wide/);
  await assert.rejects(
    () => refused.admin.createAutomatic({ title: "C1 auto echo", config: { prototype: { mode: "echo_codes", echoOnAutomatic: true } } }),
    /--confirm-store-wide/,
  );
  await assert.rejects(
    () => refused.admin.setNodeConfig("gid://shopify/DiscountAutomaticNode/1", JSON.stringify(percentAll)),
    /--confirm-store-wide/,
  );
  assert.equal(refused.store.count("automaticCreate") + refused.store.count("metafieldsSet"), 0);

  // Not store-wide: a product-scoped automatic node, or a code node (needs the code).
  await refused.admin.createAutomatic({ title: "C3 product", config: productMode });
  await refused.admin.createCode({ title: "C2 node 1", code: "WONPROTO1", config: percentAll });

  const confirmed = setup({ confirmStoreWide: true });
  await confirmed.admin.functionInfo();
  await confirmed.admin.createAutomatic({ title: "C3 size", config: percentAll });
  assert.equal(confirmed.store.count("automaticCreate"), 1);
});

test("dry-run is the default and never reaches the executor", async () => {
  assert.deepEqual(lib.parseArgs(["node", "c3.mjs"]), { live: false, confirmStoreWide: false });
  assert.deepEqual(lib.parseArgs(["node", "c3.mjs", "--live", "--confirm-store-wide"]), { live: true, confirmStoreWide: true });

  const { store, admin, cleanup } = setup({ live: false });
  const log = console.log;
  console.log = () => {};
  try {
    await admin.functionInfo();
    await admin.createAutomatic({ title: "C3 size", config: percentAll }); // flagged, not refused, in a dry-run
    await cleanup.sweepLeftovers();
    await cleanup.run();
  } finally {
    console.log = log;
  }
  assert.equal(store.calls.length, 0);
});

test("product metafields are only ever written on won-e2e products", async () => {
  const { store, admin } = setup();
  const merchantId = store.addProduct("some-merchant-product", false);
  await admin.product("some-merchant-product");
  await assert.rejects(() => admin.setProductMetafield(merchantId, '{"percent":5}'), /not a won-e2e-\* product/);
  assert.equal(store.count("metafieldsSet"), 0);
  assert.ok(lib.E2E_PRODUCT_HANDLES.length >= 2 && lib.E2E_PRODUCT_HANDLES.every((h: string) => h.startsWith("won-e2e-")));
});
