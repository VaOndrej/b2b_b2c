// Production wiring of the sync layer: the real engine payload builders from
// @won/core/discounts (T1) + console logging + the default retry policy.

import { buildNodeVars, buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { productRuleIndex } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
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
    buildShopFunctionConfig: (config, options) => buildShopFunctionConfig(config, options),
    buildNodeVars: (role, config, now) => buildNodeVars(role, config, now),
    productRuleIndex: (config, products) => productRuleIndex(config, products),
    verifyShopFunctionConfig: (json) => verifyShopFunctionConfig(json),
    now: () => new Date(),
    logger,
  };
}

export function createProductionSync(client: AdminClient, db: PrismaClient, logger?: SyncLogger): Sync {
  return createSync(productionSyncDeps(client, db, logger));
}
