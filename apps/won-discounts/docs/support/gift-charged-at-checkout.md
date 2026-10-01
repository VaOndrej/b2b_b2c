---
title: The gift is charged at checkout
slug: gift-charged-at-checkout
layer: support
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [gift charged, gift not free, paid gift, gift price at checkout, second gift item, dárek se platí, dárek není zdarma]
summary: Why a gift line is paid at checkout, in the order to check, from the order being below the threshold to a second item of the gift.
---

# The gift is charged at checkout

Checkout makes **1 item** of a gift free when the order reaches the gift's
threshold. Check in this order:

## 1. The order is below the threshold

The threshold counts the items before discounts, without the gift. When the
customer removed items, the cart on your store removes the gift; a gift line
left in the cart below the threshold is paid. **Try a cart** with the same
items shows how much is missing.

## 2. More than one item of the gift

Only 1 item is free. A quantity of 2 on the gift line, or the same gift added a
second time, is paid for the extra items.

## 3. The line is not the gift Won offers

Only the variants you picked for that threshold (or its fallback) are free,
and only on the line the cart added as the gift. The same product added to the
cart the usual way is an ordinary item. A gift you changed in the admin after
the customer added the old one is paid; the customer can remove it.

## 4. No threshold in the cart's currency

A market whose currency has no gift threshold gets no gift. See
[free-shipping-missing-in-a-market](free-shipping-missing-in-a-market).

## 5. The change is not synced yet

A threshold or gift just saved can take a short moment to reach checkout.
Check the Overview for a sync error. See
[../concepts/saving-and-syncing.md](../concepts/saving-and-syncing.md).

More: [../concepts/cart-rewards.md](../concepts/cart-rewards.md).
