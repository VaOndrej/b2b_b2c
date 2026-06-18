// MVP_5_3 Phase 2 (move-not-copy): props-driven Catalogs admin view. Renders the
// list of price catalogs (system + custom), a create form, and per-catalog edit
// forms — all native <form method="post"> posting intents to the standalone
// app.catalogs route, which delegates to handleCatalogsSettingsAction. The
// per-facet rule tabs (price list / floor / discounts / quantity / membership)
// attach to a catalog detail route in a follow-up; this is the catalog CRUD shell.

// Kept in sync with price-catalog.server (CATALOG_STATUSES / MEMBERSHIP_MODES).
// Inlined here because this is a client component — RR7 forbids importing a
// `.server` module into client code.
const CATALOG_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
const MEMBERSHIP_MODES = ["INHERIT_ALL", "OPT_IN"] as const;

interface CatalogAudienceTag {
  tag: string;
}

interface CatalogMarketFilter {
  countryCode?: string | null;
  currencyCode?: string | null;
  languageCode?: string | null;
}

export interface CatalogListItem {
  id: string;
  name: string;
  priority: number;
  status: string;
  isDefault: boolean;
  isSystem: boolean;
  matchCompany: boolean;
  membershipMode: string;
  audienceTags: CatalogAudienceTag[];
  marketFilters: CatalogMarketFilter[];
  _count?: {
    memberships: number;
    priceRules: number;
    tierPrices: number;
    floorRules: number;
    quantityRules: number;
    discountRules: number;
  };
}

interface CatalogsViewProps {
  catalogs: CatalogListItem[];
  isSubmitting: boolean;
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

export function CatalogFields({ catalog }: { catalog?: CatalogListItem }) {
  const market = catalog?.marketFilters?.[0] ?? {};
  return (
    <div className="catalogs-grid">
      <label>
        Name
        <input name="name" defaultValue={catalog?.name ?? ""} required />
      </label>
      <label>
        Priority {catalog?.isSystem ? "(system, fixed)" : ""}
        <input
          name="priority"
          type="number"
          defaultValue={String(catalog?.priority ?? 0)}
          disabled={catalog?.isSystem ?? false}
        />
      </label>
      <label>
        Status
        <select name="status" defaultValue={catalog?.status ?? "DRAFT"}>
          {CATALOG_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Membership
        <select name="membershipMode" defaultValue={catalog?.membershipMode ?? "OPT_IN"}>
          {MEMBERSHIP_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === "INHERIT_ALL" ? "Inherit all products" : "Opt-in list"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Audience tags (comma separated)
        <input
          name="audienceTags"
          defaultValue={(catalog?.audienceTags ?? []).map((t) => t.tag).join(", ")}
          placeholder="loyalty-gold, vip"
        />
      </label>
      <label className="catalogs-checkbox">
        <input
          type="checkbox"
          name="matchCompany"
          defaultChecked={catalog?.matchCompany ?? false}
          disabled={catalog?.isSystem ?? false}
        />
        Match B2B purchasing company
      </label>
      <label>
        Market country (optional)
        <input name="marketCountry" defaultValue={market.countryCode ?? ""} placeholder="CZ" />
      </label>
      <label>
        Market currency (optional)
        <input name="marketCurrency" defaultValue={market.currencyCode ?? ""} placeholder="CZK" />
      </label>
      <label>
        Market language (optional)
        <input name="marketLanguage" defaultValue={market.languageCode ?? ""} placeholder="cs" />
      </label>
    </div>
  );
}

export function CatalogsView({ catalogs, isSubmitting }: CatalogsViewProps) {
  return (
    <div className="catalogs-workspace" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <style>{`
        .catalogs-workspace > s-section > form,
        .catalogs-workspace .catalogs-card {
          display: block;
          background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
          border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 18px;
          padding: 20px;
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
        }
        .catalogs-workspace label {
          display: flex; flex-direction: column; gap: 6px;
          font-size: 13px; font-weight: 600; color: #344054;
        }
        .catalogs-workspace input, .catalogs-workspace select {
          border: 1px solid #d0d5dd; border-radius: 10px; background: #fff;
          color: #101828; font-size: 14px; min-height: 40px; padding: 8px 12px;
          box-sizing: border-box; width: 100%;
        }
        .catalogs-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px 18px; margin-bottom: 14px;
        }
        .catalogs-checkbox { flex-direction: row; align-items: center; gap: 8px; }
        .catalogs-checkbox input { width: auto; min-height: 0; }
        .catalogs-workspace button {
          border: 1px solid #07213a; border-radius: 10px; background: #07213a;
          color: #fff; min-height: 38px; padding: 0 16px; font-size: 13px;
          font-weight: 600; cursor: pointer;
        }
        .catalogs-workspace button.danger {
          background: #fff; color: #b42318; border-color: rgba(180, 35, 24, 0.4);
        }
        .catalogs-badge {
          display: inline-block; padding: 2px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 700; margin-left: 8px;
        }
      `}</style>

      <s-section heading="Create a catalog">
        <form method="post">
          <input type="hidden" name="intent" value="save-catalog" />
          <CatalogFields />
          <button type="submit" disabled={isSubmitting}>
            Create catalog
          </button>
        </form>
      </s-section>

      <s-section heading={`Catalogs (${catalogs.length})`}>
        {catalogs.length === 0 ? (
          <p>No catalogs yet. The default and B2B system catalogs are seeded automatically.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {catalogs.map((catalog) => (
              <div key={catalog.id} className="catalogs-card">
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                  <strong style={{ fontSize: "15px", color: "#101828" }}>{catalog.name}</strong>
                  {catalog.isDefault && (
                    <span className="catalogs-badge" style={{ background: "#eaf2ff", color: "#0a4ea3" }}>default</span>
                  )}
                  {catalog.isSystem && (
                    <span className="catalogs-badge" style={{ background: "#eef0f3", color: "#475467" }}>system</span>
                  )}
                  <span className="catalogs-badge" style={{ background: "#f2f4f7", color: "#475467" }}>
                    priority {catalog.priority}
                  </span>
                  <span className="catalogs-badge" style={{ background: "#f2f4f7", color: "#475467" }}>
                    {catalog.status}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "12px", color: "#667085" }}>
                    {ruleCount(catalog)} rules · {catalog._count?.memberships ?? 0} members
                  </span>
                  <a
                    href={`/app/catalogs/${catalog.id}`}
                    style={{ fontSize: "13px", fontWeight: 600, color: "#005bd3", textDecoration: "none" }}
                  >
                    Open editor →
                  </a>
                </div>

                <form method="post">
                  <input type="hidden" name="intent" value="save-catalog" />
                  <input type="hidden" name="catalogId" value={catalog.id} />
                  <CatalogFields catalog={catalog} />
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button type="submit" disabled={isSubmitting}>
                      Save changes
                    </button>
                  </div>
                </form>

                {!catalog.isSystem && (
                  <form method="post" style={{ marginTop: "10px", background: "none", border: "none", padding: 0, boxShadow: "none" }}>
                    <input type="hidden" name="intent" value="delete-catalog" />
                    <input type="hidden" name="catalogId" value={catalog.id} />
                    <button type="submit" className="danger" disabled={isSubmitting}>
                      Delete catalog
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </s-section>
    </div>
  );
}
