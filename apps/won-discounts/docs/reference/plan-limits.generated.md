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
margin protection and moving Shopify discounts work in full on Free.

**Pro price:** 29 USD a month.
**Where:** Settings → Plan. You start and cancel Pro there.

## Free includes

- Every discount type (percentage, fixed amount, free shipping),
  automatic or with a code
- Up to 200 discounts, at most 20 active code discounts at a time
- The default combination rules
- Margin protection: one store-wide minimum margin and one ceiling for products without a cost price
- Moving Shopify discounts into Won, with Undo
- Admin in Czech or English

## Pro unlocks (available now)

| Pro capability | Area | On Free |
|---|---|---|
| Show a discount only in chosen markets | Discounts & codes | The whole discount is off on Free: without this setting it would give more than you set up. |
| Choose per discount which other discounts it stacks with | Discounts & codes | The Pro setting is left out; the rest keeps working. |
| A minimum quantity per product or collection | Discounts & codes | The whole discount is off on Free: without this setting it would give more than you set up. |
| Generated codes with your own pattern | Discounts & codes | The Pro setting is left out; the rest keeps working. |
| More than 100 generated codes in a batch | Discounts & codes | Kept within the Free limit. |
| Campaigns: start and end many discounts at once | Campaigns | The Pro setting is left out; the rest keeps working. |
| Quantity discount sets for chosen products or collections | Quantity discounts | The Pro setting is left out; the rest keeps working. |
| More than one quantity discount set | Quantity discounts | The Pro setting is left out; the rest keeps working. |
| Quantity discounts counted across the whole cart | Quantity discounts | Kept within the Free limit. |
| Up to 6 Milestones steps per market (Free: 2) | Milestones | Kept within the Free limit. |
| A choice of gifts at one step | Milestones | Kept within the Free limit. |

For Margin protection, Pro adds settings of their own for a collection and for a single product:

| Pro capability | Area | On Free |
|---|---|---|
| Margin protection settings per collection | Margin protection | Merged into the store-wide setting; the strictest value wins. |
| Margin protection settings per product | Margin protection | Merged into the store-wide setting; the strictest value wins. |

Pro also opens **Try a cart** (Settings → Tools): which discounts apply to a cart and why.

With per-discount combinations, at most **6** discounts stack on one line
(or on the order).

## Pro capabilities not available yet

These are not supported at checkout yet. They are listed so the plan comparison
is complete; none of them can be set up today.

| Pro capability | Area | On Free |
|---|---|---|
| Show a discount only to chosen customer segments | Discounts & codes | The whole discount is off on Free: without this setting it would give more than you set up. |

## What "On Free" means

Pro settings are **never erased**: they stay saved, but the server leaves them
out of what checkout runs while the shop is on Free. The admin lists each one
that is not in force. A Pro setting is always neutralised in the direction that
gives customers **less**, never more than the merchant set up.
