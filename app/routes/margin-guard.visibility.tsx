import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig } from "../services/margin-guard-config.server";
import { resolveStorefrontVisibilityByHandles } from "../services/storefront-visibility.server";

function parseHandles(value: string | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean);
}

function parseSegment(value: string | null): "B2B" | "B2C" | null {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return null;
}

function normalizeCustomerId(value: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Customer/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Customer/${normalized}`;
  }
  return normalized;
}

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

async function resolveSegment(input: {
  admin: AdminGraphqlClient | undefined;
  segment: "B2B" | "B2C" | null;
  customerId: string | null;
  b2bTag: string;
}): Promise<"B2B" | "B2C"> {
  if (input.segment) {
    return input.segment;
  }
  if (!input.customerId || !input.admin) {
    return "B2C";
  }

  try {
    const response = await input.admin.graphql(
      `#graphql
        query CustomerTags($id: ID!) {
          customer(id: $id) {
            tags
          }
        }`,
      {
        variables: {
          id: input.customerId,
        },
      },
    );
    const payload = await response.json();
    const tags = Array.isArray(payload?.data?.customer?.tags)
      ? payload.data.customer.tags
      : [];
    const expectedTag = input.b2bTag.trim().toLowerCase() || "b2b";
    const normalizedTags = tags.map((tag: unknown) =>
      String(tag ?? "").trim().toLowerCase(),
    );
    return normalizedTags.includes(expectedTag) ? "B2B" : "B2C";
  } catch {
    return "B2C";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const handles = parseHandles(url.searchParams.get("handles"));
  const config = await getOrCreateMarginGuardConfig();
  const segment = await resolveSegment({
    admin: admin as AdminGraphqlClient | undefined,
    segment: parseSegment(url.searchParams.get("segment")),
    customerId: normalizeCustomerId(
      url.searchParams.get("logged_in_customer_id") ??
        url.searchParams.get("customerId"),
    ),
    b2bTag: config.b2bTag,
  });
  const customerId = normalizeCustomerId(
    url.searchParams.get("logged_in_customer_id") ??
      url.searchParams.get("customerId"),
  );
  const visibility = await resolveStorefrontVisibilityByHandles({
    admin,
    handles,
    segment,
    customerId,
    rules: config.productVisibilityRules,
  });

  return Response.json(
    {
      segment,
      customerId: customerId ?? null,
      b2bTag: config.b2bTag,
      ...visibility,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
