import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

// Vzhled is gone (feedback 6 Oct 2026, body 12 a 13): the storefront texts are on Překlady, every element's look
// on its module's page. The old address leads to Překlady.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app/translations");
};
