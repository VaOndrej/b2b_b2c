import type { ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import {
  buildEmbedDeepLink,
  extractEmbedExtensionUuid,
  isEmptyStore,
  parseEmbedStatus,
  type EmbedStatus,
} from "@won/core/toasts/embed-status";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { SettingsSearch } from "../components/SettingsSearch";
import { useSavedToast } from "../lib/use-saved-toast";
// Live preview intentionally lives only on the Appearance page (single source).

const EMBED_BLOCK_HANDLE = "won_toasts_embed";
// The app's theme app extension registration UUID (stable across merchants for
// a given app version) — used as the deep-link fallback. The loader prefers the
// UUID read live from the merchant's settings_data when available.
const EMBED_EXTENSION_UUID = "019fcc26-7067-7681-bdda-e97362bc9997";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);

  // Only touch Admin GraphQL for scopes the app actually holds — querying a
  // missing scope can trigger a re-auth redirect. With those scopes added
  // (read_themes / read_orders) this lights up automatically; without them the
  // dashboard degrades to "unknown" and hides the empty-state hint.
  const grantedScopes = session.scope ?? "";
  const canReadThemes = grantedScopes.includes("read_themes");
  let embedStatus: EmbedStatus = "unknown";
  let ordersCount: number | null = null;
  let themeReadOk = false;
  // Enabled on a non-live (draft/dev) theme but not the live one.
  let embedOnDraft = false;
  // Prefer the REAL extension UUID read from any theme that has the embed; fall
  // back to the constant only if it's on no theme at all.
  let embedUuid = EMBED_EXTENSION_UUID;

  if (canReadThemes) {
    try {
      // Scan all themes (client-side role filter is more robust than a `roles`
      // argument). Status comes from the live (MAIN) theme; the UUID for the
      // deep link can come from whichever theme has the embed.
      const res = await admin.graphql(
        `#graphql
        query WonThemes {
          themes(first: 20) {
            nodes {
              role
              files(filenames: ["config/settings_data.json"], first: 1) {
                nodes {
                  body { ... on OnlineStoreThemeFileBodyText { content } }
                }
              }
            }
          }
        }`,
      );
      const json = await res.json();
      const nodes = json?.data?.themes?.nodes;
      if (Array.isArray(nodes)) {
        themeReadOk = true;
        for (const n of nodes) {
          const content = n?.files?.nodes?.[0]?.body?.content;
          if (typeof content !== "string") continue;
          const isMain = String(n?.role).toUpperCase() === "MAIN";
          const status = parseEmbedStatus(content, EMBED_BLOCK_HANDLE);
          if (isMain) embedStatus = status;
          if (status !== "unknown") {
            const uuid = extractEmbedExtensionUuid(content, EMBED_BLOCK_HANDLE);
            if (uuid) embedUuid = uuid;
            if (!isMain) embedOnDraft = true;
          }
        }
      }
    } catch {
      // query error → themeReadOk stays false, embedStatus "unknown" (fail-safe)
    }
  }

  const embedNote = !canReadThemes
    ? "Add the read_themes scope to auto-detect the embed."
    : !themeReadOk
      ? "Couldn't read your themes — open the theme editor to check."
      : embedStatus === "enabled"
        ? "Detected on your live theme."
        : embedStatus === "disabled"
          ? "The embed is on your live theme but turned off — switch it on."
          : embedOnDraft
            ? "Enabled on a draft theme, but not your live theme. Enable it on the live theme to go live."
            : "Not enabled on any theme yet — turn it on in the theme editor.";

  if (grantedScopes.includes("read_orders")) {
    try {
      const res = await admin.graphql(
        `#graphql
        query WonOrdersProbe { orders(first: 1) { nodes { id } } }`,
      );
      const json = await res.json();
      const nodes = json?.data?.orders?.nodes;
      if (Array.isArray(nodes)) ordersCount = nodes.length;
    } catch {
      // missing read_orders → stays null (empty-state hint hidden)
    }
  }

  return {
    config,
    embedStatus,
    embedNote,
    ordersCount,
    embedDeepLink: buildEmbedDeepLink({
      shop: session.shop,
      extensionUuid: embedUuid,
      blockHandle: EMBED_BLOCK_HANDLE,
    }),
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

function TaskRow({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <s-stack direction="block" gap="small">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-badge tone={done ? "success" : "neutral"}>
          {done ? "Done" : "To do"}
        </s-badge>
        <s-text type="strong">{title}</s-text>
      </s-stack>
      {children}
    </s-stack>
  );
}

export default function Index() {
  const { config, embedStatus, embedNote, ordersCount, embedDeepLink } =
    useLoaderData<typeof loader>();
  useSavedToast();

  const appEnabled = config.enabled;
  const embedEnabled = embedStatus === "enabled";
  const doneCount = (appEnabled ? 1 : 0) + (embedEnabled ? 1 : 0);
  const allDone = doneCount === 2;
  const embedTone =
    embedStatus === "enabled"
      ? "success"
      : embedStatus === "disabled"
        ? "critical"
        : "caution";
  const embedLabel =
    embedStatus === "enabled"
      ? "Enabled"
      : embedStatus === "disabled"
        ? "Disabled"
        : "Unknown";

  return (
    <s-page heading="Won Toasts">
      <s-section heading="Search settings">
        <SettingsSearch />
      </s-section>

      {/* MVP6 setup guide — 2 tasks + progress → All done. Leads the merchant
          through the "installed but not showing" footgun. */}
      <s-section heading={allDone ? "You're all set" : "Set up Won Toasts"}>
        {allDone ? (
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone="success">All done</s-badge>
            <s-text color="subdued">
              Toasts are live on your storefront.
            </s-text>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="large">
            <s-text color="subdued">{doneCount} of 2 tasks complete</s-text>

            <TaskRow done={appEnabled} title="1 · Enable the app">
              <Form method="post" data-save-bar>
                <s-switch
                  label="Show Won Toasts on the storefront"
                  name="enabled"
                  value="on"
                  checked={config.enabled}
                />
              </Form>
            </TaskRow>

            <TaskRow done={embedEnabled} title="2 · Enable the app embed">
              <s-text color="subdued">
                Turn the Won Toasts embed on in your theme, then Continue to
                re-check.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" href={embedDeepLink} target="_blank">
                  Enable app embed
                </s-button>
                <s-button href="/app">Continue</s-button>
              </s-stack>
            </TaskRow>
          </s-stack>
        )}
      </s-section>

      {/* Dashboard: theme embed status card. */}
      <s-section heading="Theme embed">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone={embedTone}>{embedLabel}</s-badge>
          <s-text color="subdued">{embedNote}</s-text>
        </s-stack>
        <s-button href={embedDeepLink} target="_blank">
          Manage theme embed
        </s-button>
      </s-section>

      {/* Empty-store (cold-start) hint — only with read_orders + zero orders. */}
      {ordersCount !== null && isEmptyStore(ordersCount) ? (
        <s-section heading="New store?">
          <s-banner tone="info" heading="Start with cold-start-safe toasts">
            You have no orders yet. Cart toasts and countdowns work from your
            first visitor; social proof turns on once real orders arrive.
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Preview">
        <s-paragraph>
          See the live preview while you tune the look on the{" "}
          <s-link href="/app/appearance">Appearance</s-link> page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
