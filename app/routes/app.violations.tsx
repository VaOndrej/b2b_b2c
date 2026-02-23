import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { listMarginViolationLogs } from "../services/margin-guard-config.server";
import { getDiscountFunctionStatusWithAutoDisable } from "../services/discount-function-activation.server";
import { syncLiveCheckoutViolationsFromFunctionLogs } from "../services/cart-validation-violation-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await getDiscountFunctionStatusWithAutoDisable(admin);
  if (process.env.NODE_ENV !== "production") {
    await syncLiveCheckoutViolationsFromFunctionLogs(session.shop);
  }
  const logs = await listMarginViolationLogs(200);
  return { logs };
};

export default function AppViolationsRoute() {
  const { logs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Margin Violations">
      <s-section heading="Violation log">
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
