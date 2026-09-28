// Won discount nodes in Shopify ↔ the desired nodes of a config (nodes.ts),
// tracked in Prisma WonNode (key "auto" | "code:<ruleId>"). Only nodes in
// WonNode are ever updated or deleted; a node of THIS app's function that a
// lost response / crash left untracked is ADOPTED (matched by the exact code
// for a code node, by title "Won Discounts" for the automatic one) instead of
// being duplicated. Nothing else on the store is touched.
//
// Passes (codes are unique per store, so a code moving between two rules must
// leave the old node before it can join the new one):
//   A. delete tracked nodes no longer desired (disabled / deleted rules);
//   B. existing nodes: update changed properties, remove dropped codes (async
//      bulk delete by redeem-code id), queue added codes;
//      → wait for the removal jobs;
//   C. missing nodes: adopt, or create WITH their function_vars metafield
//      (C4: a node without campaignStart/End would fail every run);
//   D. add queued codes (discountRedeemCodeBulkAdd, ≤ 250 per call, async:
//      polled; per-code failures reported);
//   then function_vars for every node that was not just created with them.
// `varsComplete` tells the caller whether EVERY existing Won node now carries
// the desired function_vars (phase 2 of a campaign switch, function-payload.ts).

import type { PrismaClient } from "../../generated/prisma/client";
import { canonicalJson } from "./products";
import { NODE_VARS_KEY, WON_NAMESPACE } from "./graphql";
import {
  ALL_COMBINE,
  AUTO_NODE_TITLE,
  codesHash,
  FUNCTION_HANDLE,
  payloadHash,
  type DesiredNode,
} from "./nodes";
import { errorText, setMetafields, userErrorText, type Transport, type UserErrorLike } from "./transport";
import type { SyncStep } from "./types";

/** Shopify: discountRedeemCodeBulkAdd takes at most 250 codes per call. */
export const REDEEM_CODES_PER_CALL = 250;
const NODES_PER_READ = 100;
const METAFIELDS_PER_SET = 25;

export interface RemoteNode {
  id: string;
  kind: "automatic" | "code";
  title: string;
  startsAt: string;
  endsAt: string | null;
  discountClasses: string[];
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
  usageLimit: number | null;
  appliesOncePerCustomer: boolean;
  codesCount: number | null;
  vars: string | null;
}

interface WonNodeRow {
  key: string;
  role: string;
  ruleId: string | null;
  discountNodeId: string;
  codesHash: string | null;
  varsVersion: string | null;
}

interface NodeState {
  desired: DesiredNode;
  nodeId: string;
  /** function_vars currently on the node (null = unknown/absent). */
  vars: string | null;
  /** A code change failed or is still running: the codes hash is not saved (re-read next sync). */
  codesFailed: boolean;
  codesHash: string | null;
}

interface NodeSyncArgs {
  transport: Transport;
  db: PrismaClient;
  shop: string;
  now: Date;
  desired: DesiredNode[];
  /** The exact function_vars JSON each desired node must carry. */
  varsJson: (node: DesiredNode) => string;
  record: (step: SyncStep) => void;
}

type DiscountNodeData = {
  __typename?: string;
  id?: string;
  vars?: { value: string } | null;
  automaticDiscount?: Record<string, unknown> | null;
  codeDiscount?: Record<string, unknown> | null;
} | null;

function parseRemote(node: DiscountNodeData): RemoteNode | null {
  if (!node?.id) return null;
  const vars = node.vars?.value ?? null;
  const discount =
    node.__typename === "DiscountAutomaticNode" && node.automaticDiscount?.__typename === "DiscountAutomaticApp"
      ? { kind: "automatic" as const, d: node.automaticDiscount }
      : node.__typename === "DiscountCodeNode" && node.codeDiscount?.__typename === "DiscountCodeApp"
        ? { kind: "code" as const, d: node.codeDiscount }
        : null;
  if (!discount) return null;
  const d = discount.d as {
    title: string;
    startsAt: string;
    endsAt: string | null;
    discountClasses?: string[];
    combinesWith?: RemoteNode["combinesWith"];
    usageLimit?: number | null;
    appliesOncePerCustomer?: boolean;
    codesCount?: { count: number } | null;
  };
  return {
    id: node.id,
    kind: discount.kind,
    title: d.title,
    startsAt: d.startsAt,
    endsAt: d.endsAt ?? null,
    discountClasses: d.discountClasses ?? [],
    combinesWith: d.combinesWith ?? { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
    usageLimit: d.usageLimit ?? null,
    appliesOncePerCustomer: d.appliesOncePerCustomer ?? false,
    codesCount: d.codesCount?.count ?? null,
    vars,
  };
}

const sameInstant = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);

