// MVP_5_5 — the Catalogs index pane: the create-a-catalog form. Catalog
// navigation moved to CatalogsRail (rendered by the app.catalogs layout) and
// per-catalog editing lives entirely in CatalogEditorView, so this view no
// longer duplicates the settings form once per catalog. CatalogFields stays
// here because both the create form and the editor's Settings tab share it.

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

interface CatalogCreateViewProps {
  isSubmitting: boolean;
}

export function CatalogFields({ catalog }: { catalog?: CatalogListItem }) {
  const market = catalog?.marketFilters?.[0] ?? {};
  return (
    <div className="catalogs-grid">
      {/* Scoped here, not on a parent: CatalogFields renders inside both the
          create pane and the editor's Settings tab, which style their own shells. */}
      <style>{`
        .catalogs-grid {
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px 18px; margin-bottom: 14px;
        }
        .catalogs-grid .catalogs-checkbox { flex-direction: row; align-items: center; gap: 8px; }
        .catalogs-grid .catalogs-checkbox input { width: auto; min-height: 0; }
      `}</style>
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

export function CatalogCreateView({ isSubmitting }: CatalogCreateViewProps) {
  return (
    <div className="catalogs-workspace">
      <style>{`
        .catalogs-workspace > s-section > form {
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
        .catalogs-workspace button {
          border: 1px solid #07213a; border-radius: 10px; background: #07213a;
          color: #fff; min-height: 38px; padding: 0 16px; font-size: 13px;
          font-weight: 600; cursor: pointer;
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
    </div>
  );
}
