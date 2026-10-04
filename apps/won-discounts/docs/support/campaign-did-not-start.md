---
title: The campaign did not start (or the discount is not the campaign's)
slug: campaign-did-not-start
layer: support
feature: campaigns
min_plan: pro
status: beta
app_version: MVP6
source: hand-written
generated_from: null
lang: en
updated: 2026-10-04
keywords: [campaign not working, table shows old breaks during campaign, campaign did not start, black friday discount missing, wrong discount during campaign, campaign time zone, kampaň nezačala]
summary: Check the store's time zone, that the discount is ticked with a change, that the campaign is not ended or cancelled, the plan, and try a cart at that time.
---

# The campaign did not start

Work through these in order:

1. **Time zone.** The window is in the **store's** time zone (Shopify settings),
   not yours. The Campaigns screen says which zone and what time it is there now.
2. **Status.** In **Campaigns**, is it *Running*? *Scheduled* means its start is
   still ahead; *Ended by hand* means someone clicked End now or Cancel.
3. **The discount is in the campaign.** Its card lists every change ("Autumn 10 %:
   20 %"). A discount that is not listed keeps its own value. A discount that is
   switched off stays off unless the campaign switches it on.
4. **Quantity discounts.** The product-page table shows the campaign's breaks only
   from a minute after the start until 7 minutes before the end; checkout gives
   them the whole time, so in those minutes the cart is better than the table says.
   A campaign's breaks that give less than the set's usual ones never apply — the
   card then says a saved change is not used. **Gifts** do not change in a campaign.
5. **Plan.** Campaigns are Pro. On Free a campaign runs only when it was already
   running at the move to Free.
6. **Try a cart during the campaign** (in its card) shows exactly what checkout
   gives at the campaign's time. If it shows the campaign's value but the store
   does not, open the Overview: a sync problem is shown there and retried.

If you changed a running campaign's start or end, the usual discounts apply for a
few seconds while the change reaches Shopify; that is expected.

See [campaigns](../concepts/campaigns.md).
