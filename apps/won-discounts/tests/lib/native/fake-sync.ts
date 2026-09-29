// Fake `saveAndSync` for the native-discount tests: the REAL saveConfig (same
// validation and DB rows as production, the F12 base version included) + a
// miniature sync that keeps, in the FakeShopify store,
//   - one Won code app discount per enabled code rule (the "one code, one
//     discount" rule bites exactly like it does live),
//   - one Won automatic app discount while any automatic rule is enabled,
//   - the shop function config (`shopify.shopFunctionConfig`): the rules Shopify
//     RUNS, written last like the real sync (F2 reads it back live).
// Failures are scripted per call: "before_save", "after_save" (config saved,
// nothing synced: Shopify keeps running the previous config), "after_node"
// (config saved AND nodes + shop config written, then the read-back failed),
// "throw", "node_without_save" (nodes + shop config written, the config NOT
// saved: an orphan).

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import { saveConfig } from "../../../app/lib/config.server.ts";
import type { SaveAndSync } from "../../../app/lib/native/types.ts";
import type { FakeShopify } from "./fake-shopify.ts";

export type SyncFailure = "before_save" | "after_save" | "after_node" | "throw" | "node_without_save";

export const WON_APP_KEY = "won-discounts-test-key";

export interface FakeSync {
  saveAndSync: SaveAndSync;
  /** Every config it was asked to save, in order. */
  calls: WonDiscountsConfig[];
  /** Scripted failures, consumed one per call. */
  failures: SyncFailure[];
  /** ruleId → Won code node id in the fake store. */
  nodeIds: Map<string, string>;
  /** The Won automatic node id while one exists. */
  autoNodeId: string | null;
  /** Runs before each save (a test writes "another instance's" config here, F12). */
  beforeSave: (() => Promise<void>) | null;
  /** Saves refused because another writer changed the config (F12). */
  conflicts: number;
}

export function createFakeSync(db: PrismaClient, shopify: FakeShopify, failures: SyncFailure[] = []): FakeSync {
  const nodeIds = new Map<string, string>();
  const calls: WonDiscountsConfig[] = [];
  const fake: FakeSync = {
    saveAndSync: async () => ({ ok: true }),
    calls,
    failures,
    nodeIds,
    autoNodeId: null,
    beforeSave: null,
    conflicts: 0,
  };

  function sync(config: WonDiscountsConfig): { ok: true } | { ok: false; message: string } {
    const wanted = config.modules.codes.rules.filter((r) => r.enabled && r.method === "code" && (r.codes ?? []).length > 0);
    const wantedIds = new Set(wanted.map((r) => r.id));
    for (const [ruleId, nodeId] of [...nodeIds]) {
      if (!wantedIds.has(ruleId)) {
        shopify.nodes.delete(nodeId);
        nodeIds.delete(ruleId);
      }
    }
    for (const rule of wanted) {
      const existing = nodeIds.get(rule.id);
      for (const code of rule.codes ?? []) {
        const holder = shopify.holderOf(code);
        if (holder && holder.id !== existing) return { ok: false, message: `Code ${code} must be unique` };
      }
      const id = existing ?? shopify.newId("code");
      shopify.nodes.set(id, {
        id,
        discount: {
          __typename: "DiscountCodeApp",
          title: rule.name,
          status: "ACTIVE",
          codes: { nodes: (rule.codes ?? []).map((code) => ({ code })) },
          appDiscountType: { appKey: WON_APP_KEY, functionId: "won-fn", title: "Won", app: { title: "Won Discounts" } },
        },
      });
      nodeIds.set(rule.id, id);
    }
    const automatic = config.modules.codes.rules.some((r) => r.enabled && r.method === "automatic");
    if (automatic && !fake.autoNodeId) {
      fake.autoNodeId = shopify.newId("automatic");
      shopify.nodes.set(fake.autoNodeId, {
        id: fake.autoNodeId,
        discount: {
          __typename: "DiscountAutomaticApp",
          title: "Won Discounts",
          status: "ACTIVE",
          appDiscountType: { appKey: WON_APP_KEY, functionId: "won-fn", title: "Won", app: { title: "Won Discounts" } },
        },
      });
    } else if (!automatic && fake.autoNodeId) {
      shopify.nodes.delete(fake.autoNodeId);
      fake.autoNodeId = null;
    }
    // Last, like the real sync: the rules the discount function runs.
    shopify.shopFunctionConfig = JSON.stringify({
      modules: { codes: { rules: config.modules.codes.rules.filter((r) => r.enabled).map((r) => ({ id: r.id, method: r.method })) } },
    });
    return { ok: true };
  }

  fake.saveAndSync = async ({ shop, config, baseVersion }) => {
    calls.push(JSON.parse(JSON.stringify(config)));
    if (fake.beforeSave) await fake.beforeSave();
    const failure = failures.shift();
    if (failure === "before_save") return { ok: false, message: "Shopify is not answering" };
    if (failure === "throw") throw new Error("sync crashed");
    if (failure === "node_without_save") {
      // A sync that pushed nodes but died before the config was stored.
      sync(config);
      return { ok: false, message: "sync died before saving" };
    }
    const saved = await saveConfig(db, shop, config, baseVersion !== undefined ? { expectedVersion: baseVersion } : {});
    if (!saved.ok && saved.reason === "base_changed") {
      fake.conflicts += 1;
      return { ok: false, message: "the config changed meanwhile", conflict: true };
    }
    if (!saved.ok) return { ok: false, message: `config refused: ${saved.reason}` };
    if (failure === "after_save") return { ok: false, message: "sync failed after save" };
    const synced = sync(saved.config);
    if (!synced.ok) return synced;
    if (failure === "after_node") return { ok: false, message: "config read-back failed" };
    return { ok: true };
  };
  return fake;
}
