---
title: The quantity-tiers table does not show on the product
slug: tiers-table-not-showing-on-the-product
layer: support
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [table not showing, block missing, quantity tiers not visible, product page, app block, theme editor, tabulka se nezobrazuje]
summary: Why the quantity-tiers block is missing from a product page, in the order to check, from the block not being added to the product having no tiers.
---

# The quantity-tiers table does not show on the product

Check in this order:

## 1. The block is not on the product template

**Quantity tiers** in the admin shows whether the block is on your active
theme's product template. If it says it is not, click **Add table to the
product page**. See
[add-tiers-to-the-product-page](../tasks/add-tiers-to-the-product-page.md).

## 2. You changed or duplicated the theme

The block is added to one theme. Switching to another theme, publishing a
duplicate, or restoring an older theme version does not carry it over; add it
again on the new theme.

## 3. The product has no tier set

The table only renders when a tier set applies to the product. With Pro
scoped sets, a product outside every scoped set's product/collection list,
with no global set either, has none. See
[product-did-not-get-the-global-tiers](product-did-not-get-the-global-tiers.md)
and [../concepts/quantity-tiers.md](../concepts/quantity-tiers.md).

## 4. The change is not synced yet

A tier set just saved can take a short moment to reach the storefront config.
Refresh the product page; if it still does not show after a sync completes,
check the Overview for a sync error. See
[../concepts/saving-and-syncing.md](../concepts/saving-and-syncing.md).

## 5. Shop is on Free and the set is scoped

A product-or-collection-scoped tier set is Pro; on Free it is switched off, not
deleted, so a product it was meant for shows no table unless the global set
also covers it. See [../concepts/plans-free-vs-pro.md](../concepts/plans-free-vs-pro.md).
