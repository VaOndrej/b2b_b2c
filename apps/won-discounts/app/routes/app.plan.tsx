import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { codeRuleLimit, resolvePlan } from "../lib/ui-actions.server";
import { PlanScreen } from "../components/screens/PlanScreen";

// Tarif: the plan in force is server-derived (BILL-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [{ config }, plan] = await Promise.all([loadConfig(db, session.shop), resolvePlan()]);
  return { pro: plan.pro, codeRules: codeRuleLimit(config), maxRules: CONFIG_LIMITS.rules };
};

export default function Plan() {
  const props = useLoaderData<typeof loader>();
  return <PlanScreen {...props} />;
}
