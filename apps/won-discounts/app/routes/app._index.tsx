import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
// Shared, framework-free domain logic lives in @won/core — import from it the
// same way across every app. This demo just proves the wiring resolves.
import { SEGMENTS } from "@won/core/segment/segment.types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { segments: SEGMENTS };
};

export default function Index() {
  const { segments } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Your new app">
      <s-section heading="It works">
        <s-paragraph>
          This starter is wired to <s-text>@won/app-kit</s-text> (Shopify auth,
          SSR, webhooks) and <s-text>@won/core</s-text> (shared domain logic).
        </s-paragraph>
        <s-paragraph>Segments from @won/core: {segments.join(", ")}</s-paragraph>
      </s-section>
    </s-page>
  );
}
