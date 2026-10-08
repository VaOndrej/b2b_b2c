---
title: A discount code and the gift
slug: discount-code-and-the-gift
layer: support
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-08
keywords: [code removes gift, lose the gift, code below threshold, keep the code, remove the code, count other discounts, kód a dárek, přijdu o dárek]
summary: What happens to the gift when a discount code takes the order below the threshold, with and without counting other discounts.
---

# A discount code and the gift

It depends on **Count the goods into the cart value only after other discounts** in
**Milestones**:

## Off (the default)

The threshold is the price of the items before discounts. A code never takes
the gift away; the customer gets both.

## On

The threshold counts after discounts in the cart. When the customer enters a
code in the cart's code field and the order drops below the threshold, the
cart warns first and lets them choose:

- **Keep the code (no gift)** — the gift leaves the cart;
- **Remove the code** — the code is removed and the gift stays.

A code entered **only at checkout** keeps the gift: checkout never takes away
a gift the cart already added. That is why the cart has its own code field.

## The code itself does not apply

The cart says "Code X does not apply to this cart." The code may be for other
products, may have ended, or may not combine with the cart's discounts. See
[code-not-applied](code-not-applied).

More: [../concepts/cart-rewards.md](../concepts/cart-rewards.md).
