import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { ruleMarginImpact } from "../lib/integration/margin.server";
import { ruleEditorAction, ruleEditorPage } from "../lib/integration/pages.server";
import { RuleEditorScreen } from "../components/screens/RuleEditorScreen";

// Rule editor: /app/discounts/new(?recipe=…) or /app/discounts/<rule id>.
// `?saved=1` is the landing right after creating a rule (it reports that save's sync).
// Ochrana marže (MVP 2): `marginImpact` = on how many products margin protection
// lowers this SAVED rule (null = protection off or a new rule); the note links to
// those rows in Přehled zásahů. It is read beside the page (REL-1: a failed count
// only leaves the note out — the margin page shows the full picture). After a
// save the loader runs again, so the note follows the saved rule.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  const url = new URL(request.url);
  const ruleId = params.id ?? "new";
  const [props, marginImpact] = await Promise.all([
    ruleEditorPage(ctx, {
      scopes: session.scope ?? "",
      ruleId,
      recipe: url.searchParams.get("recipe"),
      saved: url.searchParams.get("saved") === "1",
    }),
    ruleId === "new" ? Promise.resolve(null) : ruleMarginImpact(ctx, ruleId).catch(() => null),
  ]);
  if (!props) throw new Response("Not Found", { status: 404 });
  return { ...props, marginImpact };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  // SEC-2: the shop is the session's; the rule id is the URL's; the form is
  // parsed and validated on the server by saveRule (SEC-1).
  const { admin, session, redirect } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
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
