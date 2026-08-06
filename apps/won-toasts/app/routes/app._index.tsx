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

import type { RuleMetrics } from "@won/core/toasts/analytics";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { summarizeAnalytics } from "../services/analytics.server";
import { SettingsSearch } from "../components/SettingsSearch";
import { ToastPreview } from "../components/ToastPreview";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";
import { ruleLabel } from "../lib/labels";

const DAY_MS = 86_400_000;

/** Sum impressions + interactions (clicks + undos) across every rule. */
function totalsOf(metrics: Record<string, RuleMetrics>) {
  let impressions = 0;
  let interactions = 0;
  let topRule = "";
  let topImpr = 0;
  for (const [ruleId, m] of Object.entries(metrics)) {
    impressions += m.impressions;
    interactions += m.clicks + m.undos;
    if (m.impressions > topImpr) {
      topImpr = m.impressions;
      topRule = ruleId;
    }
  }
  return { impressions, interactions, topRule, topImpr };
}

/** Week-over-week change as a fraction (null when there's no prior baseline). */
function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

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

  // Real toast activity for the Overview dashboard: last 7 days vs the prior 7
  // (a genuine week-over-week trend, not a fabricated one). Best-effort — a
  // metrics hiccup must never break the home page.
  let stats = {
    impressions: 0,
    interactions: 0,
    interactionRate: 0,
    imprDelta: null as number | null,
    interDelta: null as number | null,
    topRule: "",
    topImpr: 0,
  };
  try {
    const [w7, w14] = await Promise.all([
      summarizeAnalytics(session.shop, 7 * DAY_MS),
      summarizeAnalytics(session.shop, 14 * DAY_MS),
    ]);
    const cur = totalsOf(w7);
    const two = totalsOf(w14);
    const prevImpr = two.impressions - cur.impressions;
    const prevInter = two.interactions - cur.interactions;
    stats = {
      impressions: cur.impressions,
      interactions: cur.interactions,
      interactionRate: cur.impressions > 0 ? cur.interactions / cur.impressions : 0,
      imprDelta: deltaPct(cur.impressions, prevImpr),
      interDelta: deltaPct(cur.interactions, prevInter),
      topRule: cur.topRule,
      topImpr: cur.topImpr,
    };
  } catch {
    // metrics stay zeroed — the dashboard shows the "collecting data" state
  }

  return {
    config,
    embedStatus,
    embedNote,
    ordersCount,
    stats,
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
  return persistConfig(() =>
    updateToastConfig(session.shop, {
      enabled: formData.get("enabled") === "on",
    }),
  );
};

// A setup step: badge + title + body, with clear spacing so the action never
// looks glued to a neighbouring group (doctrine §6).
function SetupStep({
  done,
  step,
  title,
  children,
}: {
  done: boolean;
  step: number;
  title: string;
  children?: ReactNode;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-badge tone={done ? "success" : "neutral"}>
          {done ? "Done" : `Step ${step}`}
        </s-badge>
        <s-text type="strong">{title}</s-text>
      </s-stack>
      {children}
    </s-stack>
  );
}

// One number on the Overview dashboard: label, big value, an optional
// week-over-week trend, and a plain-language line explaining what it means
// (the merchant asked for the explanation right under the number).
function StatCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint: string;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="small-100">
        <s-text color="subdued">{label}</s-text>
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        {typeof delta === "number" ? (
          <s-badge tone={delta >= 0 ? "success" : "critical"}>
            {`${delta >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100))}% week/week`}
          </s-badge>
        ) : null}
        <s-text color="subdued">{hint}</s-text>
      </s-stack>
    </s-box>
  );
}

