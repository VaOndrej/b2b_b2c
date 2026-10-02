---
title: Limits
slug: limits
layer: reference
feature: core
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [limit, maximum, how many, codes, code discounts, 25, size, too many discounts]
summary: Exact limits of Won Discounts — discounts per shop, active code discounts, codes, stacking, margin collections and settings size.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Limits

## Discounts and codes

| What | Limit |
|---|---|
| Discounts in one shop | 200 |
| Active code discounts at the same time | 20 |
| Codes in one code discount | 1,000 |
| Length of one code (Shopify itself allows 255; a Shopify discount with a longer code stays in Shopify) | 64 characters |
| Products, variants or collections picked in one discount | 250 each |
| Discounts stacked on one line or on the order (Pro) | 6 |
| Codes a customer enters that are counted (the first ones entered; later codes are not counted) | 25 |
| Spaces a customer types around a code that still count (a code entered with more does not apply) | 16 characters |

**Why the code-discount limit:** every active code discount is its own Shopify
discount, and Shopify runs at most 25 discount
functions per store (other apps' discounts count too). All automatic Won
discounts run in one. A scheduled code discount counts as active. To offer more
codes, add them to an existing code discount.

## Margin protection

| What | Limit |
|---|---|
| Minimum margin | 0–95 % |
| Ceiling for products without a cost price | 0–100 % |
| Collections with their own margin setting (Pro) | 50 |

## Settings size

| What | Limit |
|---|---|
| Discount settings the checkout function reads | 9,000 bytes (Shopify's hard limit is 10,000) |
| All saved app settings | 256 KiB |

A save that would go over either limit is refused with an explanation; nothing
is saved. Fewer discounts, fewer codes or fewer collections with their own
margin setting make room.

## Quantity tiers

| What | Limit |
|---|---|
| Quantity tier sets (Pro; Free has one global set) | 50 |
| Quantity breaks in one tier set | 10 |
| Ways to count quantity | 3 (`line`, `product`, `cart`; `cart` is Pro) |
| Combined size of every tier set (checkout reads a compact copy) | 550 bytes |

All tier sets together share that last, much smaller budget, so many sets with
many breaks and several currencies can run out of room well before the set or
break counts above. A save that would not fit is refused with the byte count
and the budget; nothing is saved.

## Clearance (Pro)

| What | Limit |
|---|---|
| Clearance discount | 1–90 %, whole percent |
| Quota (pieces to sell) | 1–100,000 |
| Sales not ended at once, per store | 500 |
| Sales not ended per variant | 1 |
| Market price lists one sale changes | 10 |

## Block appearances

4 presets for the quantity-tiers product-page block:
`default`, `highlight`, `chips`, `tiles`. An unrecognised value falls back to
`default`.
