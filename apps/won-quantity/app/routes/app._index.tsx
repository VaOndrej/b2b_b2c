import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getQuantityConfig } from "../services/quantity-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getQuantityConfig(session.shop) };
};

export default function Index() {
  const { config } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Won Quantity">
      <s-section heading="Storefront status">
        <s-paragraph>
          Quantity rules are{" "}
          <strong>{config.enabled ? "enabled" : "disabled"}</strong>.
        </s-paragraph>
        <s-paragraph>
          Default rule: minimum <strong>{config.minimum}</strong>, step{" "}
          <strong>{config.step}</strong>, maximum{" "}
          <strong>{config.maximum ?? "none"}</strong>.
        </s-paragraph>
        <s-paragraph>
          <a href="/app/settings">Configure quantity defaults and app embed</a>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
