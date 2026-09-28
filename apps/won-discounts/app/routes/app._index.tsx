import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await loadConfig(db, session.shop);

  return {
    schemaVersion: config.schemaVersion,
    ruleCount: config.modules.codes.rules.length,
  };
};

export default function Index() {
  const { schemaVersion, ruleCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Won Discounts">
      <s-section heading="Stav">
        <s-paragraph>
          Konfigurace: verze {schemaVersion} · {ruleCount}{" "}
          {ruleCount === 1 ? "pravidlo" : ruleCount >= 2 && ruleCount <= 4 ? "pravidla" : "pravidel"}
        </s-paragraph>
        <s-paragraph>Vložení do tématu: zatím neověřeno</s-paragraph>
      </s-section>
    </s-page>
  );
}
