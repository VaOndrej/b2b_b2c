// Production wiring of the sync layer: the real engine payload builders from
// @won/core/discounts (T1), the shop's plan from the one server resolver
// (BILL-1, app/lib/plan.server.ts) + console logging + the default retry policy.

import { buildNodeVars, buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";
import { productRuleIndex } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { planOf } from "../plan.server";
import { createSync, type Sync } from "./sync.server";
import type { SyncDeps, SyncLogger } from "./types";

export const consoleSyncLogger: SyncLogger = {
  info: (message, context) => console.info(`[won-sync] ${message}`, context ?? ""),
  warn: (message, context) => console.warn(`[won-sync] ${message}`, context ?? ""),
  error: (message, context) => console.error(`[won-sync] ${message}`, context ?? ""),
};

export function productionSyncDeps(client: AdminClient, db: PrismaClient, logger: SyncLogger = consoleSyncLogger): SyncDeps {
  return {
    client,
    db,
    plan: planOf,
    buildShopFunctionConfig: (config, options) => buildShopFunctionConfig(config, options),
    buildNodeVars: (role, config, now) => buildNodeVars(role, config, now),
    productRuleIndex: (config, products) => productRuleIndex(config, products),
    verifyShopFunctionConfig: (json) => verifyShopFunctionConfig(json),
    buildStorefrontConfig: (config, options) =>
      buildStorefrontConfig(config, {
        configVersion: options.configVersion,
        ...(options.shopCurrency ? { shopCurrency: options.shopCurrency } : {}),
        ...(options.variantHandles ? { variantHandles: options.variantHandles } : {}),
        // MVP 6.1: the campaign whose tier sets the product page shows now (live E2E found this option dropped here).
        ...(options.campaignId ? { campaignId: options.campaignId } : {}),
      }),
    now: () => new Date(),
    logger,
  };
}

export function createProductionSync(client: AdminClient, db: PrismaClient, logger?: SyncLogger): Sync {
  return createSync(productionSyncDeps(client, db, logger));
}
