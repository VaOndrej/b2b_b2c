---
title: Cart rewards
slug: cart-rewards
layer: concept
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [cart rewards, free shipping, free gift, gift with purchase, spend x get y, threshold, gift ladder, progress bar, no thanks, odměny, doprava zdarma, dárek zdarma, práh]
summary: Free shipping and a free gift from an order amount per currency. The cart on your store shows the progress and adds the gift; checkout always makes the gift free.
---

# Cart rewards

**Cart rewards** ("Cart rewards" in the admin's navigation) are Won's
"spend X, get Y": **free shipping** from an order amount, and a **free gift**
from an order amount. Each amount is set **per currency** of your markets.

## The threshold

Every reward counts the same amount: the **price of the items in the cart
before any discount**, in the cart's currency. The gift itself never counts.
A clearance item counts at the price the customer pays for it.

A reward has its own amount in each currency (for example 1 000 Kč in Czechia,
40 € in Slovakia), never converted by exchange rate. A currency without an
amount does not get the reward: the admin says which market that is, see
[../support/free-shipping-missing-in-a-market.md](../support/free-shipping-missing-in-a-market.md)
and [markets-and-currencies](markets-and-currencies).

## Free shipping

From the amount, checkout gives the shipping for free (100 % off every
delivery option). It adds up with product and order discounts according to
the combination switches in Settings; when a switch says shipping does not
combine, free shipping is not given next to that discount. See
[combining-discounts](combining-discounts).

## The free gift

The gift is a **real product variant from your stock**, not a coupon. When the
order reaches the threshold, the cart on your store adds it as its own line
(with the line property `_won_gift`) and offers **No thanks**. At checkout
**1 item of the gift is always free**; a second item of it is paid. Checkout is
never blocked because of a gift.

- **No thanks**: the gift leaves the cart and does not come back in that cart,
  even when more is added. Removing the gift by hand counts the same way.
- **Below the threshold again** (the customer removes items): the cart removes
  the gift. A gift line still in the cart below the threshold is paid at
  checkout, never free. See
  [../support/gift-charged-at-checkout.md](../support/gift-charged-at-checkout.md).
- **Sold out**: a gift that is out of stock is not offered and the cart says so.
  You can set a **fallback gift** for that case.
- The gift line never gets any other discount, and margin protection does not
  apply to it.

## Codes and the gift

The cart on your store has a discount-code field. By default the threshold is
counted **before** discounts, so a code never costs the customer the gift.

With **Count other discounts toward the gift threshold** on, the threshold is
counted after discounts in the cart: when a code takes the order below it, the
cart warns the customer first and lets them choose — keep the code without the
gift, or remove the code. A code entered only at checkout keeps the gift (the
cart cannot warn there), which is why the cart offers its own code field. See
[../support/discount-code-and-the-gift.md](../support/discount-code-and-the-gift.md).

## What the cart shows

With the app embed on, the cart drawer shows by itself:

- how much is left to free shipping and to the next gift, with a progress bar;
- the gift, **No thanks**, or the choice of gifts (Pro);
- the discount-code field;
- **You save X** — the difference between the price before and after discounts;
- a tip such as "Add 1 more Mug to get −10 %" when a few more items reach a
  quantity discount (computed by the same engine checkout uses, never a guess;
  when it cannot be computed, no tip is shown).

On the cart page you place the same panel with the **Rewards and code** block;
without the block the panel goes to the top of the cart summary. See
[../tasks/add-the-cart-panel-to-the-cart-page.md](../tasks/add-the-cart-panel-to-the-cart-page.md).

The cart only changes the cart when the customer does something (adds an item,
clicks a button); opening a page never changes it.

## Free and Pro

| | Free | Pro |
|---|---|---|
| Free shipping | From one amount per currency | Same |
| Gift thresholds | 1 | A ladder of up to 10 |
| Gifts per threshold | 1 | A choice of up to 3 |
| Fallback gift | Yes | Yes |

After a downgrade, the further thresholds and choices stay saved but only the
first threshold with its first gift applies. See
[plans-free-vs-pro](plans-free-vs-pro).

## Check it before customers do

**Try a cart** shows free shipping and the gift for a cart you build: a reached
threshold adds the gift line exactly as the cart on your store would, free at
checkout. See [../tasks/try-a-cart.md](../tasks/try-a-cart.md).
