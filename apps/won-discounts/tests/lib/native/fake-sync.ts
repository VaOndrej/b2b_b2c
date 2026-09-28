// Fake `saveAndSync` for the native-discount tests: the REAL saveConfig (same
// validation and DB rows as production) + a miniature sync that keeps one Won
// code app discount per enabled code rule in the FakeShopify store — enough
// for the "one code, one discount" rule to bite exactly like it does live.
// Failures are scripted per call: "before_save", "after_save" (config saved,
// nothing synced), "after_node" (config saved AND the Won node created), "throw".

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import { saveConfig } from "../../../app/lib/config.server.ts";
import type { SaveAndSync } from "../../../app/lib/native/types.ts";
import type { FakeShopify } from "./fake-shopify.ts";

export type SyncFailure = "before_save" | "after_save" | "after_node" | "throw";

export const WON_APP_KEY = "won-discounts-test-key";

export interface FakeSync {
  saveAndSync: SaveAndSync;
  /** Every config it was asked to save, in order. */
  calls: WonDiscountsConfig[];
  /** Scripted failures, consumed one per call. */
  failures: SyncFailure[];
  /** ruleId → Won code node id in the fake store. */
  nodeIds: Map<string, string>;
}

export function createFakeSync(db: PrismaClient, shopify: FakeShopify, failures: SyncFailure[] = []): FakeSync {
  const nodeIds = new Map<string, string>();
  const calls: WonDiscountsConfig[] = [];
  const fake: FakeSync = { saveAndSync: async () => ({ ok: true }), calls, failures, nodeIds };

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
    return { ok: true };
  }

  fake.saveAndSync = async ({ shop, config }) => {
    calls.push(JSON.parse(JSON.stringify(config)));
    const failure = failures.shift();
    if (failure === "before_save") return { ok: false, message: "Shopify is not answering" };
    if (failure === "throw") throw new Error("sync crashed");
    const saved = await saveConfig(db, shop, config);
    if (!saved.ok) return { ok: false, message: `config refused: ${saved.reason}` };
    if (failure === "after_save") return { ok: false, message: "sync failed after save" };
    const synced = sync(saved.config);
    if (!synced.ok) return synced;
    if (failure === "after_node") return { ok: false, message: "config read-back failed" };
    return { ok: true };
  };
  return fake;
}
