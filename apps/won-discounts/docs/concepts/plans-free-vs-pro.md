---
title: Free vs Pro, the idea
slug: plans-free-vs-pro
layer: concept
feature: plans
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [free, pro, plan, pricing, upgrade, downgrade, difference, pro settings on free, tarif]
summary: Free limits scope, never quality. What Pro adds today, and what happens to Pro settings on a Free shop (kept, but not applied at checkout).
---

# Free vs Pro, the idea

> **Free limits scope, never quality.**

The same engine, the match between the admin and checkout, margin protection,
Try a cart and moving Shopify discounts work in full on Free. Free is not a demo.

## What Pro adds today

- **Market targeting**: a discount only in chosen markets
  ([markets-and-currencies](markets-and-currencies)).
- **Combinations per discount**: choose which discounts stack
  ([pro-combinations](pro-combinations)).
- **Margin settings per collection** and the overview of where protection steps in
  ([margin-per-collection](margin-per-collection)).
- **Quantity discount sets per product or collection** and counting across the
  whole cart ([quantity-tiers](quantity-tiers)).
- **A ladder of gift thresholds and a choice of up to 3 gifts** in Cart rewards
  ([cart-rewards](cart-rewards)).

Later versions add Pro modules such as Clearance and Campaigns.

Pro is a flat monthly price with no limit on orders. Pro subscriptions are not on sale
yet; until they are, every shop runs on Free. Price and the full comparison:
[reference/plan-limits](../reference/plan-limits.generated.md).

## Pro settings on a Free shop

Pro settings are **never erased**. They stay saved, but checkout does not run them
while the shop is on Free, and the admin lists each one that is not in force. They
are always neutralised in the direction that gives customers less:

- A discount limited to chosen markets **does not apply at all**. Dropping only the
  market limit would open it to everyone.
- Per-discount combinations are left out; the default combining rules apply.
- Collection margin settings are merged into the store-wide setting; the strictest
  value wins.
- Quantity discount sets for chosen products or collections are switched off; a
  product in one never falls back to the store-wide set.
- Of the gift thresholds only the first applies, with its first gift.

The plan is checked on the server. Checkout never receives Pro settings the shop's
plan does not include.
