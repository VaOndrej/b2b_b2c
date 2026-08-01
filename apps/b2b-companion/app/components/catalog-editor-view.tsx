// MVP_5_3 Phase 2 — catalog editor with per-facet tabs (Settings/Audience +
// Membership | Price list | Floor | Discounts | Quantity). Props-driven, native
// <form method="post"> posting intents handled by handleCatalogsSettingsAction.
// Reuses CatalogFields from the list view (move-not-copy) for the settings tab.

import { CatalogFields, type CatalogListItem } from "./catalogs-view";
import { AdminCatalogPicker } from "./admin-catalog-picker";

export const CATALOG_EDITOR_TABS = [
  { id: "settings", label: "Settings & audience" },
  { id: "membership", label: "Membership" },
  { id: "price-list", label: "Price list" },
  { id: "floor", label: "Floor" },
  { id: "discounts", label: "Discounts" },
  { id: "quantity", label: "Quantity" },
  { id: "visibility", label: "Visibility" },
] as const;

export type CatalogEditorTab = (typeof CATALOG_EDITOR_TABS)[number]["id"];

export interface CatalogDetail extends CatalogListItem {
  memberships: Array<{ id: string; productId: string }>;
  priceRules: Array<{ id: string; scope: string; targetId: string | null; mode: string; value: number }>;
  floorRules: Array<{ id: string; productId: string | null; variantId: string | null; minPercentOfBasePrice: number; allowZeroFinalPrice: boolean | null }>;
  discountRules: Array<{ id: string; scope: string; targetId: string | null; code: string | null; percentOff: number; priority: number; stackMode: string; minPricePercentOfBasePrice: number | null }>;
  quantityRules: Array<{ id: string; productId: string | null; variantId: string | null; collectionId: string | null; moq: number | null; step: number | null; max: number | null }>;
  variantVisibilityRules: Array<{ id: string; productId: string; variantId: string; visibilityMode: string }>;
  visibilityRules: Array<{ id: string; scope: string; targetId: string; handle: string | null; visibilityMode: string }>;
  couponRules: Array<{ id: string; code: string }>;
  discountCaps: Array<{ id: string; maxCombinedPercentOff: number }>;
  blacklistRules: Array<{ id: string; leftType: string; leftValue: string; rightType: string; rightValue: string }>;
  customerQuantityRules: Array<{ id: string; customerId: string; productId: string; maxOrderQuantity: number }>;
}

interface CatalogEditorViewProps {
  catalog: CatalogDetail;
  activeTab: CatalogEditorTab;
  isSubmitting: boolean;
}

function HiddenCatalogId({ id }: { id: string }) {
  return <input type="hidden" name="catalogId" value={id} />;
}

function DeleteRow({ intent, ruleId, catalogId, label }: { intent: string; ruleId: string; catalogId: string; label?: string }) {
  return (
    <form method="post" className="catalog-editor-inline">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <HiddenCatalogId id={catalogId} />
      <button type="submit" className="danger">{label ?? "Remove"}</button>
    </form>
  );
}

