#!/usr/bin/env node
/* eslint-env node */
// Seed (and clean up) the MVP 1 checkout E2E rules on the dev store through the
// CANONICAL sync: app/lib/sync/save-and-sync.server.ts `saveAndSync({ client,
// db, shop, input, otherCodes })` with the CLI AdminClient (`shopify app execute`
// as the app) and the app's own DB, so WonNode/SyncRun/ConfigVersion stay the
// app's and the next admin save starts from what is on the store.
//
// Profiles (--profile, default mvp1):
//   mvp1    scripts/e2e/mvp1-fixture.mjs: "E2E auto 10 %" (automatic, 10 % on
//           won-e2e-simple-a) and "E2E kód" (code WONE2E15, 15 % on the order);
//           tests/e2e/checkout.mvp1.spec.ts.
//   shapes  scripts/e2e/shapes-fixture.mjs: a fixed amount per item above
//           won-e2e-simple-b's price (sent as 100 %) and two Pro-stacked
//           percentages on won-e2e-simple-a (sent as one summed percent);
//           tests/e2e/checkout.shapes.spec.ts (matrix with WON_E2E_PROFILE=shapes).
//   margin  scripts/e2e/margin-fixture.mjs (MVP 2): margin protection ON (minimum
//           margin 25 %, maximum discount 30 %), "E2E marže auto 50 %" on
//           won-e2e-simple-a, won-e2e-simple-b and won-e2e-spare, codes WONE2EM20
//           = 20 % and WONE2EM60 = 60 % on the order;
//           tests/e2e/checkout.margin.spec.ts (WON_E2E_PROFILE=margin).
//           The variant cost metafields are the cost mirror's job, run after the
//           seed: scripts/e2e/margin-costs.mjs (dry-run, then --live); after
//           --cleanup, `margin-costs.mjs --clear` removes them again.
//   margin-pro  the same + a Pro per-collection override: the test collection
//           won-e2e-margin (won-e2e-simple-b only; create it first with
//           scripts/e2e/margin-collection.mjs --live) gets a maximum discount of
//           10 %. Run the seed with NODE_ENV=development WON_DEV_PLAN=pro (and
//           `shopify app dev` likewise): on Free the plan gate folds the override
//           into the global value; tests/e2e/checkout.margin.spec.ts with
//           WON_E2E_PROFILE=margin-pro.
//   tiers   scripts/e2e/tiers-fixture.mjs (MVP 3): a global quantity tier set
//           "e2e-tiers-global" counted per product (from 3 items −10 %, from 5
//           items −15 %), margin protection ON (minimum margin 30 %, maximum
//           discount 30 %), no rule; tests/e2e/storefront.tiers.spec.ts
//           (WON_E2E_PROFILE=tiers). The sync writes the storefront config (K5);
//           the variant pdp maximum (K4) comes with the full cost pass:
//           scripts/e2e/margin-costs.mjs (dry-run, then --live).
//   tiers-pro  the same + a Pro set on the test collection won-e2e-tiers
//           (won-e2e-simple-b + won-e2e-spare; create it first with
//           scripts/e2e/margin-collection.mjs --fixture tiers --live), counted
//           across the cart: from 2 items −20 %. Run with NODE_ENV=development
//           WON_DEV_PLAN=pro (and `shopify app dev` likewise).
//   rewards  scripts/e2e/rewards-fixture.mjs (MVP 4): free shipping from 40 Kč /
//           2 €, a gift (won-e2e-spare) from 50 Kč / 3 €; no rule;
//           tests/e2e/storefront.rewards.spec.ts (WON_E2E_PROFILE=rewards).
//   rewards-other  the same with countOtherDiscounts on + code WONE2EDAR (50 %
//           on the order).
//   outlet  scripts/e2e/outlet-fixture.mjs (MVP 5): auto 10 % on won-e2e-two-variants and won-e2e-spare, code
//           WONE2EVYP (20 % on the order); the sales are started / ended by scripts/e2e/outlet.mjs.
//   campaign  scripts/e2e/campaign-fixture.mjs (MVP 6): auto 10 % on won-e2e-simple-a; the campaign (30 % in a
//           window a few minutes ahead) is scheduled / removed by scripts/e2e/campaign.mjs.
//   cards     scripts/e2e/cards-fixture.mjs (MVP 7): a global tier set, 2 items −10 %; card prices on; a custom
//           look that only a Pro shop's storefront gets.
//   campaign-tiers  scripts/e2e/campaign-tiers-fixture.mjs (MVP 6.1): a global tier set, 2 items −10 %; the
//           campaign (2 items −20 % in a window) is scheduled by scripts/e2e/campaign.mjs --fixture tiers.
//   rewards-pro  + a second threshold (80 Kč / 4 €) with a choice of 3 gifts and
//           the spare as fallback. Run with NODE_ENV=development WON_DEV_PLAN=pro.
// A seed REPLACES the E2E rules, tier sets, margin and reward settings of the
// other profile (one backup covers all of them).
//
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs
//       DRY-RUN (default): reads the store + the stored config, prints the seed
//       config and the sync plan (scripts/sync/live-sync.ts dry-run: every
//       mutation printed, none sent). Writes nothing anywhere.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs [--profile shapes] --live
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile tiers --preset chips [--live]   (visual QA of a block preset)
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile rewards --texts --looks milestones=checklist+blink [--live]
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile tiers --old-look [--live]
//       adds the merchant's own storefront texts and / or ready-made looks to the profile's seed, or (--old-look)
//       the look in the shape stored before the split
//       (scripts/e2e/looks-fixture.mjs; tests/e2e/storefront.looks.spec.ts; runbook/looks.sh)
//       backs up the stored config (only when no backup exists yet, so a re-seed
//       never backs up its own seed), saves the seed config and syncs it.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --cleanup [--live]
//       restores the backed-up config (no row before → the defaults, i.e. no
//       rules) and syncs it; dry-run by default. Without the backup: removes
//       the E2E rules and resets the margin settings only when they are the
//       margin / margin-pro seed's (scripts/e2e/margin-cleanup.mjs); any other
//       margin settings stay, the cleanup says so (exit 3 if still on).
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --state
//       read-only: Won nodes of the app's function, the shop function_config
//       metafield and the won-e2e-simple-a / won-e2e-simple-b product metafields.
//
// Options: --out <dir> (evidence + backup; default $WON_E2E_OUT or
// <tmp>/won-discounts-e2e) · --json (print the whole result).
//
// DB: DATABASE_URL is the dev app's SQLite (apps/won-discounts/prisma/dev.sqlite,
// the file `shopify app dev` uses: its schema-relative `file:./dev.sqlite`). The
// script sets that absolute URL itself, so no .env is read. Only Prisma opens
// the file; the script prints rule ids/names and counts, never the rows.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

