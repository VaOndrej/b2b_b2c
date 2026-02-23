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

function parseSegment(value: string | null): "B2B" | "B2C" {
  return value === "B2B" ? "B2B" : "B2C";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const handles = parseHandles(url.searchParams.get("handles"));
  const segment = parseSegment(url.searchParams.get("segment"));
  const customerId =
    url.searchParams.get("logged_in_customer_id") ??
    url.searchParams.get("customerId");
  const config = await getOrCreateMarginGuardConfig();
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
