import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../../../app/db.server.ts";
import { selectAutoScenarioProductIds } from "./scenario-selection.ts";

const DEFAULT_STOREFRONT_BASE_URL = "https://b2b-b2c-store-development.myshopify.com";
const DEFAULT_SCENARIO_FALLBACK_HANDLES = {
  visibility: null,
  step: null,
  max: null,
  variant: "the-complete-snowboard",
} as const;

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
        step: string;
        max: string;
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
    step: string | null;
    max: string | null;
    variant: string | null;
  };
}

interface ShopifyAdminProductNode {
  id: string;
  handle: string;
}

interface StorefrontProductJsonPayload {
  handle?: unknown;
  variants?: Array<{ id?: unknown }> | null;
}

export interface StorefrontHandlePreflightInput {
  storefrontBaseUrl: string;
  storefrontPassword: string | null;
  handle: string | null;
  requireVariants?: boolean;
}

export interface StorefrontHandlePreflightResult {
  ok: boolean;
  normalizedHandle: string | null;
  variantCount: number;
  reason: string | null;
}

export function resolveShopifyE2ERuntimeConfig(): ShopifyE2ERuntimeConfig {
  return {
    storefrontBaseUrl: normalizeBaseUrl(
      readEnvValue("SHOPIFY_E2E_STOREFRONT_BASE_URL") || DEFAULT_STOREFRONT_BASE_URL,
    ),
    handleOverrides: {
      visibility: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY") || null,
      step: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_STEP") || null,
      max: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_MAX") || null,
      variant: readEnvValue("SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT") || null,
    },
    storefrontPassword: readEnvValue("SHOPIFY_E2E_STOREFRONT_PASSWORD") || null,
  };
}

function normalizeHandle(rawValue: string | null | undefined): string | null {
  const normalized = String(rawValue ?? "").trim().toLowerCase();
  return normalized || null;
}

