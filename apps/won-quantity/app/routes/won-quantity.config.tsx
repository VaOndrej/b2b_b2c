import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { resolveQuantityRule } from "../services/quantity-config.server";

function toShopifyGid(
  value: string | null,
  type: "Product" | "ProductVariant",
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith(`gid://shopify/${type}/`)) return normalized;
  return /^\d+$/.test(normalized)
    ? `gid://shopify/${type}/${normalized}`
    : null;
}

function localizedMessages(
  locale: string,
  rule: { minimum: number; step: number; maximum: number | null },
) {
  const czech = locale.toLowerCase().startsWith("cs");
  return {
    minimum: czech
      ? `Minimální množství: ${rule.minimum}`
      : `Minimum: ${rule.minimum}`,
    step: czech
      ? `Prodává se v násobcích ${rule.step}`
      : `Sold in multiples of ${rule.step}`,
    maximum:
      rule.maximum == null
        ? null
        : czech
          ? `Maximální množství: ${rule.maximum}`
          : `Maximum: ${rule.maximum}`,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = context.session?.shop ?? url.searchParams.get("shop");

  if (!shop) {
    return Response.json(
      { status: "won-quantity-config-ok", enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const productGid =
    toShopifyGid(url.searchParams.get("product_id"), "Product") ??
    "gid://shopify/Product/0";
  const variantGid = toShopifyGid(
    url.searchParams.get("variant_id"),
    "ProductVariant",
  );

  try {
    const rule = await resolveQuantityRule(shop, productGid, variantGid);
    return Response.json(
      {
        status: "won-quantity-config-ok",
        ...rule,
        messages: localizedMessages(
          url.searchParams.get("locale") ?? "en",
          rule,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "won-quantity-config-ok", enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
};
