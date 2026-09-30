---
title: A discount code did not apply
slug: code-not-applied
layer: support
feature: discounts
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [code not working, code not applied, coupon, invalid code, not applicable, minimum, better discount, usage limit, kód se neuplatnil]
summary: The reasons a Won discount code gives nothing or is shown as not applicable, and how to find which one applies to a given cart.
---

# A discount code did not apply

Enter the code in [Try a cart](../tasks/try-a-cart.md) with the customer's products,
market and day. It says for each code why it applies or not. The usual reasons:

## The code is not live

- The code discount is switched off, has no code yet, or is not in Shopify yet
  (status "Not synced"). See
  [../reference/discount-statuses.generated.md](../reference/discount-statuses.generated.md).
- It has not started yet, or has ended. Dates are whole days in the shop's time zone.
- The code belongs to a discount **outside Won**: Won does not count it
  ([discount-outside-won](discount-outside-won)).

## The cart does not qualify

- **Minimum not met**: an amount or a number of items. Check whether the minimum
  counts the whole cart or only the selected products.
- **Not for these products**: the code targets other products or collections.
- **Not valid in this currency**: the discount has no value for the cart's currency
  ([discount-not-offered-in-a-currency](discount-not-offered-in-a-currency)).
- **Not valid in this market** (Pro market targeting).

## Another discount wins

- **A better discount** already applies to the same items. Two product discounts do
  not add up, so the code gives nothing and Shopify shows it as not applicable
  ([../concepts/combining-discounts.md](../concepts/combining-discounts.md)).
- **Two codes of the same discount**: only one of them applies.
- **Margin protection**: the items are already at their lowest allowed price, so the
  code saves nothing there
  ([discount-lowered-by-margin-protection](discount-lowered-by-margin-protection)).
- **Pro stack with two codes**: Shopify shows one code as not applicable, but its
  value is included in the other ([../concepts/pro-combinations.md](../concepts/pro-combinations.md)).

## Shopify's own limits

The code's total usage limit is used up, or a once-per-customer code was already used
by this customer. Shopify counts and enforces these.
