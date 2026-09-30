---
title: The discount is lower because of margin protection
slug: discount-lowered-by-margin-protection
layer: support
feature: margin
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [discount lower, discount reduced, margin floor, margin protection, capped, less than set, order discount smaller, sleva je nižší]
summary: How to tell that margin protection lowered a discount, why it did, and what to change if the result is not what you want.
---

# The discount is lower because of margin protection

## How to tell

- [Try a cart](../tasks/try-a-cart.md) marks the item with the margin floor and says
  "The discount on an item is lowered from … to …".
- The discount editor notes that protection lowers the discount.
- With Pro, **Where protection steps in** lists each discount and variant, and by how
  much.

## Why it happened

Margin protection is on and the full discount would take the item below its lowest
allowed price:

- **With a cost price**: the price after discounts must keep your minimum margin,
  measured like Shopify's product margin, from the price the customer pays (tax
  included for tax-inclusive prices).
- **Without a cost price**: the discount is capped at the ceiling percentage.

A product discount is cut to that floor. An order discount is lowered, or leaves out
the items already at their floor. Checkout still goes through; protection never
blocks.

## What you can change

- Lower the **minimum margin**, or the ceiling for products without a cost price.
- Add missing **cost prices** in Shopify: a product with a real cost price is limited
  by its margin, not by the ceiling
  ([products-without-cost-price](products-without-cost-price)).
- With Pro, give a collection its own values
  ([../concepts/margin-per-collection.md](../concepts/margin-per-collection.md)).
- Or turn protection off. Then Won discounts apply in full.

Protection does not touch shipping discounts or discounts outside Won. Background:
[../concepts/margin-protection.md](../concepts/margin-protection.md).