export function CatalogEditorView({ catalog, activeTab, isSubmitting }: CatalogEditorViewProps) {
  const cid = catalog.id;
  return (
    <div className="catalog-editor" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <style>{`
        .catalog-editor form { display:block; background:#fff; border:1px solid rgba(7,33,58,0.10); border-radius:16px; padding:18px; box-shadow:0 1px 2px rgba(7,33,58,0.04); margin-bottom:12px; }
        .catalog-editor form.catalog-editor-inline { display:inline-block; background:none; border:none; padding:0; box-shadow:none; margin:0; }
        .catalog-editor label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:#344054; }
        .catalog-editor input, .catalog-editor select { border:1px solid #d0d5dd; border-radius:10px; background:#fff; color:#101828; font-size:14px; min-height:38px; padding:8px 12px; box-sizing:border-box; width:100%; }
        .catalog-editor .row { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; margin-bottom:12px; }
        .catalog-editor button { border:1px solid #07213a; border-radius:10px; background:#07213a; color:#fff; min-height:36px; padding:0 14px; font-size:13px; font-weight:600; cursor:pointer; }
        .catalog-editor button.danger { background:#fff; color:#b42318; border-color:rgba(180,35,24,0.4); }
        .catalog-editor table { width:100%; border-collapse:collapse; margin-bottom:12px; font-size:13px; }
        .catalog-editor th, .catalog-editor td { text-align:left; padding:8px 10px; border-bottom:1px solid #eef0f3; }
        .catalog-editor .tabs { display:flex; flex-wrap:wrap; gap:8px; }
        .catalog-editor .tabs a { text-decoration:none; border:1px solid rgba(7,33,58,0.16); border-radius:999px; padding:8px 16px; font-size:13px; font-weight:500; color:#51606f; }
        .catalog-editor .tabs a.active { background:#07213a; color:#fff; font-weight:700; }
        .catalog-editor .editor-head { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .catalog-editor .editor-head h2 { margin:0; font-size:20px; font-weight:700; color:#101828; }
        .catalog-editor .editor-badge { padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700; background:#f2f4f7; color:#475467; }
        .catalog-editor .editor-badge.is-default { background:#eaf2ff; color:#0a4ea3; }
        .catalog-editor .danger-zone { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
        .catalog-editor .danger-zone p { margin:0; font-size:13px; color:#667085; max-width:60ch; }
      `}</style>

      <div className="editor-head">
        <h2>{catalog.name}</h2>
        {catalog.isDefault && <span className="editor-badge is-default">default</span>}
        {catalog.isSystem && <span className="editor-badge">system</span>}
        <span className="editor-badge">priority {catalog.priority}</span>
        <span className="editor-badge">{catalog.status}</span>
      </div>

      <div className="tabs">
        {CATALOG_EDITOR_TABS.map((tab) => (
          <a
            key={tab.id}
            href={`/app/catalogs/${cid}?tab=${tab.id}`}
            className={tab.id === activeTab ? "active" : ""}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {activeTab === "settings" && (
        <s-section heading="Settings & audience">
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog" />
            <HiddenCatalogId id={cid} />
            <CatalogFields catalog={catalog} />
            <button type="submit" disabled={isSubmitting}>Save settings</button>
          </form>

          {!catalog.isSystem && (
            <form method="post" className="danger-zone">
              <input type="hidden" name="intent" value="delete-catalog" />
              <HiddenCatalogId id={cid} />
              <p>
                Deleting a catalog removes its rules and memberships. Customers it scoped fall
                back to the default catalog.
              </p>
              <button type="submit" className="danger" disabled={isSubmitting}>
                Delete catalog
              </button>
            </form>
          )}
        </s-section>
      )}

      {activeTab === "membership" && (
        <s-section heading="Membership">
          <p style={{ fontSize: "13px", color: "#667085" }}>
            {catalog.membershipMode === "INHERIT_ALL"
              ? "This catalog inherits the whole store (INHERIT_ALL). Opt-in entries below are ignored until you switch to OPT_IN on the Settings tab."
              : "Opt-in: only the products listed below belong to this catalog."}
          </p>
          <table>
            <thead><tr><th>Product</th><th></th></tr></thead>
            <tbody>
              {catalog.memberships.map((m) => (
                <tr key={m.id}>
                  <td>{m.productId}</td>
                  <td><DeleteRow intent="remove-catalog-membership" ruleId={m.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="add-catalog-membership" />
            <HiddenCatalogId id={cid} />
            <AdminCatalogPicker name="productId" label="Product" resourceType="product" required />
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add product</button>
          </form>
        </s-section>
      )}

      {activeTab === "price-list" && (
        <s-section heading="Price list">
          <table>
            <thead><tr><th>Scope</th><th>Target</th><th>Mode</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {catalog.priceRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.scope}</td><td>{r.targetId ?? "—"}</td><td>{r.mode}</td><td>{r.value}</td>
                  <td><DeleteRow intent="delete-catalog-price-rule" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-price-rule" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <label>Scope<select name="scope"><option>CATALOG</option><option>COLLECTION</option><option>PRODUCT</option><option>VARIANT</option></select></label>
              <label>Mode<select name="mode"><option>PERCENT</option><option>FIXED</option></select></label>
              <label>Value (PERCENT = % of base, FIXED = unit price)<input name="value" type="number" step="0.01" /></label>
            </div>
            <p style={{ fontSize: "12px", color: "#667085", margin: "0 0 8px" }}>
              Fill the picker that matches the scope (leave all blank for CATALOG):
            </p>
            <div className="row">
              <AdminCatalogPicker name="productId" label="Product (scope PRODUCT)" resourceType="product" />
              <AdminCatalogPicker name="collectionId" label="Collection (scope COLLECTION)" resourceType="collection" />
              <AdminCatalogPicker name="variantId" label="Variant (scope VARIANT)" resourceType="variant" />
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add price rule</button>
          </form>
        </s-section>
      )}

      {activeTab === "floor" && (
        <s-section heading="Floor">
          <table>
            <thead><tr><th>Product</th><th>Variant</th><th>Min %</th><th>Allow zero</th><th></th></tr></thead>
            <tbody>
              {catalog.floorRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.productId ?? "(catalog default)"}</td><td>{r.variantId ?? "—"}</td>
                  <td>{r.minPercentOfBasePrice}</td><td>{r.allowZeroFinalPrice == null ? "—" : String(r.allowZeroFinalPrice)}</td>
                  <td><DeleteRow intent="delete-catalog-floor-rule" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-floor-rule" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="productId" label="Product (blank = catalog default)" resourceType="product" />
              <AdminCatalogPicker name="variantId" label="Variant (optional)" resourceType="variant" />
              <label>Min % of base<input name="minPercentOfBasePrice" type="number" step="0.01" /></label>
            </div>
            <label className="catalog-editor-checkbox" style={{ flexDirection: "row", alignItems: "center", gap: "8px" }}>
              <input type="checkbox" name="allowZeroFinalPrice" style={{ width: "auto", minHeight: 0 }} /> Allow zero final price
            </label>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add floor rule</button>
          </form>
        </s-section>
      )}

      {activeTab === "discounts" && (
        <s-section heading="Discounts">
          <table>
            <thead><tr><th>Scope</th><th>Target/Code</th><th>% off</th><th>Priority</th><th>Stack</th><th></th></tr></thead>
            <tbody>
              {catalog.discountRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.scope}</td><td>{r.code ?? r.targetId ?? "—"}</td><td>{r.percentOff}</td>
                  <td>{r.priority}</td><td>{r.stackMode}</td>
                  <td><DeleteRow intent="delete-catalog-discount-rule" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-discount-rule" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <label>Scope<select name="scope"><option>GLOBAL</option><option>COLLECTION</option><option>PRODUCT</option><option>COUPON</option></select></label>
              <label>Code (scope COUPON)<input name="code" /></label>
              <label>% off<input name="percentOff" type="number" step="0.01" /></label>
            </div>
            <div className="row">
              <AdminCatalogPicker name="productId" label="Product (scope PRODUCT)" resourceType="product" />
              <AdminCatalogPicker name="collectionId" label="Collection (scope COLLECTION)" resourceType="collection" />
              <label>Priority<input name="priority" type="number" defaultValue="100" /></label>
            </div>
            <div className="row">
              <label>Stack<select name="stackMode"><option>STACKABLE</option><option>EXCLUSIVE</option><option>NEVER_WITH_COUPONS</option></select></label>
              <label>Min price % of base (optional)<input name="minPricePercentOfBasePrice" type="number" step="0.01" /></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add discount rule</button>
          </form>

          <h4 style={{ margin: "8px 0 0", fontSize: "14px", color: "#101828" }}>Coupons allowed in this catalog</h4>
          <table>
            <thead><tr><th>Code</th><th></th></tr></thead>
            <tbody>
              {catalog.couponRules.map((r) => (
                <tr key={r.id}><td>{r.code}</td><td><DeleteRow intent="delete-catalog-coupon" ruleId={r.id} catalogId={cid} /></td></tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-coupon" />
            <HiddenCatalogId id={cid} />
            <label>Coupon code<input name="code" placeholder="VIP20" /></label>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Allow coupon</button>
          </form>

          <h4 style={{ margin: "8px 0 0", fontSize: "14px", color: "#101828" }}>Max combined discount cap</h4>
          <p style={{ fontSize: "12px", color: "#667085", margin: "0 0 6px" }}>
            Current: {catalog.discountCaps[0] ? `${catalog.discountCaps[0].maxCombinedPercentOff}%` : "none (uses shop default)"}
          </p>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-cap" />
            <HiddenCatalogId id={cid} />
            <label>Cap % (combined discounts)<input name="maxCombinedPercentOff" type="number" step="0.01" /></label>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Set cap</button>
          </form>
          {catalog.discountCaps[0] && (
            <form method="post" className="catalog-editor-inline" style={{ marginTop: "6px" }}>
              <input type="hidden" name="intent" value="delete-catalog-cap" />
              <HiddenCatalogId id={cid} />
              <button type="submit" className="danger">Clear cap</button>
            </form>
          )}

          <h4 style={{ margin: "8px 0 0", fontSize: "14px", color: "#101828" }}>Discount combination blacklist</h4>
          <table>
            <thead><tr><th>Left</th><th>Right</th><th></th></tr></thead>
            <tbody>
              {catalog.blacklistRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.leftType}:{r.leftValue}</td><td>{r.rightType}:{r.rightValue}</td>
                  <td><DeleteRow intent="delete-catalog-blacklist" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-blacklist" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <label>Left type<select name="leftType"><option>COUPON_CODE</option><option>RULE_ID</option><option>SCOPE</option></select></label>
              <label>Left value<input name="leftValue" /></label>
            </div>
            <div className="row">
              <label>Right type<select name="rightType"><option>COUPON_CODE</option><option>RULE_ID</option><option>SCOPE</option></select></label>
              <label>Right value<input name="rightValue" /></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add blacklist pair</button>
          </form>
        </s-section>
      )}

      {activeTab === "quantity" && (
        <s-section heading="Quantity">
          <table>
            <thead><tr><th>Product</th><th>Variant</th><th>Collection</th><th>MOQ</th><th>Step</th><th>Max</th><th></th></tr></thead>
            <tbody>
              {catalog.quantityRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.productId ?? "—"}</td><td>{r.variantId ?? "—"}</td><td>{r.collectionId ?? "—"}</td>
                  <td>{r.moq ?? "—"}</td><td>{r.step ?? "—"}</td><td>{r.max ?? "—"}</td>
                  <td><DeleteRow intent="delete-catalog-quantity-rule" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-quantity-rule" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="productId" label="Product" resourceType="product" />
              <AdminCatalogPicker name="variantId" label="Variant (optional)" resourceType="variant" />
              <AdminCatalogPicker name="collectionId" label="Collection (optional)" resourceType="collection" />
            </div>
            <div className="row">
              <label>MOQ<input name="moq" type="number" /></label>
              <label>Step<input name="step" type="number" /></label>
              <label>Max<input name="max" type="number" /></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add quantity rule</button>
          </form>

          <h4 style={{ margin: "8px 0 0", fontSize: "14px", color: "#101828" }}>Customer-specific max quantity</h4>
          <table>
            <thead><tr><th>Customer</th><th>Product</th><th>Max</th><th></th></tr></thead>
            <tbody>
              {catalog.customerQuantityRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.customerId}</td><td>{r.productId}</td><td>{r.maxOrderQuantity}</td>
                  <td><DeleteRow intent="delete-catalog-customer-quantity" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-customer-quantity" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="customerId" label="Customer" resourceType="customer" />
              <AdminCatalogPicker name="productId" label="Product" resourceType="product" />
              <label>Max<input name="maxOrderQuantity" type="number" /></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add customer max</button>
          </form>
        </s-section>
      )}

      {activeTab === "visibility" && (
        <s-section heading="Variant visibility">
          <p style={{ fontSize: "13px", color: "#667085" }}>
            Hide specific variants for customers resolved into this catalog (e.g. a
            carton variant visible only in wholesale). Projected to the storefront.
          </p>
          <table>
            <thead><tr><th>Product</th><th>Variant</th><th>Mode</th><th></th></tr></thead>
            <tbody>
              {catalog.variantVisibilityRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.productId}</td><td>{r.variantId}</td><td>{r.visibilityMode}</td>
                  <td><DeleteRow intent="delete-catalog-variant-visibility" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-variant-visibility" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="productId" label="Product" resourceType="product" required />
              <AdminCatalogPicker name="variantId" label="Variant" resourceType="variant" required />
              <label>Mode<select name="visibilityMode"><option>HIDDEN</option><option>VISIBLE</option></select></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add variant rule</button>
          </form>

          <h4 style={{ margin: "8px 0 0", fontSize: "14px", color: "#101828" }}>Product &amp; collection visibility</h4>
          <table>
            <thead><tr><th>Scope</th><th>Target</th><th>Handle</th><th>Mode</th><th></th></tr></thead>
            <tbody>
              {catalog.visibilityRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.scope}</td><td>{r.targetId}</td><td>{r.handle ?? "—"}</td><td>{r.visibilityMode}</td>
                  <td><DeleteRow intent="delete-catalog-visibility" ruleId={r.id} catalogId={cid} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-visibility" />
            <input type="hidden" name="scope" value="PRODUCT" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="targetId" label="Hide product" resourceType="product" required />
              <label>Mode<select name="visibilityMode"><option>HIDDEN</option><option>VISIBLE</option></select></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add product rule</button>
          </form>
          <form method="post">
            <input type="hidden" name="intent" value="save-catalog-visibility" />
            <input type="hidden" name="scope" value="COLLECTION" />
            <HiddenCatalogId id={cid} />
            <div className="row">
              <AdminCatalogPicker name="targetId" label="Hide collection" resourceType="collection" required />
              <label>Collection handle (for storefront)<input name="handle" placeholder="wholesale" /></label>
              <label>Mode<select name="visibilityMode"><option>HIDDEN</option><option>VISIBLE</option></select></label>
            </div>
            <button type="submit" disabled={isSubmitting} style={{ marginTop: "10px" }}>Add collection rule</button>
          </form>
        </s-section>
      )}
    </div>
  );
}
