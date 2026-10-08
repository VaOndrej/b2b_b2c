import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadTranslationsScreen, translationsAction, type TranslationsResult } from "../lib/integration/translations.server";
import type { UiResult } from "../components/model/types";
import { TranslationsScreen } from "../components/screens/TranslationsScreen";

// Překlady (feedback 6 Oct 2026, body 11, 12, 14): the storefront texts per language. A static route (wins over
// app.$module.tsx); data and writes in app/lib/integration/translations.server.ts, the SESSION shop (SEC-2), the
// form parsed on the server (SEC-1), the language limit and the Pro-only CSV checked there too.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadTranslationsScreen(ctx);
};

export const action = async ({ request }: ActionFunctionArgs): Promise<TranslationsResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return translationsAction(ctx, await request.formData());
};

/** The page's own form only saves; the CSV answers go to the screen's fetcher. */
function saveResult(submitted: TranslationsResult | undefined): UiResult | null {
  if (!submitted) return null;
  return submitted.ok && (submitted.message === "export" || submitted.message === "import-preview") ? null : submitted;
}

export default function Translations() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <TranslationsScreen key={loaded.configVersion ?? "none"} {...loaded} result={saveResult(submitted)} />;
}
