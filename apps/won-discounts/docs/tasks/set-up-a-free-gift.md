---
title: Set up a free gift from an amount
slug: set-up-a-free-gift
layer: task
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-08
keywords: [free gift, gift with purchase, gift threshold, gift ladder, choice of gifts, fallback gift, sold out gift, dárek zdarma, nastavit dárek, žebřík dárků]
summary: Pick a product variant as the gift and the order amount per currency; on Pro add more thresholds, a choice of up to 3 gifts and a fallback.
---

# Set up a free gift from an amount

1. Open **Discounts → Milestones**.
2. Click **Add a step**; **Free gift** is chosen under **What the customer gets**.
3. In the table **From what cart value**, enter the amount for each of your markets.
4. Click **Pick a gift** and choose the product variant from your store.
5. Optionally pick a **Fallback gift when it is sold out**.
6. Save.

## Pro

- Up to **6 steps** (Free: 2), a gift on at most 5 of them (for example a
  gift from 1 500 Kč and another from 3 000 Kč). Every step the order reaches
  gets its own gift.
- **Gift (a choice of up to 3)**: pick up to 3 variants; the customer chooses
  one in the cart.

## Notes

- The gift is a real product: it needs stock like any other item. A sold-out
  gift is not offered (the fallback is, when set).
- At checkout 1 item of the gift is always free. See
  [../concepts/cart-rewards.md](../concepts/cart-rewards.md).
- **Count the goods into the cart value only after other discounts** decides
  what happens when a code takes the order below the gift's amount; see
  [../support/discount-code-and-the-gift.md](../support/discount-code-and-the-gift.md).
- Check the result in **Try a cart**: a cart over the step's amount shows the gift
  line, free. See [try-a-cart](try-a-cart).
- The cart adds the gift only with the app embed on. See
  [add-the-cart-panel-to-the-cart-page](add-the-cart-panel-to-the-cart-page).
