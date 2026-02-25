import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  deactivateDiscountFunction,
  getDiscountFunctionStatusWithAutoDisable,
} from "../services/discount-function-activation.server";
import {
  deleteCouponSegmentRule,
  deleteProductCustomerMaximumQuantityRule,
  deleteProductFloorRule,
  deleteProductMaximumQuantityRule,
  deleteProductQuantityRule,
  deleteProductStepQuantityRule,
  deleteProductVisibilityRule,
  deleteProductTierPriceRule,
  getOrCreateMarginGuardConfig,
  upsertCouponSegmentRule,
  upsertProductCustomerMaximumQuantityRule,
  upsertProductFloorRule,
  upsertProductMaximumQuantityRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductVisibilityRule,
  upsertProductTierPriceRule,
  updateGlobalMarginGuardConfig,
} from "../services/margin-guard-config.server";

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  let config = await getOrCreateMarginGuardConfig();
  let autoActivationMessage: string | null = null;
  let discountFunctionStatus: "ACTIVE" | "INACTIVE" | "ERROR" = "ERROR";
  let discountFunctionMessage = "Discount status is unknown.";
  const syncActivation = await ensureCartValidationActive(admin);
  autoActivationMessage = syncActivation.message;
  config = await getOrCreateMarginGuardConfig();
  const discountStatus = await getDiscountFunctionStatusWithAutoDisable(admin);
  discountFunctionStatus = discountStatus.status;
  discountFunctionMessage = discountStatus.message;
  const url = new URL(request.url);
  const activation = url.searchParams.get("activation");
  const message = url.searchParams.get("message");
  const discountActionMessage = url.searchParams.get("discountActionMessage");
  return {
    config,
    activation,
    message,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-global") {
    const b2bTag = String(formData.get("b2bTag") ?? "b2b").trim() || "b2b";
    const globalMinPricePercent = parseNumber(
      formData.get("globalMinPricePercent"),
      70,
    );
    const allowZeroFinalPrice = formData.get("allowZeroFinalPrice") === "on";
    const allowRemoveAtMinimumOrderQuantity =
      formData.get("allowRemoveAtMinimumOrderQuantity") === "on";
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
      allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity,
      allowStacking,
      maxCombinedPercentOff:
        maxCombinedPercentOff != null && Number.isFinite(maxCombinedPercentOff)
          ? maxCombinedPercentOff
          : null,
    });
  }

  if (intent === "save-product-floor") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const allowZeroOverrideRaw = String(
      formData.get("allowZeroFinalPriceOverride") ?? "inherit",
    ).trim();
    const b2bOverrideRaw = String(formData.get("b2bOverridePrice") ?? "").trim();
    const minPercentOfBasePrice = parseNumber(
      formData.get("minPercentOfBasePrice"),
      70,
    );
    const b2bOverridePrice = b2bOverrideRaw ? Number(b2bOverrideRaw) : null;

    if (productId) {
      await upsertProductFloorRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minPercentOfBasePrice,
        allowZeroFinalPrice:
          allowZeroOverrideRaw === "allow"
            ? true
            : allowZeroOverrideRaw === "deny"
              ? false
              : null,
        b2bOverridePrice:
          b2bOverridePrice != null &&
          Number.isFinite(b2bOverridePrice) &&
          b2bOverridePrice >= 0
            ? b2bOverridePrice
            : null,
      });
    }
  }

  if (intent === "delete-product-floor") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductFloorRule(id);
    }
  }

  if (intent === "save-product-tier-price") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minQuantity = Math.max(1, Math.floor(parseNumber(formData.get("minQuantity"), 1)));
    const unitPrice = parseNumber(formData.get("unitPrice"), NaN);

    if (productId && Number.isFinite(unitPrice) && unitPrice >= 0) {
      await upsertProductTierPriceRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minQuantity,
        unitPrice,
      });
    }
  }

  if (intent === "delete-product-tier-price") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductTierPriceRule(id);
    }
  }

  if (intent === "save-product-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minimumOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("minimumOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minimumOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductQuantityRule(id);
    }
  }

  if (intent === "save-product-step-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const stepQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("stepQuantity"), 1)),
    );

    if (productId) {
      await upsertProductStepQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        stepQuantity,
      });
    }
  }

  if (intent === "delete-product-step-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductStepQuantityRule(id);
    }
  }

  if (intent === "save-product-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductMaximumQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        maxOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductMaximumQuantityRule(id);
    }
  }

  if (intent === "save-product-customer-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );
    if (productId && customerId) {
      await upsertProductCustomerMaximumQuantityRule({
        productId,
        customerId,
        maxOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-customer-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductCustomerMaximumQuantityRule(id);
    }
  }

  if (intent === "save-product-visibility-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "ALL").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();

    if (productId) {
      await upsertProductVisibilityRule({
        productId,
        visibilityMode:
          visibilityModeRaw === "B2B_ONLY" ||
          visibilityModeRaw === "B2C_ONLY" ||
          visibilityModeRaw === "CUSTOMER_ONLY"
            ? visibilityModeRaw
            : "ALL",
        customerId,
      });
    }
  }

  if (intent === "delete-product-visibility-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductVisibilityRule(id);
    }
  }

  if (intent === "save-coupon-segment-rule") {
    const code = String(formData.get("code") ?? "").trim();
    const allowedSegmentRaw = String(formData.get("allowedSegment") ?? "ALL").trim();
    if (code) {
      await upsertCouponSegmentRule({
        code,
        allowedSegment:
          allowedSegmentRaw === "B2B" || allowedSegmentRaw === "B2C"
            ? allowedSegmentRaw
            : "ALL",
      });
    }
  }

  if (intent === "delete-coupon-segment-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteCouponSegmentRule(id);
    }
  }

  if (intent === "deactivate-discount-function") {
    const result = await deactivateDiscountFunction(admin);
    const url = new URL(request.url);
    url.searchParams.set("discountActionMessage", result.message);
    return Response.redirect(url.toString(), 302);
  }

  if (
    intent === "save-global" ||
    intent === "save-product-floor" ||
    intent === "delete-product-floor" ||
    intent === "save-product-tier-price" ||
    intent === "delete-product-tier-price" ||
    intent === "save-product-quantity-rule" ||
    intent === "delete-product-quantity-rule" ||
    intent === "save-product-step-quantity-rule" ||
    intent === "delete-product-step-quantity-rule" ||
    intent === "save-product-max-quantity-rule" ||
    intent === "delete-product-max-quantity-rule" ||
    intent === "save-product-customer-max-quantity-rule" ||
    intent === "delete-product-customer-max-quantity-rule" ||
    intent === "save-product-visibility-rule" ||
    intent === "delete-product-visibility-rule" ||
    intent === "save-coupon-segment-rule" ||
    intent === "delete-coupon-segment-rule"
  ) {
    await ensureCartValidationActive(admin);
  }

  return null;
};

