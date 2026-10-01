// The dry-run client of scripts/sync/live-sync.ts (and the E2E seed/cleanup
// scripts that run it): every READ goes to the real client (the store), every
// MUTATION is printed with its variables and answered with a synthetic success
// — nothing in Shopify changes. The read-backs the sync verifies (the shop
// function config, MVP 3: the storefront config) answer the value "written",
// so a dry-run of a correct config reports ok.

import type { AdminClient, AdminGraphQLResult } from "../../app/lib/admin-client.server.ts";
import { operationKind } from "../../app/lib/admin-client-cli.server.ts";
import { operationName } from "../../app/lib/sync/graphql.ts";

const redact = (value: unknown): unknown => {
  if (typeof value === "string") return value.length > 300 ? `<${Buffer.byteLength(value)} B> ${value.slice(0, 120)}…` : value;
  if (Array.isArray(value)) return value.length > 20 ? [...value.slice(0, 20).map(redact), `… ${value.length - 20} more`] : value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
};

/** Reads pass through; mutations are printed and answered synthetically (nothing is written). */
export class DryRunClient implements AdminClient {
  private seq = 0;
  private shopConfig: string | null = null;
  /** MVP 3: the storefront config "written" (app-data metafield), answered by its read-back. */
  private storefrontConfig: string | null = null;
  private readonly bulkCounts = new Map<string, number>();
  private readonly log: (line: string) => void;
  readonly planned: { op: string; variables: unknown }[] = [];

  constructor(
    private readonly real: AdminClient,
    opts: { log?: (line: string) => void } = {},
  ) {
    this.log = opts.log ?? ((line) => console.log(line));
  }

  private id(kind: string) {
    this.seq += 1;
    return `gid://shopify/${kind}/DRY-RUN-${this.seq}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async graphql(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<any>> {
    const op = operationName(query);
    if (operationKind(query) !== "mutation") {
      if (op === "WonSyncRedeemBulkStatus") {
        const importedCount = this.bulkCounts.get(String(variables?.id)) ?? 0;
        return { data: { discountRedeemCodeBulkCreation: { done: true, importedCount, failedCount: 0, codes: { nodes: [] } } } };
      }
      if (op === "WonSyncJob") return { data: { job: { id: variables?.id, done: true } } };
      if (op === "WonSyncShopConfigReadBack" && this.shopConfig !== null) {
        return { data: { shop: { id: "dry-run", metafield: { id: "dry-run", value: this.shopConfig } } } };
      }
      if (op === "WonSyncStorefrontConfig" && this.storefrontConfig !== null) {
        // The real installation id, the value "written" (the sync verifies it).
        const real = await this.real.graphql<{ currentAppInstallation?: { id?: string } | null }>(query, variables);
        const id = real.data?.currentAppInstallation?.id ?? "gid://shopify/AppInstallation/DRY-RUN";
        return { data: { currentAppInstallation: { id, metafield: { id: "dry-run", value: this.storefrontConfig } } } };
      }
      return this.real.graphql(query, variables);
    }
    this.planned.push({ op, variables });
    this.log(`\n--- would send ${op} ---\n${JSON.stringify(redact(variables ?? {}), null, 2)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (variables ?? {}) as Record<string, any>;
    switch (op) {
      case "WonSyncMetafieldsSet":
        for (const mf of v.metafields ?? []) if (mf.key === "function_config") this.shopConfig = mf.value;
        return { data: { metafieldsSet: { metafields: [], userErrors: [] } } };
      case "WonSyncStorefrontConfigSet":
        for (const mf of v.metafields ?? []) if (mf.key === "storefront_config") this.storefrontConfig = mf.value;
        return { data: { metafieldsSet: { metafields: [], userErrors: [] } } };
      case "WonSyncMetafieldsDelete":
        return { data: { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } };
      case "WonSyncAutomaticCreate":
        return { data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: this.id("DiscountAutomaticNode") }, userErrors: [] } } };
      case "WonSyncCodeCreate":
        return { data: { discountCodeAppCreate: { codeAppDiscount: { discountId: this.id("DiscountCodeNode") }, userErrors: [] } } };
      case "WonSyncAutomaticUpdate":
        return { data: { discountAutomaticAppUpdate: { automaticAppDiscount: { discountId: v.id }, userErrors: [] } } };
      case "WonSyncCodeUpdate":
        return { data: { discountCodeAppUpdate: { codeAppDiscount: { discountId: v.id }, userErrors: [] } } };
      case "WonSyncAutomaticDelete":
        return { data: { discountAutomaticDelete: { deletedAutomaticDiscountId: v.id, userErrors: [] } } };
      case "WonSyncCodeDelete":
        return { data: { discountCodeDelete: { deletedCodeDiscountId: v.id, userErrors: [] } } };
      case "WonSyncCodeDeactivate":
        return { data: { discountCodeDeactivate: { codeDiscountNode: { id: v.id }, userErrors: [] } } };
      case "WonSyncCodeActivate":
        return { data: { discountCodeActivate: { codeDiscountNode: { id: v.id }, userErrors: [] } } };
      case "WonSyncRedeemBulkAdd": {
        const id = this.id("DiscountRedeemCodeBulkCreation");
        this.bulkCounts.set(id, Array.isArray(v.codes) ? v.codes.length : 0);
        return { data: { discountRedeemCodeBulkAdd: { bulkCreation: { id }, userErrors: [] } } };
      }
      case "WonSyncRedeemBulkDelete":
        return { data: { discountCodeRedeemCodeBulkDelete: { job: { id: this.id("Job"), done: false }, userErrors: [] } } };
      default:
        throw new Error(`dry-run: no synthetic response for ${op}`);
    }
  }
}
