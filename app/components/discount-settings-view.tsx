import { AdminCatalogPicker } from "./admin-catalog-picker";
import {
  modifyRuleButtonStyle,
  deleteRuleButtonStyle,
  type ManualRuleFormController,
} from "./use-manual-rule-form";
import type { CatalogDescribers } from "./catalog-describers";
import type { DiscountConflictView } from "../services/discount-conflict.server";

// MVP_5_1 (move-not-copy): the Discounts admin UI (coupon segment rules,
// automatic-discount/floor conflict banner, advanced orchestration, blacklist
// combinations, per-segment caps) extracted verbatim from the app.settings.tsx
// monolith. Both the standalone app.settings.discounts route and the legacy
// all-in-one workspace render THIS component, so there is one implementation.

export interface DiscountSettingsViewProps {
  isDiscountCouponsSection: boolean;
  isDiscountOrchestrationSection: boolean;
  couponSegmentRules: any[];
  advancedDiscountRules: any[];
  discountBlacklistRules: any[];
  discountSegmentCaps: any[];
  discountConflicts: DiscountConflictView[];
  isSubmitting: boolean;
  openManualRuleForm: ManualRuleFormController["openManualRuleForm"];
  setOpenManualRuleForm: ManualRuleFormController["setOpenManualRuleForm"];
  openManualAddForm: ManualRuleFormController["openManualAddForm"];
  openManualModifyForm: ManualRuleFormController["openManualModifyForm"];
  describeProduct: CatalogDescribers["describeProduct"];
  describeCollection: CatalogDescribers["describeCollection"];
}

