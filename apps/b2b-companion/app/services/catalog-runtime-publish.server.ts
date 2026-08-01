import { ensureCartValidationActive } from "./cart-validation-activation.server.ts";
import { ensureDiscountFunctionActive } from "./discount-function-activation.server.ts";
import { syncStorefrontProjectionMetafields } from "./storefront-projection.server.ts";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

// MVP_5_3 #2.2 — after any catalog edit, republish the catalog-derived config to
// the cart-validation + discount function metafields and the storefront
// projection, so catalog changes take effect. Each step is best-effort; a
// failure in one does not block the others (errors are logged).
export async function republishCatalogRuntime(admin: AdminGraphqlClient) {
  await ensureCartValidationActive(admin as any).catch((error) => {
    console.error("[republishCatalogRuntime] cart validation:", error);
  });
  await ensureDiscountFunctionActive(admin as any).catch((error) => {
    console.error("[republishCatalogRuntime] discount function:", error);
  });
  await syncStorefrontProjectionMetafields(admin as any).catch((error) => {
    console.error("[republishCatalogRuntime] storefront projection:", error);
  });
}
