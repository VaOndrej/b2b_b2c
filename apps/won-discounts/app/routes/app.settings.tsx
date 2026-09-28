import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { graphqlFrom, readMarketNames } from "../lib/ui-actions.server";
import { currencyViews } from "../components/model/markets";
import { SettingsScreen } from "../components/screens/SettingsScreen";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config }, marketNames] = await Promise.all([
    loadConfig(db, session.shop),
    readMarketNames(graphqlFrom(admin), session.shop),
  ]);
  return { currencies: currencyViews(config.markets, { marketNames }) };
};

export default function Settings() {
  const props = useLoaderData<typeof loader>();
  return <SettingsScreen {...props} />;
}
