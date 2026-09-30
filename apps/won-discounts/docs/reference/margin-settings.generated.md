---
title: Margin protection settings
slug: margin-settings
layer: reference
feature: margin
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [margin, minimum margin, cost price, floor, ceiling, default, ochrana marže, nákupní cena]
summary: Margin protection defaults, accepted values, the floor formula and a worked example computed by the engine.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Margin protection settings

| Setting | Default | Accepted values |
|---|---|---|
| Turn on margin protection | off | on / off |
| Minimum margin | empty (= never below the cost price) | 0–95 %, one decimal, rounded up |
| Products without a cost price: discount at most | 50 % | 0–100 %, one decimal, rounded down |
| Settings per collection (Pro) | none | up to 100 collections |

Rounding always goes the stricter way, so a saved value never allows a larger
discount than the one typed.

## The floor of one item

- **With a cost price:** lowest price = cost price ÷ (1 − minimum margin).
- **Without a cost price** (or not read yet): lowest price = price × (1 − ceiling).

## Worked example

A product at 100.00 USD with a cost price of 60.00 USD, minimum margin 20 %:
the lowest price is **75.00 USD**, so a Won discount can take off at most
25.00 USD.

The same product without a cost price and the default 50 % ceiling:
the lowest price is **50.00 USD**, a discount of at most 50.00 USD.
