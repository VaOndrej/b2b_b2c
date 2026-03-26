import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../../../app/db.server.ts";
import { selectAutoScenarioProductIds } from "./scenario-selection.ts";

const DEFAULT_STOREFRONT_BASE_URL = "https://b2b-b2c-store-development.myshopify.com";

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadProjectEnv(): Record<string, string> {
  const dotenvPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(dotenvPath)) {
    return {};
  }
  return parseDotenv(readFileSync(dotenvPath, "utf8"));
}

function readEnvValue(name: string): string {
  const processValue = String(process.env[name] ?? "").trim();
  if (processValue) {
    return processValue;
  }
  const fileValue = String(loadProjectEnv()[name] ?? "").trim();
  return fileValue;
}

function normalizeBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `SHOPIFY_E2E_STOREFRONT_BASE_URL must start with http:// or https://. Received: ${rawValue}`,
    );
  }
  return trimmed;
}

export type ShopifyE2ERuntime =
  | {
      enabled: true;
      storefrontBaseUrl: string;
      scenarioHandles: {
        visibility: string;
        quantity: string;
        variant: string | null;
      };
      storefrontPassword: string | null;
    }
  | {
      enabled: false;
      storefrontBaseUrl: string;
      storefrontPassword: string | null;
      skipReason: string;
    };

interface ShopifyE2ERuntimeConfig {
  storefrontBaseUrl: string;
  storefrontPassword: string | null;
  handleOverrides: {
    visibility: string | null;
    quantity: string | null;
    variant: string | null;
  };
}

interface ShopifyAdminProductNode {
  id: string;
  handle: string;
}

export function resolveShopifyE2ERuntimeConfig(): ShopifyE2ERuntimeConfig {
  return {
    storefrontBaseUrl: normalizeBaseUrl(
      readEnvValue("SHOPIFY_E2E_STOREFRONT_BASE_URL") || DEFAULT_STOREFRONT_BASE_URL,
    ),
    handleOverrides: {
      visibility: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY") || null,
      quantity: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_QUANTITY") || null,
      variant: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT") || null,
    },
    storefrontPassword: readEnvValue("SHOPIFY_E2E_STOREFRONT_PASSWORD") || null,
  };
}

function normalizeHandle(rawValue: string | null | undefined): string | null {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  return normalized || null;
}

function buildAdminApiUrl(shop: string): string {
  return `https://${shop}/admin/api/2026-04/graphql.json`;
}

async function fetchAdminProductHandlesById(input: {
  shop: string;
  accessToken: string;
  productIds: string[];
}): Promise<Record<string, string>> {
  if (input.productIds.length === 0) {
    return {};
  }

  const response = await fetch(buildAdminApiUrl(input.shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": input.accessToken,
    },
    body: JSON.stringify({
      query: `#graphql
        query CodexResolveProductHandles($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              handle
            }
          }
        }`,
      variables: {
        ids: input.productIds,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Shopify Admin API handle lookup failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    data?: { nodes?: Array<ShopifyAdminProductNode | null> };
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `Shopify Admin API handle lookup returned GraphQL errors: ${payload.errors
        .map((error) => String(error.message ?? "Unknown error"))
        .join("; ")}`,
    );
  }

  const nodes = Array.isArray(payload.data?.nodes) ? payload.data.nodes : [];
  const byId: Record<string, string> = {};
  for (const node of nodes) {
    const id = String(node?.id ?? "").trim();
    const handle = normalizeHandle(node?.handle);
    if (id && handle) {
      byId[id] = handle;
    }
  }
  return byId;
}

async function resolveAutoScenarioHandles(config: ShopifyE2ERuntimeConfig): Promise<{
  visibility: string | null;
  quantity: string | null;
  variant: string | null;
}> {
  const visibilityRules = await prisma.productVisibilityRule.findMany({
    where: {
      configId: "default",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      productId: true,
      visibilityMode: true,
    },
  });

  const quantityRules = await prisma.productQuantityRule.findMany({
    where: {
      configId: "default",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      productId: true,
      minimumOrderQuantity: true,
      stepQuantity: true,
      maxOrderQuantity: true,
    },
  });

  const variantVisibilityRules = await prisma.productVariantVisibilityRule.findMany({
    where: {
      configId: "default",
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      productId: true,
      visibilityMode: true,
    },
  });

  const selectedProductIds = selectAutoScenarioProductIds({
    visibilityRules,
    quantityRules,
    variantVisibilityRules,
  });

  const productIdsToResolve = Array.from(
    new Set(
      [
        config.handleOverrides.visibility ? null : selectedProductIds.visibility,
        config.handleOverrides.quantity ? null : selectedProductIds.quantity,
        config.handleOverrides.variant ? null : selectedProductIds.variant,
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  if (productIdsToResolve.length === 0) {
    return {
      visibility: config.handleOverrides.visibility,
      quantity: config.handleOverrides.quantity,
      variant: config.handleOverrides.variant,
    };
  }

  const storefrontHost = new URL(config.storefrontBaseUrl).hostname;
  const offlineSession = await prisma.session.findFirst({
    where: {
      shop: storefrontHost,
      isOnline: false,
    },
    orderBy: {
      id: "asc",
    },
    select: {
      shop: true,
      accessToken: true,
    },
  });

  if (!offlineSession) {
    throw new Error(
      `No offline Shopify session found in Prisma for ${storefrontHost}. Install or re-auth the app before running storefront E2E.`,
    );
  }

  const handlesByProductId = await fetchAdminProductHandlesById({
    shop: offlineSession.shop,
    accessToken: offlineSession.accessToken,
    productIds: productIdsToResolve,
  });

  return {
    visibility:
      config.handleOverrides.visibility ??
      (selectedProductIds.visibility
        ? normalizeHandle(handlesByProductId[selectedProductIds.visibility])
        : null),
    quantity:
      config.handleOverrides.quantity ??
      (selectedProductIds.quantity
        ? normalizeHandle(handlesByProductId[selectedProductIds.quantity])
        : null),
    variant:
      config.handleOverrides.variant ??
      (selectedProductIds.variant
        ? normalizeHandle(handlesByProductId[selectedProductIds.variant])
        : null),
  };
}

export async function resolveShopifyE2ERuntime(): Promise<ShopifyE2ERuntime> {
  const config = resolveShopifyE2ERuntimeConfig();

  try {
    const scenarioHandles = await resolveAutoScenarioHandles(config);
    const missingScenarioNames = [
      !scenarioHandles.visibility ? "visibility" : null,
      !scenarioHandles.quantity ? "quantity" : null,
    ].filter((value): value is string => Boolean(value));

    if (missingScenarioNames.length > 0) {
      return {
        enabled: false,
        storefrontBaseUrl: config.storefrontBaseUrl,
        storefrontPassword: config.storefrontPassword,
        skipReason:
          "Unable to auto-resolve required storefront E2E products for scenarios: " +
          missingScenarioNames.join(", "),
      };
    }

    const visibilityHandle = scenarioHandles.visibility!;
    const quantityHandle = scenarioHandles.quantity!;

    return {
      enabled: true,
      storefrontBaseUrl: config.storefrontBaseUrl,
      storefrontPassword: config.storefrontPassword,
      scenarioHandles: {
        visibility: visibilityHandle,
        quantity: quantityHandle,
        variant: scenarioHandles.variant,
      },
    };
  } catch (error) {
    return {
      enabled: false,
      storefrontBaseUrl: config.storefrontBaseUrl,
      storefrontPassword: config.storefrontPassword,
      skipReason:
        error instanceof Error ? error.message : "Unknown E2E runtime resolution error.",
    };
  }
}
