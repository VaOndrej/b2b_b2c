import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import {
  graphqlFrom,
  loadAdminSignals,
  moveNative,
  readBackupId,
  readNativeIds,
  readOnboardingForm,
  saveOnboarding,
  undoMove,
} from "../lib/ui-actions.server";
import type { UiResult } from "../components/model/types";
import { buildOnboardingProps, OnboardingScreen } from "../components/screens/OnboardingScreen";

// Onboarding steps 1–3. Revalidated on focus (embed auto-detection).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config, readOnly }, signals] = await Promise.all([
    loadConfig(db, session.shop),
    loadAdminSignals({
      shop: session.shop,
      scopes: session.scope ?? "",
      // eslint-disable-next-line no-undef
      apiKey: process.env.SHOPIFY_API_KEY || "",
      graphql: graphqlFrom(admin),
    }),
  ]);
  return buildOnboardingProps(config, { native: signals.native, embed: signals.embed, readOnly });
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "move") return moveNative({ shop: session.shop }, readNativeIds(form));
  if (intent === "undo") return undoMove({ shop: session.shop }, readBackupId(form));
  const patch = readOnboardingForm(form);
  if (!patch) return { ok: false, reason: "invalid", errors: [] };
  return saveOnboarding(db, session.shop, patch);
};

export default function Onboarding() {
  const props = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  // A successful step save just advances the step (the loader re-reads it); only
  // refusals are worth a banner here.
  return <OnboardingScreen {...props} result={result && !result.ok ? result : null} />;
}
