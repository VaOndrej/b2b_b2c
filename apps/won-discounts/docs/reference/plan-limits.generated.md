---
title: Free vs Pro plans
slug: plan-limits
layer: reference
feature: plans
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [free, pro, plan, pricing, limits, upgrade, downgrade, tarif]
summary: What the Free plan includes, which Won Discounts features need Pro, and what happens to Pro settings on Free.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Free vs Pro plans

Free limits **scope, never quality**: the same engine, checkout consistency,
margin protection, Try a cart and moving Shopify discounts work in full on Free.

**Pro price:** 29 USD a month.
**Availability:** Pro subscriptions start in a later version. Until then you have everything in Free.

## Free includes

- Every discount type (percentage, fixed amount, free shipping),
  automatic or with a code
- Up to 200 discounts, at most 20 active code discounts at a time
- The default combination rules
- Try a cart: which discounts apply to a cart and why
- Margin protection: one store-wide minimum margin and one ceiling for products without a cost price
- Moving Shopify discounts into Won, with Undo
- Admin in Czech or English

## Pro unlocks (available now)

| Pro capability | Area | On Free |
|---|---|---|
| Show a discount only in chosen markets | Discounts & codes | The whole discount does not apply on Free (removing only its targeting would widen it to everyone). |
| Choose per discount which other discounts it stacks with | Discounts & codes | The Pro setting is left out; the rest keeps working. |
| Quantity discount sets for chosen products or collections | Quantity discounts | The Pro setting is left out; the rest keeps working. |
| More than one quantity discount set | Quantity discounts | The Pro setting is left out; the rest keeps working. |
| Quantity discounts counted across the whole cart | Quantity discounts | Kept within the Free limit. |
| A ladder of several gift thresholds | Cart rewards | Kept within the Free limit. |
| A choice of gifts at one threshold | Cart rewards | Kept within the Free limit. |
| Margin protection settings per collection | Margin protection | Merged into the store-wide setting; the strictest value wins. |

With per-discount combinations, at most **6** discounts stack on one line
(or on the order).

## Pro capabilities of modules not built yet

These belong to planned modules or are not supported at checkout yet. They are
listed so the plan comparison is complete; none of them can be set up today.

| Pro capability | Area | On Free |
|---|---|---|
| Show a discount only to chosen customer segments | Discounts & codes | The whole discount does not apply on Free (removing only its targeting would widen it to everyone). |
| Campaigns: start and end many discounts at once (e.g. Black Friday) | Campaigns | The Pro setting is left out; the rest keeps working. |

## Planned modules

- **Clearance** (Pro): Sell N units at a discount, then back to full price.
- **Campaigns** (Pro): Black Friday and other campaigns. Start and end every discount at once.

## What "On Free" means

Pro settings are **never erased**: they stay saved, but the server leaves them
out of what checkout runs while the shop is on Free. The admin lists each one
that is not in force. A Pro setting is always neutralised in the direction that
gives customers **less**, never more than the merchant set up.
