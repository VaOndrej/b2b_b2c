import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  listMarginViolationLogs,
} from "../services/margin-guard-config.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import { reconcileDiscountFunctionStatus } from "../services/discount-function-activation.server";
import { syncLiveCheckoutViolationsFromFunctionLogs } from "../services/cart-validation-violation-sync.server";
import { getViolationsSyncMode } from "../services/violations-sync-mode.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const syncMode = getViolationsSyncMode(process.env.NODE_ENV === "production");

  await ensureCartValidationActive(admin);
  if (syncMode.usesLocalDevLogSync) {
    await syncLiveCheckoutViolationsFromFunctionLogs(session.shop);
  }

  const [discountFunction, config, logs] = await Promise.all([
    reconcileDiscountFunctionStatus(admin),
    getOrCreateMarginGuardConfig(),
    listMarginViolationLogs(200),
  ]);

  return {
    config,
    logs,
    discountFunction,
    sourceMessage: syncMode.sourceMessage,
  };
};

export default function AppHealthRoute() {
  const { config, logs, discountFunction, sourceMessage } =
    useLoaderData<typeof loader>();
  const cartValidationActive = config.cartValidationStatus === "ACTIVE";

  return (
    <s-page heading="App Health">
      <s-section heading="Runtime status">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Cart validation:{" "}
              <strong
                style={{ color: cartValidationActive ? "#0b6e4f" : "#b42318" }}
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
                    discountFunction.status === "ACTIVE"
                      ? "#0b6e4f"
                      : discountFunction.status === "INACTIVE"
                        ? "#6941c6"
                        : "#b42318",
                }}
              >
                {discountFunction.status}
              </strong>
              {discountFunction.lastSyncAt
                ? ` | last sync: ${new Date(discountFunction.lastSyncAt).toLocaleString()}`
                : ` | ${discountFunction.message}`}
            </s-paragraph>
            <s-paragraph>
              Violations: <strong>{logs.length}</strong> recent records
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Violation log">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-paragraph>{sourceMessage}</s-paragraph>
        </s-box>
        {logs.length === 0 ? (
          <s-paragraph>No violations recorded yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {logs.map((log: any) => (
              <s-box key={log.id} padding="base" borderWidth="base" borderRadius="base">
                <s-paragraph>
                  {new Date(log.createdAt).toLocaleString()} | shop: {log.shop} | product:{" "}
                  {log.productId} | segment: {log.segment}
                </s-paragraph>
                <s-paragraph>
                  base: {log.basePrice.toFixed(2)} | final: {log.finalPrice.toFixed(2)} | floor:{" "}
                  {log.floorPrice.toFixed(2)} | violation: {log.violationAmount.toFixed(2)}
                </s-paragraph>
                <s-paragraph>
                  source: {log.source}
                  {log.customerId ? ` | customer: ${log.customerId}` : ""}
                </s-paragraph>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
