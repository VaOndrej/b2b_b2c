import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { QUANTITY_E2E_HANDLES } from "./fixtures.ts";

const SHOP = "b2b-b2c-store-development.myshopify.com";
const appRoot = path.resolve(import.meta.dirname, "../../..");
const repoRoot = path.resolve(appRoot, "../..");
const statePath = path.join(repoRoot, "tmp/e2e-seed/won-quantity.json");

interface ProductPayload {
  id: number;
  handle: string;
  variants: Array<{ id: number; title: string }>;
}

interface SeedState {
  shop: string;
  config: {
    enabled: boolean;
    minimum: number;
    step: number;
    maximum: number | null;
  } | null;
  rules: Array<{
    targetKey: string;
    minimum: number | null;
    step: number | null;
    maximum: number | null;
  }>;
  targetKeys: string[];
}

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
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

function projectEnvironment(): Record<string, string> {
  const dotenvPath = path.join(appRoot, ".env");
  return existsSync(dotenvPath)
    ? parseDotenv(readFileSync(dotenvPath, "utf8"))
    : {};
}

function ensureDatabaseEnvironment(): void {
  if (process.env.DATABASE_URL) return;
  const value = projectEnvironment().DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for Won Quantity E2E.");
  process.env.DATABASE_URL = value;
}

function splitSetCookie(value: string | null): string[] {
  return value
    ? value.split(/,(?=[^;,=\s]+=[^;,]+)/u).map((entry) => entry.trim())
    : [];
}

async function storefrontCookie(baseUrl: string): Promise<string | null> {
  const password =
    String(process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD ?? "").trim() ||
    projectEnvironment().SHOPIFY_E2E_STOREFRONT_PASSWORD?.trim();
  if (!password || /^http:\/\/(?:127\.0\.0\.1|localhost)/u.test(baseUrl)) {
    return null;
  }
  const response = await fetch(new URL("/password", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      form_type: "storefront_password",
      utf8: "✓",
      password,
    }),
  });
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookie(headers.get("set-cookie"));
  return (
    cookies
      .map((cookie) => cookie.split(";", 1)[0]?.trim() ?? "")
      .filter(Boolean)
      .join("; ") || null
  );
}

async function resolveProduct(
  baseUrl: string,
  cookie: string | null,
  handle: string,
): Promise<ProductPayload> {
  const response = await fetch(
    new URL(`/products/${encodeURIComponent(handle)}.js`, baseUrl),
    {
      headers: cookie ? { Cookie: cookie } : undefined,
      redirect: "follow",
    },
  );
  // Shopify serves /products/<handle>.js as `text/javascript` with a JSON body.
  // A missing or password-gated product instead returns `text/html` (even with
  // HTTP 200), so accept only JSON/JS content types — not a bare status check.
  const contentType = response.headers.get("content-type") ?? "";
  const servesJson =
    contentType.includes("json") || contentType.includes("javascript");
  if (!response.ok || !servesJson) {
    throw new Error(
      `Required namespaced fixture ${handle} is unavailable (HTTP ${response.status}).`,
    );
  }
  const payload = (await response.json()) as ProductPayload;
  if (payload.handle !== handle || !Array.isArray(payload.variants)) {
    throw new Error(`Unexpected storefront payload for ${handle}.`);
  }
  return payload;
}

function productKey(product: ProductPayload): string {
  return `product:gid://shopify/Product/${product.id}`;
}

function variantKey(variantId: number): string {
  return `variant:gid://shopify/ProductVariant/${variantId}`;
}

async function prismaClient() {
  ensureDatabaseEnvironment();
  return (await import("../../../app/db.server.ts")).default;
}

export async function restoreQuantityE2EState(): Promise<void> {
  if (!existsSync(statePath)) return;
  const state = JSON.parse(await readFile(statePath, "utf8")) as SeedState;
  const prisma = await prismaClient();
  await prisma.$transaction(async (transaction) => {
    await transaction.quantityRule.deleteMany({
      where: { shop: state.shop, targetKey: { in: state.targetKeys } },
    });
    if (state.config) {
      await transaction.quantityConfig.upsert({
        where: { shop: state.shop },
        create: { shop: state.shop, ...state.config },
        update: state.config,
      });
      for (const rule of state.rules) {
        await transaction.quantityRule.create({
          data: { shop: state.shop, ...rule },
        });
      }
    } else {
      await transaction.quantityConfig.deleteMany({
        where: { shop: state.shop },
      });
    }
  });
  await rm(statePath, { force: true });
}

export async function seedQuantityE2EState(): Promise<void> {
  await restoreQuantityE2EState();
  const baseUrl =
    process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL || `https://${SHOP}`;
  const cookie = await storefrontCookie(baseUrl);
  const [defaultProduct, stepProduct, maximumProduct] = await Promise.all([
    resolveProduct(baseUrl, cookie, QUANTITY_E2E_HANDLES.default),
    resolveProduct(baseUrl, cookie, QUANTITY_E2E_HANDLES.step),
    resolveProduct(baseUrl, cookie, QUANTITY_E2E_HANDLES.maximum),
  ]);
  if (stepProduct.variants.length < 2) {
    throw new Error(
      `${QUANTITY_E2E_HANDLES.step} requires at least two variants.`,
    );
  }

  const targetKeys = [
    productKey(defaultProduct),
    productKey(stepProduct),
    variantKey(stepProduct.variants[1].id),
    productKey(maximumProduct),
  ];
  const prisma = await prismaClient();
  const [existingConfig, existingRules] = await Promise.all([
    prisma.quantityConfig.findUnique({ where: { shop: SHOP } }),
    prisma.quantityRule.findMany({
      where: { shop: SHOP, targetKey: { in: targetKeys } },
    }),
  ]);
  const state: SeedState = {
    shop: SHOP,
    config: existingConfig
      ? {
          enabled: existingConfig.enabled,
          minimum: existingConfig.minimum,
          step: existingConfig.step,
          maximum: existingConfig.maximum,
        }
      : null,
    rules: existingRules.map(({ targetKey, minimum, step, maximum }) => ({
      targetKey,
      minimum,
      step,
      maximum,
    })),
    targetKeys,
  };
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  await prisma.$transaction(async (transaction) => {
    await transaction.quantityConfig.upsert({
      where: { shop: SHOP },
      create: { shop: SHOP, enabled: true, minimum: 1, step: 1 },
      update: { enabled: true, minimum: 1, step: 1, maximum: null },
    });
    await transaction.quantityRule.deleteMany({
      where: { shop: SHOP, targetKey: { in: targetKeys } },
    });
    await transaction.quantityRule.createMany({
      data: [
        {
          shop: SHOP,
          targetKey: productKey(stepProduct),
          minimum: 2,
          step: 2,
        },
        {
          shop: SHOP,
          targetKey: variantKey(stepProduct.variants[1].id),
          minimum: 3,
          step: 3,
          maximum: 9,
        },
        {
          shop: SHOP,
          targetKey: productKey(maximumProduct),
          minimum: 2,
          step: 2,
          maximum: 6,
        },
      ],
    });
  });
}
