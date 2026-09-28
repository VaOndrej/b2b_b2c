import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { deleteRule, graphqlFrom, readShopContext, resolvePlan, saveRule } from "../lib/ui-actions.server";
import { isRecipeKey } from "../components/model/rule-form";
import type { UiResult } from "../components/model/types";
import { buildRuleEditorProps, RuleEditorScreen } from "../components/screens/RuleEditorScreen";

// Rule editor: /app/discounts/new(?recipe=…) or /app/discounts/<rule id>.
// `?saved=1` is the landing right after creating a rule.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config, readOnly }, shopContext, plan] = await Promise.all([
    loadConfig(db, session.shop),
    readShopContext(graphqlFrom(admin)),
    resolvePlan(),
  ]);
  const url = new URL(request.url);
  const recipe = url.searchParams.get("recipe");
  const props = buildRuleEditorProps(config, {
    ruleId: params.id ?? "new",
    recipe: isRecipeKey(recipe) ? recipe : null,
    readOnly,
    pro: plan.pro,
    timezone: shopContext.timezone,
    shopCurrency: shopContext.currencyCode,
  });
  if (!props) throw new Response("Not Found", { status: 404 });
  const saved: UiResult | null = url.searchParams.get("saved") === "1" ? { ok: true, message: "saved" } : null;
  return { ...props, result: saved };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  // SEC-2: the shop is the session's; the rule id is the URL's; the form is
  // parsed and validated on the server by saveRule (SEC-1).
  const { admin, session, redirect } = await authenticate.admin(request);
  const form = await request.formData();
  const ruleId = params.id ?? "new";

  if (form.get("intent") === "delete") {
    const result = await deleteRule(db, session.shop, ruleId);
    if (result.ok) return redirect("/app/discounts?deleted=1");
    return { result };
  }

  const [shopContext, plan] = await Promise.all([readShopContext(graphqlFrom(admin)), resolvePlan()]);
  const { result, ruleId: savedId } = await saveRule(db, session.shop, form, {
    ruleId,
    timezone: shopContext.timezone,
    shopCurrency: shopContext.currencyCode,
    pro: plan.pro,
  });
  if (result.ok && ruleId === "new" && savedId) return redirect(`/app/discounts/${savedId}?saved=1`);
  return { result };
};

export default function RuleEditor() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  const result = submitted && "result" in submitted ? submitted.result : loaded.result;
  // Remount per rule so a different rule never inherits the previous form state.
  return <RuleEditorScreen key={loaded.rule?.id ?? `new-${loaded.recipe}`} {...loaded} result={result} />;
}