export default function Index() {
  const { config, embedStatus, embedNote, ordersCount, stats, embedDeepLink } =
    useLoaderData<typeof loader>();
  const saveError = useSavedToast();

  const appEnabled = config.enabled;
  const embedEnabled = embedStatus === "enabled";
  const live = appEnabled && embedEnabled;

  return (
    <s-page heading="Won Toasts">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}
      {/* When LIVE the Overview is a dashboard: a health check ("is everything
          on?") plus the numbers as the hero, each with a one-line explanation of
          what it means (the toast list that used to fill this page moved to the
          config pages). When NOT live we lead the merchant through going live. */}
      {live ? (
        <>
          <s-section heading="You're live">
            <s-stack direction="block" gap="large">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-badge tone="success">App on</s-badge>
                <s-badge tone="success">Embed active</s-badge>
                <s-badge tone="success">Running on your storefront</s-badge>
              </s-stack>

              {stats.impressions > 0 ? (
                <s-grid
                  gridTemplateColumns="repeat(3, minmax(0, 1fr))"
                  gap="base"
                >
                  <StatCard
                    label="Impressions"
                    value={stats.impressions.toLocaleString("en-US")}
                    delta={stats.imprDelta}
                    hint="How many times a toast popped up for shoppers."
                  />
                  <StatCard
                    label="Interactions"
                    value={stats.interactions.toLocaleString("en-US")}
                    delta={stats.interDelta}
                    hint={`Clicks and undos — ${(stats.interactionRate * 100).toFixed(1)}% of impressions reacted.`}
                  />
                  <StatCard
                    label="Most shown"
                    value={stats.topRule ? ruleLabel(stats.topRule) : "—"}
                    hint={
                      stats.topRule
                        ? `Shown ${stats.topImpr.toLocaleString("en-US")}× in the last 7 days.`
                        : "No single toast leads yet."
                    }
                  />
                </s-grid>
              ) : (
                <s-banner tone="info" heading="Collecting data">
                  Your toasts are live. As shoppers see them, impressions and
                  interactions from the last 7 days show up here.
                </s-banner>
              )}

              {stats.impressions > 0 ? (
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small-100">
                    <s-text type="strong">What the numbers tell you</s-text>
                    <s-text color="subdued">
                      {`Your "${stats.topRule ? ruleLabel(stats.topRule) : "toasts"}" show most, and ${(stats.interactionRate * 100).toFixed(1)}% of impressions get a click or undo. A toast is an assist — read-through matters more than clicks for informational toasts.`}
                    </s-text>
                  </s-stack>
                </s-box>
              ) : null}

              <s-stack direction="inline" gap="base">
                <s-button variant="primary" href="/app/toasts">
                  Set up toasts
                </s-button>
                <s-button href="/app/design">Customise the look</s-button>
                <s-button href="/app/analytics">See full insights</s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </>
      ) : (
        <s-section heading="Go live">
          <s-stack direction="block" gap="large">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="caution">Not live yet</s-badge>
              <s-text color="subdued">
                Two quick steps and your toasts go live.
              </s-text>
            </s-stack>

            {/* Before going live the preview is the hero — what shoppers will
                actually see (same render tokens as the storefront). */}
            <ToastPreview
              theme={config.theme}
              closeable={config.global.closeable}
              customCss={config.plan === "pro" ? config.theme.customCss : undefined}
            />

            <s-stack direction="block" gap="large">
              <SetupStep done={appEnabled} step={1} title="Turn on Won Toasts">
                <Form method="post" data-save-bar>
                  <s-switch
                    label="Show Won Toasts on the storefront"
                    name="enabled"
                    value="on"
                    checked={config.enabled}
                  />
                </Form>
              </SetupStep>

              <SetupStep done={embedEnabled} step={2} title="Enable the app embed">
                <s-text color="subdued">{embedNote}</s-text>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    href={embedDeepLink}
                    target="_blank"
                  >
                    Enable app embed
                  </s-button>
                  <s-button href="/app">Re-check</s-button>
                </s-stack>
              </SetupStep>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {/* Empty-store (cold-start) hint — only with read_orders + zero orders. */}
      {ordersCount !== null && isEmptyStore(ordersCount) ? (
        <s-section heading="New store?">
          <s-banner tone="info" heading="Start with cold-start-safe toasts">
            You have no orders yet. Cart toasts and countdowns work from your
            first visitor; social proof turns on once real orders arrive.
          </s-banner>
        </s-section>
      ) : null}

      <s-section heading="Find a setting">
        <SettingsSearch />
      </s-section>
    </s-page>
  );
}
