import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createCatalogSearchLoader,
  searchAdminCatalog,
} from "../services/admin-catalog-search.server";

const catalogSearchLoader = createCatalogSearchLoader({
  authenticateAdmin: (request) => authenticate.admin(request),
  searchCatalog: searchAdminCatalog,
});

export const loader = async ({ request }: LoaderFunctionArgs) =>
  catalogSearchLoader({ request });