export default function AppSettingsRoute() {
  const {
    config,
    activation,
    message,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
  } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const productMoqRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.minimumOrderQuantity) > 1,
  );
  const productStepRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.stepQuantity ?? 0) > 1,
  );
  const productMaxRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.maxOrderQuantity ?? 0) > 0,
  );
  const productCustomerMaxRules = Array.isArray(config.productCustomerQuantityRules)
    ? config.productCustomerQuantityRules.filter(
        (rule: any) => Number(rule.maxOrderQuantity ?? 0) > 0,
      )
    : [];

  return (
    <s-page heading="Margin Guard Settings">
      <s-section heading="Global configuration">
        <form method="post">
          <input type="hidden" name="intent" value="save-global" />
          <s-stack direction="block" gap="base">
            <label>
              Customer segment tag treated as B2B pricing
              <input name="b2bTag" defaultValue={config.b2bTag} placeholder="wholesale" />
            </label>
            <s-paragraph>
              Any customer with this exact tag is evaluated as the protected segment in
              discount controls.
            </s-paragraph>
            <label>
              Global minimum price percent
              <input
                name="globalMinPricePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.globalMinPricePercent}
              />
            </label>
            <label>
              <input
                name="allowZeroFinalPrice"
                type="checkbox"
                defaultChecked={config.allowZeroFinalPrice}
              />
              Allow zero final price globally
            </label>
            <label>
              <input
                name="allowRemoveAtMinimumOrderQuantity"
                type="checkbox"
                defaultChecked={
                  (config as any).allowRemoveAtMinimumOrderQuantity !== false
                }
              />
              Allow removing a cart line when customer decreases from MOQ
            </label>
            <label>
              <input name="allowStacking" type="checkbox" defaultChecked={config.allowStacking} />
              Allow discount stacking
            </label>
            <label>
              Max combined discount percent (optional)
              <input
                name="maxCombinedPercentOff"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.maxCombinedPercentOff ?? ""}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save global settings
            </button>
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Per-product floor rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-floor" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
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
              Allow zero final price override
              <select name="allowZeroFinalPriceOverride" defaultValue="inherit">
                <option value="inherit">Inherit global</option>
                <option value="allow">Allow free final price</option>
                <option value="deny">Disallow free final price</option>
              </select>
            </label>
            <label>
              Minimum price percent
              <input
                name="minPercentOfBasePrice"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={70}
              />
            </label>
            <label>
              B2B override base price (optional)
              <input
                name="b2bOverridePrice"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 499.00"
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save product floor
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured product floors</s-heading>
          {config.productFloors.length === 0 ? (
            <s-paragraph>No per-product floor rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productFloors.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | {rule.minPercentOfBasePrice}% |
                    zero-final:{" "}
                    {rule.allowZeroFinalPrice == null
                      ? "inherit"
                      : rule.allowZeroFinalPrice
                        ? "allow"
                        : "deny"}{" "}
                    | b2b-base-override:{" "}
                    {rule.b2bOverridePrice == null ? "none" : rule.b2bOverridePrice}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-floor" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product tier pricing rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-tier-price" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
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
              Minimum quantity (tier starts at)
              <input
                name="minQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <label>
              Tier unit price
              <input
                name="unitPrice"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 450.00"
                required
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save tier pricing rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured tier pricing rules</s-heading>
          {config.productTierPrices.length === 0 ? (
            <s-paragraph>No per-product tier pricing rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productTierPrices.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | qty {rule.minQuantity}
                    + | unit price: {rule.unitPrice}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-tier-price" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product MOQ rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-quantity-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
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
              Minimum order quantity (MOQ)
              <input
                name="minimumOrderQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save MOQ rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured MOQ rules</s-heading>
          {productMoqRules.length === 0 ? (
            <s-paragraph>No per-product MOQ rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productMoqRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | MOQ {rule.minimumOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-quantity-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product step quantity rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-step-quantity-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
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
              Step quantity (carton multiple)
              <input
                name="stepQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save step rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured step rules</s-heading>
          {productStepRules.length === 0 ? (
            <s-paragraph>No per-product step quantity rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productStepRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | step {rule.stepQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-step-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product maximum quantity rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-max-quantity-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
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
              Maximum order quantity
              <input
                name="maxOrderQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save maximum quantity rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured max quantity rules</s-heading>
          {productMaxRules.length === 0 ? (
            <s-paragraph>No per-product max quantity rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productMaxRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | max {rule.maxOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-max-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-customer max quantity overrides">
        <form method="post">
          <input
            type="hidden"
            name="intent"
            value="save-product-customer-max-quantity-rule"
          />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
            </label>
            <label>
              Customer ID
              <input
                name="customerId"
                placeholder="gid://shopify/Customer/123456789"
                required
              />
            </label>
            <label>
              Maximum order quantity for this customer
              <input
                name="maxOrderQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save customer max override
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured customer max overrides</s-heading>
          {productCustomerMaxRules.length === 0 ? (
            <s-paragraph>No customer max overrides yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productCustomerMaxRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | customer {rule.customerId} | max {rule.maxOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-customer-max-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Basic product visibility rules">
        <s-paragraph>
          Storefront enforcement: include
          {" "}
          <code>/apps/margin-guard/visibility-script</code>
          {" "}
          in your theme to hide restricted products before checkout.
        </s-paragraph>
        <form method="post">
          <input type="hidden" name="intent" value="save-product-visibility-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
            </label>
            <label>
              Visibility mode
              <select name="visibilityMode" defaultValue="B2B_ONLY">
                <option value="B2B_ONLY">B2B only</option>
                <option value="B2C_ONLY">B2C only</option>
                <option value="CUSTOMER_ONLY">Specific customer only</option>
                <option value="ALL">Visible for all (removes rule)</option>
              </select>
            </label>
            <label>
              Customer ID (required only for specific customer mode)
              <input
                name="customerId"
                placeholder="gid://shopify/Customer/123456789"
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save visibility rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured visibility rules</s-heading>
          {config.productVisibilityRules.length === 0 ? (
            <s-paragraph>No visibility rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productVisibilityRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.visibilityMode}
                    {rule.customerId ? ` | customer: ${rule.customerId}` : ""}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-visibility-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Coupon segment validation rules">
        <form method="post">
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
            <button type="submit" disabled={isSubmitting}>
              Save coupon rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured coupon rules</s-heading>
          {config.couponSegmentRules.length === 0 ? (
            <s-paragraph>No coupon segment rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.couponSegmentRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.code} | allowed: {rule.allowedSegment}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-coupon-segment-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Testing">
        <s-paragraph>
          Validation simulator was removed. Use automated guard tests with{" "}
          <code>npm run guard:test</code>.
        </s-paragraph>
      </s-section>

      <s-section heading="Live Shopify Function activation">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Cart validation function is automatically synced on save and when
              this page opens.
            </s-paragraph>
            {autoActivationMessage && (
              <s-paragraph>Auto-sync info: {autoActivationMessage}</s-paragraph>
            )}
            {activation === "success" && (
              <s-paragraph>Activation status: SUCCESS. {message}</s-paragraph>
            )}
            {activation === "error" && (
              <s-paragraph>Activation status: ERROR. {message}</s-paragraph>
            )}
            <s-paragraph>
              Cart validation:{" "}
              <strong
                style={{
                  color:
                    config.cartValidationStatus === "ACTIVE"
                      ? "#0b6e4f"
                      : "#b42318",
                }}
              >
                {config.cartValidationStatus}
              </strong>
              {config.cartValidationLastSyncAt
                ? ` | last sync: ${new Date(config.cartValidationLastSyncAt).toLocaleString()}`
                : ""}
              {config.cartValidationLastError
                ? ` | last error: ${config.cartValidationLastError}`
                : ""}
            </s-paragraph>
            <s-paragraph>
              Discount function:{" "}
              <strong
                style={{
                  color:
                    discountFunctionStatus === "ACTIVE"
                      ? "#0b6e4f"
                      : discountFunctionStatus === "INACTIVE"
                        ? "#6941c6"
                        : "#b42318",
                }}
              >
                {discountFunctionStatus}
              </strong>{" "}
              | {discountFunctionMessage}
            </s-paragraph>
            <s-paragraph>
              Discount function is automatically forced OFF for the current MVP
              phase.
            </s-paragraph>
            {discountActionMessage && (
              <s-paragraph>{discountActionMessage}</s-paragraph>
            )}
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
