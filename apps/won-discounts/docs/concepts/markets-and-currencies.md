---
title: Markets and currencies
slug: markets-and-currencies
layer: concept
feature: markets
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [currency, market, eur, czk, exchange rate, conversion, not offered, amount per currency, minimum per currency, trhy, měny]
summary: Fixed amounts and minimums have their own value in each currency and are never converted by exchange rate. A currency without a value means the discount is not offered there.
---

# Markets and currencies

## One value per currency, never converted

Every **amount** in a discount has its own value in each currency of your markets:
a fixed discount (100 CZK in Czechia, 4 EUR in Slovakia) and a minimum order amount.
Won **never converts** by exchange rate, so the number a customer sees is always
the one you set.

The currencies Won offers are the currencies of your Shopify markets. Settings lists
them.

## A currency without a value

If a discount has no value for a currency, it is **not offered** in that currency.
Won never shows a converted or foreign number instead.

- The Overview warns: the discount "isn't offered in EUR. The value is missing."
- A discount with no value in any of the shop's currencies shows "Not running".

This applies to the minimum too. A percentage discount needs no amount, but if it
has a minimum order amount, the minimum must be set for every currency; a currency
without it is not offered.

## Percentages

A percentage is taken from the price in the cart's currency, including fixed prices
set for a market in Shopify.

## Market targeting (Pro)

With Pro a discount can be limited to chosen markets. Won decides by the cart's
country. Shopify asks for permission to read your markets when you first pick one.
On Free such a discount does not apply at all, because dropping only the targeting
would open it to every market. A discount that targets only markets switched off in
Won shows "Not running".

## The one conversion: cost prices

Margin protection converts cost prices, which Shopify keeps in the shop currency,
with Shopify's exchange rate. See [cost-prices](cost-prices).

## Several shipments

A fixed shipping discount applies to the first shipment only when an order ships in
several parts.

Troubleshooting:
[../support/discount-not-offered-in-a-currency.md](../support/discount-not-offered-in-a-currency.md).