import { E2E_AUTO_RULE_ID, E2E_CODE, E2E_PRODUCT_HANDLE, E2E_RULE_IDS, e2eRules } from "./mvp1-fixture.mjs";
import { classifyStoredMargin } from "./margin-cleanup.mjs";
import {
  MARGIN_CODE,
  MARGIN_COLLECTION_HANDLE,
  MARGIN_HANDLES,
  MARGIN_ORDER_CAP_CODE,
  MARGIN_RULE_IDS,
  marginModule,
  marginRules,
} from "./margin-fixture.mjs";
import { SHAPES_HANDLES, SHAPES_PRODUCT_B_HANDLE, SHAPES_RULE_IDS, shapesRules } from "./shapes-fixture.mjs";
import { ALL_REWARDS_TIER_IDS, milestoneRules, REWARDS_CODE_RULE_ID, REWARDS_HANDLES, REWARDS_STEP_RULE_ID, rewardsModule, rewardsRules } from "./rewards-fixture.mjs";
import { OUTLET_HANDLES, OUTLET_RULE_IDS, outletRules } from "./outlet-fixture.mjs";
import { CAMPAIGN_HANDLES, CAMPAIGN_RULE_ID, campaignRules } from "./campaign-fixture.mjs";
import { CAMPAIGN_TIERS_HANDLES, CAMPAIGN_TIERS_SET_ID, campaignTiersModule } from "./campaign-tiers-fixture.mjs";
import { CARDS_HANDLES, CARDS_SET_ID, cardsStorefront, cardsTiersModule } from "./cards-fixture.mjs";
import { LOOK_TEXTS, looksStorefront, oldLookStorefront, parseLooks } from "./looks-fixture.mjs";
import { TIERS_COLLECTION_HANDLE, TIERS_COLLECTION_SET_ID, TIERS_GLOBAL_SET_ID, tiersMarginModule, tiersModule } from "./tiers-fixture.mjs";

