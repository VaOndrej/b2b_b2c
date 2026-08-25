/**
 * Support-docs reference generator.
 *
 * Regenerates apps/won-toasts/docs/reference/*.generated.md from the canonical
 * enums in @won/core/toasts. Volatile facts (plan limits, event types, config
 * option values) live in code exactly once; the support chatbot consumes the
 * generated markdown. NEVER hand-edit the generated files.
 *
 *   npm run docs:gen -w won-toasts     # write the files
 *
 * `buildDocs()` is pure (a function of code only, no wall-clock/env) so the
 * freshness test (tests/docs-freshness.test.ts) can diff committed vs. code and
 * fail CI when an enum changes but the docs weren't regenerated.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { writeFileSync } from "node:fs";

import {
  PRO_FEATURES,
  FREE_MILESTONE_LIMIT,
  FREE_MAX_PER_SESSION,
  FREE_CURRENCY_LIMIT,
} from "@won/core/toasts/tier";
import { CART_EVENT_TYPES } from "@won/core/toasts/cart-events";
import {
  PAGE_TYPES,
  DEVICE_TARGETS,
  CUSTOMER_TARGETS,
} from "@won/core/toasts/targeting";
import { LOCALE_LIMIT_FREE, LOCALE_LIMIT_PRO } from "@won/core/toasts/locales";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_SURFACES,
  NOTIFICATION_PAGES,
  AGGREGATE_TYPES,
  notificationPlanFor,
} from "@won/core/toasts/notifications";
import {
  TOAST_CONFIG_VERSION,
  POSITIONS,
  CLICK_ACTIONS,
  OVERFLOW,
  STACK,
  GROUPING_MODES,
  THEME_MODES,
  ANIMATIONS,
  ICON_SETS,
  SHADOW_LEVELS,
  DENSITIES,
  MILESTONE_KINDS,
  DEFAULT_ACCENT,
} from "@won/core/toasts/config.defaults";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(scriptDir, "..", "docs", "reference");

/** Human labels for machine keys. Missing key → the raw key is shown. */
const PRO_LABELS: Record<string, string> = {
  design_studio: "Design studio — custom colors, radius, shadow, animation, per-event accent",
  advanced_grouping: "Advanced grouping & anti-spam tuning",
  custom_css: "Custom CSS",
  targeting: "Targeting — show toasts by page / device / customer",
  unlimited_milestones: `More than ${FREE_MILESTONE_LIMIT} active milestones`,
  remove_branding: 'Remove the "Powered by Won" badge',
  analytics: "Analytics",
  experiments: "A/B experiments",
};

type Frontmatter = {
  title: string;
  slug: string;
  feature: string;
  min_plan: "free" | "pro";
  summary: string;
  keywords: string[];
};

function frontmatter(fm: Frontmatter): string {
  return [
    "---",
    `title: ${fm.title}`,
    `slug: ${fm.slug}`,
    "layer: reference",
    `feature: ${fm.feature}`,
    `min_plan: ${fm.min_plan}`,
    "status: stable",
    `config_version: ${TOAST_CONFIG_VERSION}`,
    "source: generated",
    "generated_from: '@won/core/toasts'",
    "lang: en",
    `keywords: [${fm.keywords.join(", ")}]`,
    `summary: ${fm.summary}`,
    "---",
  ].join("\n");
}

const BANNER =
  "<!-- AUTO-GENERATED from @won/core/toasts — DO NOT EDIT. " +
  "Run `npm run docs:gen -w won-toasts` to refresh. -->";

function list(values: readonly string[]): string {
  return values.map((v) => `- \`${v}\``).join("\n");
}

function doc(fm: Frontmatter, body: string): string {
  return `${frontmatter(fm)}\n\n${BANNER}\n\n${body.trim()}\n`;
}

/** Pure: build the full map of generated docs { relativePath: content }. */
export function buildDocs(): Record<string, string> {
  const planLimits = doc(
    {
      title: "Plans: Free vs Pro",
      slug: "plan-limits",
      feature: "plans",
      min_plan: "free",
      summary: "What the Free plan includes and which features require Pro.",
      keywords: ["free", "pro", "pricing", "limits", "plan", "upgrade"],
    },
    `# Plans: Free vs Pro

Won Toasts gates **scope, never quality** — the Free plan keeps every cart event,
all accessibility, all languages, the live preview and the default look. Pro
unlocks *more* customization and reach, it never removes basic usability.

## Free plan includes

- All cart toasts (add / remove / increase / decrease) with Undo
- Countdown timers and announcements
- Up to **${FREE_MILESTONE_LIMIT}** active milestones
- Up to **${LOCALE_LIMIT_FREE}** languages (Pro: up to ${LOCALE_LIMIT_PRO})
- Up to **${FREE_CURRENCY_LIMIT}** per-currency free-shipping thresholds
- Message templates, accessibility and the live preview — in full
- The default appearance (light/dark/system)
- A per-session cap of **${FREE_MAX_PER_SESSION}** toasts, fixed (Pro can raise
  it or set 0 for unlimited) — a shopper is never floodable on any plan
- Shows a small "Powered by Won" badge

## Pro plan unlocks

${PRO_FEATURES.map((f) => `- ${PRO_LABELS[f] ?? f} \`(${f})\``).join("\n")}

## At a glance

