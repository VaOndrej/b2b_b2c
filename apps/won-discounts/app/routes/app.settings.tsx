import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { currencyViews } from "../components/model/markets";
import { SettingsScreen } from "../components/screens/SettingsScreen";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { config } = await loadConfig(db, session.shop);
  return { currencies: currencyViews(config.markets) };
};

export default function Settings() {
  const props = useLoaderData<typeof loader>();
  return <SettingsScreen {...props} />;
}
