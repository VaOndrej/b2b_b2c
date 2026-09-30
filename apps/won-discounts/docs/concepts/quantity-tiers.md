---
title: Quantity tiers
slug: quantity-tiers
layer: concept
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [quantity tiers, volume discount, buy more save more, tier set, tier break, product page table, qty breaks, count mode, množstevní slevy, úrovně]
summary: Quantity tiers give a lower price per item from a chosen quantity up. One tier set applies per product; the better of a tier and a product discount wins.
---

# Quantity tiers

Quantity tiers are Won's "buy more, save more" module: from a chosen quantity,
each item in the tier costs less. A tier set is a list of **breaks** — `from 3
→ −10 %`, `from 5 → −15 %` — either a percentage or a fixed amount off per
item, in each market's currency.

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

- **Per line** — only that cart line's quantity.
- **Per product** — every line of the same product, added up.
- **Per cart** (Pro) — every line whose product uses this same tier set, added
  up across the whole cart.

Lines that cannot earn a discount at all (a clearance line, a free-gift line)
are never counted. The break used is the highest quantity threshold at or
below the count.

## Tiers vs. other discounts

A tier competes with product discounts on the same item exactly like two
product discounts compete with each other: **the better one for the customer
wins**, they never add up. See [combining-discounts](combining-discounts). A
tier is never part of a Pro stack.

## Margin protection

Margin protection can lower a tier's discount the same way it lowers any other
product discount — never below the price floor you set. See
[margin-protection](margin-protection).

## Free and Pro

| | Free | Pro |
|---|---|---|
| Tier sets | 1, global | Several, scoped to chosen products or collections |
| Counting | Per line or per product | + per cart |

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
