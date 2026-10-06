import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import {
  loadMarginScreen,
  readMarginForm,
  readMarginSaveOptions,
  refreshCostsAction,
  saveMarginSettings,
} from "../lib/integration/margin.server";
import { MARGIN_FIELD, MARGIN_INTENT, MARGIN_SAVE_FIELDS } from "../components/model/margin";
import { submittedOf, withValues } from "../components/model/submitted";
import type { UiResult } from "../components/model/types";
import { MarginScreen } from "../components/screens/MarginScreen";

// Ochrana marže (MVP 2). A static route: it wins over app.$module.tsx, so
// /app/margin (nav, Přehled, the rule editor's deep links) keeps its URL. The
// screen lives in components/screens/MarginScreen.tsx so the dev harness renders
// the same component; the data and the writes live in
// app/lib/integration/margin.server.ts. The request context is built from the
// SESSION shop (SEC-2); BILL-1 is applied there (Free gets no impact data).
//
// `?rule=<id>` narrows Přehled zásahů to one rule (the rule editor's link, §13c).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  // `?rule=` narrows Přehled zásahů ON THE SERVER (audit P2-2): never an empty filter of the largest rows.
  return loadMarginScreen(ctx, { focusRuleId: new URL(request.url).searchParams.get("rule") });
};

// `intent=save`: the settings form, parsed and validated on the server
// (readMarginForm, SEC-1), saved against the version the page read (F12) —
// `replaceUnreadable=1` confirms replacing an unreadable stored config (I3).
// `intent=refreshCosts`: "Obnovit nákupní ceny", from this page and from Přehled.
export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  const form = await request.formData();
  const intent = form.get(MARGIN_FIELD.intent);
  if (intent === MARGIN_INTENT.refreshCosts) return refreshCostsAction(ctx);
  if (intent !== MARGIN_INTENT.save) return { ok: false, reason: "bad_request" };
  // B14: a refused save (a field error, a config changed meanwhile, …) gets back what the form posted, so the
  // screen shows it again instead of the stored values.
  const posted = () => submittedOf(form, MARGIN_SAVE_FIELDS);
  const parsed = readMarginForm(form);
  if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors, values: posted() };
  return withValues(await saveMarginSettings(ctx, parsed.settings, readMarginSaveOptions(form)), posted);
};

export default function Margin() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  // Remount on a new stored version (after a save) so the form shows what is stored now. A refused save does not
  // change the version; when someone else's save does, the result's posted values seed the remounted form (B14).
  return <MarginScreen key={loaded.configVersion ?? "none"} {...loaded} result={submitted ?? null} />;
}
