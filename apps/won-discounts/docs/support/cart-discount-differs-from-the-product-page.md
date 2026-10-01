---
title: The discount in the cart is different from the product page
slug: cart-discount-differs-from-the-product-page
layer: support
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [cart discount different, product page price different, quantity tiers, live price, count mode, margin protection, foreign currency, sleva v košíku je jiná]
summary: Why the tier discount shown on the product page differs from the cart, usually the count mode, quantity already in the cart, margin protection, or a market in its own currency.
---

# The discount in the cart is different from the product page

## 1. The product page counts quantity already in the cart

The live price on the product page adds the quantity you are about to add to
whatever is already in the cart that counts toward the same tier (same
variant, same product, or same tier set, depending on the count mode). If the
product page and the cart still disagree, first reproduce both with the same
starting cart in [try-a-cart](../tasks/try-a-cart.md).

## 2. The count mode

Per line, per product or per cart (Pro) all count differently. "Per line"
counts each cart line on its own — the same variant added with different
line properties or a different selling plan is a separate line and does not
add up with it. A quantity split across several lines of the same product
only adds up under "per product" or "per cart". See
[../concepts/quantity-tiers.md](../concepts/quantity-tiers.md).

## 3. Margin protection lowered it, or the market has its own currency

The product page's cap never promises more than checkout's, but it can lag
behind it: in a market with its own currency it converts the price floor
using Shopify's exchange rate, and a variant whose floor is still being
computed shows no discount promise at all rather than a guess. See
[tier-lowered-by-margin-protection](tier-lowered-by-margin-protection.md).

## 4. A product discount beat the tier

A tier competes with other product discounts on the same item; the product
page shows the tier, but a code or automatic discount the shopper adds later
can win instead if it is better. See
[../concepts/combining-discounts.md](../concepts/combining-discounts.md).

## 5. The tier set is not synced yet

A tier set just changed can take a short moment to reach the storefront block
and the checkout function separately; they read the same source but not at the
exact same instant. See [../concepts/saving-and-syncing.md](../concepts/saving-and-syncing.md).

For a checkout difference that is not about quantity tiers, see
[checkout-discount-differs](checkout-discount-differs.md).
