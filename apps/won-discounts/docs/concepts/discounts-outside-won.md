---
title: Discounts outside Won
slug: discounts-outside-won
layer: concept
feature: native-discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [shopify discount, native discount, outside won, other app, clash, conflict, move, not movable, bxgy, slevy mimo Won]
summary: Discounts created in Shopify or by other apps run outside Won's engine. Why that matters, what the Overview shows, and which of them can be moved into Won.
---

# Discounts outside Won

A discount created in Shopify's own Discounts page, or by another app, runs
**outside Won**. Won's engine does not count it.

## Why it matters

- Won cannot promise what the customer pays when another discount also applies.
- **Margin protection does not guard it.** A discount outside Won can still take a
  price below your floor.
- Shopify combines a discount outside Won with a Won discount only when both allow
  it. Won discounts allow combining with everything, so the other discount's own
  combination setting decides.

## What the Overview shows

The Overview lists every live discount outside Won:

- **Movable** ones, with a Move button (and Move all).
- **Not movable** ones, each with the reason.
- **Clashes with Won**: the same code on a Shopify discount and a Won discount (the
  Won discount cannot go live until one of them changes), the same products, the same
  collections, two order discounts or two shipping discounts.

## What can be moved

Basic discounts (percentage or amount off products, collections or the order) and
free shipping, while active or scheduled.

## What stays in Shopify

- Buy X get Y (Won has no Buy X get Y; [quantity discounts](quantity-tiers.md) cover "buy more, pay less").
- Discounts calculated by another app.
- Discounts limited to specific customers or segments.
- Discounts for subscriptions only.
- A fixed amount taken once per order from selected products, or from each item of
  the whole order.
- Free shipping limited to some countries or with a maximum shipping price.
- Discounts with more products, collections or codes than a Won discount holds.
- Ended discounts and discounts whose usage limit is used up (nothing to move).

What moving does and what it loses:
[moving-native-discounts](moving-native-discounts). Steps:
[../tasks/move-native-discounts.md](../tasks/move-native-discounts.md).
