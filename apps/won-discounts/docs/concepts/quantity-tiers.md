---
title: Quantity discounts
slug: quantity-tiers
layer: concept
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-10-01
keywords: [quantity discounts, quantity tiers, volume discount, buy more save more, tier set, tier break, product page table, qty breaks, count mode, množstevní slevy, úrovně]
summary: Quantity discounts give a lower price per item from a chosen quantity up. One tier set applies per product; the better of a tier and a product discount wins.
---

# Quantity discounts

**Quantity discounts** ("Quantity discounts" in the admin's navigation) are
Won's "buy more, save more" module: from a chosen quantity, each item costs
less. Internally, and in this doc, each price step is called a **tier**; a
**tier set** is its list of **breaks** — `from 3 → −10 %`, `from 5 → −15 %`.

A tier set is **one kind only**: every break is a percentage, or every break
is a fixed amount per item in each market's currency — never mixed within one
set. Values never fall as quantity goes up: a later, higher break is always
worth at least as much as an earlier one. The admin's form enforces both, so a
set is never saved in a shape that could let the Free quantity-counting limits
([below](#how-the-quantity-is-counted)) accidentally give a customer more than
a stricter Pro counting would.

## Which tier set applies to a product

A product gets **exactly one** tier set, decided in this order:

1. the first set (in the order you saved them) whose product list includes the
   product;
2. otherwise, the first set whose collection list includes one of the
   product's collections;
3. otherwise, the one global set;
4. otherwise the product has no quantity tiers.

Product- and collection-scoped sets are Pro. On Free there is only the one
global set, so every product either uses it or (if you removed it) has none.
This is deliberate: the product page shows one table, and a product can be
given lower tiers than the global set, or none at all, by scoping it out.

**Downgrading from Pro:** scoped sets are **not deleted**, only switched off,
so a product never falls back into the global set and ends up with a bigger
discount than you set up. See [plans-free-vs-pro](plans-free-vs-pro).

## How the quantity is counted

Each tier set counts quantity one of three ways:

- **Each variant separately** ("line") — only the one cart line it merges
  into: the same variant, with no line properties and no selling plan, added
  again stays the same line and keeps counting; the same variant with
  different properties or a different subscription is a separate line and
  does **not** add up with it.
- **All variants of a product together** ("product") — every line of the same
  product, added up.
- **The whole cart** ("cart", Pro) — every line whose product uses this same
  tier set, added up across the whole cart.

Lines that cannot earn a discount at all (a clearance line not switched on
for discounts, a free-gift line) are never counted. The break used is the
highest quantity threshold at or below the count.

## Tiers vs. other discounts

A tier competes with product discounts on the same item exactly like two
product discounts compete with each other: **the better one for the customer
wins**, they never add up. See [combining-discounts](combining-discounts). A
tier is never part of a Pro stack.

A clearance item only gets a tier when **Clearance with other discounts** is
switched on in Settings; off (the default while clearance isn't built), it
never does. Gift lines never get a tier. See
[switch-combination-categories](../tasks/switch-combination-categories.md).

## Margin protection

Margin protection can lower a tier's discount the same way it lowers any other
product discount — never below the price floor you set. See
[margin-protection](margin-protection).

The product page shows that lowered value too, computed the same way as
checkout — but **never more than checkout promises, sometimes a little less**
while it catches up: in a market with its own currency the floor is converted
using Shopify's exchange rate, and a variant whose floor is not known yet
shows no discount promise rather than a guess. See
[../support/tier-lowered-by-margin-protection.md](../support/tier-lowered-by-margin-protection.md).

## Free and Pro

| | Free | Pro |
|---|---|---|
| Tier sets | 1, global | Several, scoped to chosen products or collections |
| Counting | Per variant or per product | + per cart |

Every tier set, together, also shares one small storage budget, so very many
sets with many breaks and currencies can run out of room before hitting the
set or break count limits above; the admin says so when it would not fit.
Exact limits: [reference/limits](../reference/limits.generated.md).

## Markets and currencies

A fixed amount per item has its own value in each market's currency, never
converted by exchange rate. A break with no value for the cart's currency does
not apply in that currency; see [markets-and-currencies](markets-and-currencies).

## On the product page

The quantity-tiers table is a theme app block, added to the product page with
one click from the admin. It shows the current variant's tiers and a live
price that updates as the shopper changes the quantity, counting quantity the
same way the engine does (including quantity already in the cart). See
[../tasks/set-up-quantity-tiers.md](../tasks/set-up-quantity-tiers.md) and
[../tasks/add-tiers-to-the-product-page.md](../tasks/add-tiers-to-the-product-page.md).