register();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(APP_DIR, "../..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const DEV_DB = path.join(APP_DIR, "prisma/dev.sqlite");

// Validated with the Shopify dev MCP (admin 2026-04): read_products, read_discounts.
const STATE_QUERY = `query WonE2eState($after: String, $handle: String!, $handleB: String!) {
  shop {
    id
    functionConfig: metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      value
      updatedAt
    }
  }
  product: productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    metafield(namespace: "$app:won_discounts", key: "product") {
      id
      value
    }
  }
  productB: productByIdentifier(identifier: { handle: $handleB }) {
    id
    handle
    metafield(namespace: "$app:won_discounts", key: "product") {
      id
      value
    }
  }
  discountNodes(first: 100, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticApp { title status discountClasses appDiscountType { functionId appKey } }
        ... on DiscountCodeApp { title status discountClasses codesCount { count } appDiscountType { functionId appKey } }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
        ... on DiscountAutomaticFreeShipping { title status }
        ... on DiscountCodeBasic { title status }
        ... on DiscountCodeBxgy { title status }
        ... on DiscountCodeFreeShipping { title status }
      }
    }
  }
}
`;

// --- Arguments ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const live = flag("--live");
const cleanup = flag("--cleanup");
const stateOnly = flag("--state");
const printJson = flag("--json");
const OUT_DIR = path.resolve(option("--out") ?? process.env.WON_E2E_OUT ?? path.join(os.tmpdir(), "won-discounts-e2e"));
const BACKUP_FILE = path.join(OUT_DIR, "seed-mvp1-backup.json");
for (const arg of argv) {
  if (arg.startsWith("--") && !["--live", "--cleanup", "--state", "--json", "--out", "--profile", "--preset", "--texts", "--looks", "--old-look"].includes(arg)) {
    throw new Error(`unknown argument ${arg}`);
  }
}

// Seed profiles: the products each one targets and its rules (GIDs by handle).
const PROFILES = {
  mvp1: { handles: [E2E_PRODUCT_HANDLE], rules: (ids) => e2eRules(ids[E2E_PRODUCT_HANDLE]), label: `code ${E2E_CODE}` },
  shapes: { handles: SHAPES_HANDLES, rules: shapesRules, label: "capped fixed per item + Pro stack, no code" },
  margin: {
    handles: MARGIN_HANDLES,
    rules: marginRules,
    margin: () => marginModule(),
    label: `margin protection on (min margin 25 %, max discount 30 %), auto 50 % on ${MARGIN_HANDLES.length} products + codes ${MARGIN_CODE}, ${MARGIN_ORDER_CAP_CODE}`,
  },
  "margin-pro": {
    handles: MARGIN_HANDLES,
    rules: marginRules,
    collections: [MARGIN_COLLECTION_HANDLE],
    margin: (collectionIds) => marginModule(collectionIds[MARGIN_COLLECTION_HANDLE]),
    label: `margin protection on (min margin 25 %, max discount 30 %) + Pro: collection ${MARGIN_COLLECTION_HANDLE} max discount 10 %, auto 50 % on ${MARGIN_HANDLES.length} products + codes ${MARGIN_CODE}, ${MARGIN_ORDER_CAP_CODE}`,
  },
  tiers: {
    handles: [],
    rules: () => [],
    tiers: () => tiersModule(),
    margin: () => tiersMarginModule(),
    label: "quantity tiers: global set per product (from 3 items −10 %, from 5 items −15 %), margin protection on (min margin 30 %, max discount 30 %), no rule",
  },
  "tiers-pro": {
    handles: [],
    rules: () => [],
    collections: [TIERS_COLLECTION_HANDLE],
    tiers: (collectionIds) => tiersModule(collectionIds[TIERS_COLLECTION_HANDLE]),
    margin: () => tiersMarginModule(),
    label: `quantity tiers + Pro: a set on ${TIERS_COLLECTION_HANDLE} counted across the cart (from 2 items −20 %) before the global set; margin protection on (min margin 30 %, max discount 30 %), no rule`,
  },
  rewards: {
    handles: REWARDS_HANDLES,
    rules: () => [],
    rewards: (variantIds) => rewardsModule(variantIds),
    label: "rewards: free shipping from 40 Kč / 2 €, a gift (won-e2e-spare) from 50 Kč / 3 €, no rule",
  },
  "rewards-other": {
    handles: REWARDS_HANDLES,
    rules: () => rewardsRules(),
    rewards: (variantIds) => rewardsModule(variantIds, { other: true }),
    label: "rewards counting other discounts: free shipping from 40 Kč / 2 €, a gift from 50 Kč / 3 €, code WONE2EDAR 50 % on the order",
  },
  "rewards-pro": {
    handles: REWARDS_HANDLES,
    rules: () => milestoneRules(),
    rewards: (variantIds) => rewardsModule(variantIds, { pro: true }),
    label: "rewards + Pro (Milníky): free shipping from 40 Kč / 2 €, the spare from 50 Kč / 3 €, a choice of 3 gifts from 80 Kč / 4 € (fallback: the spare), 10 % off the order from 300 Kč / 15 €",
  },
  outlet: {
    handles: OUTLET_HANDLES,
    rules: outletRules,
    label: "Výprodej (MVP 5): auto 10 % on won-e2e-two-variants + won-e2e-spare, code WONE2EVYP 20 % on the order (the sales themselves: scripts/e2e/outlet.mjs)",
  },
  campaign: {
    handles: CAMPAIGN_HANDLES,
    rules: campaignRules,
    label: "Kampaně (MVP 6): auto 10 % on won-e2e-simple-a (the campaign itself, 30 % in a window minutes ahead: scripts/e2e/campaign.mjs)",
  },
  cards: {
    handles: CARDS_HANDLES,
    rules: () => [],
    tiers: () => cardsTiersModule(),
    storefront: cardsStorefront,
    label: "Ceny na kartách BETA + vlastní vzhled (MVP 7): a global tier set, 2 items −10 %, card prices on, a custom look (Pro only)",
  },
  "campaign-tiers": {
    handles: CAMPAIGN_TIERS_HANDLES,
    rules: () => [],
    tiers: () => campaignTiersModule(),
    label: "Kampaně mění úrovně (MVP 6.1): a global tier set, 2 items −10 % (the campaign itself, 2 items −20 % in a window minutes ahead: scripts/e2e/campaign.mjs --fixture tiers)",
  },
};
const PROFILE = option("--profile") ?? "mvp1";
if (!Object.hasOwn(PROFILES, PROFILE)) throw new Error(`unknown --profile ${PROFILE} (${Object.keys(PROFILES).join(", ")})`);
/** Every E2E rule id of every profile: what a cleanup without a backup removes, and what "the seed is in it" means. */
const ALL_E2E_RULE_IDS = [...E2E_RULE_IDS, ...SHAPES_RULE_IDS, ...MARGIN_RULE_IDS, REWARDS_CODE_RULE_ID, REWARDS_STEP_RULE_ID, ...OUTLET_RULE_IDS, CAMPAIGN_RULE_ID];
/** Every E2E tier set id (MVP 3): a cleanup without a backup removes them, and they mean "the seed is in it" too. */
const ALL_E2E_TIER_SET_IDS = [TIERS_GLOBAL_SET_ID, TIERS_COLLECTION_SET_ID, CAMPAIGN_TIERS_SET_ID, CARDS_SET_ID];
const tierSetsOf = (config) => (Array.isArray(config?.modules?.tiers?.sets) ? config.modules.tiers.sets : []);
const giftTiersOf = (config) => (Array.isArray(config?.modules?.rewards?.gifts) ? config.modules.rewards.gifts : []);
const hasE2eRewards = (config) => giftTiersOf(config).some((tier) => ALL_REWARDS_TIER_IDS.includes(tier.id));

// The app's DB, absolute (never the .env): set before the Prisma client loads.
process.env.DATABASE_URL = `file:${DEV_DB}`;

const appModule = (relative) => import(pathToFileURL(path.join(APP_DIR, relative)).href);
const { createCliAdminClient } = await appModule("app/lib/admin-client-cli.server.ts");
const { loadConfig } = await appModule("app/lib/config.server.ts");
const { saveAndSync, loadSyncStatus } = await appModule("app/lib/sync/save-and-sync.server.ts");
const { detectNativeDiscounts } = await appModule("app/lib/native/detect.server.ts");
const { APPEARANCE_PRESETS, createDefaultConfig } = await import("@won/core/discounts/config");
// --preset <default|highlight|chips|tiles> (visual QA of the quantity tiers block, MVP 3): the seeded
// config's storefront.appearancePreset. Only with a tiers profile; absent = the default preset.
const PRESET = option("--preset");
if (PRESET !== undefined && !APPEARANCE_PRESETS.includes(PRESET)) throw new Error(`unknown --preset ${PRESET} (${APPEARANCE_PRESETS.join(", ")})`);

// --texts / --looks <element>=<look>[+blink],… (úkol 8): the merchant's texts per language and ready-made looks on top of the profile.
const TEXTS = flag("--texts");
const LOOKS = parseLooks(option("--looks"));
// --old-look: the storefront settings in the shape of before the split (the conversion's live check).
const OLD_LOOK = flag("--old-look");
if (OLD_LOOK && Object.keys(LOOKS).length > 0) throw new Error("--old-look is the shape of before the looks: not with --looks");

const client = createCliAdminClient({ appDir: APP_DIR, cwd: REPO_ROOT, store: STORE });

async function query(document, variables) {
  const result = await client.graphql(document, variables);
  if (result.errors?.length) throw new Error(`GraphQL: ${result.errors.map((e) => e.message).join("; ")}`);
  return result.data;
}

function readClientId() {
  const toml = fs.readFileSync(path.join(APP_DIR, "shopify.app.toml"), "utf8");
  return /^client_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
function writeEvidence(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}-${stamp()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

// --- Read-only state -------------------------------------------------------------------------
async function readState() {
  const functions = await query(`query WonSyncFunctions {
  shopifyFunctions(first: 50) {
    nodes {
      id
      handle
      apiType
    }
  }
}`);
  const fn = functions.shopifyFunctions.nodes.find((node) => node.handle === "won-discounts-engine") ?? null;
  const nodes = [];
  let shop = null;
  let product = null;
  let productB = null;
  let after = null;
  for (let page = 0; page < 50; page += 1) {
    const data = await query(STATE_QUERY, { handle: E2E_PRODUCT_HANDLE, handleB: SHAPES_PRODUCT_B_HANDLE, ...(after ? { after } : {}) });
    shop ??= data.shop;
    product ??= data.product;
    productB ??= data.productB;
    nodes.push(...data.discountNodes.nodes);
    if (!data.discountNodes.pageInfo.hasNextPage) break;
    after = data.discountNodes.pageInfo.endCursor;
  }
  const ours = nodes.filter((node) => fn && node.discount?.appDiscountType?.functionId === fn.id);
  let config = null;
  if (shop?.functionConfig?.value) {
    try {
      const parsed = JSON.parse(shop.functionConfig.value);
      config = {
        bytes: Buffer.byteLength(shop.functionConfig.value),
        updatedAt: shop.functionConfig.updatedAt,
        rules: (parsed?.modules?.codes?.rules ?? []).map((rule) => ({ id: rule.id, name: rule.name, method: rule.method, enabled: rule.enabled })),
      };
    } catch {
      config = { bytes: Buffer.byteLength(shop.functionConfig.value), unreadable: true };
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    functionId: fn?.id ?? null,
    wonNodes: ours.map((node) => ({
      id: node.id,
      type: node.discount.__typename,
      title: node.discount.title,
      status: node.discount.status,
      classes: node.discount.discountClasses,
      codes: node.discount.codesCount?.count,
    })),
    otherDiscountNodes: nodes
      .filter((node) => !ours.includes(node))
      .map((node) => ({ id: node.id, type: node.discount?.__typename ?? null, title: node.discount?.title ?? null, status: node.discount?.status ?? null })),
    shopFunctionConfig: config,
    product: product ? { handle: product.handle, id: product.id, wonProductMetafield: product.metafield?.value ?? null } : null,
    productB: productB ? { handle: productB.handle, id: productB.id, wonProductMetafield: productB.metafield?.value ?? null } : null,
  };
}

// --- Config helpers ---------------------------------------------------------------------------
function summarize(config) {
  return (config?.modules?.codes?.rules ?? []).map((rule) => ({ id: rule.id, name: rule.name, method: rule.method, enabled: rule.enabled }));
}

/** "tier set e2e-tiers-global (global, per product): 3+ −10 %, 5+ −15 %" per set — ids and values only. */
/** "free shipping CZK 4000, EUR 200; gift e2e-gift CZK 5000 → 1 variant(s)" — ids and values only. */
function rewardsText(config) {
  const rewards = config?.modules?.rewards ?? {};
  const money = (m) => Object.entries(m ?? {}).map(([cur, v]) => `${cur} ${v}`).join(", ");
  const parts = [rewards.freeShipping ? `free shipping ${money(rewards.freeShipping.threshold)}` : "no free shipping"];
  for (const tier of giftTiersOf(config)) parts.push(`gift ${tier.id} ${money(tier.threshold)} → ${tier.choices.length} variant(s)${tier.fallbackVariantId ? " + fallback" : ""}`);
  if (rewards.countOtherDiscounts) parts.push("counting other discounts");
  return parts.join("; ");
}

function tiersText(config) {
  const sets = tierSetsOf(config);
  if (sets.length === 0) return ["no tier set"];
  return sets.map((set) => {
    const scope = set.scope === "global" ? "global" : `scoped ${JSON.stringify(set.scope)}`;
    const breaks = (set.breaks ?? []).map((b) => `${b.minQty}+ ${b.percent !== undefined ? `−${b.percent} %` : `−${JSON.stringify(b.amountOff)}`}`).join(", ");
    return `tier set ${set.id} (${scope}, per ${set.countAcross}): ${breaks}`;
  });
}

/** "margin off" · "margin ON (min margin 25 %, max discount 30 %, 0 collection(s))" — never the raw module. */
function marginText(config) {
  const margin = config?.modules?.margin;
  if (!margin || margin.enabled !== true) return "margin protection off";
  const min = margin.global?.minMarginPercent;
  return `margin protection ON (min margin ${min ?? "—"} %, max discount ${margin.global?.maxDiscountPercent} %, ${margin.perCollection?.length ?? 0} collection setting(s))`;
}

/**
 * The stored margin settings as a cleanup without a backup sees them
 * (scripts/e2e/margin-cleanup.mjs): the E2E fixture's (phase A or Pro) → reset;
 * anything else → left alone. An override's collection is the E2E test
 * collection when it is `won-e2e-margin`'s GID, or — that collection deleted —
 * a GID that no longer resolves on the store.
 */
async function classifyMargin(margin) {
  const overrideIds = (Array.isArray(margin?.perCollection) ? margin.perCollection : [])
    .map((o) => o?.collectionId)
    .filter((id) => typeof id === "string");
  const fixtureIds = new Set();
  if (overrideIds.length > 0) {
    const data = await query(
      `query WonE2eMarginCollections($handle: String!, $ids: [ID!]!) {
  collectionByIdentifier(identifier: { handle: $handle }) {
    id
  }
  nodes(ids: $ids) {
    id
  }
}`,
      { handle: MARGIN_COLLECTION_HANDLE, ids: overrideIds },
    );
    const current = data.collectionByIdentifier?.id ?? null;
    overrideIds.forEach((id, i) => {
      if (id === current || (current === null && !data.nodes[i])) fixtureIds.add(id);
    });
  }
  return classifyStoredMargin(margin, { isFixtureCollection: (id) => fixtureIds.has(id) });
}

function seedConfig(previous, productIds, collectionIds, variantIds) {
  // Only the profile's E2E rules (no campaigns, default engine switches) so the
  // carts the spec checks are decided by these rules alone; markets are kept.
  const config = createDefaultConfig();
  config.markets = previous.markets ?? [];
  config.modules.codes.rules = PROFILES[PROFILE].rules(productIds);
  if (PROFILES[PROFILE].margin) config.modules.margin = PROFILES[PROFILE].margin(collectionIds);
  if (PROFILES[PROFILE].tiers) config.modules.tiers = PROFILES[PROFILE].tiers(collectionIds);
  if (PROFILES[PROFILE].rewards) config.modules.rewards = PROFILES[PROFILE].rewards(variantIds);
  // MVP 7: a profile's storefront settings (card prices, the custom look).
  if (PROFILES[PROFILE].storefront) config.storefront = PROFILES[PROFILE].storefront(config.storefront);
  if (PRESET !== undefined) {
    if (!PROFILES[PROFILE].tiers) throw new Error(`--preset needs a tiers profile (--profile ${PROFILE} has no tier set)`);
    config.storefront.appearancePreset = PRESET;
  }
  config.storefront = looksStorefront(config.storefront, { looks: LOOKS, texts: TEXTS, hasTiers: tierSetsOf(config).length > 0 });
  if (TEXTS) config.locales = structuredClone(LOOK_TEXTS);
  if (OLD_LOOK) config.storefront = oldLookStorefront(config.storefront);
  return config;
}

function readBackup() {
  if (!fs.existsSync(BACKUP_FILE)) return null;
  return JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
}

/** Codes of the shop's native discounts (the canonical detector), for the code-hash collision guard. */
async function nativeCodes(db) {
  const rows = await db.wonNode.findMany({ where: { shop: STORE }, select: { discountNodeId: true } });
  const detection = await detectNativeDiscounts(client, { wonNodeIds: rows.map((row) => row.discountNodeId), ownAppKey: readClientId() });
  return detection.movable.flatMap((node) => node.codes);
}

/** The app's tracked Won nodes for evidence: key, role and the node's live Shopify status only (no raw rows). */
async function trackedNodeSummary(db) {
  const rows = await db.wonNode.findMany({ where: { shop: STORE }, select: { key: true, role: true, discountNodeId: true } });
  let statusById = null;
  try {
    statusById = new Map((await readState()).wonNodes.map((node) => [node.id, node.status]));
  } catch (error) {
    console.log(`(could not read the nodes' Shopify status: ${error?.message ?? error})`);
  }
  return rows.map((row) => ({
    key: row.key,
    role: row.role,
    status: statusById ? (statusById.get(row.discountNodeId) ?? "not on the store") : "unknown",
  }));
}

function syncSummary(result) {
  return {
    save: result.save.ok
      ? { ok: true, versionId: result.save.versionId, functionConfigBytes: result.save.functionConfigBytes, issues: result.save.issues }
      : { ok: false, reason: result.save.reason, issues: result.save.issues },
    sync: result.sync,
    warnings: result.warnings,
  };
}

function printSync(result) {
  console.log(`\n# save: ${result.save.ok ? `ok (version ${result.save.versionId}, ${result.save.functionConfigBytes} B)` : `REFUSED (${result.save.reason})`}`);
  for (const issue of result.save.issues ?? []) console.log(`  issue ${issue.path}: ${issue.message}`);
  if (result.sync) {
    console.log(`# sync: ${result.sync.ok ? "ok" : "FAILED"} (run ${result.sync.runId})`);
    for (const step of result.sync.steps) console.log(`${step.ok ? "✔" : "✖"} ${step.step} — ${step.detail}`);
  }
  for (const warning of result.warnings ?? []) console.log(`warning: ${warning}`);
}

/** The sync plan of `config` without sending a mutation: scripts/sync/live-sync.ts in dry-run. */
function dryRunPlan(config, label) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `seed-mvp1-${label}-config.json`);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\n# sync plan (dry-run, ${path.relative(REPO_ROOT, path.join(APP_DIR, "scripts/sync/live-sync.ts"))} --config ${file})`);
  const run = spawnSync("npx", ["tsx", path.join(APP_DIR, "scripts/sync/live-sync.ts"), "--config", file], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return run.status ?? 1;
}

// --- Modes ------------------------------------------------------------------------------------
async function main() {
  if (stateOnly) {
    const state = await readState();
    console.log(JSON.stringify(state, null, 2));
    console.log(`\nEvidence: ${writeEvidence("state-mvp1", state)}`);
    return;
  }

  const { PrismaClient } = await appModule("app/generated/prisma/client.ts");
  const db = new PrismaClient();
  try {
    const loaded = await loadConfig(db, STORE);
    if (loaded.unreadable) throw new Error("the stored config cannot be read; refusing to touch it (nothing was sent)");
    if (loaded.readOnly) throw new Error("the stored config belongs to a newer schema; refusing to touch it (nothing was sent)");
    const hasSeed =
      (loaded.config.campaigns ?? []).some((c) => String(c.id).startsWith("e2e-")) ||
      loaded.config.modules.codes.rules.some((rule) => ALL_E2E_RULE_IDS.includes(rule.id)) ||
      tierSetsOf(loaded.config).some((set) => ALL_E2E_TIER_SET_IDS.includes(set.id)) ||
      hasE2eRewards(loaded.config);
    console.log(
      `# stored config of ${STORE}: ${loaded.exists ? `${loaded.config.modules.codes.rules.length} rule(s)${hasSeed ? " (the E2E seed is in it)" : ""}` : "no row yet"}`,
    );
    for (const rule of summarize(loaded.config)) console.log(`  - ${rule.id} "${rule.name}" ${rule.method} ${rule.enabled ? "enabled" : "disabled"}`);
    console.log(`  ${marginText(loaded.config)}`);
    for (const line of tiersText(loaded.config)) console.log(`  ${line}`);
    console.log(`  rewards: ${rewardsText(loaded.config)}`);

    if (cleanup) {
      const backup = readBackup();
      let target;
      let foreignMargin = null;
      if (backup) {
        target = backup.exists ? backup.config : createDefaultConfig();
        console.log(`\n# cleanup: restore the backup of ${backup.backedUpAt} (${backup.exists ? `${summarize(backup.config).length} rule(s)` : "there was no row: the defaults, no rules"})`);
      } else {
        // No backup: the E2E rules go; the margin settings go only when they are the fixture's.
        const margin = await classifyMargin(loaded.config.modules.margin);
        if (!hasSeed && margin.kind !== "fixture") {
          console.log(`\n# cleanup: no backup in ${OUT_DIR}, no E2E rule stored and ${margin.kind === "foreign" ? `margin settings that are not the fixture's (${margin.reason})` : "default margin settings"} — nothing to do`);
          return;
        }
        target = {
          ...loaded.config,
          modules: {
            ...loaded.config.modules,
            codes: { rules: loaded.config.modules.codes.rules.filter((rule) => !ALL_E2E_RULE_IDS.includes(rule.id)) },
            tiers: { ...loaded.config.modules.tiers, sets: tierSetsOf(loaded.config).filter((set) => !ALL_E2E_TIER_SET_IDS.includes(set.id)) },
            // A rewards module holding an E2E gift tier is the seed's (free shipping included): back to the defaults.
            ...(hasE2eRewards(loaded.config) ? { rewards: createDefaultConfig().modules.rewards } : {}),
          },
          // MVP 6: the E2E campaigns (scripts/e2e/campaign.mjs) go too.
          campaigns: (loaded.config.campaigns ?? []).filter((c) => !String(c.id).startsWith("e2e-")),
        };
        console.log(`\n# cleanup: no backup in ${OUT_DIR}; removing only the E2E rules and tier sets from the stored config`);
        if (margin.kind === "fixture") {
          target.modules.margin = createDefaultConfig().modules.margin;
          console.log(`  margin settings = the ${margin.profile} seed's${margin.collectionId ? ` (override of ${margin.collectionId})` : ""} → reset to the defaults (off, no override)`);
        } else if (margin.kind === "foreign") {
          foreignMargin = margin.reason;
          console.log(`  ! margin settings LEFT UNTOUCHED: they are not the E2E fixture's (${margin.reason}). If an E2E run left them, switch margin protection off in the admin (Ochrana marže).`);
        }
      }
      console.log(`  after the cleanup: ${summarize(target).length} rule(s), ${marginText(target)}, ${tiersText(target).join("; ")}, rewards: ${rewardsText(target)}`);
      const marginWasOn = loaded.config.modules.margin?.enabled === true && target.modules?.margin?.enabled !== true;
      if (!live) {
        process.exitCode = dryRunPlan(target, "cleanup");
        if (marginWasOn) console.log("\nnote: margin protection goes off → then clear the cost metafields: node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear [--live]");
        if (foreignMargin) console.log(`\nnote: the margin settings stay as they are (${foreignMargin})`);
        console.log("\n(dry-run: nothing written; pass --live)");
        return;
      }
      const result = await saveAndSync({ client, db, shop: STORE, input: target, otherCodes: await nativeCodes(db) });
      printSync(result);
      const status = await loadSyncStatus(db, STORE);
      const evidence = {
        name: "seed-mvp1-cleanup",
        store: STORE,
        at: new Date().toISOString(),
        restored: summarize(target),
        margin: marginText(target),
        tiers: tiersText(target),
        ...(foreignMargin ? { marginLeftUntouched: foreignMargin } : {}),
        result: syncSummary(result),
        syncRun: status,
      };
      console.log(`\nEvidence: ${writeEvidence("seed-mvp1-cleanup", evidence)}`);
      if (marginWasOn) console.log("next: clear the cost metafields — node apps/won-discounts/scripts/e2e/margin-costs.mjs --clear, then --clear --live");
      if (printJson) console.log(JSON.stringify(evidence, null, 2));
      if (result.save.ok && result.sync?.ok && backup) fs.renameSync(BACKUP_FILE, BACKUP_FILE.replace(/\.json$/, `.restored-${stamp()}.json`));
      process.exitCode = result.save.ok && result.sync?.ok ? 0 : 1;
      if (process.exitCode === 0 && foreignMargin && target.modules?.margin?.enabled === true) {
        // The rules are gone, but protection is still on with settings this script does not own.
        console.error(`\n! cleanup incomplete: margin protection is still ON with settings that are not the E2E fixture's (${foreignMargin})`);
        process.exitCode = 3;
      }
      return;
    }

    const productIds = {};
    const variantIds = {};
    for (const handle of PROFILES[PROFILE].handles) {
      const found = (
        await query(
          `query WonE2eProduct($handle: String!) {
  productByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    variants(first: 1) {
      nodes {
        id
      }
    }
    metafield(namespace: "$app:won_discounts", key: "product") {
      value
    }
  }
  shop {
    ianaTimezone
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      value
    }
  }
}`,
          { handle },
        )
      ).productByIdentifier;
      if (!found?.id) throw new Error(`product ${handle} not found on ${STORE}`);
      productIds[handle] = found.id;
      if (found.variants?.nodes?.[0]?.id) variantIds[handle] = found.variants.nodes[0].id;
    }
    const collectionIds = {};
    for (const handle of PROFILES[PROFILE].collections ?? []) {
      const found = (
        await query(
          `query WonE2eCollection($handle: String!) {
  collectionByIdentifier(identifier: { handle: $handle }) {
    id
    handle
    productsCount {
      count
    }
  }
}`,
          { handle },
        )
      ).collectionByIdentifier;
      if (!found?.id) throw new Error(`collection ${handle} not found on ${STORE}: run scripts/e2e/margin-collection.mjs --live first`);
      collectionIds[handle] = found.id;
      console.log(`# collection ${handle} = ${found.id} (${found.productsCount?.count ?? "?"} product(s))`);
    }
    const backup = readBackup();
    const previous = backup ? (backup.exists ? backup.config : createDefaultConfig()) : loaded.config;
    const config = seedConfig(previous, productIds, collectionIds, variantIds);
    console.log(
      `\n# seed (profile ${PROFILE}): ${Object.entries(productIds).map(([handle, id]) => `${handle} = ${id}`).join(", ")}; ${PROFILES[PROFILE].label}`,
    );
    for (const rule of summarize(config)) console.log(`  + ${rule.id} "${rule.name}" ${rule.method}`);
    console.log(`  ${marginText(config)}`);
    for (const line of tiersText(config)) console.log(`  ${line}`);
    console.log(`  rewards: ${rewardsText(config)}`);
    if (TEXTS) console.log(`  texts: ${Object.entries(config.locales).map(([locale, texts]) => `${locale} ${Object.keys(texts).length}`).join(", ")}`);
    if (OLD_LOOK) console.log(`  look as stored before the split: accent ${config.storefront.accent}, a custom look (Pro), no looks`);
    if (Object.keys(LOOKS).length > 0) console.log(`  looks: ${Object.entries(config.storefront.looks).map(([element, look]) => `${element} ${look.preset}${look.blink ? " + flash" : ""} (${look.accent})`).join(", ")}`);

    if (!live) {
      process.exitCode = dryRunPlan(config, PROFILE === "mvp1" ? "seed" : `seed-${PROFILE}`);
      console.log("\n(dry-run: nothing written; pass --live)");
      return;
    }

    if (!backup) {
      if (hasSeed) throw new Error("the stored config already holds the E2E seed but there is no backup; run --cleanup first");
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(
        BACKUP_FILE,
        `${JSON.stringify({ store: STORE, backedUpAt: new Date().toISOString(), exists: loaded.exists, config: loaded.exists ? loaded.config : null }, null, 2)}\n`,
      );
      console.log(`\n# backup: ${BACKUP_FILE}`);
    } else {
      console.log(`\n# backup kept: ${BACKUP_FILE} (${backup.backedUpAt})`);
    }

    const result = await saveAndSync({ client, db, shop: STORE, input: config, otherCodes: await nativeCodes(db) });
    printSync(result);
    const status = await loadSyncStatus(db, STORE);
    const wonNodes = await trackedNodeSummary(db);
    const evidenceName = PROFILE === "mvp1" ? "seed-mvp1" : `seed-mvp1-${PROFILE}`;
    const evidence = {
      name: evidenceName,
      profile: PROFILE,
      store: STORE,
      at: new Date().toISOString(),
      products: Object.entries(productIds).map(([handle, id]) => ({ handle, id })),
      rules: summarize(config),
      margin: marginText(config),
      tiers: tiersText(config),
      ...(PROFILE === "mvp1" ? { autoRule: E2E_AUTO_RULE_ID } : {}),
      result: syncSummary(result),
      syncRun: status,
      wonNodes,
    };
    console.log(`\nEvidence: ${writeEvidence(evidenceName, evidence)}`);
    if (printJson) console.log(JSON.stringify(evidence, null, 2));
    if (PROFILES[PROFILE].margin && result.save.ok && result.sync?.ok) {
      console.log("next: mirror the purchase costs (+ the variant pdp maximum) — node apps/won-discounts/scripts/e2e/margin-costs.mjs (dry-run), then --live");
    }
    process.exitCode = result.save.ok && result.sync?.ok ? 0 : 1;
  } finally {
    await db.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n✖ ${error?.message ?? error}`);
  process.exitCode = 1;
}
