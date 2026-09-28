import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { graphqlFrom, readShopContext, readTryCart, runTryCart } from "../lib/ui-actions.server";
import { resolveLocale } from "../i18n";
import { shopToday } from "../components/model/rule-form";
import type { CartPlanView, UiResult } from "../components/model/types";
import { buildTryCartProps, TryCartScreen } from "../components/screens/TryCartScreen";

// Vyzkoušet košík. The plan is computed on the server (runTryCart seam → engine).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config }, shopContext] = await Promise.all([loadConfig(db, session.shop), readShopContext(graphqlFrom(admin))]);
  return buildTryCartProps(config, { timezone: shopContext.timezone, shopCurrency: shopContext.currencyCode });
};

export const action = async ({ request }: ActionFunctionArgs): Promise<{ result: UiResult; plan: CartPlanView | null }> => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const [{ config }, shopContext] = await Promise.all([loadConfig(db, session.shop), readShopContext(graphqlFrom(admin))]);
  const { input, errors } = readTryCart(form, config, {
    shopCurrency: shopContext.currencyCode,
    today: shopToday(shopContext.timezone),
  });
  if (errors.length > 0) return { result: { ok: false, reason: "invalid", errors }, plan: null };
  const locale = resolveLocale(typeof form.get("locale") === "string" ? String(form.get("locale")) : null);
  return runTryCart({ shop: session.shop }, { ...input, locale });
};

export default function TryCart() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <TryCartScreen {...loaded} plan={submitted?.plan ?? loaded.plan} result={submitted?.result ?? loaded.result} />;
}
