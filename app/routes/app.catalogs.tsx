import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { listPriceCatalogs } from "../services/price-catalog.server";
import { handleCatalogsSettingsAction } from "../services/catalogs-settings.server";
import { republishCatalogRuntime } from "../services/catalog-runtime-publish.server";
import { CatalogsView, type CatalogListItem } from "../components/catalogs-view";

// MVP_5_3 Phase 2 — standalone Catalogs admin route. Lists the system catalogs
// (default / b2b, seeded by migration) plus the merchant's N custom catalogs and
// lets them create/edit/delete catalogs (audience tags, market filter, priority,
// status, membership mode). Per-facet rule editing (price list / floor /
// discounts / quantity / membership) attaches in a follow-up; enforcement wiring
// is Phase 3. Behavior is unchanged until Phase 3 switches publication.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const catalogs = (await listPriceCatalogs()) as unknown as CatalogListItem[];
  return { catalogs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  await handleCatalogsSettingsAction({ formData });
  await republishCatalogRuntime(admin);
  return null;
};

export default function CatalogsRoute() {
  const { catalogs } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Catalogs">
      <p style={{ margin: "0 0 16px", color: "#475467", fontSize: "14px", lineHeight: 1.5 }}>
        A catalog is the universal scoping key: audience (tags / company / market) plus its own
        price list, floor, discounts, quantity, and membership. The <strong>default</strong>{" "}
        catalog is the global baseline (anonymous / B2C fallback); other catalogs inherit it and
        override only what they set.
      </p>
      <CatalogsView catalogs={catalogs} isSubmitting={isSubmitting} />
    </s-page>
  );
}
