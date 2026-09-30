---
title: A discount outside Won
slug: discount-outside-won
layer: support
feature: native-discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [discount outside won, shopify discount, other app discount, engine does not count, clash, code already used, cannot move, sleva mimo Won]
summary: What the "discounts outside Won" warning means, why it matters for checkout and margin protection, and what to do with each such discount.
---

# A discount outside Won

## What the warning means

The Overview found a live discount that does not run through Won: one created in
Shopify's Discounts page or by another app. Won's engine does not count it.

## Why it matters

- Checkout may give a different total than Won shows, because that discount can add
  to Won's or block it.
- Margin protection does not guard it.
- If it uses the same code as a Won discount, the Won discount cannot go live:
  Shopify allows a code on one discount only.

## What to do

- **Movable**: click **Move**. The dialog says what is lost (for example the usage
  count). Steps: [../tasks/move-native-discounts.md](../tasks/move-native-discounts.md).
- **Not movable**: the Overview says why (for example Buy X get Y, another app's
  discount, a discount for specific customers). Keep it in Shopify knowing Won does
  not count it, or end it in Shopify if Won's discounts replace it.
- **Clash on a code**: move the Shopify discount into Won, or change the code of the
  Won discount.

## After uninstalling

Discounts moved into Won stop working when the app is uninstalled. Undo the moves
first ([../tasks/undo-a-move.md](../tasks/undo-a-move.md)).

Background: [../concepts/discounts-outside-won.md](../concepts/discounts-outside-won.md).
