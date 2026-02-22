import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  listMarginViolationLogs,
} from "../services/margin-guard-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [config, logs] = await Promise.all([
    getOrCreateMarginGuardConfig(),
    listMarginViolationLogs(10),
  ]);

  return { config, recentViolationCount: logs.length };
};

export default function AppDashboardRoute() {
  const { config, recentViolationCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Margin Guard Dashboard">
      <s-section heading="MVP_1 status">
        <s-stack direction="block" gap="small">
          <s-paragraph>Segment detection: enabled (tag: {config.b2bTag})</s-paragraph>
          <s-paragraph>
            Global floor: {config.globalMinPricePercent}% of effective base price
          </s-paragraph>
          <s-paragraph>
            Discount stacking: {config.allowStacking ? "allowed" : "single-discount only"}
          </s-paragraph>
          <s-paragraph>Per-product floor rules: {config.productFloors.length}</s-paragraph>
          <s-paragraph>Recent violations tracked: {recentViolationCount}</s-paragraph>
        </s-stack>
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
