---
title: Margin protection
slug: margin-protection
layer: concept
feature: margin
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [margin, margin protection, minimum margin, floor, cost price, never blocks, lowered discount, vat, tax, ochrana marže, minimální marže]
summary: Margin protection lowers a Won discount so no item goes below a price floor. Margin is Shopify's product margin from the price the customer pays; it never blocks checkout.
---

# Margin protection

Margin protection makes sure **no Won discount takes an item below a price floor**
you set. It is off until you turn it on in **Margin protection**.

## How margin is measured

Exactly like Shopify shows a product's margin:

> margin = (price after discounts − cost price) ÷ price after discounts

The price is the one the customer pays. For tax-inclusive prices that price includes
VAT, so the protected margin is measured on the gross price.

From your **minimum margin** Won derives each item's lowest price:
cost price ÷ (1 − minimum margin). With the minimum margin empty, the floor is the
cost price itself: never below cost.

Products without a cost price get a simpler rule: their discount is at most a set
percentage. See [cost-prices](cost-prices).

## What it does

- It **never blocks** an order. It only lowers a discount so the price does not go
  below the floor.
- A **product discount** is cut down to the floor. If the item is already at the
  floor, that discount gives nothing on it.
- An **order discount** is lowered, or leaves out the items that are already at
  their floor, whichever saves the customer more.
- **Shipping discounts** are not affected.
- It runs **last**, after the combining rules, so it also caps Pro stacks.

## What it does not guard

Only discounts that run through Won. A discount created in Shopify or by another
app is not seen and can still go below the floor. See
[discounts-outside-won](discounts-outside-won).

## Where you see its effect

- In the discount editor: a note when protection lowers that discount (with Pro,
  on how many variants).
- In **Try a cart**: the items marked with the margin floor, with the amount before
  and after.
- With Pro: **Where protection steps in**, per discount and variant. See
  [margin-per-collection](margin-per-collection).

## Free and Pro

Free has one store-wide minimum margin and one ceiling for products without a cost
price. Pro adds settings per collection and the overview of where protection steps
in.

Values, defaults and a worked example:
[reference/margin-settings](../reference/margin-settings.generated.md). How to turn it
on: [../tasks/turn-on-margin-protection.md](../tasks/turn-on-margin-protection.md).
