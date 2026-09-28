import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { onboardingAction, onboardingPage } from "../lib/integration/pages.server";
import type { UiResult } from "../components/model/types";
import { OnboardingScreen } from "../components/screens/OnboardingScreen";

// Onboarding steps 1–3. Revalidated on focus (embed auto-detection).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  // `?recheck=` (focus after the theme editor) re-reads the theme, bypassing the short cache.
  const fresh = new URL(request.url).searchParams.has("recheck");
  return onboardingPage(ctx, { scopes: session.scope ?? "", fresh });
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  return onboardingAction(ctx, await request.formData());
};

export default function Onboarding() {
  const props = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  // A successful step save just advances the step (the loader re-reads it); a
  // move / undo result and every refusal are worth a banner here.
  const shown = result && (!result.ok || result.message === "moved" || result.message === "undone") ? result : null;
  return <OnboardingScreen {...props} result={shown} />;
}
