import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useParams } from "react-router";
import { authenticate } from "../shopify.server";
import { listPriceCatalogs } from "../services/price-catalog.server";
import { CatalogsRail } from "../components/catalogs-rail";
import type { CatalogListItem } from "../components/catalogs-view";

// MVP_5_5 — Catalogs layout route. Owns the page shell and the catalog rail;
// the right pane is whichever child matched: the create form (index) or the
// per-catalog editor ($catalogId). The loader runs on both URLs, so the rail
// stays populated and revalidates itself after any child action (rename a
// catalog and its rail entry updates with it).
//
// Writes live on the children: a native <form method="post"> targets the
// current URL, which always resolves to the leaf route's action.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const catalogs = (await listPriceCatalogs()) as unknown as CatalogListItem[];
  return { catalogs };
};

export default function CatalogsLayoutRoute() {
  const { catalogs } = useLoaderData<typeof loader>();
  const { catalogId } = useParams();

  return (
    <s-page heading="Catalogs">
      <p style={{ margin: "0 0 16px", color: "#475467", fontSize: "14px", lineHeight: 1.5 }}>
        A catalog is the universal scoping key: audience (tags / company / market) plus its own
        price list, floor, discounts, quantity, and membership. The <strong>default</strong>{" "}
        catalog is the global baseline (anonymous / B2C fallback); other catalogs inherit it and
        override only what they set.
      </p>

      <div className="catalogs-layout">
        <style>{`
          .catalogs-layout {
            display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
            gap: 20px; align-items: start;
          }
          @media (max-width: 900px) {
            .catalogs-layout { grid-template-columns: minmax(0, 1fr); }
          }
        `}</style>
        <CatalogsRail catalogs={catalogs} activeCatalogId={catalogId} />
        <div>
          <Outlet />
        </div>
      </div>
    </s-page>
  );
}
