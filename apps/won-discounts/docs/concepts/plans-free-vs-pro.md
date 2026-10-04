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
updated: 2026-10-04
keywords: [free, pro, plan, pricing, 29 usd, trial, upgrade, downgrade, difference, pro settings on free, tarif]
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

Clearance (Pro) sells a number of pieces of a variant at a discount, see [clearance](clearance). Campaigns (Pro) change your discounts for a time window, see [campaigns](campaigns); a campaign running when the store moves to Free finishes.

Pro is a flat **29 USD a month** with no limit on orders, with a **14-day free trial**
and no yearly plan. You start it, and cancel it, on the **Plan** page; the charge
goes through Shopify (see [start-the-pro-trial](../tasks/start-the-pro-trial.md),
[billing-and-downgrade](billing-and-downgrade)). Reports per discount and a custom
look of the storefront blocks are Pro too. The full comparison:
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
