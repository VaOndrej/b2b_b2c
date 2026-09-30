---
title: Turn on margin protection
slug: turn-on-margin-protection
layer: task
feature: margin
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [turn on margin protection, minimum margin, cost price, ceiling, set up margin, zapnout ochranu marže]
summary: Switch margin protection on, set the minimum margin and the ceiling for products without a cost price, and check where it lowers discounts.
---

# Turn on margin protection

1. Open **Margin protection** and **Turn on margin protection**.
2. **Minimum margin**: the margin a discounted item must keep, measured like
   Shopify's product margin. Leave it empty to only never go below the cost price.
3. **Products without a cost price: discount at most**: the ceiling for products with
   no cost price in Shopify.
4. Save.

## After saving

- Won reads the cost prices from Shopify in the background and shows the progress.
  Until a product's cost price is read, the ceiling protects it.
- The **Cost prices** part shows how many products have no cost price. Add them in
  Shopify on the product, in the variant's pricing; Won picks them up by itself.

## Check the effect

- The discount editor notes when protection lowers that discount.
- [try-a-cart](try-a-cart) marks items at the margin floor, with the discount before
  and after.
- With Pro, **Where protection steps in** lists every discount and variant it
  lowers, and **Settings per collection** sets other values for chosen collections
  ([../concepts/margin-per-collection.md](../concepts/margin-per-collection.md)).

Protection never blocks an order and guards only Won discounts. Background:
[../concepts/margin-protection.md](../concepts/margin-protection.md). Values and
defaults: [../reference/margin-settings.generated.md](../reference/margin-settings.generated.md).
