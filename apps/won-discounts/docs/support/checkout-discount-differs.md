---
title: The discount at checkout differs from what I expected
slug: checkout-discount-differs
layer: support
feature: engine
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [checkout, wrong discount, different, expected, lower, higher, missing, not applied, rounding, sync, sleva v pokladně]
summary: Why checkout gives a different discount than expected, in the order to check, and how to reproduce it in Try a cart.
---

# The discount at checkout differs from what I expected

**First reproduce it** in [Try a cart](../tasks/try-a-cart.md) with the same products,
market, codes and day. Try a cart runs the same engine as checkout and explains each
discount. Then check, in this order:

## 1. The change is not in Shopify yet

Saved is not the same as live. While a discount is "Not synced" (or the last sync
failed), checkout runs the previous state. Open the Overview and **Sync again**. See
[../concepts/saving-and-syncing.md](../concepts/saving-and-syncing.md).

## 2. A collection changed a moment ago

A product just added to or removed from a collection reaches checkout within
minutes. **Refresh targeting** on the Overview does it now.

## 3. A discount outside Won applies too

A Shopify discount or another app's discount can add to Won's, or block it if it does
not combine. Won does not see it. Check **Discounts outside Won** on the Overview.
See [../concepts/discounts-outside-won.md](../concepts/discounts-outside-won.md).

## 4. The combining rules

Two product discounts on the same item do not add up; the better one wins. The order
discount is taken from the subtotal after product discounts. See
[../concepts/combining-discounts.md](../concepts/combining-discounts.md).

## 5. Margin protection lowered it

See [discount-lowered-by-margin-protection](discount-lowered-by-margin-protection).

## 6. Currency, market or dates

- No value in the cart's currency: the discount is not offered there
  ([discount-not-offered-in-a-currency](discount-not-offered-in-a-currency)).
- Dates are whole days in the shop's time zone, and the end day is included.

## 7. Small, known differences

- A percentage that lands exactly on half a cent: Shopify may round 1 cent the other
  way.
- A fixed shipping discount when an order ships in several parts applies to the first
  shipment only.
- A cart with very many discounts can hit Shopify's output size limit; checkout then
  gives slightly less. Try a cart shows the exact amount.

## 8. A Pro setting on a Free shop

Pro settings stay saved but checkout does not run them on Free. The Overview lists
them. See [../concepts/plans-free-vs-pro.md](../concepts/plans-free-vs-pro.md).
