import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import {
  getQuantityConfig,
  updateQuantityConfig,
} from "../services/quantity-config.server";

function parsePositiveInteger(value: FormDataEntryValue | null, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be an integer greater than or equal to 1.`);
  }
  return parsed;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getQuantityConfig(session.shop);
  return {
    config,
    themeEditorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  try {
    const minimum = parsePositiveInteger(formData.get("minimum"), "Minimum");
    const step = parsePositiveInteger(formData.get("step"), "Step");
    const maximumRaw = String(formData.get("maximum") ?? "").trim();
    const maximum = maximumRaw
      ? parsePositiveInteger(maximumRaw, "Maximum")
      : null;

    await updateQuantityConfig(session.shop, {
      enabled: formData.get("enabled") === "on",
      minimum,
      step,
      maximum,
    });
    return { saved: true, error: null };
  } catch (error) {
    return {
      saved: false,
      error:
        error instanceof Error
          ? error.message
          : "Configuration could not be saved.",
    };
  }
};

const fieldStyle = {
  display: "grid",
  gap: "6px",
  maxWidth: "320px",
} as const;

const inputStyle = {
  border: "1px solid #8a8a8a",
  borderRadius: "8px",
  font: "inherit",
  padding: "10px 12px",
} as const;

export default function SettingsRoute() {
  const { config, themeEditorUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="Won Quantity settings">
      <s-section heading="Quantity defaults">
        <Form method="post">
          <div style={{ display: "grid", gap: "18px" }}>
            <label
              style={{ display: "flex", gap: "10px", alignItems: "center" }}
            >
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={config.enabled}
              />
              Enable Won Quantity on the storefront
            </label>

            <label style={fieldStyle}>
              <span>Default minimum</span>
              <input
                style={inputStyle}
                type="number"
                name="minimum"
                min="1"
                step="1"
                required
                defaultValue={config.minimum}
              />
            </label>

            <label style={fieldStyle}>
              <span>Default step</span>
              <input
                style={inputStyle}
                type="number"
                name="step"
                min="1"
                step="1"
                required
                defaultValue={config.step}
              />
            </label>

            <label style={fieldStyle}>
              <span>Optional maximum</span>
              <input
                style={inputStyle}
                type="number"
                name="maximum"
                min="1"
                step="1"
                defaultValue={config.maximum ?? ""}
                placeholder="No maximum"
              />
            </label>

            {actionData?.error ? (
              <p role="alert" style={{ color: "#b42318", margin: 0 }}>
                {actionData.error}
              </p>
            ) : null}
            {actionData?.saved ? (
              <p role="status" style={{ color: "#0b6e4f", margin: 0 }}>
                Settings saved.
              </p>
            ) : null}

            <div>
              <button type="submit" disabled={isSaving} style={inputStyle}>
                {isSaving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading="Theme app embed">
        <s-paragraph>
          Status: <strong>Needs activation or verification</strong>. Won
          Quantity remains a storefront no-op until its app embed is enabled in
          each theme.
        </s-paragraph>
        <s-paragraph>
          <a href={themeEditorUrl} target="_top" rel="noreferrer">
            Open the current theme editor and activate the Won Quantity app
            embed
          </a>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