/** The properties that differ between Shopify and the desired node (empty = up to date). */
export function nodeDiff(desired: DesiredNode, remote: RemoteNode, now: Date): string[] {
  const diff: string[] = [];
  if (remote.title !== desired.title) diff.push("title");
  if ([...remote.discountClasses].sort().join() !== [...desired.discountClasses].sort().join()) diff.push("discountClasses");
  const c = remote.combinesWith;
  if (!c.productDiscounts || !c.orderDiscounts || !c.shippingDiscounts) diff.push("combinesWith");
  if (!sameInstant(desired.endsAt, remote.endsAt)) diff.push("endsAt");
  if (desired.startsAt !== null ? !sameInstant(desired.startsAt, remote.startsAt) : Date.parse(remote.startsAt) > now.getTime()) {
    diff.push("startsAt");
  }
  if (desired.role.kind === "code") {
    if (remote.usageLimit !== desired.usageLimit) diff.push("usageLimit");
    if (remote.appliesOncePerCustomer !== desired.appliesOncePerCustomer) diff.push("appliesOncePerCustomer");
  }
  return diff;
}

function updateInput(desired: DesiredNode, remote: RemoteNode, now: Date): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: desired.title,
    discountClasses: desired.discountClasses,
    combinesWith: { ...ALL_COMBINE },
    endsAt: desired.endsAt,
  };
  if (desired.startsAt !== null) input.startsAt = desired.startsAt;
  else if (Date.parse(remote.startsAt) > now.getTime()) input.startsAt = now.toISOString();
  if (desired.role.kind === "code") {
    input.usageLimit = desired.usageLimit;
    input.appliesOncePerCustomer = desired.appliesOncePerCustomer;
  }
  return input;
}

