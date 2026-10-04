// The MVP 6.1 (kampaně mění i úrovně) E2E fixture, shared by the seed (scripts/e2e/seed-mvp1.mjs --profile
// campaign-tiers), the campaign script (scripts/e2e/campaign.mjs --fixture tiers) and the spec
// (tests/e2e/storefront.campaign-tiers.spec.ts):
//   global tier set "e2e-ct-global", counted per line: from 2 items −10 %
//   campaign "e2e-campaign": the same set from 2 items −20 % inside its window (more generous: core
//   campaign-tiers.ts tierOverrideIssue), scheduled by campaign.mjs a few minutes ahead in the shop's time zone.
// No rule, no margin protection: the tier alone decides the line. Percentages only (they hold in every currency).

export const CAMPAIGN_TIERS_HANDLES = ["won-e2e-simple-a"];
export const CAMPAIGN_TIERS_SET_ID = "e2e-ct-global";
export const CAMPAIGN_TIERS_MIN_QTY = 2;
export const CAMPAIGN_TIERS_BASE_PERCENT = 10;
export const CAMPAIGN_TIERS_PERCENT = 20;

/** modules.tiers of the seed config. */
export function campaignTiersModule() {
  return {
    sets: [{ id: CAMPAIGN_TIERS_SET_ID, scope: "global", countAcross: "line", breaks: [{ minQty: CAMPAIGN_TIERS_MIN_QTY, percent: CAMPAIGN_TIERS_BASE_PERCENT }] }],
  };
}

/** The E2E campaign over a window (shop-local `YYYY-MM-DDTHH:MM:SS`): the set's breaks during the campaign. */
export function e2eTierCampaign(id, start, end) {
  return {
    id,
    name: "E2E kampaň úrovně 20 %",
    window: { start, end },
    overrides: [{ ruleId: CAMPAIGN_TIERS_SET_ID, patch: { breaks: [{ minQty: CAMPAIGN_TIERS_MIN_QTY, percent: CAMPAIGN_TIERS_PERCENT }] } }],
    killed: false,
  };
}
