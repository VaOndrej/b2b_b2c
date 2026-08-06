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

import { PRO_FEATURES, FREE_MILESTONE_LIMIT } from "@won/core/toasts/tier";
import { CART_EVENT_TYPES } from "@won/core/toasts/cart-events";
import {
  PAGE_TYPES,
  DEVICE_TARGETS,
  CUSTOMER_TARGETS,
} from "@won/core/toasts/targeting";
import { LOCALE_LIMIT_FREE } from "@won/core/toasts/locales";
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
- Up to **${FREE_MILESTONE_LIMIT}** active milestones
- Message templates in all supported languages
- The default appearance (light/dark/system)
- Shows a small "Powered by Won" badge

## Pro plan unlocks

${PRO_FEATURES.map((f) => `- ${PRO_LABELS[f] ?? f} \`(${f})\``).join("\n")}

## At a glance

| Capability | Free | Pro |
|---|---|---|
| Cart toasts + Undo | ✅ | ✅ |
| Languages & templates | ✅ | ✅ |
| Active milestones | up to ${FREE_MILESTONE_LIMIT} | unlimited |
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

  return {
    "reference/plan-limits.generated.md": planLimits,
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
