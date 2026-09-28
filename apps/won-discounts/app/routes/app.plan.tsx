import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { resolvePlan } from "../lib/ui-actions.server";
import { PlanScreen } from "../components/screens/PlanScreen";

// Tarif: the plan in force is server-derived (BILL-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return resolvePlan();
};

export default function Plan() {
  const props = useLoaderData<typeof loader>();
  return <PlanScreen {...props} />;
}