function splitSetCookieHeader(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/,(?=[^;,=\s]+=[^;,]+)/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildStorefrontUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/+$/u, "")}/`).toString();
}

async function resolveStorefrontPreflightCookieHeader(
  baseUrl: string,
  password: string | null,
): Promise<string | null> {
  const normalizedPassword = String(password ?? "").trim();
  if (!normalizedPassword) {
    return null;
  }

  const response = await fetch(buildStorefrontUrl(baseUrl, "/password"), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
    body: new URLSearchParams({
      form_type: "storefront_password",
      utf8: "✓",
      password: normalizedPassword,
    }).toString(),
  });

  const headerBag = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const rawCookies =
    typeof headerBag.getSetCookie === "function"
      ? headerBag.getSetCookie()
      : splitSetCookieHeader(response.headers.get("set-cookie"));

  const cookieHeader = rawCookies
    .map((cookie) => String(cookie).split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");

  return cookieHeader || null;
}

export async function preflightStorefrontHandle(
  input: StorefrontHandlePreflightInput,
): Promise<StorefrontHandlePreflightResult> {
  const normalizedHandle = normalizeHandle(input.handle);
  if (!normalizedHandle) {
    return {
      ok: false,
      normalizedHandle: null,
      variantCount: 0,
      reason: "Missing storefront handle.",
    };
  }

  try {
    const cookieHeader = await resolveStorefrontPreflightCookieHeader(
      input.storefrontBaseUrl,
      input.storefrontPassword,
    );
    const headers = cookieHeader ? { Cookie: cookieHeader } : undefined;
    const response = await fetch(
      buildStorefrontUrl(
        input.storefrontBaseUrl,
        `/products/${encodeURIComponent(normalizedHandle)}.js`,
      ),
      {
        headers,
        redirect: "follow",
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        normalizedHandle,
        variantCount: 0,
        reason: `Storefront product.js returned HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as StorefrontProductJsonPayload | null;
    const payloadHandle =
      typeof payload?.handle === "string" ? normalizeHandle(payload.handle) : null;
    const variants = Array.isArray(payload?.variants) ? payload.variants : [];

    if (payloadHandle && payloadHandle !== normalizedHandle) {
      return {
        ok: false,
        normalizedHandle,
        variantCount: variants.length,
        reason: `Storefront resolved handle ${payloadHandle} instead of ${normalizedHandle}.`,
      };
    }

    if (input.requireVariants && variants.length === 0) {
      return {
        ok: false,
        normalizedHandle,
        variantCount: 0,
        reason: "Storefront product does not expose variants.",
      };
    }

    return {
      ok: true,
      normalizedHandle,
      variantCount: variants.length,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      normalizedHandle,
      variantCount: 0,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown storefront preflight failure.",
    };
  }
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
  step: string | null;
  max: string | null;
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
        config.handleOverrides.step ? null : selectedProductIds.step,
        config.handleOverrides.max ? null : selectedProductIds.max,
        config.handleOverrides.variant ? null : selectedProductIds.variant,
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  if (productIdsToResolve.length === 0) {
    return {
      visibility: config.handleOverrides.visibility,
      step: config.handleOverrides.step,
      max: config.handleOverrides.max,
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

  const resolvedHandles = {
    visibility:
      config.handleOverrides.visibility ??
      (selectedProductIds.visibility
        ? normalizeHandle(handlesByProductId[selectedProductIds.visibility])
        : null),
    step:
      config.handleOverrides.step ??
      (selectedProductIds.step
        ? normalizeHandle(handlesByProductId[selectedProductIds.step])
        : null),
    max:
      config.handleOverrides.max ??
      (selectedProductIds.max
        ? normalizeHandle(handlesByProductId[selectedProductIds.max])
        : null),
    variant:
      config.handleOverrides.variant ??
      (selectedProductIds.variant
        ? normalizeHandle(handlesByProductId[selectedProductIds.variant])
        : null),
  };

  async function resolveHandleWithFallback(input: {
    preferredHandle: string | null;
    fallbackHandle: string | null;
    requireVariants?: boolean;
    preserveExplicitOverride: boolean;
  }): Promise<string | null> {
    if (input.preserveExplicitOverride) {
      return input.preferredHandle;
    }

    const preferred = await preflightStorefrontHandle({
      storefrontBaseUrl: config.storefrontBaseUrl,
      storefrontPassword: config.storefrontPassword,
      handle: input.preferredHandle,
      requireVariants: input.requireVariants,
    });
    if (preferred.ok) {
      return preferred.normalizedHandle;
    }

    const normalizedFallback = normalizeHandle(input.fallbackHandle);
    if (!normalizedFallback || normalizedFallback === preferred.normalizedHandle) {
      return null;
    }

    const fallback = await preflightStorefrontHandle({
      storefrontBaseUrl: config.storefrontBaseUrl,
      storefrontPassword: config.storefrontPassword,
      handle: normalizedFallback,
      requireVariants: input.requireVariants,
    });
    return fallback.ok ? fallback.normalizedHandle : null;
  }

  return {
    visibility: await resolveHandleWithFallback({
      preferredHandle: resolvedHandles.visibility,
      fallbackHandle: DEFAULT_SCENARIO_FALLBACK_HANDLES.visibility,
      preserveExplicitOverride: Boolean(config.handleOverrides.visibility),
    }),
    step: await resolveHandleWithFallback({
      preferredHandle: resolvedHandles.step,
      fallbackHandle: DEFAULT_SCENARIO_FALLBACK_HANDLES.step,
      preserveExplicitOverride: Boolean(config.handleOverrides.step),
    }),
    max: await resolveHandleWithFallback({
      preferredHandle: resolvedHandles.max,
      fallbackHandle: DEFAULT_SCENARIO_FALLBACK_HANDLES.max,
      preserveExplicitOverride: Boolean(config.handleOverrides.max),
    }),
    variant: await resolveHandleWithFallback({
      preferredHandle: resolvedHandles.variant,
      fallbackHandle: DEFAULT_SCENARIO_FALLBACK_HANDLES.variant,
      requireVariants: true,
      preserveExplicitOverride: Boolean(config.handleOverrides.variant),
    }),
  };
}

export async function resolveShopifyE2ERuntime(): Promise<ShopifyE2ERuntime> {
  const config = resolveShopifyE2ERuntimeConfig();

  try {
    const scenarioHandles = await resolveAutoScenarioHandles(config);
    const missingScenarioNames = [
      !scenarioHandles.visibility ? "visibility" : null,
      !scenarioHandles.step ? "step" : null,
      !scenarioHandles.max ? "max" : null,
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
    const stepHandle = scenarioHandles.step!;
    const maxHandle = scenarioHandles.max!;

    return {
      enabled: true,
      storefrontBaseUrl: config.storefrontBaseUrl,
      storefrontPassword: config.storefrontPassword,
      scenarioHandles: {
        visibility: visibilityHandle,
        step: stepHandle,
        max: maxHandle,
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
