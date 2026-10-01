---
title: The gift is not added to the cart
slug: gift-not-added-to-the-cart
layer: support
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [gift not added, no gift in cart, gift missing, gift sold out, declined gift, no thanks, dárek se nepřidal, dárek chybí]
summary: Why the cart does not add the gift, in the order to check, from the app embed being off to the customer having declined it.
---

# The gift is not added to the cart

Check in this order:

## 1. The app embed is off

The gift is added by the cart on your store, which needs the app embed.
**Cart rewards** shows its state; **Turn on in theme** fixes it. See
[../tasks/add-the-cart-panel-to-the-cart-page.md](../tasks/add-the-cart-panel-to-the-cart-page.md).

## 2. The customer declined it

After **No thanks** (or removing the gift by hand) the gift does not come back
in that cart, even when more is added. A new cart offers it again.

## 3. The customer has to choose

With a choice of gifts (Pro), the cart asks the customer which one; nothing is
added until they pick.

## 4. The gift is sold out

A sold-out gift is not offered and the cart says so. Restock it, or set a
**Fallback gift when it is sold out** for the threshold.

## 5. The order is below the threshold, or the currency has none

The threshold counts the items before discounts, without the gift, in the
cart's currency. See
[free-shipping-missing-in-a-market](free-shipping-missing-in-a-market).

## 6. The cart has not refreshed yet

The cart adds the gift after the customer changes the cart (adds an item,
changes a quantity) — never just by opening a page. Some themes refresh the
cart drawer only after a reload.

More: [../concepts/cart-rewards.md](../concepts/cart-rewards.md).
