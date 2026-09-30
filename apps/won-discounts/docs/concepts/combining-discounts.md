---
title: How Won discounts combine
slug: combining-discounts
layer: concept
feature: engine
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [combine, combination, stack, add up, better wins, two discounts, product discount, order discount, shipping, kombinace]
summary: The default combining rules. Product discounts on the same item compete (the better one wins); product, order and shipping discounts add up.
---

# How Won discounts combine

## The default rules

- **Product discount vs. product discount on the same item:** they do not add up.
  The one that saves the customer more wins. On an exact tie a fixed internal order
  decides, so the result is always the same.
- **Product + order + shipping:** they add up. The order discount is taken from the
  subtotal **after** product discounts.
- **Order discount vs. order discount:** they do not add up; the better one wins.
- **Shipping:** one shipping discount applies. A percentage (free shipping counts as
  100 %) ranks above a fixed amount, the larger first.

The same rules decide between automatic discounts and codes. A code that loses to a
better automatic discount on every item gives nothing, and Shopify then shows it as
not applicable. See [../support/code-not-applied.md](../support/code-not-applied.md).

## One product discount per item

Outside Shopify Plus, checkout applies one product discount per cart line. Won picks
that one for you by the rules above.

## Changing the defaults

- **Free:** Settings lets you switch each category above between adding up and
  competing, store-wide. See
  [../tasks/switch-combination-categories.md](../tasks/switch-combination-categories.md).
- **Pro:** a discount can be set to stack with chosen other discounts. See
  [pro-combinations](pro-combinations).

Exact table, generated from the code:
[reference/combination-defaults](../reference/combination-defaults.generated.md).
