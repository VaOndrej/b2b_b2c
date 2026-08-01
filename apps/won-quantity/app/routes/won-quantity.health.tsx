import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return Response.json(
    { status: "won-quantity-ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
};
