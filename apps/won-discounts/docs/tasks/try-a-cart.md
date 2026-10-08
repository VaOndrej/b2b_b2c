---
title: Try a cart
slug: try-a-cart
layer: task
feature: try-cart
min_plan: pro
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-10-08
keywords: [try a cart, common combinations, combination check, warnings, test discount, preview, simulate, check code, what applies, why, checkout may differ, vyzkoušet košík, časté kombinace]
summary: The app checks the common combinations of your discounts by itself and warns ahead; on Pro you also build your own test cart and see which discounts apply at checkout and why. Nothing is ordered.
---

# Try a cart

Try a cart runs the same engine as checkout. Nothing is ordered.

## Common combinations

At the top the app lists the carts it built itself from the discounts that run: the quantity discount alone, with
a code, with an order discount, with free shipping, with a gift or a discount step of Milestones, a sale variant
with the rest, a campaign on its first day, and the ladder in every market with its own amounts. Each is marked
**Fine** or **Warning**. The home page shows how many have a warning.

A warning says what will go otherwise than you set up, with a link to the setting behind it:

- margin protection lowered a discount or took it away;
- the discounts together passed the highest discount you allow;
- a discount does not apply because it does not combine with another;
- a code takes the cart under a gift's amount;
- a discount step of Milestones lost to a higher step, another order discount or a code;
- checkout shortens the discounts (too many for one cart).

The carts use your own products: the one with the lowest margin, one with its own tiers, one on sale. They are a
calculation from the prices and purchase costs the app has stored, not a real order. Prices in another currency
are an estimate from your own amounts.

Every plan sees the number of warnings. Which combinations and why, and **Open in the cart**, are on Pro.

## Your own cart (Pro)

1. Open **Settings → Tools → Try a cart** (or **Try it in a cart** from a discount).
2. **Add products** and set quantities.
3. Pick the **Market & currency**. Prices come from Shopify for that market; a
   product without a price in that currency cannot be calculated.
4. Optional: tick the **discounts with a code** the customer would enter. The list
   holds your Won discounts; the app fills in the code. Automatic discounts are
   listed as applying on their own. A discount that cannot apply for the chosen
   market or day is greyed out with the reason.
5. Optional: **When**. "Now", or "Custom date and time" in the shop's time zone, to
   check a scheduled discount or a campaign at an exact minute; a campaign's
   **Try a cart during the campaign** fills both in.
6. **Calculate**.

## Reading the result

- **What applies**: the discount per item, the order discount and the total the
  customer pays.
- Each discount and code has a sentence saying why it applies or not ("needs 1 more
  item", "another discount is better", "not valid in EUR").
- Items at the margin floor are marked, with the discount before and after.
- Milestones: free shipping and how much is left to it and to the gift. A
  reached gift threshold adds the gift line, tagged **Gift**, exactly as the cart
  on your store would; it is free. With a choice of gifts (Pro) the first one
  offered is shown. See [../concepts/cart-rewards.md](../concepts/cart-rewards.md).

## "Checkout may differ"

This box appears when checkout will not match the plan exactly, for example:

- the saved settings are not in Shopify yet, or the last sync failed;
- product targeting is being refreshed after a collection change;
- a percentage lands exactly on half a cent (Shopify may round 1 cent the other way);
- a fixed shipping discount with several shipments (first shipment only);
- very many discounts in one cart hit Shopify's output limit (the amounts shown are
  then what checkout really takes off).

Background: [../concepts/how-won-plans-discounts.md](../concepts/how-won-plans-discounts.md).
