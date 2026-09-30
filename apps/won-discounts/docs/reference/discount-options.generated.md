---
title: Discount options
slug: discount-options
layer: reference
feature: discounts
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [discount type, percentage, fixed amount, free shipping, code, automatic, recipe, minimum]
summary: Every discount type, target, way of applying and minimum option in Discounts & codes, plus what each recipe pre-fills.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Discount options

The options of a discount in **Discounts & codes** (Slevy a kódy), with the
admin's English and Czech wording.

## Discount type

| EN | CS | Key |
|---|---|---|
| Percentage | Procenta | `percentage` |
| Fixed amount | Pevná částka | `fixed` |
| Free shipping | Doprava zdarma | `freeShipping` |

## Applies to

| EN | CS | Key |
|---|---|---|
| Whole order | Celá objednávka | `order` |
| Products | Produkty | `products` |
| Collections | Kolekce | `collections` |
| Shipping | Doprava | `shipping` |

Free shipping always applies to shipping.

## Applies

| EN | CS | Key |
|---|---|---|
| Automatically | Automaticky | `automatic` |
| With a code | Kódem | `code` |

## The minimum counts

| EN | CS | Key |
|---|---|---|
| the whole cart | z celého košíku | `cart` |
| the selected products | z vybraných produktů | `entitled` |

A new discount counts its minimum on the whole cart. A discount moved from
Shopify keeps Shopify's rule: the minimum counts only the selected products.

## Recipes

What each recipe pre-fills. Amounts are suggested only for the currencies
listed; any other currency starts empty, so the discount is not offered there
until you fill it in.

| Recipe | Pre-filled |
|---|---|
| % off everything (Automatic discount on the whole order) | Percentage 10 % · Applies to: Whole order · Automatically |
| Amount off the order (A fixed amount per currency, above a minimum spend) | Fixed amount 100.00 CZK, 4.00 EUR, 4.00 GBP, 20.00 PLN, 5.00 USD · Applies to: Whole order · Automatically · Minimum order: 1000.00 CZK, 40.00 EUR, 40.00 GBP, 200.00 PLN, 50.00 USD |
| Free shipping (Above an amount you set per market) | Free shipping · Applies to: Shipping · Automatically · Minimum order: 1500.00 CZK, 60.00 EUR, 60.00 GBP, 300.00 PLN, 75.00 USD |
| Welcome code (A newsletter code, once per customer) | Percentage 10 % · Applies to: Whole order · With a code: WELCOME10 · Once per customer |
| Blank discount | Percentage 10 % · Applies to: Whole order · Automatically |
