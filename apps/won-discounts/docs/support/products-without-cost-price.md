---
title: Products without a cost price
slug: products-without-cost-price
layer: support
feature: margin
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [no cost price, missing cost, cost per item, products without cost price, ceiling, reading cost prices, add cost price, produkty bez nákupní ceny]
summary: What margin protection does with products that have no cost price in Shopify, where to find them, and how to add the cost so Won picks it up.
---

# Products without a cost price

## What happens to them

Margin protection cannot compute a margin without a cost price, so their discount is
capped at **"Products without a cost price: discount at most"**. The same ceiling
protects products whose cost price has not been read yet.

## Where to find them

**Margin protection → Cost prices** shows how many variants have a cost price, how
many products have none, and a list of them with a link to add it in Shopify.

## How to fix it

Add the cost per item in Shopify on the product, in the variant's pricing. Won picks
it up within minutes by itself; once a day all cost prices are checked as well.
**Refresh cost prices** reads them now.

## Common questions

**"Cost prices: not read yet".** They are read only while protection is on. Turn it
on and save; the reading runs in the background and shows its progress.

**The ceiling is higher than my real margin allows.** The ceiling does not know the
cost. A product whose cost is 70 % of its price keeps the full ceiling, which can be
below cost. Add its cost price.

**A product has a cost price, but Won treats it as missing.** In a cart in another
currency the cost price must be converted with Shopify's rate; if that is not
possible, the ceiling applies. If Shopify refused to store a cost price for checkout,
the stricter of the previous cost and the ceiling applies; the page says so.

Background: [../concepts/cost-prices.md](../concepts/cost-prices.md).
