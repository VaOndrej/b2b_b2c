// The MVP 6 (Kampaně) E2E fixture, shared by the seed (scripts/e2e/seed-mvp1.mjs --profile campaign), the campaign
// script (scripts/e2e/campaign.mjs) and the spec (tests/e2e/storefront.campaign.spec.ts):
//   "E2E kampaň auto 10 %"  automatic, 10 % on won-e2e-simple-a (product target)
//   campaign "e2e-campaign"  the same rule at 30 % inside its window (scheduled by campaign.mjs a few minutes ahead,
//                            in the shop's time zone, so the spec sees it start and end)
// Percentages only: they hold in every currency with nothing to convert.

export const CAMPAIGN_HANDLES = ["won-e2e-simple-a"];
export const CAMPAIGN_RULE_ID = "e2e-campaign-auto-10";
export const CAMPAIGN_ID = "e2e-campaign";
export const CAMPAIGN_BASE_PERCENT = 10;
export const CAMPAIGN_PERCENT = 30;

/** The seeded rule; `ids` maps each handle to its product GID on the store. */
export function campaignRules(ids) {
  return [
    {
      id: CAMPAIGN_RULE_ID,
      name: "E2E kampaň auto 10 %",
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: CAMPAIGN_BASE_PERCENT },
      target: { kind: "products", productIds: CAMPAIGN_HANDLES.map((h) => ids[h]), variantIds: [] },
    },
  ];
}

/** The E2E campaign over a window (shop-local `YYYY-MM-DDTHH:MM:SS`). */
export function e2eCampaign(start, end) {
  return {
    id: CAMPAIGN_ID,
    name: "E2E kampaň 30 %",
    window: { start, end },
    overrides: [{ ruleId: CAMPAIGN_RULE_ID, patch: { value: { kind: "percentage", percent: CAMPAIGN_PERCENT } } }],
    killed: false,
  };
}
