// MVP_5_5 — the catalogs rail: persistent left-hand navigation shared by the
// create form (/app/catalogs) and the per-catalog editor (/app/catalogs/:id).
// It lives in the app.catalogs layout route, so switching catalogs only swaps
// the right pane. "Create a catalog" is the first entry and targets the index
// route; every other entry is one catalog.

import type { CatalogListItem } from "./catalogs-view";

interface CatalogsRailProps {
  catalogs: CatalogListItem[];
  activeCatalogId?: string;
}

function ruleCount(catalog: CatalogListItem): number {
  const counts = catalog._count;
  if (!counts) {
    return 0;
  }
  return (
    counts.priceRules +
    counts.tierPrices +
    counts.floorRules +
    counts.quantityRules +
    counts.discountRules
  );
}

export function CatalogsRail({ catalogs, activeCatalogId }: CatalogsRailProps) {
  const isCreateActive = !activeCatalogId;
  return (
    <nav className="catalogs-rail" aria-label="Catalogs">
      <style>{`
        .catalogs-rail {
          position: sticky; top: 16px; align-self: start;
          display: flex; flex-direction: column; gap: 4px;
          background: #fff; border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 18px; padding: 10px;
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
        }
        .catalogs-rail a {
          display: block; text-decoration: none; border-radius: 12px;
          padding: 10px 12px; color: #344054; border: 1px solid transparent;
        }
        .catalogs-rail a:hover { background: #f7f9fb; }
        .catalogs-rail a.active { background: #f2f6fb; border-color: rgba(0, 91, 211, 0.28); }
        .catalogs-rail a.create {
          font-weight: 700; color: #07213a; border-color: rgba(7, 33, 58, 0.16);
          border-style: dashed; margin-bottom: 6px;
        }
        .catalogs-rail a.create.active { background: #07213a; color: #fff; border-style: solid; }
        .catalogs-rail .rail-name {
          display: block; font-size: 14px; font-weight: 600; color: #101828;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .catalogs-rail a.active .rail-name { color: #0a4ea3; }
        .catalogs-rail .rail-meta {
          margin-top: 4px; display: flex; align-items: center; flex-wrap: wrap; gap: 5px;
          font-size: 11px; color: #667085;
        }
        .catalogs-rail .rail-badge {
          padding: 1px 8px; border-radius: 999px; font-weight: 700;
          background: #f2f4f7; color: #475467;
        }
        .catalogs-rail .rail-badge.is-default { background: #eaf2ff; color: #0a4ea3; }
        .catalogs-rail .rail-empty { padding: 10px 12px; font-size: 13px; color: #667085; }
      `}</style>

      <a href="/app/catalogs" className={`create${isCreateActive ? " active" : ""}`}>
        + Create a catalog
      </a>

      {catalogs.length === 0 ? (
        <p className="rail-empty">
          No catalogs yet. The default and B2B system catalogs are seeded automatically.
        </p>
      ) : (
        catalogs.map((catalog) => {
          const isActive = catalog.id === activeCatalogId;
          return (
            <a
              key={catalog.id}
              href={`/app/catalogs/${catalog.id}`}
              className={isActive ? "active" : ""}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="rail-name">{catalog.name}</span>
              <span className="rail-meta">
                {catalog.isDefault && <span className="rail-badge is-default">default</span>}
                {catalog.isSystem && <span className="rail-badge">system</span>}
                <span className="rail-badge">{catalog.status}</span>
                <span>
                  {ruleCount(catalog)} rules · {catalog._count?.memberships ?? 0} members
                </span>
              </span>
            </a>
          );
        })
      )}
    </nav>
  );
}
