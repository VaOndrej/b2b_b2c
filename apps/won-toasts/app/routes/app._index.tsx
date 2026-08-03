import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  return {
    config,
    themeEditorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  await updateToastConfig(session.shop, {
    enabled: formData.get("enabled") === "on",
  });
  return { saved: true };
};

export default function Index() {
  const { config, themeEditorUrl } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="Won Toasts">
      <s-section heading="Status">
        <s-paragraph>
          Storefront toasts are{" "}
          <strong>{config.enabled ? "enabled" : "disabled"}</strong>. Toasts
          appear <strong>{config.global.position}</strong> for{" "}
          <strong>{config.global.durationMs} ms</strong> on the{" "}
          <strong>{config.plan}</strong> plan.
        </s-paragraph>
        <Form method="post">
          <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={config.enabled}
            />
            <span>Enable Won Toasts on the storefront</span>
          </label>
          <div style={{ marginTop: "12px" }}>
            <button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Install the app embed">
        <s-paragraph>
          Toasts render through the <strong>Won Toasts</strong> app embed. Turn
          it on once in your theme, then everything else is controlled here in
          the admin.
        </s-paragraph>
        <s-paragraph>
          <a href={themeEditorUrl} target="_blank" rel="noreferrer">
            Open theme editor → App embeds
          </a>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