export function DiscountSettingsView({
  isDiscountCouponsSection,
  isDiscountOrchestrationSection,
  couponSegmentRules,
  advancedDiscountRules,
  discountBlacklistRules,
  discountSegmentCaps,
  discountConflicts,
  isSubmitting,
  openManualRuleForm,
  setOpenManualRuleForm,
  openManualAddForm,
  openManualModifyForm,
  describeProduct,
  describeCollection,
}: DiscountSettingsViewProps) {
  return (
    <>
      {isDiscountCouponsSection && (
      <s-section heading="Coupon segment validation rules">
        <button
          type="button"
          style={modifyRuleButtonStyle}
          onClick={() => openManualAddForm("coupon-segment-rule-form")}
        >
          Add coupon rule
        </button>
        {openManualRuleForm === "coupon-segment-rule-form" ? (
          <form
            id="coupon-segment-rule-form"
            data-rule-panel-form-id="coupon-segment-rule-form"
            method="post"
          >
            <input type="hidden" name="intent" value="save-coupon-segment-rule" />
            <s-stack direction="block" gap="base">
              <label>
                Coupon code
                <input name="code" required placeholder="VIP20" />
              </label>
              <label>
                Allowed segment
                <select name="allowedSegment" defaultValue="ALL">
                  <option value="ALL">All segments</option>
                  <option value="B2B">B2B only</option>
                  <option value="B2C">B2C only</option>
                </select>
              </label>
              <s-stack direction="inline" gap="small">
                <button
                  type="button"
                  onClick={() => setOpenManualRuleForm(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}>
                  Save coupon rule
                </button>
              </s-stack>
            </s-stack>
          </form>
        ) : null}

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured coupon rules</s-heading>
          {couponSegmentRules.length === 0 ? (
            <s-paragraph>No coupon segment rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {couponSegmentRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.code} | allowed: {rule.allowedSegment}
                  </s-text>
                  <button
                    type="button"
                    style={modifyRuleButtonStyle}
                    onClick={() =>
                      openManualModifyForm("coupon-segment-rule-form", {
                        code: rule.code,
                        allowedSegment: rule.allowedSegment,
                      })
                    }
                  >
                    Modify
                  </button>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-coupon-segment-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={deleteRuleButtonStyle}
                    >
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      )}

      {(isDiscountOrchestrationSection || isDiscountCouponsSection) &&
        discountConflicts &&
        discountConflicts.length > 0 && (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(189, 27, 27, 0.28)",
              background: "rgba(255, 226, 226, 0.55)",
              color: "#7a1414",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            <strong>
              Automatic discount conflicts with your margin floor (
              {discountConflicts.length})
            </strong>
            <s-paragraph>
              These active automatic Shopify discounts, combined with your
              margin-guard rules, would push the price below the configured floor
              and get blocked (or clipped) at checkout. Lower the discount, raise
              the floor, or exclude the products.
            </s-paragraph>
            <s-stack direction="block" gap="small">
              {discountConflicts.map((conflict, index) => (
                <s-text key={`${conflict.discount.id}-${conflict.targetKind}-${conflict.targetId ?? "all"}-${conflict.segment}-${index}`}>
                  <strong>{conflict.discount.title}</strong> (
                  {conflict.discount.percentOff}% off) on{" "}
                  <strong>{conflict.targetLabel}</strong> · {conflict.segment} ·
                  floor {conflict.floorPercent}% · total {conflict.totalPercentOff}
                  % off
                  {conflict.reason === "ZERO_FINAL_PRICE_NOT_ALLOWED"
                    ? " · final price would be zero"
                    : " · below floor"}
                </s-text>
              ))}
            </s-stack>
          </div>
        )}
      {isDiscountOrchestrationSection && (
      <>
      <s-section heading="Advanced discount orchestration rules">
        <button
          type="button"
          style={modifyRuleButtonStyle}
          onClick={() => openManualAddForm("advanced-discount-rule-form")}
        >
          Add advanced discount rule
        </button>
        {openManualRuleForm === "advanced-discount-rule-form" ? (
          <form
            id="advanced-discount-rule-form"
            data-rule-panel-form-id="advanced-discount-rule-form"
            method="post"
          >
            <input type="hidden" name="intent" value="save-discount-rule" />
            <s-stack direction="block" gap="base">
              <label>
                Scope
                <select name="scope" defaultValue="GLOBAL">
                  <option value="GLOBAL">Global</option>
                  <option value="COLLECTION">Collection</option>
                  <option value="PRODUCT">Product</option>
                  <option value="COUPON">Coupon</option>
                </select>
              </label>
              <AdminCatalogPicker
                name="productId"
                label="Product (for product scope)"
                resourceType="product"
              />
              <AdminCatalogPicker
                name="collectionId"
                label="Collection (for collection scope)"
                resourceType="collection"
              />
              <label>
                Coupon code (for coupon scope)
                <input name="code" placeholder="VIP20" />
              </label>
              <label>
                Segment (optional)
                <select name="segment" defaultValue="">
                  <option value="">All segments</option>
                  <option value="B2B">B2B</option>
                  <option value="B2C">B2C</option>
                </select>
              </label>
              <label>
                Percent off
                <input
                  name="percentOff"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={10}
                  required
                />
              </label>
              <label>
                Priority
                <input name="priority" type="number" step={1} defaultValue={100} />
              </label>
              <label>
                Stack mode
                <select name="stackMode" defaultValue="STACKABLE">
                  <option value="STACKABLE">Stackable</option>
                  <option value="EXCLUSIVE">Exclusive</option>
                  <option value="NEVER_WITH_COUPONS">Never with coupons</option>
                </select>
              </label>
              <label>
                Minimum price percent of base price (optional)
                <input
                  name="minPricePercentOfBasePrice"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  placeholder="e.g. 75"
                />
              </label>
              <s-stack direction="inline" gap="small">
                <button
                  type="button"
                  onClick={() => setOpenManualRuleForm(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}>
                  Save advanced discount rule
                </button>
              </s-stack>
            </s-stack>
          </form>
        ) : null}

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured advanced discount rules</s-heading>
          {advancedDiscountRules.length === 0 ? (
            <s-paragraph>No advanced discount rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {advancedDiscountRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.scope}
                    {rule.targetId
                      ? ` | ${
                          rule.scope === "PRODUCT"
                            ? describeProduct(rule.targetId)
                            : rule.scope === "COLLECTION"
                              ? describeCollection(rule.targetId)
                              : rule.targetId
                        }`
                      : ""}
                    {rule.code ? ` | ${rule.code}` : ""}
                    {" | "}
                    {rule.segment ?? "ALL"} | {rule.percentOff}% | priority {rule.priority}
                    {" | "}
                    {rule.stackMode}
                    {" | "}
                    min-price:{" "}
                    {rule.minPricePercentOfBasePrice == null
                      ? "inherit"
                      : `${rule.minPricePercentOfBasePrice}%`}
                  </s-text>
                  <button
                    type="button"
                    style={modifyRuleButtonStyle}
                    onClick={() =>
                      openManualModifyForm(
                        "advanced-discount-rule-form",
                        {
                          scope: rule.scope,
                          productId: rule.scope === "PRODUCT" ? rule.targetId : "",
                          collectionId:
                            rule.scope === "COLLECTION" ? rule.targetId : "",
                          code: rule.code ?? "",
                          segment: rule.segment ?? "",
                          percentOff: rule.percentOff,
                          priority: rule.priority,
                          stackMode: rule.stackMode,
                          minPricePercentOfBasePrice:
                            rule.minPricePercentOfBasePrice ?? "",
                        },
                        {
                          productId:
                            rule.scope === "PRODUCT"
                              ? describeProduct(rule.targetId)
                              : "",
                          collectionId:
                            rule.scope === "COLLECTION"
                              ? describeCollection(rule.targetId)
                              : "",
                        },
                      )
                    }
                  >
                    Modify
                  </button>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-discount-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={deleteRuleButtonStyle}
                    >
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Discount blacklist combinations">
        <button
          type="button"
          style={modifyRuleButtonStyle}
          onClick={() => openManualAddForm("discount-blacklist-rule-form")}
        >
          Add blacklist rule
        </button>
        {openManualRuleForm === "discount-blacklist-rule-form" ? (
          <form
            id="discount-blacklist-rule-form"
            data-rule-panel-form-id="discount-blacklist-rule-form"
            method="post"
          >
            <input type="hidden" name="intent" value="save-discount-blacklist-rule" />
            <s-stack direction="block" gap="base">
              <label>
                Left type
                <select name="leftType" defaultValue="COUPON_CODE">
                  <option value="COUPON_CODE">Coupon code</option>
                  <option value="SCOPE">Rule scope</option>
                  <option value="RULE_ID">Rule ID</option>
                </select>
              </label>
              <label>
                Left value
                <input name="leftValue" placeholder="VIP20 or GLOBAL" required />
              </label>
              <label>
                Right type
                <select name="rightType" defaultValue="COUPON_CODE">
                  <option value="COUPON_CODE">Coupon code</option>
                  <option value="SCOPE">Rule scope</option>
                  <option value="RULE_ID">Rule ID</option>
                </select>
              </label>
              <label>
                Right value
                <input name="rightValue" placeholder="SPRING10 or COLLECTION" required />
              </label>
              <label>
                Segment
                <select name="segment" defaultValue="ALL">
                  <option value="ALL">All segments</option>
                  <option value="B2B">B2B only</option>
                  <option value="B2C">B2C only</option>
                </select>
              </label>
              <s-stack direction="inline" gap="small">
                <button
                  type="button"
                  onClick={() => setOpenManualRuleForm(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}>
                  Save blacklist rule
                </button>
              </s-stack>
            </s-stack>
          </form>
        ) : null}

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured blacklist rules</s-heading>
          {discountBlacklistRules.length === 0 ? (
            <s-paragraph>No blacklist rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {discountBlacklistRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.leftType}:{rule.leftValue} x {rule.rightType}:{rule.rightValue} |{" "}
                    {rule.segment ?? "ALL"}
                  </s-text>
                  <button
                    type="button"
                    style={modifyRuleButtonStyle}
                    onClick={() =>
                      openManualModifyForm("discount-blacklist-rule-form", {
                        leftType: rule.leftType,
                        leftValue: rule.leftValue,
                        rightType: rule.rightType,
                        rightValue: rule.rightValue,
                        segment: rule.segment ?? "ALL",
                      })
                    }
                  >
                    Modify
                  </button>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-discount-blacklist-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={deleteRuleButtonStyle}
                    >
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-segment discount caps">
        <button
          type="button"
          style={modifyRuleButtonStyle}
          onClick={() => openManualAddForm("discount-segment-cap-form")}
        >
          Add segment cap
        </button>
        {openManualRuleForm === "discount-segment-cap-form" ? (
          <form
            id="discount-segment-cap-form"
            data-rule-panel-form-id="discount-segment-cap-form"
            method="post"
          >
            <input type="hidden" name="intent" value="save-discount-segment-cap" />
            <s-stack direction="block" gap="base">
              <label>
                Segment
                <select name="segment" defaultValue="ALL">
                  <option value="ALL">All segments</option>
                  <option value="B2B">B2B only</option>
                  <option value="B2C">B2C only</option>
                </select>
              </label>
              <label>
                Max combined discount percent
                <input
                  name="maxCombinedPercentOff"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={40}
                  required
                />
              </label>
              <s-stack direction="inline" gap="small">
                <button
                  type="button"
                  onClick={() => setOpenManualRuleForm(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting}>
                  Save segment cap
                </button>
              </s-stack>
            </s-stack>
          </form>
        ) : null}

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured segment caps</s-heading>
          {discountSegmentCaps.length === 0 ? (
            <s-paragraph>No segment caps yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {discountSegmentCaps.map((cap: any) => (
                <s-stack key={cap.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {cap.segment} | max combined {cap.maxCombinedPercentOff}%
                  </s-text>
                  <button
                    type="button"
                    style={modifyRuleButtonStyle}
                    onClick={() =>
                      openManualModifyForm("discount-segment-cap-form", {
                        segment: cap.segment,
                        maxCombinedPercentOff: cap.maxCombinedPercentOff,
                      })
                    }
                  >
                    Modify
                  </button>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-discount-segment-cap"
                    />
                    <input type="hidden" name="id" value={cap.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={deleteRuleButtonStyle}
                    >
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      </>
      )}
    </>
  );
}
