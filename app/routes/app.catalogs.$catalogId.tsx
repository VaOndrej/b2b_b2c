import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getPriceCatalogDetail } from "../services/price-catalog.server";
import { handleCatalogsSettingsAction } from "../services/catalogs-settings.server";
import { republishCatalogRuntime } from "../services/catalog-runtime-publish.server";
import {
  CatalogEditorView,
  CATALOG_EDITOR_TABS,
  type CatalogDetail,
  type CatalogEditorTab,
} from "../components/catalog-editor-view";

// MVP_5_3 Phase 2 — catalog editor (per-facet tabs), at /app/catalogs/:catalogId.
// MVP_5_5: nests under the app.catalogs layout, which owns the page shell and the
// catalog rail. So this route renders the right pane only — no page element of its
// own (two would double the frame) and no back link, since the rail replaces it.

function normalizeTab(value: string | null): CatalogEditorTab {
  return CATALOG_EDITOR_TABS.some((tab) => tab.id === value)
    ? (value as CatalogEditorTab)
    : "settings";
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const catalog = (await getPriceCatalogDetail(String(params.catalogId))) as unknown as
    | CatalogDetail
    | null;
  if (!catalog) {
    throw redirect("/app/catalogs");
  }
  return { catalog };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  await handleCatalogsSettingsAction({ formData });
  await republishCatalogRuntime(admin);
  // Deleting the catalog from its editor returns to the list.
  if (intent === "delete-catalog") {
    return redirect("/app/catalogs");
  }
  return redirect(`/app/catalogs/${String(params.catalogId)}?tab=${intent.includes("price") ? "price-list" : intent.includes("floor") ? "floor" : intent.includes("discount") ? "discounts" : intent.includes("quantity") ? "quantity" : intent.includes("membership") ? "membership" : "settings"}`);
};

export default function CatalogEditorRoute() {
  const { catalog } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  const activeTab = normalizeTab(searchParams.get("tab"));

  return <CatalogEditorView catalog={catalog} activeTab={activeTab} isSubmitting={isSubmitting} />;
}
