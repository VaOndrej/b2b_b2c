---
title: The quantity-tier discount is lower because of margin protection
slug: tier-lowered-by-margin-protection
layer: support
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [tier lowered, margin protection, quantity tiers, price floor, capped, discount smaller, foreign currency, úroveň je nižší kvůli ochraně marže]
summary: A quantity tier is a product discount, so margin protection caps it, never below the price floor. The product page never promises more than checkout; it can promise less while it catches up.
---

# The quantity-tier discount is lower because of margin protection

## Why it happened

A quantity tier is a product discount like any other, so margin protection
cuts it down to the item's price floor the same way. See
[margin-protection](../concepts/margin-protection.md) for exactly how the floor
is computed.

- **With a cost price:** the tier is capped so the price stays at or above the
  minimum margin.
- **Without a cost price:** the tier is capped at the ceiling percentage for
  products without a cost price.

This can make a higher break look smaller than expected, or, at the extreme,
give nothing extra once the item is already at its floor.

## How to tell

- [try-a-cart](../tasks/try-a-cart.md) marks the item with the margin floor and
  shows the amount before and after.
- On the product page, the live price already reflects the cap in the rule
  below.

## The rule: the product page never promises more than checkout

The product page's cap and checkout's cap are computed the same way, but not
always at the exact same instant, so the rule is **never more, sometimes
less**:

- **A market with its own currency:** the product page converts the price
  floor from the shop's currency using Shopify's own exchange rate, rounded
  against the customer, so it never shows a bigger discount than checkout
  will give. It can show a touch less.
- **A variant whose floor is not known yet** — margin protection was just
  turned on or changed, or the cost price was just added, and the floor has
  not finished recomputing: the product page shows no discount promise for
  that variant rather than a guess. It catches up once the recompute
  finishes; checkout always uses the current floor.

## What you can change

- Lower the minimum margin, or the ceiling for products without a cost price.
- Add the missing cost price in Shopify
  ([products-without-cost-price](products-without-cost-price.md)).
- With Pro, give the product's collection its own margin setting
  ([../concepts/margin-per-collection.md](../concepts/margin-per-collection.md)).

Background: [../concepts/quantity-tiers.md](../concepts/quantity-tiers.md),
[discount-lowered-by-margin-protection](discount-lowered-by-margin-protection.md).
