import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  deactivateDiscountFunction,
  getDiscountFunctionStatusWithAutoDisable,
} from "../services/discount-function-activation.server";
import {
  deleteProductFloorRule,
  getOrCreateMarginGuardConfig,
  upsertProductFloorRule,
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
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
      allowZeroFinalPrice,
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

  if (intent === "deactivate-discount-function") {
    const result = await deactivateDiscountFunction(admin);
    const url = new URL(request.url);
    url.searchParams.set("discountActionMessage", result.message);
    return Response.redirect(url.toString(), 302);
  }

  if (
    intent === "save-global" ||
    intent === "save-product-floor" ||
    intent === "delete-product-floor"
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