function createInput(desired: DesiredNode, now: Date, varsJson: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: desired.title,
    functionHandle: FUNCTION_HANDLE,
    startsAt: desired.startsAt ?? now.toISOString(),
    discountClasses: desired.discountClasses,
    combinesWith: { ...ALL_COMBINE },
    metafields: [{ namespace: WON_NAMESPACE, key: NODE_VARS_KEY, type: "json", value: varsJson }],
  };
  if (desired.endsAt !== null) input.endsAt = desired.endsAt;
  if (desired.role.kind === "code") {
    input.code = desired.codes[0];
    input.context = { all: "ALL" };
    input.appliesOncePerCustomer = desired.appliesOncePerCustomer;
    if (desired.usageLimit !== null) input.usageLimit = desired.usageLimit;
  }
  return input;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class NodeSync {
  /** True once every desired node that exists in Shopify carries the desired function_vars. */
  varsComplete = false;
  private functionId: string | null | undefined;
  private readonly states = new Map<string, NodeState>();
  private readonly pendingAdds: { key: string; nodeId: string; codes: string[] }[] = [];
  private readonly removalJobs: { key: string; jobId: string }[] = [];
  private tracked = new Map<string, WonNodeRow>();

  constructor(private readonly a: NodeSyncArgs) {}

  private step(step: string, ok: boolean, detail: string): void {
    this.a.record({ step, ok, detail });
  }

  async run(): Promise<void> {
    const { db, shop } = this.a;
    const rows = await db.wonNode.findMany({ where: { shop } });
    this.tracked = new Map(rows.map((row) => [row.key, row]));
    const remote = await this.readNodes(rows.map((row) => row.discountNodeId));
    const desiredKeys = new Set(this.a.desired.map((node) => node.key));

    // A. Deletions.
    for (const row of rows) {
      if (desiredKeys.has(row.key)) continue;
      await this.deleteNode(row, remote.get(row.discountNodeId) ?? null);
    }

    // B. Existing nodes.
    const missing: DesiredNode[] = [];
    for (const desired of this.a.desired) {
      const row = this.tracked.get(desired.key);
      const node = row ? remote.get(row.discountNodeId) ?? null : null;
      if (row && (!node || node.kind !== desired.role.kind)) {
        await db.wonNode.deleteMany({ where: { shop, key: desired.key } });
        this.tracked.delete(desired.key);
        this.step(`node.missing:${desired.key}`, true, `the tracked discount ${row.discountNodeId} is gone in Shopify; it is recreated`);
      }
      if (!row || !node || node.kind !== desired.role.kind) {
        missing.push(desired);
        continue;
      }
      await this.reconcileExisting(desired, node, row.codesHash);
    }
    await this.awaitRemovals();

    // C. Missing nodes.
    for (const desired of missing) await this.ensureNode(desired);

    // D. Code additions.
    await this.addCodes();

    await this.writeVars();
    await this.saveCodesHashes();
  }

  private async readNodes(ids: string[]): Promise<Map<string, RemoteNode | null>> {
    const out = new Map<string, RemoteNode | null>();
    for (const batch of chunks(ids, NODES_PER_READ)) {
      const data: { nodes: DiscountNodeData[] } = await this.a.transport.call("nodes", { ids: batch });
      batch.forEach((id, i) => out.set(id, parseRemote(data.nodes[i] ?? null)));
    }
    return out;
  }

  private async deleteNode(row: WonNodeRow, node: RemoteNode | null): Promise<void> {
    const { db, shop } = this.a;
    const key = row.key;
    if (!node) {
      await db.wonNode.deleteMany({ where: { shop, key } });
      this.step(`node.delete:${key}`, true, "already gone in Shopify; no longer tracked");
      return;
    }
    try {
      const automatic = node.kind === "automatic";
      const data: Record<string, { userErrors: UserErrorLike[] }> = await this.a.transport.call(
        automatic ? "automaticDelete" : "codeDelete",
        { id: node.id },
      );
      const payload = data[automatic ? "discountAutomaticDelete" : "discountCodeDelete"];
      const error = userErrorText(payload?.userErrors);
      if (error && !/does not exist|not found/i.test(error)) {
        this.step(`node.delete:${key}`, false, `could not delete "${node.title}": ${error}`);
        return;
      }
      await db.wonNode.deleteMany({ where: { shop, key } });
      this.step(`node.delete:${key}`, true, `deleted "${node.title}" (rule disabled or removed)`);
    } catch (error) {
      this.step(`node.delete:${key}`, false, `could not delete "${node.title}": ${errorText(error)}`);
    }
  }

  private async reconcileExisting(desired: DesiredNode, node: RemoteNode, storedCodesHash: string | null): Promise<void> {
    const state: NodeState = { desired, nodeId: node.id, vars: node.vars, codesFailed: false, codesHash: storedCodesHash };
    this.states.set(desired.key, state);
    const diff = nodeDiff(desired, node, this.a.now);
    if (diff.length > 0) {
      const automatic = desired.role.kind === "automatic";
      try {
        const data: Record<string, { userErrors: UserErrorLike[] }> = await this.a.transport.call(
          automatic ? "automaticUpdate" : "codeUpdate",
          { id: node.id, [automatic ? "automaticAppDiscount" : "codeAppDiscount"]: updateInput(desired, node, this.a.now) },
        );
        const error = userErrorText(data[automatic ? "discountAutomaticAppUpdate" : "discountCodeAppUpdate"]?.userErrors);
        this.step(`node.update:${desired.key}`, !error, error ? `could not update "${desired.title}": ${error}` : `updated ${diff.join(", ")}`);
      } catch (error) {
        this.step(`node.update:${desired.key}`, false, `could not update "${desired.title}": ${errorText(error)}`);
      }
    }
    if (desired.role.kind === "code") await this.planCodes(state, node.codesCount);
  }

  /** Diff the node's redeem codes with the rule's; removals start now, additions are queued. */
  private async planCodes(state: NodeState, codesCount: number | null): Promise<void> {
    const { desired } = state;
    const wanted = codesHash(desired.codes);
    if (state.codesHash === wanted && codesCount === desired.codes.length) return;
    let existing: { id: string; code: string }[];
    try {
      existing = await this.readCodes(state.nodeId);
    } catch (error) {
      state.codesFailed = true;
      this.step(`codes:${desired.key}`, false, `could not read the codes of "${desired.title}": ${errorText(error)}`);
      return;
    }
    const want = new Set(desired.codes.map((code) => code.toUpperCase()));
    const have = new Set(existing.map((c) => c.code.toUpperCase()));
    const remove = existing.filter((c) => !want.has(c.code.toUpperCase()));
    const add = desired.codes.filter((code) => !have.has(code.toUpperCase()));
    if (remove.length === 0 && add.length === 0) {
      state.codesHash = null; // confirmed equal: saved as the desired hash below
      return;
    }
    state.codesHash = null;
    if (add.length > 0) this.pendingAdds.push({ key: desired.key, nodeId: state.nodeId, codes: add });
    for (const batch of chunks(remove, REDEEM_CODES_PER_CALL)) {
      try {
        const data: { discountCodeRedeemCodeBulkDelete: { job: { id: string } | null; userErrors: UserErrorLike[] } } =
          await this.a.transport.call("redeemBulkDelete", { discountId: state.nodeId, ids: batch.map((c) => c.id) });
        const payload = data.discountCodeRedeemCodeBulkDelete;
        const error = userErrorText(payload.userErrors);
        if (error || !payload.job) {
          state.codesFailed = true;
          this.step(`codes.remove:${desired.key}`, false, `could not remove ${batch.length} code(s) from "${desired.title}": ${error ?? "no job"}`);
          continue;
        }
        this.removalJobs.push({ key: desired.key, jobId: payload.job.id });
        this.step(`codes.remove:${desired.key}`, true, `removing ${batch.length} code(s): ${batch.map((c) => c.code).slice(0, 10).join(", ")}${batch.length > 10 ? ", …" : ""}`);
      } catch (error) {
        state.codesFailed = true;
        this.step(`codes.remove:${desired.key}`, false, `could not remove codes from "${desired.title}": ${errorText(error)}`);
      }
    }
  }

  private async readCodes(nodeId: string): Promise<{ id: string; code: string }[]> {
    const out: { id: string; code: string }[] = [];
    let after: string | null = null;
    for (;;) {
      const data: {
        discountNode: {
          discount: { codes?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; code: string }[] } } | null;
        } | null;
      } = await this.a.transport.call("nodeCodes", { id: nodeId, after });
      const codes = data.discountNode?.discount?.codes;
      if (!codes) break;
      out.push(...codes.nodes);
      if (!codes.pageInfo.hasNextPage) break;
      after = codes.pageInfo.endCursor;
    }
    return out;
  }

  private async awaitRemovals(): Promise<void> {
    for (const { key, jobId } of this.removalJobs) {
      const state = this.states.get(key);
      try {
        const { done } = await this.a.transport.poll(
          async () => ((await this.a.transport.call("job", { id: jobId })) as { job: { done: boolean } | null }).job,
          (job) => job?.done === true,
        );
        if (!done) {
          if (state) state.codesFailed = true;
          this.step(`codes.remove:${key}`, false, `code removal job ${jobId} still running; codes are checked again on the next sync`);
        }
      } catch (error) {
        if (state) state.codesFailed = true;
        this.step(`codes.remove:${key}`, false, `could not check code removal job ${jobId}: ${errorText(error)}`);
      }
    }
  }

  private async ourFunctionId(): Promise<string | null> {
    if (this.functionId !== undefined) return this.functionId;
    try {
      const data: { shopifyFunctions: { nodes: { id: string; handle: string }[] } } = await this.a.transport.call("functions");
      this.functionId = data.shopifyFunctions.nodes.find((fn) => fn.handle === FUNCTION_HANDLE)?.id ?? null;
    } catch {
      this.functionId = null;
    }
    return this.functionId;
  }

  private trackedIds(): Set<string> {
    return new Set([...this.tracked.values()].map((row) => row.discountNodeId));
  }

  /**
   * A node of THIS app's function that already represents `desired` in
   * Shopify but is not tracked (lost create response, crash before the
   * WonNode write). Code node: the node owning its first code; automatic:
   * an automatic node titled "Won Discounts". Anything not ours → foreign.
   */
  private async findExisting(desired: DesiredNode): Promise<{ ours: string } | { foreign: string } | null> {
    const functionId = await this.ourFunctionId();
    const tracked = this.trackedIds();
    if (desired.role.kind === "code") {
      const code = desired.codes[0]!;
      const data: {
        codeDiscountNodeByCode: { id: string; codeDiscount: { __typename: string; title?: string; appDiscountType?: { functionId: string } } } | null;
      } = await this.a.transport.call("codeLookup", { code });
      const found = data.codeDiscountNodeByCode;
      if (!found) return null;
      const title = found.codeDiscount.title ?? found.codeDiscount.__typename;
      if (functionId && found.codeDiscount.appDiscountType?.functionId === functionId) {
        if (tracked.has(found.id)) {
          const owner = [...this.tracked.values()].find((row) => row.discountNodeId === found.id);
          return { foreign: `the code ${code} is still on the Won discount for ${owner?.key ?? found.id} ("${title}"); it moves on the next sync` };
        }
        return { ours: found.id };
      }
      return { foreign: `the code ${code} is already used by the discount "${title}" — remove it there or pick another code` };
    }
    if (!functionId) return null;
    let after: string | null = null;
    for (;;) {
      const data: {
        discountNodes: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: { id: string; discount: { __typename: string; title?: string; appDiscountType?: { functionId: string } } }[];
        };
      } = await this.a.transport.call("automaticLookup", { after });
      const match = data.discountNodes.nodes.find(
        (node) =>
          node.discount.__typename === "DiscountAutomaticApp" &&
          node.discount.title === AUTO_NODE_TITLE &&
          node.discount.appDiscountType?.functionId === functionId &&
          !tracked.has(node.id),
      );
      if (match) return { ours: match.id };
      if (!data.discountNodes.pageInfo.hasNextPage) return null;
      after = data.discountNodes.pageInfo.endCursor;
    }
  }

  private async track(desired: DesiredNode, nodeId: string, varsVersion: string | null): Promise<void> {
    const { db, shop } = this.a;
    const data = {
      role: desired.role.kind,
      ruleId: desired.role.kind === "code" ? desired.role.ruleId : null,
      discountNodeId: nodeId,
      codesHash: null,
      varsVersion,
    };
    const row = await db.wonNode.upsert({
      where: { shop_key: { shop, key: desired.key } },
      create: { shop, key: desired.key, ...data },
      update: data,
    });
    this.tracked.set(desired.key, row);
  }

  private async ensureNode(desired: DesiredNode): Promise<void> {
    const key = desired.key;
    let existing: Awaited<ReturnType<NodeSync["findExisting"]>>;
    try {
      existing = await this.findExisting(desired);
    } catch (error) {
      this.step(`node.create:${key}`, false, `could not check Shopify before creating "${desired.title}": ${errorText(error)}`);
      return;
    }
    if (existing && "foreign" in existing) {
      this.step(`node.create:${key}`, false, `"${desired.title}" not created: ${existing.foreign}`);
      return;
    }
    if (existing) {
      const [node] = (await this.readNodes([existing.ours])).values();
      if (!node) {
        this.step(`node.adopt:${key}`, false, `found ${existing.ours} but could not read it`);
        return;
      }
      await this.track(desired, node.id, null);
      this.step(`node.adopt:${key}`, true, `"${desired.title}" already existed in Shopify (${node.id}); tracked again`);
      await this.reconcileExisting(desired, node, null);
      return;
    }

    const vars = this.a.varsJson(desired);
    const automatic = desired.role.kind === "automatic";
    const variables = { [automatic ? "automaticAppDiscount" : "codeAppDiscount"]: createInput(desired, this.a.now, vars) };
    type CreatePayload = Record<string, { automaticAppDiscount?: { discountId: string } | null; codeAppDiscount?: { discountId: string } | null; userErrors: UserErrorLike[] }>;
    const payloadKey = automatic ? "discountAutomaticAppCreate" : "discountCodeAppCreate";
    let nodeId: string | null = null;
    try {
      const data: CreatePayload = await this.a.transport.call(automatic ? "automaticCreate" : "codeCreate", variables, {
        idempotent: false,
        recover: async () => {
          const found = await this.findExisting(desired);
          if (!found || !("ours" in found)) return null;
          const discount = { discountId: found.ours };
          return { [payloadKey]: { automaticAppDiscount: discount, codeAppDiscount: discount, userErrors: [] } };
        },
      });
      const payload = data[payloadKey];
      const error = userErrorText(payload?.userErrors);
      nodeId = (automatic ? payload?.automaticAppDiscount?.discountId : payload?.codeAppDiscount?.discountId) ?? null;
      if (error || !nodeId) {
        this.step(`node.create:${key}`, false, `could not create "${desired.title}": ${error ?? "no id returned"}`);
        return;
      }
    } catch (error) {
      this.step(`node.create:${key}`, false, `could not create "${desired.title}": ${errorText(error)}`);
      return;
    }
    await this.track(desired, nodeId, payloadHash(vars));
    const rest = desired.codes.slice(1);
    this.states.set(key, { desired, nodeId, vars, codesFailed: false, codesHash: null });
    if (rest.length > 0) this.pendingAdds.push({ key, nodeId, codes: rest });
    this.step(`node.create:${key}`, true, `created "${desired.title}"${automatic ? "" : ` with code ${desired.codes[0]}`}`);
  }

  private async addCodes(): Promise<void> {
    for (const { key, nodeId, codes } of this.pendingAdds) {
      const state = this.states.get(key);
      const title = state?.desired.title ?? key;
      let added = 0;
      const failures: string[] = [];
      for (const batch of chunks(codes, REDEEM_CODES_PER_CALL)) {
        try {
          const data: {
            discountRedeemCodeBulkAdd: { bulkCreation: { id: string } | null; userErrors: UserErrorLike[] };
          } = await this.a.transport.call(
            "redeemBulkAdd",
            { discountId: nodeId, codes: batch.map((code) => ({ code })) },
            // Re-sending a batch that landed only fails those codes as taken;
            // the next sync re-reads the node's codes and settles it.
            { idempotent: true },
          );
          const payload = data.discountRedeemCodeBulkAdd;
          const error = userErrorText(payload.userErrors);
          if (error || !payload.bulkCreation) {
            failures.push(error ?? "no bulk creation returned");
            continue;
          }
          const creationId = payload.bulkCreation.id;
          type Status = {
            done: boolean;
            importedCount: number | null;
            failedCount: number | null;
            codes: { nodes: { code: string; errors: { message: string }[] }[] };
          } | null;
          const { value, done } = await this.a.transport.poll<Status>(
            async () => ((await this.a.transport.call("redeemBulkStatus", { id: creationId })) as { discountRedeemCodeBulkCreation: Status }).discountRedeemCodeBulkCreation,
            (status) => status?.done === true,
          );
          if (!done || !value) {
            failures.push(`bulk add ${creationId} still running; checked again on the next sync`);
            continue;
          }
          added += value.importedCount ?? 0;
          if ((value.failedCount ?? 0) > 0) {
            const bad = value.codes.nodes.filter((c) => c.errors.length > 0).map((c) => `${c.code} (${c.errors.map((e) => e.message).join(", ")})`);
            failures.push(`${value.failedCount} code(s) rejected: ${bad.slice(0, 10).join("; ")}${bad.length > 10 ? "; …" : ""}`);
          }
        } catch (error) {
          failures.push(errorText(error));
        }
      }
      if (state && failures.length > 0) state.codesFailed = true;
      this.step(
        `codes.add:${key}`,
        failures.length === 0,
        failures.length === 0 ? `added ${added} code(s) to "${title}"` : `added ${added}/${codes.length} code(s) to "${title}": ${failures.join("; ")}`,
      );
    }
  }

  /** function_vars for every node that did not just get them at creation. */
  private async writeVars(): Promise<void> {
    const { db, shop } = this.a;
    const writes: { key: string; nodeId: string; json: string }[] = [];
    for (const [key, state] of this.states) {
      const json = this.a.varsJson(state.desired);
      if (state.vars !== null && sameJson(state.vars, json)) continue;
      writes.push({ key, nodeId: state.nodeId, json });
    }
    if (writes.length === 0) {
      this.varsComplete = true;
      return;
    }
    const written: string[] = [];
    const failures: string[] = [];
    for (const batch of chunks(writes, METAFIELDS_PER_SET)) {
      const error = await setMetafields(
        this.a.transport,
        batch.map((w) => ({ ownerId: w.nodeId, namespace: WON_NAMESPACE, key: NODE_VARS_KEY, type: "json", value: w.json })),
      );
      if (error) {
        failures.push(error);
        continue;
      }
      for (const w of batch) {
        written.push(w.key);
        await db.wonNode.updateMany({ where: { shop, key: w.key }, data: { varsVersion: payloadHash(w.json) } });
      }
    }
    this.varsComplete = failures.length === 0;
    this.step(
      "node_vars",
      failures.length === 0,
      failures.length === 0
        ? `function_vars written on ${written.length} node(s): ${written.join(", ")}`
        : `function_vars written on ${written.length}/${writes.length} node(s); ${failures.join("; ")} (a node with stale vars plans without the campaign until the next sync)`,
    );
  }

  private async saveCodesHashes(): Promise<void> {
    const { db, shop } = this.a;
    for (const [key, state] of this.states) {
      if (state.desired.role.kind !== "code" || state.codesFailed) continue;
      const wanted = codesHash(state.desired.codes);
      const row = this.tracked.get(key);
      if (row?.codesHash === wanted) continue;
      await db.wonNode.updateMany({ where: { shop, key }, data: { codesHash: wanted } });
    }
  }
}

function sameJson(a: string, b: string): boolean {
  try {
    return canonicalJson(JSON.parse(a)) === canonicalJson(JSON.parse(b));
  } catch {
    return false;
  }
}
