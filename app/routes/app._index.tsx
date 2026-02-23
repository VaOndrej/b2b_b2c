import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  listMarginViolationLogs,
} from "../services/margin-guard-config.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import { getDiscountFunctionStatusWithAutoDisable } from "../services/discount-function-activation.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  await ensureCartValidationActive(admin);
  const [discountFunction, config, logs] = await Promise.all([
    getDiscountFunctionStatusWithAutoDisable(admin),
    getOrCreateMarginGuardConfig(),
    listMarginViolationLogs(10),
  ]);
  const last24hCount = logs.filter((item: { createdAt: Date }) => {
    const createdAt = new Date(item.createdAt).getTime();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return createdAt >= oneDayAgo;
  }).length;

  return {
    config,
    recentViolationCount: logs.length,
    last24hViolationCount: last24hCount,
    discountFunction,
  };
};

export default function AppDashboardRoute() {
  const {
    config,
    recentViolationCount,
    last24hViolationCount,
    discountFunction,
  } =
    useLoaderData<typeof loader>();
  const cartValidationActive = config.cartValidationStatus === "ACTIVE";

  return (
    <s-page heading="Margin Guard Dashboard">
      <s-section heading="Governance status">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              B2B segment tag: <strong>{config.b2bTag}</strong>
            </s-paragraph>
            <s-paragraph>
              Global floor:{" "}
              <strong>{config.globalMinPricePercent}%</strong> of effective base
              price
            </s-paragraph>
            <s-paragraph>
              Discount stacking:{" "}
              <strong>
                {config.allowStacking ? "allowed" : "single-discount only"}
              </strong>
            </s-paragraph>
            <s-paragraph>
              Per-product floor rules: <strong>{config.productFloors.length}</strong>
            </s-paragraph>
            <s-paragraph>
              Cart validation function:{" "}
              <strong
                style={{ color: cartValidationActive ? "#0b6e4f" : "#b42318" }}
              >
                {config.cartValidationStatus}
              </strong>
              {config.cartValidationLastSyncAt
                ? ` (last sync ${new Date(config.cartValidationLastSyncAt).toLocaleString()})`
                : ""}
            </s-paragraph>
            <s-paragraph>
              Discount function:{" "}
              <strong
                style={{
                  color:
                    discountFunction.status === "ACTIVE"
                      ? "#0b6e4f"
                      : discountFunction.status === "INACTIVE"
                        ? "#6941c6"
                        : "#b42318",
                }}
              >
                {discountFunction.status}
              </strong>{" "}
              ({discountFunction.message})
            </s-paragraph>
            <s-paragraph>
              Violations: <strong>{recentViolationCount}</strong> recent /{" "}
              <strong>{last24hViolationCount}</strong> in last 24h
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Next actions">
        <s-stack direction="inline" gap="base">
          <s-link href="/app/settings">Configure floors and rules</s-link>
          <s-link href="/app/violations">Open violation log</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
