import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { evaluateMarginGuard } from "../services/margin-guard.server";
import {
  buildFloorRuleset,
  deleteProductFloorRule,
  getOrCreateMarginGuardConfig,
  recordMarginViolation,
  upsertProductFloorRule,
  updateGlobalMarginGuardConfig,
} from "../services/margin-guard-config.server";

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const config = await getOrCreateMarginGuardConfig();
  return { config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-global") {
    const b2bTag = String(formData.get("b2bTag") ?? "b2b").trim() || "b2b";
    const globalMinPricePercent = parseNumber(
      formData.get("globalMinPricePercent"),
      70,
    );
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
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
    const minPercentOfBasePrice = parseNumber(
      formData.get("minPercentOfBasePrice"),
      70,
    );

    if (productId) {
      await upsertProductFloorRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minPercentOfBasePrice,
      });
    }
  }

  if (intent === "delete-product-floor") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductFloorRule(id);
    }
  }

  if (intent === "simulate-validation") {
    const config = await getOrCreateMarginGuardConfig();
    const basePrice = parseNumber(formData.get("basePrice"), 0);
    const discountPercent = parseNumber(formData.get("discountPercent"), 0);
    const productId = String(formData.get("productId") ?? "").trim();
    const customerTagsRaw = String(formData.get("customerTags") ?? "");
    const customerId = String(formData.get("customerId") ?? "").trim() || undefined;

    if (productId) {
      const evaluation = evaluateMarginGuard({
        customerTags: parseTags(customerTagsRaw),
        b2bTag: config.b2bTag,
        productId,
        basePrice,
        discounts: [{ code: "SIMULATED", percentOff: discountPercent }],
        discountRules: {
          allowStacking: config.allowStacking,
          maxCombinedPercentOff: config.maxCombinedPercentOff ?? undefined,
        },
        floorRuleset: buildFloorRuleset(config),
      });

      if (!evaluation.marginAllowed) {
        await recordMarginViolation({
          shop: session.shop,
          productId,
          customerId,
          segment: evaluation.segment,
          basePrice,
          finalPrice: evaluation.finalPrice,
          floorPrice: evaluation.floorPrice,
          violationAmount: evaluation.violationAmount,
          source: "admin_simulation",
        });
      }
    }
  }

  return null;
};

export default function AppSettingsRoute() {
  const { config } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Margin Guard Settings">
      <s-section heading="Global configuration">
        <form method="post">
          <input type="hidden" name="intent" value="save-global" />
          <s-stack direction="block" gap="base">
            <label>
              B2B customer tag
              <input name="b2bTag" defaultValue={config.b2bTag} />
            </label>
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
                    {rule.productId} | {rule.segment ?? "ALL"} | {rule.minPercentOfBasePrice}%
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

      <s-section heading="Validation simulator">
        <form method="post">
          <input type="hidden" name="intent" value="simulate-validation" />
          <s-stack direction="block" gap="base">
            <label>
              Product ID
              <input name="productId" required />
            </label>
            <label>
              Base price
              <input name="basePrice" type="number" min={0} step="0.01" defaultValue={100} />
            </label>
            <label>
              Discount percent
              <input
                name="discountPercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={35}
              />
            </label>
            <label>
              Customer tags (comma-separated)
              <input name="customerTags" placeholder="b2b, wholesale" />
            </label>
            <label>
              Customer ID (optional, for logs)
              <input name="customerId" />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Run simulation
            </button>
          </s-stack>
        </form>
      </s-section>
    </s-page>
  );
}
