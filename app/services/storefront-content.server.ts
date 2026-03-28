import prisma from "../db.server.ts";
import type { Segment } from "../../core/segment/segment.types";
import { resolveSegment } from "../../core/segment/segment.engine.ts";

const DEFAULT_CONFIG_ID = "default";

function orderByPriorityAndId() {
  return [{ priority: "asc" as const }, { id: "asc" as const }];
}

export async function getStorefrontContentRules(configId = DEFAULT_CONFIG_ID) {
  return prisma.storefrontContentRule.findMany({
    where: { configId },
    orderBy: orderByPriorityAndId(),
  });
}

export async function getCollectionVisibilityRules(
  configId = DEFAULT_CONFIG_ID,
) {
  return prisma.collectionVisibilityRule.findMany({
    where: { configId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function upsertStorefrontContentRule(input: {
  id?: string;
  configId?: string;
  name: string;
  active: boolean;
  priority: number;
  segment: string;
  pageType: string;
  productId?: string | null;
  collectionId?: string | null;
  targetType: string;
  targetSelector?: string | null;
  targetPosition?: string | null;
  action: string;
  value?: string | null;
  valueCsLocale?: string | null;
}) {
  const configId = input.configId ?? DEFAULT_CONFIG_ID;
  const data = {
    configId,
    name: input.name,
    active: input.active,
    priority: input.priority,
    segment: input.segment,
    pageType: input.pageType,
    productId: input.productId ?? null,
    collectionId: input.collectionId ?? null,
    targetType: input.targetType,
    targetSelector: input.targetSelector ?? null,
    targetPosition: input.targetPosition ?? null,
    action: input.action,
    value: input.value ?? null,
    valueCsLocale: input.valueCsLocale ?? null,
  };

  if (input.id) {
    return prisma.storefrontContentRule.update({
      where: { id: input.id },
      data,
    });
  }

  return prisma.storefrontContentRule.create({ data });
}

export async function deleteStorefrontContentRule(id: string) {
  return prisma.storefrontContentRule.delete({ where: { id } });
}

export async function upsertCollectionVisibilityRule(input: {
  id?: string;
  configId?: string;
  collectionId: string;
  collectionHandle: string;
  collectionTitle?: string | null;
  visibilityMode: string;
}) {
  const configId = input.configId ?? DEFAULT_CONFIG_ID;
  const data = {
    configId,
    collectionId: input.collectionId,
    collectionHandle: input.collectionHandle,
    collectionTitle: input.collectionTitle ?? null,
    visibilityMode: input.visibilityMode,
  };

  if (input.id) {
    return prisma.collectionVisibilityRule.update({
      where: { id: input.id },
      data,
    });
  }

  return prisma.collectionVisibilityRule.create({ data });
}

export async function deleteCollectionVisibilityRule(id: string) {
  return prisma.collectionVisibilityRule.delete({ where: { id } });
}

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

export async function resolveSegmentForStorefront(input: {
  admin: AdminGraphqlClient | undefined;
  loggedInCustomerId: string | null;
  b2bTag: string;
}): Promise<Segment> {
  if (!input.loggedInCustomerId || !input.admin) {
    return "B2C";
  }

  const customerId = input.loggedInCustomerId.includes("gid://")
    ? input.loggedInCustomerId
    : `gid://shopify/Customer/${input.loggedInCustomerId}`;

  try {
    const response = await input.admin.graphql(
      `query GetCustomerTags($id: ID!) {
        customer(id: $id) {
          tags
        }
      }`,
      { variables: { id: customerId } },
    );
    const json = await response.json();
    const tags: string[] = json?.data?.customer?.tags ?? [];

    const resolution = resolveSegment({
      customerTags: tags,
      b2bTag: input.b2bTag,
    });
    return resolution.segment;
  } catch {
    return "B2C";
  }
}

export async function getB2bTag(): Promise<string> {
  const config = await prisma.marginGuardConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
    select: { b2bTag: true },
  });
  return config?.b2bTag ?? "b2b";
}
