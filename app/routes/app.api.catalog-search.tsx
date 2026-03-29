import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createCatalogSearchLoader,
  type CatalogImportReadinessDetails,
  searchAdminCatalog,
} from "../services/admin-catalog-search.server";
import {
  countActiveCatalogCollections,
  countActiveCatalogProducts,
} from "../services/product-catalog.server";

async function ensureCatalogReadyForPicker(
  type: "product" | "collection" | "customer" | "variant",
): Promise<CatalogImportReadinessDetails | null> {
  if (type === "product" || type === "variant") {
    const productCount = await countActiveCatalogProducts();
    if (productCount === 0) {
      return {
        ok: false,
        error:
          "Product catalog is not imported yet. Open Global Settings and run Import products now.",
        contract: "INTERNAL_ADMIN_ENDPOINT",
        details: {
          catalogImportRequired: true,
          type,
        },
      };
    }
  }

  if (type === "collection") {
    const collectionCount = await countActiveCatalogCollections();
    if (collectionCount === 0) {
      return {
        ok: false,
        error:
          "Collection catalog is not imported yet. Open Global Settings and run Import collections now.",
        contract: "INTERNAL_ADMIN_ENDPOINT",
        details: {
          catalogImportRequired: true,
          type,
        },
      };
    }
  }

  return null;
}

const catalogSearchLoader = createCatalogSearchLoader({
  authenticateAdmin: (request) => authenticate.admin(request),
  searchCatalog: searchAdminCatalog,
  ensureCatalogReady: ensureCatalogReadyForPicker,
});

export const loader = async ({ request }: LoaderFunctionArgs) =>
  catalogSearchLoader({ request });
