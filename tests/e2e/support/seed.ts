import prisma from "../../../app/db.server.ts";
import { syncStorefrontProjectionMetafields } from "../../../app/services/storefront-projection.server.ts";

const E2E_ADMIN_API_VERSION = "2026-04";

interface OfflineAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<unknown> }>;
}

/**
 * Builds an Admin GraphQL client from the offline Shopify session stored in
 * Prisma. Returns null when no offline session is available, letting callers
 * skip. Used by the catalog-native e2e harness to (re)project the storefront
 * metafields after the dedicated e2e catalog is created/removed.
 */
async function buildOfflineAdminClient(): Promise<OfflineAdminClient | null> {
  const session = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { id: "asc" },
    select: { shop: true, accessToken: true },
  });

  if (!session?.shop || !session?.accessToken) {
    return null;
  }

  const endpoint = `https://${session.shop}/admin/api/${E2E_ADMIN_API_VERSION}/graphql.json`;
  return {
    graphql: async (query, options) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables ?? {},
        }),
      });
      return { json: () => response.json() };
    },
  };
}

/**
 * Re-projects the current Prisma config into the live shop's storefront
 * projection metafield. Call after creating/removing the e2e catalog so the dev
 * shop metafield matches the current DB state. The dedicated e2e catalog has no
 * segment, so it never appears in the b2b/b2c projection snapshots — real
 * shoppers are unaffected either way; this just keeps the metafield consistent.
 */
export async function resyncStorefrontProjectionForE2E(): Promise<boolean> {
  const admin = await buildOfflineAdminClient();
  if (!admin) {
    return false;
  }
  try {
    await syncStorefrontProjectionMetafields(admin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exposes the offline-session Admin GraphQL client for E2E specs/setup that need
 * the live shop (e.g. projection sync). Returns null when no offline session.
 */
export async function getOfflineAdminClientForE2E() {
  return buildOfflineAdminClient();
}

export async function disconnectE2EPrisma() {
  await prisma.$disconnect();
}
