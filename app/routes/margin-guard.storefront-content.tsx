import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getStorefrontContentRules,
  getCollectionVisibilityRules,
  resolveSegmentForStorefront,
  getB2bTag,
} from "../services/storefront-content.server";
import { resolveStorefrontContent } from "../../core/storefront/storefront-content.engine";
import type { PageType } from "../../core/storefront/storefront-content.types";

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

const VALID_PAGE_TYPES: PageType[] = [
  "ALL",
  "HOME",
  "PRODUCT",
  "COLLECTION",
  "CART",
  "PAGE",
];

function parsePageType(value: string | null): PageType {
  const upper = String(value ?? "ALL").toUpperCase();
  if (VALID_PAGE_TYPES.includes(upper as PageType)) {
    return upper as PageType;
  }
  return "ALL";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);

  const loggedInCustomerId = normalizeCustomerId(
    url.searchParams.get("logged_in_customer_id"),
  );
  const pageType = parsePageType(url.searchParams.get("page_type"));
  const handle = url.searchParams.get("handle") ?? null;
  const productId = url.searchParams.get("product_id") ?? null;
  const locale = url.searchParams.get("locale") ?? "en";

  const [b2bTag, contentRules, collectionVisibilityRules] = await Promise.all([
    getB2bTag(),
    getStorefrontContentRules(),
    getCollectionVisibilityRules(),
  ]);

  const segment = await resolveSegmentForStorefront({
    admin,
    loggedInCustomerId,
    b2bTag,
  });

  const result = resolveStorefrontContent({
    segment,
    pageType,
    productId,
    collectionHandle: handle,
    locale,
    rules: contentRules as any,
    collectionVisibilityRules: collectionVisibilityRules as any,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
