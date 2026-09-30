---
title: Try a cart
slug: try-a-cart
layer: task
feature: try-cart
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [try a cart, test discount, preview, simulate, check code, what applies, why, checkout may differ, vyzkoušet košík]
summary: Build a test cart with products, a market, codes and a day, and see which Won discounts apply at checkout and why. Nothing is ordered.
---

# Try a cart

Try a cart runs the same engine as checkout on real Shopify prices. Nothing is
ordered.

1. Open **Try a cart** (or **Try it in a cart** from a discount).
2. **Add products** and set quantities.
3. Pick the **Market & currency**. Prices come from Shopify for that market; a
   product without a price in that currency cannot be calculated.
4. Optional: **Codes**, several separated by commas. Codes of discounts outside Won
   are recognised but not counted.
5. Optional: **Date**, a day in the shop's time zone, to check a scheduled discount.
6. **Calculate**.

## Reading the result

- **What applies**: the discount per item, the order discount and the total the
  customer pays.
- Each discount and code has a sentence saying why it applies or not ("needs 1 more
  item", "another discount is better", "not valid in EUR").
- Items at the margin floor are marked, with the discount before and after.

## "Checkout may differ"

This box appears when checkout will not match the plan exactly, for example:

- the saved settings are not in Shopify yet, or the last sync failed;
- product targeting is being refreshed after a collection change;
- a percentage lands exactly on half a cent (Shopify may round 1 cent the other way);
- a fixed shipping discount with several shipments (first shipment only);
- very many discounts in one cart hit Shopify's output limit (the amounts shown are
  then what checkout really takes off).

Background: [../concepts/how-won-plans-discounts.md](../concepts/how-won-plans-discounts.md).