| Capability | Free | Pro |
|---|---|---|
| Cart toasts + Undo | ✅ | ✅ |
| Languages & templates | ✅ | ✅ |
| Countdown + announcement | ✅ | ✅ |
| Low stock / cart activity | — | ✅ |
| Active milestones | up to ${FREE_MILESTONE_LIMIT} | unlimited |
| Languages | up to ${LOCALE_LIMIT_FREE} | up to ${LOCALE_LIMIT_PRO} |
| Per-currency thresholds | up to ${FREE_CURRENCY_LIMIT} | unlimited |
| Toasts per session | ${FREE_MAX_PER_SESSION}, fixed | merchant-controlled |
| Design studio / custom CSS | — | ✅ |
| Targeting (page/device/customer) | — | ✅ |
| Analytics / experiments | — | ✅ |
| "Powered by Won" badge | shown | removed |`,
  );

  const eventTypes = doc(
    {
      title: "Event and milestone types",
      slug: "event-types",
      feature: "cart-toasts",
      min_plan: "free",
      summary: "The cart event types, semantic toast types, and milestone kinds the engine recognizes.",
      keywords: ["event", "type", "cart", "milestone", "semantic", "accent"],
    },
    `# Event and milestone types

## Cart event types

The net change detected on the cart that produces a toast:

${list(CART_EVENT_TYPES)}

## Semantic toast types

Each toast has a semantic type that drives its accent color, icon and message
template:

${list(Object.keys(DEFAULT_ACCENT))}

## Milestone kinds

Rewards a milestone can track (the app announces progress; it does not grant the
reward):

${list([...MILESTONE_KINDS].map(String))}`,
  );

  const configOptions = doc(
    {
      title: "Configuration option values",
      slug: "config-options",
      feature: "core",
      min_plan: "free",
      summary: "Every accepted value for behavior, appearance, language and targeting settings.",
      keywords: ["config", "options", "position", "animation", "theme", "locale", "targeting"],
    },
    `# Configuration option values

Accepted values for each setting. Invalid or unknown values are ignored and fall
back to the default (the config is version ${TOAST_CONFIG_VERSION}).

## Languages (locales)

Languages are **merchant-defined data**, not a fixed list. The app ships English
(\`en\`) as the built-in fallback; add any BCP-47 locales you need (e.g. \`cs\`,
\`sk\`, \`de\`, \`pt-BR\`) in Languages settings. Free plans ship up to
${LOCALE_LIMIT_FREE} languages; Pro ships many. Shoppers see the string for their
storefront locale, falling back to your default language.

## Behavior

**Position**

${list(POSITIONS)}

**Click action**

${list(CLICK_ACTIONS)}

**Overflow strategy** (when more toasts arrive than fit)

${list(OVERFLOW)}

**Stack direction**

${list(STACK)}

**Grouping mode**

${list(GROUPING_MODES)}

## Appearance

**Theme mode**

${list(THEME_MODES)}

**Animation**

${list(ANIMATIONS)}

**Icon set**

${list(ICON_SETS)}

**Shadow**

${list(SHADOW_LEVELS)}

**Density**

${list(DENSITIES)}

## Targeting *(Pro)*

**Page type**

${list(PAGE_TYPES)}

**Device**

${list(DEVICE_TARGETS)}

**Customer state**

${list(CUSTOMER_TARGETS)}`,
  );

  const notificationTypes = doc(
    {
      title: "Notification (recipe) types",
      slug: "notification-types",
      feature: "notifications",
      min_plan: "free",
      summary:
        "Every notification type a merchant can turn on, which plan it needs, where it can render and which page scopes it accepts.",
      keywords: [
        "notification",
        "recipe",
        "countdown",
        "announcement",
        "low stock",
        "cart activity",
        "surface",
        "page",
      ],
    },
    `# Notification (recipe) types

Cart toasts react to the shopper's own cart. **Notifications** (shown in the
admin as recipes on the **Toasts** page) are merchant-configured rules that can
fire on a page view instead. Every one of them is bound by the frequency rules on
the **Design → Anti-spam** section, and by the plan below.

Locked principle: **real data only.** A countdown counts to a date you set, low
stock reads live inventory, cart activity counts genuine server-side add-to-cart
events. The app never invents a number, and stays silent instead of guessing on a
quiet store.

## Types and plan

| Type | Plan |
|---|---|
${NOTIFICATION_TYPES.map((t) => `| \`${t}\` | ${notificationPlanFor(t) === "pro" ? "Pro" : "Free"} |`).join("\n")}

## Order-data types are off at launch

\`order.summary\` and \`order.created\` read order data, which needs Shopify's
**Protected customer data** approval. Until that is granted the app ships without
them: the \`orders/create\` webhook stays off and neither type can fire. Cart
activity does **not** need it — it counts add-to-cart events the app records
itself.

## Aggregate types

These render a **real counted aggregate** (marked \`data-won-aggregate\` in the
DOM) and show nothing when the underlying count is too low to be honest:

${list(AGGREGATE_TYPES)}

## Surfaces

Where a notification may render:

${list(NOTIFICATION_SURFACES)}

## Page scopes

Which storefront pages a rule may run on (\`all\`, or an empty list, means every
page):

${list(NOTIFICATION_PAGES)}`,
  );

  return {
    "reference/plan-limits.generated.md": planLimits,
    "reference/notification-types.generated.md": notificationTypes,
    "reference/event-types.generated.md": eventTypes,
    "reference/config-options.generated.md": configOptions,
  };
}

function main(): void {
  const docs = buildDocs();
  for (const [rel, content] of Object.entries(docs)) {
    const abs = join(REFERENCE_DIR, "..", rel);
    writeFileSync(abs, content, "utf8");
    console.log(`wrote ${relative(process.cwd(), abs)}`);
  }
}

// Run only when invoked directly (not when imported by the freshness test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
