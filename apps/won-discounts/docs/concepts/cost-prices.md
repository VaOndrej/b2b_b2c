---
title: Cost prices in margin protection
slug: cost-prices
layer: concept
feature: margin
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [cost price, cost per item, unit cost, no cost price, ceiling, max discount, reading cost prices, currency, exchange rate, nákupní cena]
summary: Where margin protection gets cost prices, the percentage ceiling for products without one (also used while costs load), and how other currencies are handled.
---

# Cost prices in margin protection

## Where cost prices come from

Won reads the **cost per item** of each variant from Shopify. You do not enter cost
prices in Won; add or change them in Shopify on the product, in the variant's
pricing. Won reads them only while margin protection is on.

- After you turn protection on and save, Won reads all cost prices in the background
  and shows the progress.
- When you change a cost price in Shopify, checkout knows within minutes. Once a day
  all of them are checked as well. **Refresh cost prices** reads them now.

## Products without a cost price

A product without a cost price has no margin to protect, so Won caps its discount at
a percentage instead: **"Products without a cost price: discount at most"**. The
Margin protection page shows how many products have no cost price and lists them.

The same ceiling applies while cost prices are still being read: until a product's
cost price is read, the ceiling protects it.

The ceiling is not the same as a cost floor. A product whose cost is 70 % of its
price still gets the full ceiling, which can be below its cost. Adding cost prices
gives real protection.

## Other currencies

Cost prices are in the shop currency. For a cart in another currency, checkout
converts the cost price with Shopify's current exchange rate. Try a cart has to
estimate that rate from market prices and says so. When a cost price cannot be
converted, the product is treated as having no cost price and the ceiling applies.
This is the only conversion Won makes; discount amounts are never converted (see
[markets-and-currencies](markets-and-currencies)).

## When Shopify refuses a cost price

If Shopify refuses to store a variant's cost price for checkout, the stricter of its
previous cost price and the ceiling applies until it goes through. The Margin
protection page says so.

Troubleshooting: [../support/products-without-cost-price.md](../support/products-without-cost-price.md).
Default ceiling: [reference/margin-settings](../reference/margin-settings.generated.md).
