---
title: Set up quantity discounts
slug: set-up-quantity-tiers
layer: task
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [set up quantity tiers, quantity discounts, volume discount, buy more save more, tier breaks, quantity break, count mode, nastavit množstevní slevy]
summary: Add quantity breaks to the tier set, choose a percentage or a fixed amount per currency, and pick how quantity is counted.
---

# Set up quantity discounts

1. Open **Discounts → Quantity discounts**.
2. Add a **tier**: from how many items, and the discount — a percentage, or a
   fixed amount off per item in each market's currency. Add more tiers for
   more thresholds. A set is one kind only (every tier a percent, or every
   tier an amount), and each tier must be worth at least as much as the one
   before it; the form will not let you save otherwise.
3. Choose how items are **counted**: each variant separately, or all variants
   of the product together. (With Pro, also across the whole cart.)
4. Save.

## Scoping (Pro)

By default one **global** set applies to every product. With Pro you can add
more sets, each scoped to chosen products or collections; the first matching
set wins over the global one. See
[../concepts/quantity-tiers.md](../concepts/quantity-tiers.md).

## After saving

- Add the table to the product page: see
  [add-tiers-to-the-product-page](add-tiers-to-the-product-page).
- A tier competes with other product discounts on the same item; the better
  one for the customer wins. Margin protection can still lower it.
- Check the result in [try-a-cart](try-a-cart) before relying on it.

## Running out of room

Every tier set you save shares one small storage budget across the whole
shop. With many sets, many tiers per set, or amounts in many currencies, you
can run out of room before hitting the per-set tier limit; if a save would
not fit, the admin says so and nothing is saved.

Background: [../concepts/quantity-tiers.md](../concepts/quantity-tiers.md).
Exact limits: [../reference/limits.generated.md](../reference/limits.generated.md).
