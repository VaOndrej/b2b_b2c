import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { ruleEditorAction, ruleEditorPage } from "../lib/integration/pages.server";
import { RuleEditorScreen } from "../components/screens/RuleEditorScreen";

// Rule editor: /app/discounts/new(?recipe=…) or /app/discounts/<rule id>.
// `?saved=1` is the landing right after creating a rule (it reports that save's sync).
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  const url = new URL(request.url);
  const props = await ruleEditorPage(ctx, {
    scopes: session.scope ?? "",
    ruleId: params.id ?? "new",
    recipe: url.searchParams.get("recipe"),
    saved: url.searchParams.get("saved") === "1",
  });
  if (!props) throw new Response("Not Found", { status: 404 });
  return props;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  // SEC-2: the shop is the session's; the rule id is the URL's; the form is
  // parsed and validated on the server by saveRule (SEC-1).
  const { admin, session, redirect } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  const outcome = await ruleEditorAction(ctx, await request.formData(), params.id ?? "new");
  if ("redirect" in outcome) return redirect(outcome.redirect);
  return outcome;
};

export default function RuleEditor() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  const result = submitted && "result" in submitted ? submitted.result : loaded.result;
  // Remount per rule so a different rule never inherits the previous form state.
  return <RuleEditorScreen key={loaded.rule?.id ?? `new-${loaded.recipe}`} {...loaded} result={result} />;
}
