import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import type { PageType } from "@won/core/toasts/targeting";
import { PAGE_TYPES } from "@won/core/toasts/targeting";
import { sanitizeExclusions } from "@won/core/toasts/exclusions";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { useSavedToast } from "../lib/use-saved-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const pages = (PAGE_TYPES as readonly PageType[]).filter(
    (p) => form.get(`exclude_page_${p}`) === "on",
  );
  const urls = String(form.get("exclude_urls") ?? "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);
  await updateToastConfig(session.shop, {
    exclusions: sanitizeExclusions({ pages, urls }),
  });
  return { saved: true };
};

export default function ExclusionsRoute() {
  const { config } = useLoaderData<typeof loader>();
  useSavedToast();
  const ex = config.exclusions;

  return (
    <s-page heading="Exclusions">
      <s-section>
        <s-badge tone="success">Free</s-badge>
        <s-paragraph>
          Turn the app off where it doesn’t belong. Excluded pages and URLs
          stop <s-text type="strong">everything</s-text> — cart toasts and
          notifications alike. You can also add{" "}
          <s-text type="strong">
            {'<meta name="won-toasts:active" content="false">'}
          </s-text>{" "}
          to any template to opt that page out with no config here.
        </s-paragraph>
      </s-section>

      <Form method="post" data-save-bar>
        <s-section heading="Exclude whole page types">
          <s-stack direction="inline" gap="base">
            {(PAGE_TYPES as readonly PageType[]).map((p) => (
              <s-checkbox
                key={p}
                label={p}
                name={`exclude_page_${p}`}
                value="on"
                checked={ex.pages.includes(p)}
              />
            ))}
          </s-stack>
        </s-section>

        <s-section heading="Exclude specific URLs">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              One pattern per line. Use <s-text type="strong">*</s-text> as a
              wildcard — e.g. <s-text type="strong">/checkout*</s-text> or{" "}
              <s-text type="strong">/pages/*</s-text>. Query strings and hashes
              are ignored.
            </s-paragraph>
            <s-text-area
              label="URL patterns"
              name="exclude_urls"
              rows={6}
              value={ex.urls.join("\n")}
              placeholder={"/checkout*\n/pages/legal"}
            />
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}
