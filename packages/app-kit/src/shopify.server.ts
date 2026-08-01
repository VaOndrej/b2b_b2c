import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

export const apiVersion = ApiVersion.April26;

/**
 * Build the shared Shopify app instance. Every app wires this with its own
 * Prisma client (whose schema owns the Session model) and its own env
 * (SHOPIFY_API_KEY / SCOPES / SHOPIFY_APP_URL from that app's shopify.app.toml).
 *
 * `prisma` is intentionally loosely typed: each app generates its own
 * @prisma/client, so app-kit cannot depend on one concrete PrismaClient type.
 * PrismaSessionStorage only needs the generic Session model accessor.
 */
export function createShopifyApp(prisma: any) {
  return shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
}

/** The return type of {@link createShopifyApp} — a fully configured Shopify app. */
export type ShopifyApp = ReturnType<typeof createShopifyApp>;
