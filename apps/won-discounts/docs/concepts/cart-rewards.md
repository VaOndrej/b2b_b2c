---
title: Milestones
slug: cart-rewards
layer: concept
feature: rewards
min_plan: free
status: beta
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-10-08
keywords: [milestones, cart rewards, free shipping, free gift, gift with purchase, order discount from an amount, spend x get y, ladder, steps, progress bar, no thanks, milníky, odměny, doprava zdarma, dárek zdarma, sleva od částky]
summary: One ladder of steps by cart value. Each step has an amount per market and one reward - a free gift, free shipping or a discount off the whole order. The store shows the ladder; checkout gives the rewards.
---

# Milestones

**Milestones** (in the admin's navigation under Discounts; it was called "Cart
rewards") are Won's "spend X, get Y" as **one ladder of steps**. A step is a
cart value and one reward:

- a **free gift** (a product variant from your store; on Pro a choice of up to 3),
- **free shipping** (one step at most),
- a **discount off the whole order** (a percent or an amount).

Rewards you set up before Milestones (free shipping, gifts) are the same
settings: they show as steps, nothing has to be set again.

## The cart value

Every step counts the same thing: the **price of the items in the cart before
any discount**, in the cart's currency. A gift never counts. A clearance item
counts at the price the customer pays for it.

A step has its own amount **for each market** (for example 1 000 Kč in Czechia,
40 € in Slovakia, 45 € in Germany), never converted by exchange rate. The page
shows them as a table: a row is a step, a column is a market. **Suggest the
other markets** fills the empty cells from the exchange rate you set by hand
for the market in Shopify; nothing is saved until you save the page, and a
market without such a rate says so. A market left empty does not get the step:
the admin says which market that is, see
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
order reaches the step, the cart on your store adds it as its own line
(with the line property `_won_gift`) and offers **No thanks**. At checkout
**1 item of the gift is always free**; a second item of it is paid. Checkout is
never blocked because of a gift.

- **No thanks**: the gift leaves the cart and does not come back in that cart,
  even when more is added. Removing the gift by hand counts the same way.
- **Below the step again** (the customer removes items): the cart removes
  the gift. A gift line still in the cart below the step is paid at
  checkout, never free. See
  [../support/gift-charged-at-checkout.md](../support/gift-charged-at-checkout.md).
- **Sold out**: a gift that is out of stock is not offered and the cart says so.
  You can set a **fallback gift** for that case.
- The gift line never gets any other discount, and margin protection does not
  apply to it.

## A discount off the order

A discount step gives a percent or an amount off the whole order once the cart
reaches its value. It differs from a gift in four ways, and the page says so at
the step:

- it is taken from the goods **after product discounts**, and never from items
  on clearance (those still count toward the cart value);
- of two discount steps the cart has reached, **only the higher one applies**,
  never both;
- when the customer enters a code with a larger order discount, the code
  applies instead (the better one for the customer wins, never a sum);
- **margin protection may lower it**, as it lowers any order discount.

A discount as an amount needs that amount for each market, like the cart value.

## Codes and the gift

The cart on your store has a discount-code field. By default the cart value is
counted **before** discounts, so a code never costs the customer the gift.

With **Count the goods into the cart value only after other discounts** on (one
setting for the whole ladder), the cart compares the gift's amount with the
order after discounts: when a code takes the order below it, the cart warns the
customer first and lets them choose — keep the code without the gift, or remove
the code. A code entered only at checkout keeps the gift (the cart cannot warn
there), which is why the cart offers its own code field. See
[../support/discount-code-and-the-gift.md](../support/discount-code-and-the-gift.md).

## Where the store shows the ladder

One ladder in three sizes, in four places:

| Place | Size | How it gets there |
|---|---|---|
| Top strip of the store | one sentence and a thin track | a switch in the Won app embed's settings |
| Product page (or any page) | a track with a mark per step and the sentence about the next one | the **Milestones** block |
| Cart drawer | the same compact ladder, the gift, the code field | by itself while the app embed is on |
| Cart page | every step with its reward, the reached ones ticked | the **Milestones and code** block |

**Milestones → Milestones in the store** lists the four places, says for each
whether it is in your live theme, and has the button that adds it. Every place
follows the cart without a page load.

The cart panel also shows **No thanks** or the choice of gifts (Pro),
**You save X**, and a tip such as "Add 1 more Mug to get −10 %" when a few more
items reach a quantity discount (computed by the same engine checkout uses,
never a guess). See
[../tasks/add-the-cart-panel-to-the-cart-page.md](../tasks/add-the-cart-panel-to-the-cart-page.md).

The cart only changes the cart when the customer does something (adds an item,
clicks a button); opening a page never changes it.

## Free and Pro

| | Free | Pro |
|---|---|---|
| Steps | 2 | 6 |
| Kinds of reward | Gift, free shipping, order discount | Same |
| Gifts per step | 1 | A choice of up to 3 |
| Fallback gift | Yes | Yes |

A gift can be on at most 5 steps. After a downgrade every step stays saved and
visible; only the first 2 of the ladder (the lowest cart values) apply, and the
page marks the others — remove them, or keep them for Pro. See
[plans-free-vs-pro](plans-free-vs-pro).

## Check it before customers do

**Try a cart** shows free shipping, the gift and the order discount for a cart
you build: a reached gift step adds the gift line exactly as the cart on your
store would, free at checkout. See [../tasks/try-a-cart.md](../tasks/try-a-cart.md).
