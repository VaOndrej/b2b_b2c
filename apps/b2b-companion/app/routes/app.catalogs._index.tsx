import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { handleCatalogsSettingsAction } from "../services/catalogs-settings.server";
import { republishCatalogRuntime } from "../services/catalog-runtime-publish.server";
import { CatalogCreateView } from "../components/catalogs-view";

// MVP_5_5 — the Catalogs index pane, reached from the rail's "Create a catalog"
// entry. Renders the create form only; listing and editing moved to the rail
// (app.catalogs layout) and the editor route respectively. The page shell comes
// from the parent layout, so this route renders no page element of its own.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const result = await handleCatalogsSettingsAction({ formData });
  await republishCatalogRuntime(admin);
  const createdId = "catalogId" in result ? result.catalogId : undefined;
  return redirect(createdId ? `/app/catalogs/${createdId}` : "/app/catalogs");
};

export default function CatalogsIndexRoute() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return <CatalogCreateView isSubmitting={isSubmitting} />;
}
